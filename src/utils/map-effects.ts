import * as fs from 'fs';
import * as path from 'path';
import { decodeTextFile } from './text';

export interface PermanentMapEffectDefinition {
  mapName: string;
  x: number;
  y: number;
  wilIndex: number;
  startImage: number;
  frameCount: number;
  playCount: -1;
  speedMs: number;
  drawMode: 0;
  brightness: number;
  visibility: 0;
  effectId: number;
  sourceFile: string;
  lineNumber: number;
}

export type MapEffectScanDiagnosticCode =
  | 'envir-not-found'
  | 'entry-not-found'
  | 'file-read-failed'
  | 'unsupported-encoding'
  | 'file-outside-envir'
  | 'file-budget-exceeded'
  | 'byte-budget-exceeded'
  | 'depth-budget-exceeded'
  | 'call-budget-exceeded'
  | 'effect-budget-exceeded'
  | 'label-not-found'
  | 'duplicate-label'
  | 'malformed-label-block'
  | 'conditional-block'
  | 'else-block'
  | 'orphan-act'
  | 'unsupported-control-flow'
  | 'conditional-call'
  | 'dynamic-call'
  | 'unsupported-call'
  | 'call-target-not-found'
  | 'call-outside-envir'
  | 'call-cycle'
  | 'duplicate-call'
  | 'commented-mapeffect'
  | 'prefixed-mapeffect'
  | 'outside-act-mapeffect'
  | 'conditional-mapeffect'
  | 'invalid-arity'
  | 'dynamic-map-name'
  | 'nonliteral-core'
  | 'invalid-core-range'
  | 'finite-play-count'
  | 'unsupported-draw-mode'
  | 'noncanonical-tail'
  | 'invalid-tail-range'
  | 'unsupported-brightness'
  | 'non-global-visibility'
  | 'delete-after-create-unsupported';

export interface MapEffectScanDiagnostic {
  code: MapEffectScanDiagnosticCode;
  message: string;
  filePath?: string;
  lineNumber?: number;
  source?: string;
}

export interface MapEffectScanLimits {
  /** Maximum #CALL nesting below the QManage [@Startup] entry block. */
  maxDepth: number;
  /** Maximum number of unique script files decoded during one scan. */
  maxFiles: number;
  /** Maximum combined byte length of unique script files decoded during one scan. */
  maxTotalBytes: number;
  /** Maximum number of accepted definitions before the scan fails closed. */
  maxEffects: number;
  /** Maximum number of strict static #CALL directives followed during one scan. */
  maxCalls: number;
}

export const DEFAULT_MAP_EFFECT_SCAN_LIMITS: Readonly<MapEffectScanLimits> = Object.freeze({
  maxDepth: 8,
  maxFiles: 64,
  maxTotalBytes: 2 * 1024 * 1024,
  maxEffects: 4096,
  maxCalls: 4096,
});

export interface PermanentMapEffectScanResult {
  definitions: PermanentMapEffectDefinition[];
  diagnostics: MapEffectScanDiagnostic[];
  diagnosticCounts: Partial<Record<MapEffectScanDiagnosticCode, number>>;
  scannedFiles: string[];
  totalBytes: number;
  skippedDefinitionCount: number;
  /** True when a configured safety budget prevented the complete static scan. */
  truncated: boolean;
}

interface DecodedScript {
  filePath: string;
  lines: string[];
  labelLines: Map<string, number[]>;
  sectionEndByHeader: Map<number, number>;
}

interface LabelRange {
  start: number;
  end: number;
}

interface ScanContext {
  envirPath: string;
  envirRealPath: string;
  questDiaryPath: string;
  questDiaryRealPath?: string;
  limits: MapEffectScanLimits;
  definitions: PermanentMapEffectDefinition[];
  diagnostics: MapEffectScanDiagnostic[];
  diagnosticCounts: Partial<Record<MapEffectScanDiagnosticCode, number>>;
  scannedFiles: string[];
  totalBytes: number;
  staticCallCount: number;
  skippedDefinitionCount: number;
  truncated: boolean;
  halted: boolean;
  fileCache: Map<string, DecodedScript>;
  activeBlocks: Set<string>;
  completedBlocks: Set<string>;
}

interface FlowState {
  phase: 'outside' | 'conditions' | 'act';
  pendingIfLine?: number;
  pendingIfHasExpression: boolean;
  actionUnconditional: boolean;
}

interface CallResolution {
  filePath?: string;
  diagnosticCode?: 'dynamic-call' | 'call-target-not-found' | 'call-outside-envir';
  message?: string;
}

const LABEL_PATTERN = /^\[@([^\]]+)\]$/i;
const BRACKET_HEADER_PATTERN = /^\[[^\]]+\]$/;
const INTEGER_PATTERN = /^-?\d+$/;
const DYNAMIC_PATTERN = /[<>{}%$]/;
const MAX_MAP_COORDINATE = 65_535;
const MAX_WIL_INDEX = 65_535;
const MAX_START_IMAGE = 10_000_000;
const MAX_FRAME_COUNT = 1_024;
const MIN_SPEED_MS = 16;
const MAX_SPEED_MS = 60_000;

function normalizePathKey(filePath: string): string {
  const resolved = path.resolve(filePath).replace(/\//g, '\\');
  return process.platform === 'win32' ? resolved.toLocaleLowerCase() : resolved;
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === ''
    || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function stripInlineComment(line: string): string {
  const commentIndex = line.indexOf(';');
  return (commentIndex >= 0 ? line.slice(0, commentIndex) : line).trim();
}

function normalizeLabel(label: string): string {
  return label.trim().replace(/^@/, '').toLocaleLowerCase();
}

function normalizedLimits(overrides?: Partial<MapEffectScanLimits>): MapEffectScanLimits {
  const integerLimit = (value: number | undefined, fallback: number): number => {
    if (!Number.isFinite(value)) return fallback;
    return Math.max(0, Math.floor(value!));
  };
  return {
    maxDepth: integerLimit(overrides?.maxDepth, DEFAULT_MAP_EFFECT_SCAN_LIMITS.maxDepth),
    maxFiles: integerLimit(overrides?.maxFiles, DEFAULT_MAP_EFFECT_SCAN_LIMITS.maxFiles),
    maxTotalBytes: integerLimit(
      overrides?.maxTotalBytes,
      DEFAULT_MAP_EFFECT_SCAN_LIMITS.maxTotalBytes
    ),
    maxEffects: integerLimit(overrides?.maxEffects, DEFAULT_MAP_EFFECT_SCAN_LIMITS.maxEffects),
    maxCalls: integerLimit(overrides?.maxCalls, DEFAULT_MAP_EFFECT_SCAN_LIMITS.maxCalls),
  };
}

function indexScriptSections(lines: string[]): Pick<DecodedScript, 'labelLines' | 'sectionEndByHeader'> {
  const labelLines = new Map<string, number[]>();
  const headerLines: number[] = [];
  for (let index = 0; index < lines.length; index++) {
    const code = stripInlineComment(lines[index]);
    if (BRACKET_HEADER_PATTERN.test(code)) headerLines.push(index);
    const match = code.match(LABEL_PATTERN);
    if (!match) continue;
    const key = normalizeLabel(match[1]);
    const matches = labelLines.get(key);
    if (matches) matches.push(index);
    else labelLines.set(key, [index]);
  }

  const sectionEndByHeader = new Map<number, number>();
  for (let index = 0; index < headerLines.length; index++) {
    sectionEndByHeader.set(headerLines[index], headerLines[index + 1] ?? lines.length);
  }
  return { labelLines, sectionEndByHeader };
}

function addDiagnostic(
  context: ScanContext,
  code: MapEffectScanDiagnosticCode,
  message: string,
  filePath?: string,
  lineNumber?: number,
  source?: string
): void {
  context.diagnostics.push({ code, message, filePath, lineNumber, source });
  context.diagnosticCounts[code] = (context.diagnosticCounts[code] || 0) + 1;
}

function addSkippedDefinitionDiagnostic(
  context: ScanContext,
  code: MapEffectScanDiagnosticCode,
  message: string,
  filePath: string,
  lineNumber: number,
  source: string
): void {
  context.skippedDefinitionCount++;
  addDiagnostic(context, code, message, filePath, lineNumber, source);
}

function readScript(context: ScanContext, filePath: string): DecodedScript | undefined {
  let realPath: string;
  try {
    realPath = fs.realpathSync(filePath);
  } catch (error) {
    addDiagnostic(
      context,
      'file-read-failed',
      `脚本文件无法读取：${error instanceof Error ? error.message : String(error)}`,
      filePath
    );
    return undefined;
  }

  if (!isPathInside(context.envirRealPath, realPath)) {
    addDiagnostic(context, 'file-outside-envir', '脚本真实路径位于 Envir 之外', realPath);
    return undefined;
  }

  const key = normalizePathKey(realPath);
  const cached = context.fileCache.get(key);
  if (cached) return cached;

  if (context.scannedFiles.length >= context.limits.maxFiles) {
    context.truncated = true;
    addDiagnostic(
      context,
      'file-budget-exceeded',
      `脚本文件数超过扫描上限 ${context.limits.maxFiles}`,
      realPath
    );
    return undefined;
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(realPath);
  } catch (error) {
    addDiagnostic(
      context,
      'file-read-failed',
      `脚本状态无法读取：${error instanceof Error ? error.message : String(error)}`,
      realPath
    );
    return undefined;
  }
  if (!stat.isFile()) {
    addDiagnostic(context, 'file-read-failed', '目标不是普通脚本文件', realPath);
    return undefined;
  }
  if (context.totalBytes + stat.size > context.limits.maxTotalBytes) {
    context.truncated = true;
    addDiagnostic(
      context,
      'byte-budget-exceeded',
      `脚本总字节数超过扫描上限 ${context.limits.maxTotalBytes}`,
      realPath
    );
    return undefined;
  }

  try {
    const raw = fs.readFileSync(realPath);
    if (context.totalBytes + raw.byteLength > context.limits.maxTotalBytes) {
      context.truncated = true;
      addDiagnostic(
        context,
        'byte-budget-exceeded',
        `脚本总字节数超过扫描上限 ${context.limits.maxTotalBytes}`,
        realPath
      );
      return undefined;
    }
    if (
      (raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe)
      || (raw.length >= 2 && raw[0] === 0xfe && raw[1] === 0xff)
    ) {
      addDiagnostic(
        context,
        'unsupported-encoding',
        '不支持 UTF-16/UTF-32 启动脚本，已拒绝静态扫描',
        realPath
      );
      return undefined;
    }
    const lines = decodeTextFile(raw).text.split(/\r\n|\n|\r/);
    const script: DecodedScript = {
      filePath: realPath,
      lines,
      ...indexScriptSections(lines),
    };
    context.fileCache.set(key, script);
    context.scannedFiles.push(realPath);
    context.totalBytes += raw.byteLength;
    return script;
  } catch (error) {
    addDiagnostic(
      context,
      'file-read-failed',
      `脚本解码失败：${error instanceof Error ? error.message : String(error)}`,
      realPath
    );
    return undefined;
  }
}

function findLabelRange(
  context: ScanContext,
  script: DecodedScript,
  label: string
): LabelRange | undefined {
  const expected = normalizeLabel(label);
  const labelLines = script.labelLines.get(expected) || [];

  if (labelLines.length === 0) {
    addDiagnostic(
      context,
      'label-not-found',
      `脚本标签 [@${label.replace(/^@/, '')}] 不存在`,
      script.filePath
    );
    return undefined;
  }
  if (labelLines.length > 1) {
    addDiagnostic(
      context,
      'duplicate-label',
      `脚本标签 [@${label.replace(/^@/, '')}] 出现 ${labelLines.length} 次，无法确定入口`,
      script.filePath,
      labelLines[0] + 1
    );
    return undefined;
  }

  const labelLine = labelLines[0];
  // Any bracket section is a hard script-block boundary. This prevents an unknown
  // section form from being swept into the requested label merely because it is not [@...].
  const nextHeader = script.sectionEndByHeader.get(labelLine) ?? script.lines.length;
  let firstContent = labelLine + 1;
  while (firstContent < nextHeader) {
    const code = stripInlineComment(script.lines[firstContent]);
    if (code) break;
    firstContent++;
  }

  if (firstContent < nextHeader && stripInlineComment(script.lines[firstContent]) === '{') {
    let depth = 1;
    for (let index = firstContent + 1; index < nextHeader; index++) {
      const code = stripInlineComment(script.lines[index]);
      if (code === '{') depth++;
      if (code !== '}') continue;
      depth--;
      if (depth === 0) return { start: firstContent + 1, end: index };
    }
    addDiagnostic(
      context,
      'malformed-label-block',
      `脚本标签 [@${label.replace(/^@/, '')}] 的花括号未闭合`,
      script.filePath,
      firstContent + 1
    );
    return undefined;
  }

  for (let index = firstContent; index < nextHeader; index++) {
    if (stripInlineComment(script.lines[index]) !== '}') continue;
    // Some historical scripts omit the opening wrapper at the selected label but
    // still leave its closing brace. Treat it as a hard boundary, never as content.
    return { start: labelLine + 1, end: index };
  }
  return { start: labelLine + 1, end: nextHeader };
}

function hasDynamicValue(value: string): boolean {
  return DYNAMIC_PATTERN.test(value);
}

function resolveStaticCallPath(
  context: ScanContext,
  sourceFile: string,
  reference: string
): CallResolution {
  const trimmed = reference.trim().replace(/^['"]|['"]$/g, '');
  if (!trimmed || hasDynamicValue(trimmed) || /[*?\0]/.test(trimmed)) {
    return { diagnosticCode: 'dynamic-call', message: '调用路径不是静态字面量' };
  }
  if (/^[a-z]:/i.test(trimmed) || /^[\\/]{2,}/.test(trimmed) || trimmed.includes(':')) {
    return { diagnosticCode: 'call-outside-envir', message: '调用路径使用绝对路径或设备路径' };
  }

  let normalized = trimmed.replace(/\\/g, '/');
  let base = path.dirname(sourceFile);
  let lexicalRoot = context.envirPath;
  let realRoot = context.envirRealPath;
  let questDiaryScoped = false;
  if (/^[\\/]/.test(trimmed)) {
    base = context.questDiaryPath;
    lexicalRoot = context.questDiaryPath;
    questDiaryScoped = true;
    if (!context.questDiaryRealPath) {
      return {
        diagnosticCode: 'call-target-not-found',
        message: '未找到可信的 Envir/QuestDiary 目录',
      };
    }
    realRoot = context.questDiaryRealPath;
    normalized = normalized.replace(/^\/+/, '');
  } else if (/^Envir\//i.test(normalized)) {
    base = context.envirPath;
    normalized = normalized.replace(/^Envir\//i, '');
  } else if (/^QuestDiary\//i.test(normalized)) {
    base = context.envirPath;
    lexicalRoot = context.questDiaryPath;
    questDiaryScoped = true;
    if (!context.questDiaryRealPath) {
      return {
        diagnosticCode: 'call-target-not-found',
        message: '未找到可信的 Envir/QuestDiary 目录',
      };
    }
    realRoot = context.questDiaryRealPath;
  } else if (
    context.questDiaryRealPath
    && isPathInside(context.questDiaryRealPath, sourceFile)
  ) {
    // A plain relative call made by a QuestDiary script remains in that same
    // trusted tree; it may not silently fall back into MapQuest_Def or bare Envir.
    lexicalRoot = context.questDiaryRealPath;
    realRoot = context.questDiaryRealPath;
    questDiaryScoped = true;
  }

  if (normalized.split('/').some(segment => segment === '..')) {
    return { diagnosticCode: 'call-outside-envir', message: '#CALL 路径不允许包含 .. 段' };
  }

  if (!path.posix.extname(normalized)) normalized += '.txt';
  if (path.posix.extname(normalized).toLocaleLowerCase() !== '.txt') {
    return { diagnosticCode: 'dynamic-call', message: '静态 #CALL 仅扫描 .txt 脚本' };
  }

  const segments = normalized.split('/').filter(segment => segment.length > 0 && segment !== '.');
  const candidate = path.resolve(base, ...segments);
  if (!isPathInside(lexicalRoot, candidate)) {
    return {
      diagnosticCode: 'call-outside-envir',
      message: questDiaryScoped
        ? '调用路径试图离开 QuestDiary'
        : '调用路径试图离开 Envir',
    };
  }
  if (!fs.existsSync(candidate)) {
    return { diagnosticCode: 'call-target-not-found', message: '调用目标文件不存在' };
  }

  let realPath: string;
  try {
    realPath = fs.realpathSync(candidate);
  } catch (error) {
    return {
      diagnosticCode: 'call-target-not-found',
      message: `调用目标无法解析：${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!isPathInside(realRoot, realPath)) {
    return {
      diagnosticCode: 'call-outside-envir',
      message: questDiaryScoped
        ? '调用目标真实路径位于 QuestDiary 之外'
        : '调用目标真实路径位于 Envir 之外',
    };
  }
  return { filePath: realPath };
}

function parseSafeInteger(value: string): number | undefined {
  if (!INTEGER_PATTERN.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function parseMapEffect(
  context: ScanContext,
  script: DecodedScript,
  lineNumber: number,
  source: string
): void {
  const tokens = source.trim().split(/\s+/);
  const args = tokens.slice(1);
  if (args.length !== 10) {
    const looksLikeWhitespaceTail = args.length === 12
      && args.slice(9).every(value => INTEGER_PATTERN.test(value));
    addSkippedDefinitionDiagnostic(
      context,
      looksLikeWhitespaceTail ? 'noncanonical-tail' : 'invalid-arity',
      looksLikeWhitespaceTail
        ? 'MAPEFFECT 使用空格分隔尾参数，未按 GOM canonical 管道格式解释'
        : `MAPEFFECT 参数数量应为 10，实际为 ${args.length}`,
      script.filePath,
      lineNumber,
      source
    );
    return;
  }

  const mapName = args[0];
  if (!mapName || hasDynamicValue(mapName)) {
    addSkippedDefinitionDiagnostic(
      context,
      'dynamic-map-name',
      'MAPEFFECT 地图名包含动态占位符',
      script.filePath,
      lineNumber,
      source
    );
    return;
  }

  const coreValues = args.slice(1, 9).map(parseSafeInteger);
  if (coreValues.some(value => value === undefined)) {
    addSkippedDefinitionDiagnostic(
      context,
      'nonliteral-core',
      'MAPEFFECT 核心参数必须全部是安全整数字面量',
      script.filePath,
      lineNumber,
      source
    );
    return;
  }
  const [x, y, wilIndex, startImage, frameCount, playCount, speedMs, drawMode] = coreValues as number[];

  if (playCount !== -1) {
    addSkippedDefinitionDiagnostic(
      context,
      'finite-play-count',
      'MAPEFFECT 播放次数不是 -1，不属于永久效果',
      script.filePath,
      lineNumber,
      source
    );
    return;
  }
  if (drawMode !== 0) {
    addSkippedDefinitionDiagnostic(
      context,
      'unsupported-draw-mode',
      `MAPEFFECT drawMode=${drawMode} 尚未通过 GOM 像素等价验证`,
      script.filePath,
      lineNumber,
      source
    );
    return;
  }
  if (
    x < 0
    || x > MAX_MAP_COORDINATE
    || y < 0
    || y > MAX_MAP_COORDINATE
    || wilIndex < 0
    || wilIndex > MAX_WIL_INDEX
    || startImage < 0
    || startImage > MAX_START_IMAGE
    || frameCount <= 0
    || frameCount > MAX_FRAME_COUNT
    || !Number.isSafeInteger(startImage + frameCount - 1)
    || speedMs < MIN_SPEED_MS
    || speedMs > MAX_SPEED_MS
  ) {
    addSkippedDefinitionDiagnostic(
      context,
      'invalid-core-range',
      `MAPEFFECT 坐标、资源、帧数或速度超出静态预览安全范围（帧数 1-${MAX_FRAME_COUNT}，速度 ${MIN_SPEED_MS}-${MAX_SPEED_MS}ms）`,
      script.filePath,
      lineNumber,
      source
    );
    return;
  }

  const tailMatch = args[9].match(/^(-?\d+)\|(-?\d+)\|(-?\d+)$/);
  if (!tailMatch) {
    addSkippedDefinitionDiagnostic(
      context,
      'noncanonical-tail',
      'MAPEFFECT 尾参数不是 brightness|visibility|effectId canonical 格式',
      script.filePath,
      lineNumber,
      source
    );
    return;
  }
  const brightness = parseSafeInteger(tailMatch[1]);
  const visibility = parseSafeInteger(tailMatch[2]);
  const effectId = parseSafeInteger(tailMatch[3]);
  if (
    brightness === undefined
    || visibility === undefined
    || effectId === undefined
    || brightness < 0
    || brightness > 5
    || visibility < 0
    || visibility > 4
    || effectId < 0
  ) {
    addSkippedDefinitionDiagnostic(
      context,
      'invalid-tail-range',
      'MAPEFFECT 亮度、可见范围或特效 ID 超出 canonical 范围',
      script.filePath,
      lineNumber,
      source
    );
    return;
  }
  if (visibility !== 0) {
    addSkippedDefinitionDiagnostic(
      context,
      'non-global-visibility',
      `MAPEFFECT visibility=${visibility} 依赖触发人物上下文`,
      script.filePath,
      lineNumber,
      source
    );
    return;
  }
  if (brightness !== 0) {
    addSkippedDefinitionDiagnostic(
      context,
      'unsupported-brightness',
      `MAPEFFECT brightness=${brightness} 尚未通过原始地图像素等价验证`,
      script.filePath,
      lineNumber,
      source
    );
    return;
  }

  if (context.definitions.length >= context.limits.maxEffects) {
    context.truncated = true;
    context.halted = true;
    addSkippedDefinitionDiagnostic(
      context,
      'effect-budget-exceeded',
      `永久 MAPEFFECT 数量超过扫描上限 ${context.limits.maxEffects}`,
      script.filePath,
      lineNumber,
      source
    );
    return;
  }

  context.definitions.push({
    mapName,
    x,
    y,
    wilIndex,
    startImage,
    frameCount,
    playCount: -1,
    speedMs,
    drawMode: 0,
    brightness,
    visibility: 0,
    effectId,
    sourceFile: script.filePath,
    lineNumber,
  });
}

function scanLabelBlock(
  context: ScanContext,
  filePath: string,
  label: string,
  depth: number,
  callSite?: { filePath: string; lineNumber: number; source: string }
): void {
  if (context.halted) return;
  if (depth > context.limits.maxDepth) {
    context.truncated = true;
    addDiagnostic(
      context,
      'depth-budget-exceeded',
      `#CALL 深度超过扫描上限 ${context.limits.maxDepth}`,
      callSite?.filePath || filePath,
      callSite?.lineNumber,
      callSite?.source
    );
    return;
  }

  const script = readScript(context, filePath);
  if (!script) return;
  const blockKey = `${normalizePathKey(script.filePath)}\u0000${normalizeLabel(label)}`;
  if (context.activeBlocks.has(blockKey)) {
    addDiagnostic(
      context,
      'call-cycle',
      `检测到循环 #CALL：[${label}]`,
      callSite?.filePath || script.filePath,
      callSite?.lineNumber,
      callSite?.source
    );
    return;
  }
  if (context.completedBlocks.has(blockKey)) {
    addDiagnostic(
      context,
      'duplicate-call',
      `重复静态 #CALL 已去重：[${label}]`,
      callSite?.filePath || script.filePath,
      callSite?.lineNumber,
      callSite?.source
    );
    return;
  }

  const range = findLabelRange(context, script, label);
  if (!range) return;
  context.activeBlocks.add(blockKey);

  const flow: FlowState = {
    phase: 'outside',
    pendingIfHasExpression: false,
    actionUnconditional: false,
  };

  try {
    for (let index = range.start; index < range.end; index++) {
      if (context.halted) break;
      const rawLine = script.lines[index];
      const lineNumber = index + 1;
      const trimmed = rawLine.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith(';') || trimmed.startsWith('//')) {
        if (/\bMAPEFFECT\b/i.test(trimmed)) {
          addSkippedDefinitionDiagnostic(
            context,
            'commented-mapeffect',
            '注释中的 MAPEFFECT 不会执行',
            script.filePath,
            lineNumber,
            trimmed
          );
        }
        continue;
      }

      const code = stripInlineComment(rawLine);
      if (!code || code === '{' || code === '}') continue;

      if (/^#IF$/i.test(code)) {
        flow.phase = 'conditions';
        flow.pendingIfLine = lineNumber;
        flow.pendingIfHasExpression = false;
        flow.actionUnconditional = false;
        continue;
      }
      if (/^#IF(?:\s+|\()/i.test(code)) {
        flow.phase = 'conditions';
        flow.pendingIfLine = lineNumber;
        flow.pendingIfHasExpression = true;
        flow.actionUnconditional = false;
        continue;
      }
      if (/^#ACT$/i.test(code)) {
        if (flow.phase !== 'conditions') {
          addDiagnostic(context, 'orphan-act', '#ACT 没有对应的 #IF', script.filePath, lineNumber, code);
          flow.phase = 'act';
          flow.actionUnconditional = false;
          continue;
        }
        if (flow.pendingIfHasExpression) {
          addDiagnostic(
            context,
            'conditional-block',
            '含检测表达式的 #IF/#ACT 块不参与静态预览',
            script.filePath,
            flow.pendingIfLine,
            script.lines[(flow.pendingIfLine || lineNumber) - 1]?.trim()
          );
        }
        flow.phase = 'act';
        flow.actionUnconditional = !flow.pendingIfHasExpression;
        continue;
      }
      if (/^#ELSEACT\b/i.test(code)) {
        addDiagnostic(
          context,
          'else-block',
          '#ELSEACT 依赖运行时条件结果，不参与静态预览',
          script.filePath,
          lineNumber,
          code
        );
        flow.phase = 'act';
        flow.actionUnconditional = false;
        continue;
      }
      if (/^#(?:ELSEIF|SAY|ELSESAY)\b/i.test(code)) {
        flow.phase = 'outside';
        flow.actionUnconditional = false;
        continue;
      }

      if (flow.phase === 'conditions') {
        flow.pendingIfHasExpression = true;
        continue;
      }

      if (/^#CALLEX\b/i.test(code)) {
        addDiagnostic(
          context,
          'unsupported-call',
          '#CALLEX 不属于永久 MAPEFFECT 的保守静态调用子集',
          script.filePath,
          lineNumber,
          code
        );
        continue;
      }

      if (/^#CALL\b/i.test(code)) {
        if (flow.phase !== 'act' || !flow.actionUnconditional) {
          addDiagnostic(
            context,
            'conditional-call',
            '#CALL 不在无条件 #ACT 中',
            script.filePath,
            lineNumber,
            code
          );
          continue;
        }
        const match = code.match(/^#CALL\s+\[([^\]]+)\]\s+@([^\s]+)$/i);
        if (!match || hasDynamicValue(match[1]) || hasDynamicValue(match[2])) {
          addDiagnostic(
            context,
            'dynamic-call',
            '#CALL 路径或标签不是严格静态字面量',
            script.filePath,
            lineNumber,
            code
          );
          continue;
        }
        if (context.staticCallCount >= context.limits.maxCalls) {
          context.truncated = true;
          context.halted = true;
          addDiagnostic(
            context,
            'call-budget-exceeded',
            `静态 #CALL 数量超过扫描上限 ${context.limits.maxCalls}`,
            script.filePath,
            lineNumber,
            code
          );
          continue;
        }
        context.staticCallCount++;
        const resolution = resolveStaticCallPath(context, script.filePath, match[1]);
        if (!resolution.filePath) {
          addDiagnostic(
            context,
            resolution.diagnosticCode || 'call-target-not-found',
            resolution.message || '#CALL 目标无法解析',
            script.filePath,
            lineNumber,
            code
          );
          continue;
        }
        scanLabelBlock(
          context,
          resolution.filePath,
          match[2],
          depth + 1,
          { filePath: script.filePath, lineNumber, source: code }
        );
        continue;
      }

      if (/^(?:GOTO|RANDOMGOTO|DELAYGOTO|BREAK|RETURN|END|EXIT)\b/i.test(code)) {
        addDiagnostic(
          context,
          'unsupported-control-flow',
          '遇到未静态执行的跳转或终止命令，当前动作块后续内容不再纳入',
          script.filePath,
          lineNumber,
          code
        );
        flow.actionUnconditional = false;
        continue;
      }

      if (/^DELMAPEFFECT\b/i.test(code)) {
        if (flow.phase === 'act' && flow.actionUnconditional && context.definitions.length > 0) {
          const removedCount = context.definitions.length;
          context.definitions.splice(0, removedCount);
          context.skippedDefinitionCount += removedCount;
          addDiagnostic(
            context,
            'delete-after-create-unsupported',
            `无条件 DELMAPEFFECT 出现在已收录定义之后，已保守撤销前面 ${removedCount} 条定义`,
            script.filePath,
            lineNumber,
            code
          );
        }
        continue;
      }

      if (/^[^\s.]+\.MAPEFFECT\b/i.test(code)) {
        addSkippedDefinitionDiagnostic(
          context,
          'prefixed-mapeffect',
          '带对象前缀的 MAPEFFECT 不是行首精确命令',
          script.filePath,
          lineNumber,
          code
        );
        continue;
      }

      if (/^MAPEFFECT\b/i.test(code)) {
        if (flow.phase !== 'act') {
          addSkippedDefinitionDiagnostic(
            context,
            'outside-act-mapeffect',
            'MAPEFFECT 不在 #ACT 块内',
            script.filePath,
            lineNumber,
            code
          );
          continue;
        }
        if (!flow.actionUnconditional) {
          addSkippedDefinitionDiagnostic(
            context,
            'conditional-mapeffect',
            'MAPEFFECT 位于有条件或不可证明可达的 #ACT 中',
            script.filePath,
            lineNumber,
            code
          );
          continue;
        }
        parseMapEffect(context, script, lineNumber, code);
        continue;
      }

      if (code.startsWith('#')) {
        flow.phase = 'outside';
        flow.actionUnconditional = false;
      }
    }
  } finally {
    context.activeBlocks.delete(blockKey);
    context.completedBlocks.add(blockKey);
  }
}

function resolveEntryFile(envirPath: string): string | undefined {
  const candidates = [
    path.join(envirPath, 'MapQuest_Def', 'QManage.txt'),
    path.join(envirPath, 'MapQuest_def', 'QManage.txt'),
  ];
  return candidates.find(candidate => {
    try {
      return fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
}

/**
 * Conservatively scans server-startup script calls for globally visible, ordinary-draw,
 * infinitely looping GOM MAPEFFECT declarations. The function never executes scripts.
 */
export function scanStartupPermanentMapEffects(
  envirDir: string,
  limitOverrides?: Partial<MapEffectScanLimits>
): PermanentMapEffectScanResult {
  const definitions: PermanentMapEffectDefinition[] = [];
  const diagnostics: MapEffectScanDiagnostic[] = [];
  const diagnosticCounts: Partial<Record<MapEffectScanDiagnosticCode, number>> = {};
  const emptyResult = (): PermanentMapEffectScanResult => ({
    definitions,
    diagnostics,
    diagnosticCounts,
    scannedFiles: [],
    totalBytes: 0,
    skippedDefinitionCount: 0,
    truncated: false,
  });

  let envirPath: string;
  let envirRealPath: string;
  try {
    envirPath = path.resolve(envirDir);
    if (!fs.statSync(envirPath).isDirectory()) throw new Error('目标不是目录');
    envirRealPath = fs.realpathSync(envirPath);
  } catch (error) {
    diagnostics.push({
      code: 'envir-not-found',
      message: `Envir 目录无法读取：${error instanceof Error ? error.message : String(error)}`,
      filePath: path.resolve(envirDir),
    });
    diagnosticCounts['envir-not-found'] = 1;
    return emptyResult();
  }

  const questDiaryPath = path.join(envirPath, 'QuestDiary');
  let questDiaryRealPath: string | undefined;
  try {
    const candidate = fs.realpathSync(questDiaryPath);
    if (fs.statSync(candidate).isDirectory() && isPathInside(envirRealPath, candidate)) {
      questDiaryRealPath = candidate;
    }
  } catch {
    // A missing QuestDiary directory is reported only if a rooted #CALL needs it.
  }

  const context: ScanContext = {
    envirPath,
    envirRealPath,
    questDiaryPath,
    questDiaryRealPath,
    limits: normalizedLimits(limitOverrides),
    definitions,
    diagnostics,
    diagnosticCounts,
    scannedFiles: [],
    totalBytes: 0,
    staticCallCount: 0,
    skippedDefinitionCount: 0,
    truncated: false,
    halted: false,
    fileCache: new Map(),
    activeBlocks: new Set(),
    completedBlocks: new Set(),
  };

  const entryFile = resolveEntryFile(envirPath);
  if (!entryFile) {
    addDiagnostic(
      context,
      'entry-not-found',
      '未找到 Envir/MapQuest_Def/QManage.txt',
      path.join(envirPath, 'MapQuest_Def', 'QManage.txt')
    );
  } else {
    scanLabelBlock(context, entryFile, 'Startup', 0);
  }

  // A truncated traversal cannot prove that an unread suffix lacks a later
  // unconditional DELMAPEFFECT. Do not expose a deceptively partial "permanent" set.
  if (context.truncated && context.definitions.length > 0) {
    context.skippedDefinitionCount += context.definitions.length;
    context.definitions.splice(0, context.definitions.length);
  }

  return {
    definitions: context.definitions,
    diagnostics: context.diagnostics,
    diagnosticCounts: context.diagnosticCounts,
    scannedFiles: context.scannedFiles,
    totalBytes: context.totalBytes,
    skippedDefinitionCount: context.skippedDefinitionCount,
    truncated: context.truncated,
  };
}

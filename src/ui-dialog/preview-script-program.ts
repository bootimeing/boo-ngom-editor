import { EngineId } from '../types';
import { PreviewScriptSource, PreviewScriptSourcePurpose, PreviewScriptSourceResolution } from './preview-script-source';
import { PreviewConstantExpansion, PreviewScriptConstants, constantUsePermitted } from './preview-script-constants';

export { PreviewScriptSource, PreviewScriptSourceResolution } from './preview-script-source';

export interface PreviewScriptProgramSegment {
  /** Half-open UTF-16 offsets in the virtual program and the original source. */
  start: number;
  end: number;
  source: PreviewScriptSource;
  sourceStart: number;
  sourceEnd: number;
  rewritten?: boolean;
  /** Source continues to identify the original use, not the declaration/value. */
  constantExpansion?: PreviewConstantExpansion;
}

export interface PreviewScriptProgram {
  text: string;
  primary: PreviewScriptSource;
  segments: PreviewScriptProgramSegment[];
  resolutions: Map<string, PreviewScriptSourceResolution>;
  sources: Map<string, { rawPath: string; purpose: PreviewScriptSourcePurpose; resolution: PreviewScriptSourceResolution }>;
  warnings: string[];
}

interface SourceLine { start: number; end: number; body: string; eol: string }
interface LabelLine { name: string; index: number }
interface CallSite { line: SourceLine; target?: ImportUnit; invocation: string; indentation: string; modePrefix: string; constantsOnly?: boolean }
interface SourceUnit {
  source: PreviewScriptSource;
  start: number;
  end: number;
  lines: SourceLine[];
  calls: Map<number, CallSite>;
  stripped: Set<number>;
}
interface ImportUnit extends SourceUnit {
  originalLabel: string;
  targetLabel: string;
  labelLine: SourceLine;
  identity: string;
  blocked: boolean;
}

const MAX_SOURCES = 64;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_DEPTH = 16;
const MAX_IMPORTS = 1024;
const MAX_CALLS = 4096;

function linesOf(text: string): SourceLine[] {
  const lines: SourceLine[] = [];
  const pattern = /([^\r\n]*)(\r\n|\r|\n|$)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) && match[0].length) {
    lines.push({ start: match.index, end: pattern.lastIndex, body: match[1], eol: match[2] });
  }
  return lines;
}

function labelsOf(lines: readonly SourceLine[]): LabelLine[] {
  const labels: LabelLine[] = [];
  lines.forEach((line, index) => {
    const match = /^\uFEFF?\s*\[(@[^\]\r\n]+)\]/.exec(line.body);
    if (match) labels.push({ name: match[1].trim(), index });
  });
  return labels;
}

function labelKey(name: string): string { return name.trim().toUpperCase(); }
function sourceKey(source: PreviewScriptSource): string {
  // Sources are already canonicalized by the filesystem reader. Windows file identities
  // are insensitive to URI spelling case; never use the CALLEX-generated label here.
  return source.uri.toLowerCase();
}
function structuralText(line: SourceLine): string {
  const text = line.body.replace(/^\uFEFF/, '').replace(/\s*;.*$/, '').trim();
  if (text.startsWith('//')) return '';
  // Only recognize // after a standalone structural brace. Never truncate UI URLs.
  return text.replace(/^([{}])\s*\/\/.*$/, '$1');
}

function callHasArguments(suffix: string): boolean | undefined {
  const rest = suffix.trim();
  if (!rest || rest.startsWith(';') || rest.startsWith('//')) return false;
  if (!rest.startsWith('(')) return undefined;
  let depth = 0, quote = '';
  for (let index = 0; index < rest.length; index++) {
    const character = rest[index];
    if (quote) {
      if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") { quote = character; continue; }
    if (character === '(') depth++;
    else if (character === ')' && --depth === 0) {
      const tail = rest.slice(index + 1).trim();
      return !tail || tail.startsWith(';') || tail.startsWith('//') ? true : undefined;
    }
  }
  return undefined;
}

/** A bounded, read-only loading pass, not a server interpreter or a source-file rewrite. */
export function buildPreviewScriptProgram(
  primary: PreviewScriptSource,
  engine: EngineId,
  resolve: (rawPath: string, purpose?: PreviewScriptSourcePurpose) => PreviewScriptSourceResolution,
): PreviewScriptProgram {
  const warnings: string[] = [];
  const resolutions = new Map<string, PreviewScriptSourceResolution>();
  const sources: PreviewScriptProgram['sources'] = new Map();
  const warn = (message: string) => { if (!warnings.includes(message) && warnings.length < 256) warnings.push(message); };
  const constants = new PreviewScriptConstants(engine, warn);
  const primaryLines = linesOf(primary.text);
  const primaryLabels = new Set(labelsOf(primaryLines).map(label => labelKey(label.name)));
  const root: SourceUnit = { source: primary, start: 0, end: primary.text.length, lines: primaryLines, calls: new Map(), stripped: new Set() };
  const imports: ImportUnit[] = [];
  const byName = new Map<string, ImportUnit[]>();
  const callImports = new Map<string, ImportUnit>();
  const sourceSnapshots = new Map<string, PreviewScriptSource>([[sourceKey(primary), primary]]);
  const invalidSources = new Set<string>();
  const callexCounts = new Map<string, number>();
  let sourceBytes = Buffer.byteLength(primary.text, 'utf8');
  let expandedBytes = sourceBytes;
  let callCount = 0;

  function load(rawPath: string, purpose: PreviewScriptSourcePurpose = 'questdiary-txt'): PreviewScriptSource | undefined {
    const requestKey = `${purpose}\n${rawPath}`;
    let result = sources.get(requestKey)?.resolution;
    if (!result) {
      if (sources.size >= MAX_CALLS) { warn('跨文件预处理达到 4096 个路径上限；后续调用保持未展开'); return undefined; }
      try { result = resolve(rawPath, purpose); }
      catch { result = { status: 'blocked', message: '跨文件源读取失败', candidateFilePaths: [] }; }
      sources.set(requestKey, {rawPath, purpose, resolution:result});
      if (purpose === 'questdiary-txt') resolutions.set(rawPath, result);
    }
    if (result.status !== 'found') { warn(`跨文件预处理 ${rawPath}：${result.message}`); return undefined; }
    const source = result.source;
    const key = sourceKey(source), previous = sourceSnapshots.get(key);
    if (previous && (previous.text !== source.text || previous.documentVersion !== source.documentVersion)) {
      invalidSources.add(key);
      constants.invalidateSource(source.uri);
      warn(`跨文件源身份冲突：${source.fileName} 同一 URI 返回了不同版本／正文，相关调用保持未展开`);
      return undefined;
    }
    if (!previous) {
      const bytes = Buffer.byteLength(source.text, 'utf8');
      if (sourceSnapshots.size >= MAX_SOURCES || sourceBytes + bytes > MAX_BYTES) {
        warn('跨文件预处理达到 64 个源或 8 MiB 源文本大小上限；后续调用保持未展开');
        return undefined;
      }
      sourceSnapshots.set(key, source); sourceBytes += bytes;
    }
    return invalidSources.has(key) ? undefined : source;
  }

  function include(source: PreviewScriptSource, line: SourceLine): boolean {
    let rawPath = line.body.replace(/^\uFEFF?\s*#INCLUDE\s+/i, '').trim();
    if (engine !== '996PC') rawPath = rawPath.split(/;|\/\/|\\\\/, 1)[0].trim();
    if (!/\.ini$/i.test(rawPath) || /[\x00-\x1f<>$%{}[\]]/.test(rawPath)) {
      warn(`INCLUDE 需要 Defines 内直接静态 INI 文件名：${source.fileName}`); return false;
    }
    const loaded = load(rawPath, 'defines-ini');
    if (!loaded) constants.markIncomplete('INCLUDE 源未能完整读取，不能确认全局常量重名关系');
    return Boolean(loaded && constants.addSource(loaded));
  }

  const headers = new Set<string>();
  function loadHeader(source: PreviewScriptSource): void {
    if (headers.has(sourceKey(source))) return;
    headers.add(sourceKey(source));
    for (const line of linesOf(source.text)) {
      if (/^\uFEFF?\s*\[@/.test(line.body)) break;
      if (/^\uFEFF?\s*#INCLUDE\b/i.test(line.body)) include(source, line);
    }
  }

  function extract(source: PreviewScriptSource, requested: string): Omit<ImportUnit, 'targetLabel' | 'identity' | 'blocked'> | undefined {
    const lines = linesOf(source.text), labels = labelsOf(lines);
    const matches = labels.filter(label => labelKey(label.name) === labelKey(requested));
    if (matches.length !== 1) {
      warn(`跨文件入口${matches.length ? '重复／歧义' : '缺失'}：${source.fileName} ${requested}`);
      return undefined;
    }
    const label = matches[0], labelIndex = labels.indexOf(label);
    const nextIndex = labels[labelIndex + 1]?.index ?? lines.length;
    const bodyLines = lines.slice(label.index, nextIndex);
    const stripped = new Set<number>();

    // Keep the original, conservative block validation, but allow an already
    // verified external entry to jump to another literal label in the same
    // source.  The old extractor stopped at the first next label, so a common
    // `CALL @entry -> GOTO @load -> MOV A201 ...` helper lost its assignment and
    // the caller rendered the default value.  We import only direct, literal
    // GOTO targets discovered from the selected block; no whole-file scan and
    // no execution of the imported source happens here.
    const extractBlock = (requestedLabel: string, blockLines: SourceLine[], allowBare: boolean): SourceLine[] | undefined => {
      const first = blockLines.findIndex((line, index) => index > 0 && structuralText(line) !== '');
      if (first >= 0 && structuralText(blockLines[first]) === '{') {
        let closing = -1;
        for (let index = first + 1; index < blockLines.length; index++) {
          const value = structuralText(blockLines[index]);
          if (value === '{') { warn(`跨文件入口大括号边界不确定：${source.fileName} ${requestedLabel}`); return undefined; }
          if (value === '}') { closing = index; break; }
        }
        if (closing < 0 || blockLines.slice(closing + 1).some(line => structuralText(line) !== '')) {
          warn(`跨文件入口缺少独立完整大括号边界：${source.fileName} ${requestedLabel}`); return undefined;
        }
        stripped.add(blockLines[first].start); stripped.add(blockLines[closing].start);
      } else if (!allowBare || engine === '996PC' || labels.length !== 1 || blockLines.some(line => /^[{}]$/.test(structuralText(line)))) {
        warn(`跨文件入口未展开：${source.fileName} ${requestedLabel}；需要独立 {} 块，多个无括号标签的边界尚未确认`); return undefined;
      } else if (engine === 'GEE') {
        warn('GEE/LFM 单标签无括号 CALL 文件采用本地兼容预览；完整客户端边界仍待核验');
      }
      return blockLines;
    };
    if (!extractBlock(requested, bodyLines, true)) return undefined;

    const expandedLines = [...bodyLines];
    const importedLabels = new Set<string>([labelKey(label.name)]);
    const pendingLabels = [labelKey(label.name)];
    const directGoto = (line: SourceLine): string | undefined => {
      const text = structuralText(line);
      const match = /^\s*(?:#\s*)?GOTO\s+(@[^\s\[\]{}()<>|$;]+)/i.exec(text);
      return match ? match[1].trim() : undefined;
    };
    while (pendingLabels.length > 0 && importedLabels.size <= 32) {
      const current = pendingLabels.shift()!;
      const currentLabel = labels.find(item => labelKey(item.name) === current);
      if (!currentLabel) continue;
      const currentIndex = labels.indexOf(currentLabel);
      const currentEnd = labels[currentIndex + 1]?.index ?? lines.length;
      const currentBlock = lines.slice(currentLabel.index, currentEnd);
      for (const line of currentBlock) {
        const targetName = directGoto(line);
        if (!targetName) continue;
        const targetKey = labelKey(targetName);
        if (importedLabels.has(targetKey)) continue;
        if (primaryLabels.has(targetKey)) {
          // Never let an imported helper shadow a physical label in the
          // primary document: parseFunctions() uses the last duplicate name.
          // Keeping the target unresolved is safer than silently changing a
          // primary GOTO's meaning.
          warn(`跨文件 GOTO 目标与主文档标签冲突：${source.fileName} ${targetName}`);
          continue;
        }
        const targetMatches = labels.filter(item => labelKey(item.name) === targetKey);
        if (targetMatches.length !== 1) {
          warn(`跨文件 GOTO 目标${targetMatches.length ? '重复／歧义' : '缺失'}：${source.fileName} ${targetName}`);
          continue;
        }
        const targetLabel = targetMatches[0];
        const targetIndex = labels.indexOf(targetLabel);
        const targetEnd = labels[targetIndex + 1]?.index ?? lines.length;
        const targetBlock = lines.slice(targetLabel.index, targetEnd);
        if (!extractBlock(targetName, targetBlock, false)) continue;
        importedLabels.add(targetKey);
        pendingLabels.push(targetKey);
        expandedLines.push(...targetBlock);
      }
    }
    if (pendingLabels.length > 0) warn(`跨文件 GOTO 目标递归达到 32 个标签上限：${source.fileName} ${requested}`);
    // An outer brace enclosing several labels is explicitly rejected by GOM/996PC help.
    const outerDepth = lines.slice(0, label.index).reduce((balance, line) =>
      balance + (structuralText(line) === '{' ? 1 : structuralText(line) === '}' ? -1 : 0), 0);
    if (outerDepth !== 0) {
      warn(`跨文件入口处于标签外大括号中：${source.fileName} ${requested}`); return undefined;
    }
    return { source, start: expandedLines[0].start, end: expandedLines.at(-1)!.end, lines: expandedLines,
      calls: new Map(), stripped, originalLabel: label.name, labelLine: lines[label.index] };
  }

  function scan(unit: SourceUnit, ancestry: readonly string[], depth: number): void {
    let mode = '';
    let hasLabel = false, hasCondition = false;
    for (const line of unit.lines) {
      if (/^\uFEFF?\s*\[@[^\]]+\]/.test(line.body)) { mode = ''; hasLabel = true; hasCondition = false; }
      const modeMatch = /^\s*#(IF|OR|ACT|ELSEACT|SAY|ELSESAY)(?:\s*\([^)]*\))?\s*(?:;.*)?$/i.exec(line.body);
      if (modeMatch) { mode = modeMatch[1].toUpperCase(); if (mode === 'IF') hasCondition = false; }
      else if ((mode === 'IF' || mode === 'OR') && structuralText(line) && !/^\s*#/.test(line.body)) hasCondition = true;
      if (/^\uFEFF?\s*#INCLUDE\b/i.test(line.body)) {
        if (!hasLabel || (engine === '996PC' && mode === 'ACT' && !hasCondition)) {
          if (include(unit.source, line)) unit.stripped.add(line.start);
        } else warn(`INCLUDE 条件／位置语义尚未确认：${unit.source.fileName}；${engine} 不加载此处常量`);
        continue;
      }
      if (/^\uFEFF?\s*#DEFINE\b/i.test(line.body)) {
        warn(`直接脚本中的 DEFINE 位置语义尚未确认：${unit.source.fileName}；请用本引擎 Defines INI 或已确认的常量 CALL`);
        continue;
      }
      const directive = /^(\uFEFF?\s*)#(CALL|CALLEX)\b/i.exec(line.body);
      if (!directive) continue;
      callCount++;
      // CALL is itself an action marker after IF/OR/SAY or at an entry's beginning.
      // Preserve ELSE polarity instead of adding ACT unconditionally. Failed calls
      // retain their original directive after the marker, so the resolver can abort.
      const modePrefix = mode === 'ACT' || mode === 'ELSEACT' ? ''
        : `${directive[1]}#${mode === 'ELSESAY' ? 'ELSEACT' : 'ACT'}${line.eol || '\n'}`;
      mode = mode === 'ELSESAY' || mode === 'ELSEACT' ? 'ELSEACT' : 'ACT';
      const site: CallSite = { line, invocation: '', indentation: directive[1], modePrefix };
      if (modePrefix || callCount <= MAX_CALLS) unit.calls.set(line.start, site);
      if (callCount > MAX_CALLS) { warn('跨文件预处理达到 4096 个调用上限；后续调用保持未展开'); continue; }
      if (engine === '996PC' && directive[2].toUpperCase() === 'CALLEX') {
        warn('996PC 没有已确认的 CALLEX 合同；该调用保持未展开'); continue;
      }
      const call = /^(\uFEFF?\s*)#(CALL|CALLEX)\s+\[([^\]\r\n]+)\]\s+(@[^\s\[\]{}()<>|$;]+)(.*)$/i.exec(line.body);
      if (!call || /[\x00-\x1f<>$%{}]/.test(call[3])) {
        warn(`跨文件调用路径／入口不是直接静态语法：${unit.source.fileName}，偏移 ${line.start}`); continue;
      }
      const suffix = call[5];
      // Parameters remain source-owned for the existing GOTO evaluator. A literal suffix
      // other than one balanced argument frame or a comment is not silently discarded.
      const hasArguments = callHasArguments(suffix);
      if (hasArguments === undefined) {
        warn(`跨文件调用参数语法未确认：${unit.source.fileName} ${call[4]}`); continue;
      }
      if (hasArguments) {
        warn(`${engine} CALL/CALLEX 的参数／返回目标完整语法尚未确认；参数调用保持未展开（不借用 GOTO 返回列表合同）`); continue;
      }
      if (depth >= MAX_DEPTH || imports.length >= MAX_IMPORTS || sourceBytes > MAX_BYTES) {
        warn('跨文件预处理达到深度 16、1024 个入口或 8 MiB 上限；后续调用保持未展开'); continue;
      }
      const ini = /\.ini$/i.test(call[3]);
      if (ini && (engine !== '996PC' || call[2].toUpperCase() !== 'CALL')) {
        warn(`${engine} 的 INI CALL 常量文件合同未确认；不借用 996PC 规则`); continue;
      }
      const source = load(call[3], ini ? 'questdiary-constants-ini' : 'questdiary-txt');
      if (!source) continue;
      if (ini) {
        const extracted = extract(source, call[4]);
        if (extracted) {
          const first = extracted.lines.find(line => extracted.stripped.has(line.start));
          const last = [...extracted.lines].reverse().find(line => extracted.stripped.has(line.start));
          if (first && last && first !== last && constants.addSource(source, first.end, last.start)) site.constantsOnly = true;
        }
        continue;
      }
      const identity = `${sourceKey(source)}\n${labelKey(call[4])}`;
      if (ancestry.includes(identity)) { warn(`跨文件循环调用已停止：${source.fileName} ${call[4]}`); continue; }
      site.invocation = suffix;
      const name = labelKey(call[4]), isEx = call[2].toUpperCase() === 'CALLEX';
      const prior = !isEx ? callImports.get(identity) : undefined;
      if (prior) { site.target = prior; continue; }
      const extracted = extract(source, call[4]);
      if (!extracted) continue;
      let targetLabel = extracted.originalLabel;
      if (isEx) {
        const count = callexCounts.get(name) ?? (primaryLabels.has(name) || byName.has(name) ? 1 : 0);
        callexCounts.set(name, count + 1);
        if (count) targetLabel += `~${count}`;
        const targetName = labelKey(targetLabel);
        if (primaryLabels.has(targetName) || byName.has(targetName)) {
          warn(`CALLEX 自动名称与现有标签冲突：${targetLabel}；不猜测手写后缀碰撞顺序`); continue;
        }
        if (engine === 'GEE') warn('GEE/LFM CALLEX 仅入口重命名、内部 GOTO 保持原文采用本地保守细则；手册只确认准确路径及 ~N 命名');
      }
      // `extract()` may append non-contiguous helper labels.  Count only the
      // selected lines rather than the physical span between first and last;
      // otherwise a large unused section between two helpers can consume the
      // 8 MiB budget and make a valid delegated assignment disappear.
      const bytes = extracted.lines.reduce((total, line) =>
        total + Buffer.byteLength(source.text.slice(line.start, line.end), 'utf8'), 0) + 128;
      if (expandedBytes + bytes > MAX_BYTES) { warn('跨文件展开文本达到 8 MiB 大小上限；后续调用保持未展开'); continue; }
      const entry: ImportUnit = { ...extracted, targetLabel, identity, blocked: false };
      site.target = entry; imports.push(entry); expandedBytes += bytes;
      const peers = byName.get(labelKey(targetLabel)) || [];
      if (!isEx && (primaryLabels.has(name) || peers.length)) {
        entry.blocked = true;
        peers.forEach(peer => { peer.blocked = true; });
        warn(`CALL 同名入口冲突／歧义：${call[4]}；所有相关 CALL 保持未展开，不选择首个或末个文件`);
      }
      peers.push(entry); byName.set(labelKey(targetLabel), peers);
      if (!isEx) callImports.set(identity, entry);
      if (!entry.blocked) scan(entry, [...ancestry, identity], depth + 1);
    }
  }

  if (sourceBytes <= MAX_BYTES) scan(root, [], 0);
  else warn('主文档超过跨文件预处理 8 MiB 上限；原文保留，未读取外部脚本');

  const allowed = (unit: ImportUnit) => !unit.blocked && !invalidSources.has(sourceKey(unit.source));
  // A later name/source collision can revoke an earlier CALL. Render only imports still
  // reachable from valid call sites, not every source that the loading pass inspected.
  const reachable = new Set<ImportUnit>();
  function visit(unit: SourceUnit): void {
    for (const site of unit.calls.values()) {
      if (site.target && allowed(site.target) && !reachable.has(site.target)) {
        reachable.add(site.target); visit(site.target);
      }
    }
  }
  visit(root);
  // Only a validated, still-reachable TXT entry grants access to that file's
  // declarative header. A missing label or late CALL collision must not load it.
  for (const entry of reachable) loadHeader(entry.source);
  if ([...reachable].some(entry => !allowed(entry))) {
    constants.markIncomplete('常量头部加载期间 CALL 源身份发生冲突');
    reachable.clear(); visit(root);
  }
  const chunks: string[] = [], segments: PreviewScriptProgramSegment[] = [];
  let offset = 0;
  let extraConstantBytes = 0;
  function append(text: string, source: PreviewScriptSource, sourceStart: number, sourceEnd: number, rewritten = false, constantExpansion?: PreviewConstantExpansion): void {
    if (!text) return;
    chunks.push(text);
    const last = segments.at(-1);
    if (!rewritten && !constantExpansion && last && !last.rewritten && !last.constantExpansion && last.source === source && last.sourceEnd === sourceStart) {
      last.end += text.length; last.sourceEnd = sourceEnd;
    } else segments.push({ start: offset, end: offset + text.length, source, sourceStart, sourceEnd, ...(rewritten ? { rewritten: true } : {}), ...(constantExpansion ? {constantExpansion} : {}) });
    offset += text.length;
  }
  function emit(unit: SourceUnit): void {
    let mode = '';
    for (const line of unit.lines) {
      if (/^\uFEFF?\s*\[@[^\]]+\]/.test(line.body)) mode = '';
      const modeMatch = /^\s*#(IF|OR|ACT|ELSEACT|SAY|ELSESAY)(?:\s*\([^)]*\))?\s*(?:;.*)?$/i.exec(line.body);
      if (modeMatch) mode = modeMatch[1].toUpperCase();
      const site = unit.calls.get(line.start);
      const entry = 'targetLabel' in unit ? unit as ImportUnit : undefined;
      if (site?.constantsOnly) {
        append(line.eol, unit.source, line.start, line.end, true);
      } else if (site?.target && reachable.has(site.target) && allowed(site.target)) {
        append(`${site.modePrefix}${site.indentation}GOTO ${site.target.targetLabel}${site.invocation}${line.eol}`, unit.source, line.start, line.end, true);
      } else if (site?.modePrefix) {
        append(site.modePrefix + unit.source.text.slice(line.start, line.end), unit.source, line.start, line.end, true);
      } else if (entry && line.start === entry.labelLine.start && entry.targetLabel !== entry.originalLabel) {
        append(line.body.replace(/\[(@[^\]]+)\]/, `[${entry.targetLabel}]`) + line.eol, unit.source, line.start, line.end, true);
      } else if (unit.stripped.has(line.start)) {
        append(line.eol, unit.source, line.start, line.end, true);
      } else {
        const replacements = constants.replacements(line.body, (start, end, value) =>
          !/^\uFEFF?\s*(?:#|\[@|;|\/\/)/.test(line.body) && constantUsePermitted(line.body, mode, start, end, value));
        let from = 0;
        for (const replacement of replacements) {
          append(line.body.slice(from, replacement.start), unit.source, line.start + from, line.start + replacement.start);
          let { value, expansion } = replacement;
          const delta = Buffer.byteLength(value, 'utf8') - Buffer.byteLength(expansion.expression, 'utf8');
          if (expandedBytes + extraConstantBytes + Math.max(0, delta) > MAX_BYTES) {
            value = expansion.expression; expansion = {...expansion, status:'unsupported', reason:'常量展开超过本地大小上限'};
            warn('常量展开超过本地大小上限；后续值保留原表达式');
          } else extraConstantBytes += delta;
          append(value, unit.source, line.start + replacement.start, line.start + replacement.end,
            expansion.status === 'resolved', expansion);
          from = replacement.end;
        }
        append(line.body.slice(from) + line.eol, unit.source, line.start + from, line.end);
      }
    }
  }
  emit(root);
  for (const entry of imports) if (reachable.has(entry)) {
    append('\n', entry.source, entry.start, entry.start, true);
    emit(entry);
  }
  return { text: chunks.join(''), primary, segments, resolutions, sources, warnings };
}

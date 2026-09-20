import * as fs from 'fs';
import * as path from 'path';
import { EngineId } from '../types';
import { analyzeDropRates, DropAnalysis, DropSourceLocation, dropSourceLine } from './drop-rate-analysis';
import { isPathInside } from './path';
import { findEnvirRootForPath } from './quick-files';
import { decodeTextFile, encodeTextFile } from './text';

export interface DropExternalLimits {
  maxFiles: number;
  maxBytes: number;
  maxDepth: number;
  maxCalls: number;
  maxExpandedLines: number;
  maxExpandedCharacters: number;
}
const DEFAULT_LIMITS: DropExternalLimits = {
  maxFiles: 64, maxBytes: 4_000_000, maxDepth: 16, maxCalls: 1024,
  maxExpandedLines: 20_000, maxExpandedCharacters: 1_000_000,
};
interface SourceLine { text: string; source: DropSourceLocation; failure?: string }
interface Script { filePath: string; lines: string[] }

/**
 * Three current MonItems manuals document #CALL [\\file.txt] @label and a
 * QuestDiary label enclosed in braces. GXX LocalDB.LoadMonitems (3995-4052,
 * 4233-4294) inserts that body in-place: unlike NPC CALL, this is not GOTO and
 * must not deduplicate same-named labels or add a probability grouping node.
 * GOM CALLEX explicitly documents NPC-only preprocessing. No supported
 * MonItems profile establishes CALLEX; the GXX prefix match alone does not
 * authorize borrowing NPC rules across target engines/versions.
 */
export function analyzeDropRatesWithExternal(
  text: string, engine: EngineId, sourceFile: string,
  options: Partial<DropExternalLimits> = {}
): DropAnalysis {
  if (!['GOM', 'GEE', '996PC'].includes(engine)) throw new Error('未知引擎，不能推测爆率规则');
  const limits = { ...DEFAULT_LIMITS };
  for (const key of Object.keys(limits) as (keyof DropExternalLimits)[]) {
    const value = options[key];
    if (value !== undefined) {
      if (!Number.isSafeInteger(value) || value < 1) throw new Error(`无效外部爆率预算：${key}`);
      limits[key] = Math.min(value, DEFAULT_LIMITS[key]);
    }
  }
  // Preserve the original analyzer's hard root-buffer bounds before any I/O.
  const rootLines = text.split(/\r\n|\n|\r/);
  if (text.length > DEFAULT_LIMITS.maxExpandedCharacters || rootLines.length > DEFAULT_LIMITS.maxExpandedLines) {
    throw new Error('爆率分析超过 100 万字符或 2 万行上限');
  }
  const rootFile = path.resolve(sourceFile);
  const fileCache = new Map<string, Script>();
  let bytesRead = 0, calls = 0, expandedCalls = 0;
  let envirReal = '', diaryRoot = '', diaryReal = '';
  const keyOf = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value;
  const roots = () => {
    if (diaryReal) return;
    const envir = findEnvirRootForPath(rootFile);
    if (!envir) throw new Error('当前文件不在可确认的 Envir 目录内');
    envirReal = fs.realpathSync(envir);
    const sourceReal = fs.realpathSync(fs.existsSync(rootFile) ? rootFile : path.dirname(rootFile));
    if (!isPathInside(envirReal, sourceReal)) throw new Error('当前文件真实路径位于 Envir 之外');
    diaryRoot = path.join(envir, 'QuestDiary');
    const resolved = fs.realpathSync(diaryRoot);
    if (!isPathInside(envirReal, resolved)) throw new Error('QuestDiary 真实路径位于 Envir 之外');
    diaryReal = resolved;
  };
  const readScript = (reference: string): Script => {
    // The drop loader always resolves from QuestDiary, including nested CALL.
    // No implicit .txt, same-directory fallback, Envir fallback or other server.
    if (/[<>$%:*?"\u0000-\u001f]/.test(reference)) throw new Error('调用路径含动态变量或不支持的路径字符');
    const relative = reference.replace(/^[\\/]{1,2}/, '').replace(/\\/g, '/');
    if (!relative || relative.startsWith('/') || relative.split('/').some(part => !part || part === '..' || /[. ]$/.test(part))) {
      throw new Error('调用路径含越界或歧义段');
    }
    if (!/\.txt$/i.test(relative)) throw new Error('只展开手册已确认的 .txt 爆率文本');
    roots();
    const candidate = path.resolve(diaryRoot, relative);
    if (!isPathInside(diaryRoot, candidate)) throw new Error('调用路径位于 QuestDiary 之外');
    const real = fs.realpathSync(candidate);
    if (!isPathInside(diaryReal, real) || !isPathInside(envirReal, real)) throw new Error('调用目标真实路径位于 QuestDiary 之外');
    const cached = fileCache.get(keyOf(real));
    if (cached) return cached;
    if (fileCache.size >= limits.maxFiles) throw new Error('外部爆率文件数超过预算');
    const stat = fs.statSync(real);
    if (!stat.isFile()) throw new Error('调用目标不是普通文件');
    if (stat.size + bytesRead > limits.maxBytes) throw new Error('外部爆率读取字节超过预算');
    const fd = fs.openSync(real, 'r');
    let raw: Buffer;
    try {
      const before = fs.fstatSync(fd);
      if (before.size !== stat.size || before.ino !== stat.ino || before.mtimeMs !== stat.mtimeMs) throw new Error('读取期间外部文件变化');
      // A bounded read also protects against a file growing after stat().
      const buffer = Buffer.alloc(stat.size + 1);
      let size = 0, count = 0;
      while (size < buffer.length && (count = fs.readSync(fd, buffer, size, buffer.length - size, null)) > 0) size += count;
      const after = fs.fstatSync(fd);
      if (size !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs
        || keyOf(fs.realpathSync(candidate)) !== keyOf(real)) throw new Error('读取期间外部文件变化');
      raw = buffer.subarray(0, size);
    } finally { fs.closeSync(fd); }
    bytesRead += raw.length;
    if (raw.includes(0) || (raw.length > 1 && ((raw[0] === 0xff && raw[1] === 0xfe) || (raw[0] === 0xfe && raw[1] === 0xff)))) {
      throw new Error('不支持 UTF-16/UTF-32 或二进制爆率文本');
    }
    const decoded = decodeTextFile(raw);
    if (decoded.text.includes('\ufffd') || !encodeTextFile(decoded.text, decoded.encoding).equals(raw)) {
      throw new Error('外部文本编码无法无损确认');
    }
    const script = { filePath: real, lines: decoded.text.split(/\r\n|\n|\r/) };
    fileCache.set(keyOf(real), script);
    return script;
  };
  const selectBody = (script: Script, label: string): { text: string; line: number }[] => {
    const headers = script.lines.map((line, index) => ({ value: dropSourceLine(line), index }))
      .filter(entry => /^\[@[^\]]+\]$/.test(entry.value) && entry.value.toLowerCase() === `[${label}]`.toLowerCase());
    if (headers.length !== 1) throw new Error(headers.length ? '外部标签重复，无法唯一确定' : '外部标签不存在');
    const body: { text: string; line: number }[] = [];
    let opened = false, depth = 0;
    for (let i = headers[0].index + 1; i < script.lines.length; i++) {
      const value = dropSourceLine(script.lines[i]);
      if (!value) continue;
      if (!opened) {
        if (value !== '{') throw new Error('外部爆率标签缺少独立行 {');
        opened = true; continue;
      }
      if (value === '}') {
        if (depth !== 0) throw new Error('外部爆率括号未闭合');
        return body;
      }
      if (value === '{' || /^\[@/.test(value)) throw new Error('外部爆率标签未闭合或含嵌套标签');
      if (value === '(') depth++;
      if (value === ')' && --depth < 0) throw new Error('外部爆率右括号越过标签边界');
      body.push({ text: script.lines[i], line: i + 1 });
    }
    throw new Error('外部爆率标签缺少闭合 }');
  };
  const expand = (input: SourceLine[], active: Set<string>, depth: number): SourceLine[] => {
    const output: SourceLine[] = [];
    let characters = 0;
    const append = (lines: SourceLine[]) => {
      const added = lines.reduce((sum, line) => sum + line.text.length + 1, 0);
      if (output.length + lines.length > limits.maxExpandedLines || characters + added > limits.maxExpandedCharacters) {
        throw new Error('外部爆率展开行数或字符超过预算');
      }
      characters += added; output.push(...lines);
    };
    for (const original of input) {
      const value = dropSourceLine(original.text);
      if (!/^#CALL(?:EX)?\b/i.test(value)) { append([original]); continue; }
      const previouslyExpanded = expandedCalls;
      try {
        if (++calls > limits.maxCalls) throw new Error('外部爆率调用次数超过预算');
        if (/^#CALLEX\b/i.test(value)) throw new Error(`${engine} 爆率未证实 CALLEX；不套用 NPC 的同名标签重命名规则`);
        const match = /^#CALL\s+\[([^\]]+)\]\s+(@[^\s[\]{}()<>$%]+)$/i.exec(value);
        if (!match) throw new Error('CALL 路径、标签或附加参数不是已确认的静态形式');
        if (depth >= limits.maxDepth) throw new Error('外部爆率调用深度超过预算');
        const script = readScript(match[1]);
        const callKey = `${keyOf(script.filePath)}\u0000${match[2].toLowerCase()}`;
        if (active.has(callKey)) throw new Error('外部爆率循环调用，停止展开');
        const chain = [...(original.source.callChain || []), { filePath: original.source.filePath, line: original.source.line, label: match[2] }];
        const body = selectBody(script, match[2]).map(line => ({ text: line.text,
          source: { filePath: script.filePath, line: line.line, section: match[2], callChain: chain } }));
        const nestedActive = new Set(active); nestedActive.add(callKey);
        const expanded = expand(body, nestedActive, depth + 1);
        append(expanded); expandedCalls++;
      } catch (error) {
        // A rejected outer expansion must not count discarded nested calls.
        expandedCalls = previouslyExpanded;
        append([{ ...original, failure: error instanceof Error ? error.message : String(error) }]);
      }
    }
    return output;
  };
  const expanded = expand(rootLines.map((line, index) => ({ text: line, source: { filePath: rootFile, line: index + 1 } })), new Set(), 0);
  const result = analyzeDropRates(expanded.map(line => line.text).join('\n'), engine);
  for (const row of result.rows) {
    row.source = expanded[row.line - 1]?.source;
    if (row.source?.section) row.section = row.source.section;
    if (row.source) row.line = row.source.line;
  }
  for (const group of result.groups) {
    group.source = expanded[group.line - 1]?.source;
    if (group.source) group.line = group.source.line;
  }
  for (const warning of result.warnings) {
    const entry = expanded[warning.line - 1];
    warning.source = entry?.source;
    if (entry?.failure) warning.message = `CALL 未展开：${entry.failure}`;
    if (warning.source) warning.line = warning.source.line;
  }
  result.external = { expandedCalls, unresolvedCalls: expanded.filter(line => line.failure).length, filesRead: fileCache.size, bytesRead };
  return result;
}

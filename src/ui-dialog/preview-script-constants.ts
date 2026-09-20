import { EngineId } from '../types';
import { PreviewScriptSource } from './preview-script-source';

export interface PreviewConstantDefinition {
  source: PreviewScriptSource;
  name: string;
  value: string;
  declarationStart: number;
  declarationEnd: number;
  valueStart: number;
  valueEnd: number;
  status: 'resolved' | 'unsupported';
  reason?: string;
}
export interface PreviewConstantExpansion {
  expression: string;
  name: string;
  status: 'resolved' | 'missing' | 'ambiguous' | 'unsupported';
  definition?: PreviewConstantDefinition;
  reason?: string;
}
export interface PreviewConstantReplacement {
  start: number;
  end: number;
  value: string;
  expansion: PreviewConstantExpansion;
}

const MAX_DEFINITIONS = 4096;
const MAX_VALUE_BYTES = 8192;
const MAX_REFERENCES = 32768;
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

/** A literal-only table. No MOV values, user inputs, paths or recursive evaluation. */
export class PreviewScriptConstants {
  private readonly definitions = new Map<string, PreviewConstantDefinition[]>();
  private readonly declared = new Set<string>();
  private readonly invalidSources = new Set<string>();
  private incompleteReason?: string;
  private count = 0;
  private referenceCount = 0;
  constructor(private readonly engine: EngineId, private readonly warn: (message: string) => void) {}

  invalidateSource(uri: string): void { this.invalidSources.add(uri.toLowerCase()); }
  markIncomplete(reason: string): void { this.incompleteReason ||= reason; }

  private syntax(): RegExp {
    return this.engine === '996PC' ? /^\s*#DEFINE\s+\$\(([^\s()$<>|{}\[\]]+)\)[ \t]+(.*)$/i
      : /^\s*#DEFINE\s+\$([^\s()$<>|{}\[\]]+)[ \t]+(.*)$/i;
  }

  private comment(line: string): boolean {
    return this.engine === '996PC' ? /^\s*(?:;|$)/.test(line) : /^\s*(?:;|\/\/|\\\\|$)/.test(line);
  }

  /** Validate the complete selected source first; unsupported INCLUDE never partly loads it. */
  addSource(source: PreviewScriptSource, start = 0, end = source.text.length): boolean {
    const parsed: PreviewConstantDefinition[] = [];
    const pattern = /([^\r\n]*)(\r\n|\r|\n|$)/g;
    const text = source.text.slice(start, end);
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) && match[0].length) {
      const raw = match[1].replace(/^\uFEFF/, '');
      if (this.comment(raw)) continue;
      const declaration = this.syntax().exec(raw);
      if (!declaration) {
        this.warn(`常量文件未支持的语法：${source.fileName}；只读取本引擎 DEFINE 及已确认注释，不执行嵌套 INCLUDE／命令`);
        this.markIncomplete('常量加载图含未支持的文件语法'); return false;
      }
      const rawValue = declaration[2];
      let value = rawValue;
      if (this.engine !== '996PC') {
        const comment = /;|\/\/|\\\\/.exec(value);
        if (comment) value = value.slice(0, comment.index);
      }
      value = value.trimEnd();
      const declarationStart = start + match.index;
      const valueStart = declarationStart + match[1].length - rawValue.length;
      let reason: string | undefined;
      if (!value) reason = '空常量值语义未确认';
      else if (Buffer.byteLength(value, 'utf8') > MAX_VALUE_BYTES) reason = '常量值超过 8 KiB 本地上限';
      else if (/[\u0000-\u001f\u007f<>@|\\/\[\]{}$#;:]/.test(value)) {
        reason = '常量包含递归、动态表达式、markup／动作或结构字符，本轮仅支持纯 literal';
      }
      parsed.push({ source, name: declaration[1], value, declarationStart,
        declarationEnd: start + pattern.lastIndex, valueStart, valueEnd: valueStart + value.length,
        status: reason ? 'unsupported' : 'resolved', ...(reason ? { reason } : {}) });
      if (parsed.length > MAX_DEFINITIONS) {
        this.markIncomplete('常量定义超过 4096 条本地上限'); this.warn(this.incompleteReason!); return false;
      }
    }
    for (const declaration of parsed) {
      const identity = `${source.uri.toLowerCase()}\n${declaration.declarationStart}`;
      if (this.declared.has(identity)) continue;
      if (this.count >= MAX_DEFINITIONS) {
        this.warn('常量定义超过 4096 条本地上限；超限定义不展开');
        this.markIncomplete('常量定义超过 4096 条本地上限'); return false;
      }
      this.declared.add(identity); this.count++;
      const key = declaration.name.toUpperCase();
      const entries = this.definitions.get(key) || [];
      entries.push(declaration); this.definitions.set(key, entries);
      if (declaration.reason) this.warn(`常量 ${declaration.name} 未支持：${declaration.reason}`);
    }
    return true;
  }

  /** Called after the complete load graph, so a late duplicate revokes an earlier value. */
  replacements(body: string, permitted: (start: number, end: number, value: string) => boolean): PreviewConstantReplacement[] {
    const pattern = this.engine === '996PC' ? /\$\(([^\s()$<>|{}\[\]]+)\)/g : /\(\$([^\s()$<>|{}\[\]]+)\)/g;
    const replacements: PreviewConstantReplacement[] = [];
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(body))) {
      if (++this.referenceCount > MAX_REFERENCES) {
        this.warn('常量引用超过 32768 处本地上限；超限引用保持未知'); break;
      }
      const entries = this.definitions.get(match[1].toUpperCase()) || [];
      let expansion: PreviewConstantExpansion = { expression: match[0], name: match[1], status: 'missing' };
      if (this.incompleteReason) expansion = {...expansion, status:'unsupported', reason:this.incompleteReason};
      else if (entries.some(entry => this.invalidSources.has(entry.source.uri.toLowerCase()))) {
        expansion = {...expansion, status:'unsupported', reason:'常量定义源 URI 的正文或版本发生冲突'};
      } else if (entries.length) {
        const names = new Set(entries.map(entry => entry.name));
        const values = new Set(entries.map(entry => `${entry.status}\n${entry.value}`));
        if (names.size > 1 || values.size > 1 || entries[0].name !== match[1]) {
          expansion = {...expansion, status:'ambiguous', reason:'重复值或名称大小写语义不明确'};
        } else {
          expansion = {...expansion, status:entries[0].status, definition:entries[0], reason:entries[0].reason};
          if (expansion.status === 'resolved' && !permitted(match.index, pattern.lastIndex, entries[0].value)) {
            expansion = {...expansion, status:'unsupported', reason:'此处属于未开放的命令、目标、路径或事件参数'};
          }
        }
      }
      if (expansion.status !== 'resolved') this.warn(`常量 ${match[0]} ${expansion.status === 'missing' ? '未定义' : expansion.status === 'ambiguous' ? '歧义' : '未支持'}${expansion.reason ? `：${expansion.reason}` : ''}`);
      replacements.push({start:match.index, end:pattern.lastIndex,
        value:expansion.status === 'resolved' ? expansion.definition!.value : match[0], expansion});
    }
    return replacements;
  }
}

/** Preserve command names/targets and local event inputs; only value operands are opened. */
export function constantUsePermitted(body: string, mode: string, start: number, end: number, value: string): boolean {
  if (mode === 'ACT' || mode === 'ELSEACT') {
    const operation = /^\s*(MOV|INC|DEC|MUL|DIV)\s+([^\s<>()[\]{}|]+)\s+(.*)$/i.exec(body);
    if (!operation || /[$()]/.test(operation[2]) && !/^[A-Za-z]+\$[^$()]+$/.test(operation[2])) return false;
    const valueStart = body.length - operation[3].length;
    if (start < valueStart) return false;
    return operation[1].toUpperCase() === 'MOV' || NUMBER.test(value);
  }
  if (mode !== 'SAY' && mode !== 'ELSESAY') return false;
  // Any macro in an event suffix stays unresolved, including button call arguments.
  const tagStart = body.lastIndexOf('<', start), tagEnd = body.indexOf('>', start);
  if (tagStart >= 0 && tagEnd >= end && body.indexOf('>', tagStart) === tagEnd) {
    const before = body.slice(tagStart, start);
    if (/^<\w+\s*\|/.test(before)) {
      const field = /\|\s*([a-z][\w]*)\s*=[^|]*$/i.exec(before)?.[1];
      if (field && /^(?:d?blink|link|action|label|target|on\w*|event|click|command|submitinput|submit|reload|delay|count|checkboxid|sliderid|variable|var)$/i.test(field)) return false;
    } else if (before.includes('@')) return false;
  }
  return true;
}

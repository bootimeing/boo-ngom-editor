import { EngineId } from '../types';
import { ENGINE_IDS } from './engine-registry';

export const CUSTOM_LANGUAGE_STATE_KEY = 'boo.customLanguageCatalog';

export type CustomLanguageCategory = 'check' | 'action' | 'function' | 'constant';

export interface CustomLanguageEntry {
  id: string;
  name: string;
  syntax: string;
  description: string;
  params: string[];
}

export interface CustomEngineLanguageData {
  checks: CustomLanguageEntry[];
  actions: CustomLanguageEntry[];
  functions: CustomLanguageEntry[];
  constants: CustomLanguageEntry[];
}

export interface CustomLanguageData {
  schemaVersion: 1;
  engines: Record<EngineId, CustomEngineLanguageData>;
}

const CATEGORY_KEYS: Record<CustomLanguageCategory, keyof CustomEngineLanguageData> = {
  check: 'checks',
  action: 'actions',
  function: 'functions',
  constant: 'constants',
};

function emptyEngineData(): CustomEngineLanguageData {
  return { checks: [], actions: [], functions: [], constants: [] };
}

export function createEmptyCustomLanguageData(): CustomLanguageData {
  const engines = {} as Record<EngineId, CustomEngineLanguageData>;
  for (const engine of ENGINE_IDS) engines[engine] = emptyEngineData();
  return { schemaVersion: 1, engines };
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parameterValues(value: unknown): string[] {
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/\s+/)
      : [];
  return values.map(stringValue).filter(Boolean);
}

function customId(value: unknown): string {
  const current = stringValue(value);
  if (current && /^[A-Za-z0-9_.:-]+$/.test(current)) return current;
  return `custom-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function commandName(value: string): string {
  return /^[A-Za-z_][A-Za-z0-9_.]*/.exec(value)?.[0] || '';
}

function triggerName(value: string): string {
  return value.trim().replace(/^\[@?/i, '').replace(/^@/, '').replace(/\]$/, '').trim();
}

function constantName(value: string): string {
  return value.trim().replace(/^<\$/, '').replace(/^\$/, '').replace(/>$/, '').trim();
}

function normalizeEntry(
  category: CustomLanguageCategory,
  value: unknown,
  strict: boolean
): CustomLanguageEntry | undefined {
  if (!value || typeof value !== 'object') {
    if (strict) throw new Error('自定义补全数据格式无效');
    return undefined;
  }
  const source = value as Record<string, unknown>;
  const inputName = stringValue(source.name);
  const inputSyntax = stringValue(source.syntax);
  const description = stringValue(source.description ?? source.desc);
  const params = parameterValues(source.params);
  let name = inputName;
  let syntax = inputSyntax;

  if (category === 'check' || category === 'action') {
    const suppliedName = inputName || inputSyntax;
    name = commandName(suppliedName);
    if (!name || name !== suppliedName) {
      if (strict) throw new Error('检测命令和执行命令必须使用英文字母开头的有效名称');
      return undefined;
    }
    syntax = inputSyntax || name;
  } else if (category === 'function') {
    const token = triggerName(inputSyntax || inputName);
    if (!token || /[\[\]\r\n]/.test(token)) {
      if (strict) throw new Error('引擎函数名称不能为空，且不能包含方括号或换行');
      return undefined;
    }
    name = `[@${token}]`;
    syntax = token;
  } else {
    const token = constantName(inputSyntax || inputName);
    if (!token || !/^[A-Za-z0-9_.$\u3400-\u9fff]+$/.test(token)) {
      if (strict) throw new Error('系统常量名称格式无效');
      return undefined;
    }
    name = `<$${token}>`;
    syntax = token;
  }

  return {
    id: customId(source.id),
    name,
    syntax,
    description,
    params,
  };
}

function normalizeEntries(
  category: CustomLanguageCategory,
  values: unknown,
  strict: boolean
): CustomLanguageEntry[] {
  if (!Array.isArray(values)) return [];
  const result: CustomLanguageEntry[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const value of values) {
    const entry = normalizeEntry(category, value, strict);
    if (!entry) continue;
    const nameKey = entry.name.toUpperCase();
    if (ids.has(entry.id) || names.has(nameKey)) {
      if (strict) throw new Error(`自定义项目名称或 ID 重复: ${entry.name}`);
      continue;
    }
    ids.add(entry.id);
    names.add(nameKey);
    result.push(entry);
  }
  return result;
}

export function sanitizeCustomLanguageData(value: unknown): CustomLanguageData {
  const result = createEmptyCustomLanguageData();
  if (!value || typeof value !== 'object') return result;
  const engines = (value as { engines?: unknown }).engines;
  if (!engines || typeof engines !== 'object') return result;
  for (const engine of ENGINE_IDS) {
    const source = (engines as Partial<Record<EngineId, unknown>>)[engine];
    if (!source || typeof source !== 'object') continue;
    const record = source as Record<string, unknown>;
    result.engines[engine] = {
      checks: normalizeEntries('check', record.checks, false),
      actions: normalizeEntries('action', record.actions, false),
      functions: normalizeEntries('function', record.functions, false),
      constants: normalizeEntries('constant', record.constants, false),
    };
  }
  return result;
}

export function customLanguageEntries(
  data: CustomLanguageData | undefined,
  engine: EngineId,
  category: CustomLanguageCategory
): CustomLanguageEntry[] {
  return data?.engines?.[engine]?.[CATEGORY_KEYS[category]] || [];
}

export function replaceCustomLanguageEntries(
  data: CustomLanguageData | undefined,
  engine: EngineId,
  category: CustomLanguageCategory,
  entries: unknown
): CustomLanguageData {
  const current = sanitizeCustomLanguageData(data);
  current.engines[engine][CATEGORY_KEYS[category]] = normalizeEntries(category, entries, true);
  return current;
}

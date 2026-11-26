/**
 * 数据加载器 — 从 data/*.json 加载命令/变量/引擎函数
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  CommandsData,
  EngineConstantCatalog,
  EngineConstantsData,
  EngineFunctionCatalog,
  EngineFunctionsData,
  EngineId,
  StaticLanguageData,
  StaticLanguageVariant,
  TriggerEntry,
  TriggerVariant,
  ConstantEntry,
  VariableEntry,
  VariableVariant,
  VariablesData,
} from '../types';
import { ENGINE_DEFINITIONS, getEngineDefinition } from '../utils/engine-registry';

interface ManualUpdate {
  engine: EngineId;
  revision?: string;
  removedFunctions?: string[];
  functions: EngineFunctionsData;
  saySnippets: (StaticLanguageVariant & { id: string })[];
  triggers?: TriggerVariant[];
  constants?: ConstantEntry[];
  variables?: (VariableVariant & { replaces?: string })[];
  removedVariables?: string[];
  mapInfoParams?: (StaticLanguageVariant & { id: string })[];
}

function syncSymbolEngines(entry: TriggerEntry | VariableEntry, revision: string): void {
  entry.engines = ENGINE_DEFINITIONS.map(engine => engine.id).filter(engine => entry.engineVariants?.[engine]);
  const gom = entry.engines.includes('GOM');
  const gee = entry.engines.includes('GEE');
  entry.engineClassification = {
    status: gom && gee ? 'shared' : gom ? 'gom-only' : gee ? 'gee-only' : entry.engines.length ? '996pc-only' : 'compatibility',
    method: 'manual',
    confidence: 'confirmed',
    revision,
  };
}

export function loadManualUpdate(extensionPath: string, engine: EngineId, log: (msg: string) => void): ManualUpdate | undefined {
  const file = path.join(extensionPath, 'data', `manual-${engine.toLowerCase()}.json`);
  try {
    const update: ManualUpdate = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (update.engine !== engine || !update.functions || !Array.isArray(update.saySnippets)) {
      throw new Error('引擎或数据结构不匹配');
    }
    return update;
  } catch (error) {
    log(`无法读取 ${engine} 帮助更新，使用基础目录: ${String(error)}`);
    return undefined;
  }
}

export function loadCommandsData(extensionPath: string, log: (msg: string) => void): CommandsData | null {
  const cmdPath = path.join(extensionPath, 'data', 'commands.json');
  if (!fs.existsSync(cmdPath)) {
    log(`警告: 未找到命令数据 ${cmdPath}`);
    return null;
  }
  const cmds: CommandsData = JSON.parse(fs.readFileSync(cmdPath, 'utf-8'));
  for (const { id } of ENGINE_DEFINITIONS) {
    const manual = loadManualUpdate(extensionPath, id, log);
    for (const trigger of manual?.triggers ?? []) {
      cmds.triggers ??= [];
      let existing = cmds.triggers.find(entry => entry.name.toUpperCase() === trigger.name.toUpperCase());
      if (!existing) {
        existing = { ...trigger };
        cmds.triggers.push(existing);
      }
      existing.engineVariants = { ...existing.engineVariants, [id]: trigger };
      if (trigger.source) existing.engineSources = { ...existing.engineSources, [id]: trigger.source };
      syncSymbolEngines(existing, trigger.source?.revision ?? cmds.generated);
    }
    const removed = new Set(manual?.removedFunctions?.map(name => name.toUpperCase()));
    if (!removed.size) continue;
    for (const entry of [...cmds.commands, ...cmds.execCommands]) {
      const variant = entry.engineVariants?.[id];
      if (!variant) continue;
      if (removed.has((variant.name || entry.name).toUpperCase())) {
        delete entry.engineVariants![id];
        entry.engines = entry.engines?.filter(engine => engine !== id);
      } else if (variant.aliases) {
        variant.aliases = variant.aliases.filter(alias => !removed.has(alias.toUpperCase()));
      }
    }
  }
  cmds.totalTriggers = cmds.triggers?.length ?? 0;
  log(`已加载 ${cmds.totalCheckCommands} 检测命令 + ${cmds.totalActionCommands} 执行命令`);
  return cmds;
}

export function loadVariablesData(extensionPath: string, log: (msg: string) => void): VariablesData | null {
  const varPath = path.join(extensionPath, 'data', 'variables.json');
  if (!fs.existsSync(varPath)) return null;
  const vars: VariablesData = JSON.parse(fs.readFileSync(varPath, 'utf-8'));
  const byName = new Map(vars.variables.map(row => [row.name.toUpperCase(), row]));
  for (const { id } of ENGINE_DEFINITIONS) {
    const manual = loadManualUpdate(extensionPath, id, log);
    for (const name of manual?.removedVariables ?? []) {
      const row = byName.get(name.toUpperCase());
      if (!row?.engineVariants?.[id]) continue;
      delete row.engineVariants[id];
      if (row.engineSources) delete row.engineSources[id];
      syncSymbolEngines(row, manual?.revision ?? row.engineClassification?.revision ?? '');
    }
    for (const { replaces, ...variant } of manual?.variables ?? []) {
      const key = (replaces ?? variant.name).toUpperCase();
      let row = byName.get(key);
      if (!row) {
        row = { ...variant };
        byName.set(key, row);
      }
      row.engineVariants = { ...row.engineVariants, [id]: variant };
      if (variant.source) row.engineSources = { ...row.engineSources, [id]: variant.source };
      syncSymbolEngines(row, variant.source?.revision ?? row.engineClassification?.revision ?? '');
    }
  }
  vars.variables = [...byName.values()].filter(row => row.engines?.length || !row.engineVariants);
  log(`已加载 ${vars.variables?.length || 0} 个变量`);
  return vars;
}

export function loadEngineFunctions(extensionPath: string, engine: EngineId, log: (msg: string) => void): EngineFunctionsData | null {
  const definition = getEngineDefinition(engine);
  const funcPath = path.join(extensionPath, 'data', definition.functionFile);
  if (!fs.existsSync(funcPath)) return null;
  try {
    const funcs: EngineFunctionsData = JSON.parse(fs.readFileSync(funcPath, 'utf-8'));
    const names = new Map(Object.keys(funcs).map(name => [name.toUpperCase(), name]));
    const updates = loadManualUpdate(extensionPath, engine, log);
    const removed = new Set(updates?.removedFunctions?.map(name => name.toUpperCase()));
    if (removed.size) {
      for (const [name, info] of Object.entries(funcs)) {
        if (removed.has(name.toUpperCase())) delete funcs[name];
        else if (info.aliases) info.aliases = info.aliases.filter(alias => !removed.has(alias.toUpperCase()));
      }
    }
    for (const [name, entry] of Object.entries(updates?.functions ?? {})) {
      funcs[names.get(name.toUpperCase()) ?? name] = { ...entry, fromCurrentManual: true };
    }
    log(`已加载 ${definition.label} 函数数据 (${Object.keys(funcs).length} 条)`);
    return funcs;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`加载引擎函数失败: ${msg}`);
    return null;
  }
}

export function loadEngineFunctionCatalog(
  extensionPath: string,
  log: (msg: string) => void
): EngineFunctionCatalog {
  const catalog = {} as EngineFunctionCatalog;
  for (const definition of ENGINE_DEFINITIONS) {
    catalog[definition.id] = loadEngineFunctions(extensionPath, definition.id, log) || {};
  }
  return catalog;
}

export function loadEngineConstantCatalog(
  extensionPath: string,
  log: (msg: string) => void
): EngineConstantCatalog {
  const catalog = {} as EngineConstantCatalog;
  for (const definition of ENGINE_DEFINITIONS) {
    const filePath = path.join(extensionPath, 'data', definition.constantsFile);
    let data: EngineConstantsData = {
      schemaVersion: 1,
      engine: definition.id,
      generated: '',
      constants: [],
    };
    if (fs.existsSync(filePath)) {
      try {
        data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as EngineConstantsData;
      } catch (error) {
        log(`加载 ${definition.label} 常量失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const manual = loadManualUpdate(extensionPath, definition.id, log);
    const removed = new Set(manual?.removedVariables?.map(name => name.toUpperCase()));
    if (removed.size) data.constants = data.constants.filter(entry => !removed.has(entry.name.toUpperCase()));
    const extra = manual?.constants ?? [];
    if (extra.length) {
      const byName = new Map(data.constants.map(entry => [entry.name.toUpperCase(), entry]));
      for (const entry of extra) byName.set(entry.name.toUpperCase(), entry);
      data.constants = [...byName.values()];
    }
    catalog[definition.id] = data;
    log(`已加载 ${definition.label} 常量数据 (${data.constants.length} 条)`);
  }
  return catalog;
}

export function loadStaticLanguageData(
  extensionPath: string,
  log: (msg: string) => void,
  purpose: 'script' | 'renderer' = 'script'
): StaticLanguageData | null {
  const dataPath = path.join(extensionPath, 'data', 'static-language.json');
  if (!fs.existsSync(dataPath)) {
    log(`警告: 未找到静态语言数据 ${dataPath}`);
    return null;
  }
  try {
    const data: StaticLanguageData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    // The renderer implements a specific schema for each drawn control. New
    // documented forms are available to the language tools independently.
    const rendererForms: Partial<Record<EngineId, ReadonlySet<string>>> = {
      GEE: new Set(['user-item-preview', 'hero-user-item-preview', 'gee-user-item-view-target', 'gee-hero-user-item-view-target']),
      GOM: new Set(['user-item-preview']),
      '996PC': new Set(['equipshow-positional-996pc', 'dbitemshow-positional-996pc', 'item-box']),
    };
    const byId = new Map(data.saySnippets.map(entry => [entry.id, entry]));
    const mapById = new Map(data.mapInfoParams.map(entry => [entry.id, entry]));
    for (const { id: engine } of ENGINE_DEFINITIONS) {
      const manual = loadManualUpdate(extensionPath, engine, log);
      for (const { id, ...variant } of manual?.mapInfoParams ?? []) {
        if (!mapById.has(id)) mapById.set(id, { id, engineVariants: {} });
        mapById.get(id)!.engineVariants[engine] = variant;
      }
      for (const { id, ...variant } of manual?.saySnippets ?? []) {
        if (purpose === 'renderer' && !rendererForms[engine]?.has(id)) continue;
        if (!byId.has(id)) byId.set(id, { id, engineVariants: {} });
        byId.get(id)!.engineVariants[engine] = variant;
      }
    }
    data.saySnippets = [...byId.values()];
    data.mapInfoParams = [...mapById.values()];
    log(
      `已加载 ${data.saySnippets?.length || 0} 个界面标签`
      + ` + ${data.mapInfoParams?.length || 0} 个 MapInfo 参数`
    );
    return data;
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    log(`加载静态语言数据失败: ${message}`);
    return null;
  }
}

export {
  CommandsData,
  VariablesData,
  EngineFunctionsData,
  EngineFunctionCatalog,
  EngineConstantCatalog,
};

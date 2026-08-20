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
  VariablesData,
} from '../types';
import { ENGINE_DEFINITIONS, getEngineDefinition } from '../utils/engine-registry';

export function loadCommandsData(extensionPath: string, log: (msg: string) => void): CommandsData | null {
  const cmdPath = path.join(extensionPath, 'data', 'commands.json');
  if (!fs.existsSync(cmdPath)) {
    log(`警告: 未找到命令数据 ${cmdPath}`);
    return null;
  }
  const cmds: CommandsData = JSON.parse(fs.readFileSync(cmdPath, 'utf-8'));
  log(`已加载 ${cmds.totalCheckCommands} 检测命令 + ${cmds.totalActionCommands} 执行命令`);
  return cmds;
}

export function loadVariablesData(extensionPath: string, log: (msg: string) => void): VariablesData | null {
  const varPath = path.join(extensionPath, 'data', 'variables.json');
  if (!fs.existsSync(varPath)) return null;
  const vars: VariablesData = JSON.parse(fs.readFileSync(varPath, 'utf-8'));
  log(`已加载 ${vars.variables?.length || 0} 个变量`);
  return vars;
}

export function loadEngineFunctions(extensionPath: string, engine: EngineId, log: (msg: string) => void): EngineFunctionsData | null {
  const definition = getEngineDefinition(engine);
  const funcPath = path.join(extensionPath, 'data', definition.functionFile);
  if (!fs.existsSync(funcPath)) return null;
  try {
    const funcs: EngineFunctionsData = JSON.parse(fs.readFileSync(funcPath, 'utf-8'));
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
    catalog[definition.id] = data;
    log(`已加载 ${definition.label} 常量数据 (${data.constants.length} 条)`);
  }
  return catalog;
}

export function loadStaticLanguageData(
  extensionPath: string,
  log: (msg: string) => void
): StaticLanguageData | null {
  const dataPath = path.join(extensionPath, 'data', 'static-language.json');
  if (!fs.existsSync(dataPath)) {
    log(`警告: 未找到静态语言数据 ${dataPath}`);
    return null;
  }
  try {
    const data: StaticLanguageData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
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

export type EngineId = 'GOM' | 'GEE' | '996PC';
export type CommandKind = 'check' | 'action' | 'say' | 'control';
export type CommandContext = 'IF' | 'ACT' | 'SAY' | 'ANY';
export type EngineClassificationStatus =
  | 'shared'
  | 'gom-only'
  | 'gee-only'
  | '996pc-only'
  | 'compatibility';

export interface EngineClassification {
  status: EngineClassificationStatus;
  confidence: 'confirmed' | 'unverified';
  method: 'latest-help-index' | 'manual';
  revision: string;
}

export interface HelpSource {
  revision?: string;
  page: string;
  title?: string;
}

export interface ServerCorpusEvidence {
  kind: 'server-script';
  path: string;
  line: number;
  text: string;
}

export interface CommandVariant {
  name?: string;
  syntax?: string;
  description?: string;
  params?: string[];
  example?: string;
  kind?: CommandKind;
  contexts?: CommandContext[];
  aliases?: string[];
  minArgs?: number;
  maxArgs?: number;
  source?: HelpSource;
  snippet?: string;
  completionVerified?: boolean;
  completionEnabled?: boolean;
  corpusEvidence?: ServerCorpusEvidence[];
}

// ---- 命令数据 ----
export interface CommandEntry extends CommandVariant {
  name: string;
  syntax: string;
  description: string;
  category?: string;
  engines?: EngineId[];
  engineClassification?: EngineClassification;
  engineVariants?: Partial<Record<EngineId, CommandVariant>>;
}

export interface TriggerEntry {
  name: string;
  label: string;
  description?: string;
  engines?: EngineId[];
  aliases?: string[];
  source?: HelpSource;
  engineSources?: Partial<Record<EngineId, HelpSource>>;
  engineClassification?: EngineClassification;
  engineVariants?: Partial<Record<EngineId, TriggerVariant>>;
}

export interface TriggerVariant {
  name: string;
  label: string;
  description?: string;
  aliases?: string[];
  source?: HelpSource;
}

export interface CommandsData {
  version: string;
  generated: string;
  source: string;
  totalCheckCommands: number;
  totalActionCommands: number;
  totalVariables: number;
  totalTriggers: number;
  commands: CommandEntry[];
  execCommands: CommandEntry[];
  triggers?: TriggerEntry[];
}

// ---- 变量数据 ----
export interface VariableEntry {
  name: string;
  full?: string;
  scope?: string;
  desc?: string;
  description?: string;
  engines?: EngineId[];
  aliases?: string[];
  source?: HelpSource;
  engineSources?: Partial<Record<EngineId, HelpSource>>;
  engineClassification?: EngineClassification;
  engineVariants?: Partial<Record<EngineId, VariableVariant>>;
}

export interface VariableVariant {
  name: string;
  full?: string;
  scope?: string;
  desc?: string;
  description?: string;
  aliases?: string[];
  source?: HelpSource;
  corpusEvidence?: ServerCorpusEvidence[];
}

export interface VariablesData {
  variables: VariableEntry[];
}

// ---- 引擎相关的静态补全与 MapInfo 参数 ----
export interface StaticLanguageVariant {
  label: string;
  description: string;
  source: HelpSource;
  snippet?: string;
  evidenceToken?: string;
}

export interface StaticLanguageEntry {
  id: string;
  engineVariants: Partial<Record<EngineId, StaticLanguageVariant>>;
}

export interface StaticLanguageData {
  schemaVersion: number;
  revision: string;
  saySnippets: StaticLanguageEntry[];
  mapInfoParams: StaticLanguageEntry[];
}

// ---- 引擎函数数据 (functions.json / functions-gee.json) ----
export interface EngineFunctionInfo {
  details?: string;
  params?: string;
  syntax?: string;
  paramList?: string[];
  kind?: CommandKind;
  contexts?: CommandContext[];
  aliases?: string[];
  minArgs?: number;
  maxArgs?: number;
  source?: HelpSource;
  snippet?: string;
  completionVerified?: boolean;
  completionEnabled?: boolean;
  corpusEvidence?: ServerCorpusEvidence[];
}

export type EngineFunctionsData = Record<string, EngineFunctionInfo>;
export type EngineFunctionCatalog = Record<EngineId, EngineFunctionsData>;

export interface ConstantEntry {
  name: string;
  full: string;
  description: string;
  scope?: string;
  source?: HelpSource;
  aliases?: string[];
  engines?: EngineId[];
  completionVerified: boolean;
  completionEnabled: boolean;
  diagnosticSupported?: boolean;
  corpusEvidence?: ServerCorpusEvidence[];
}

export interface EngineConstantsData {
  schemaVersion: number;
  engine: EngineId;
  generated: string;
  constants: ConstantEntry[];
}

export type EngineConstantCatalog = Record<EngineId, EngineConstantsData>;

// ---- Webview 消息 ----
export interface WebviewMessage {
  type: string;
  [key: string]: unknown;
}

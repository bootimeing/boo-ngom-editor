import {
  CommandContext,
  CommandEntry,
  CommandKind,
  ConstantEntry,
  CommandsData,
  EngineConstantCatalog,
  EngineFunctionCatalog,
  EngineFunctionInfo,
  EngineId,
  HelpSource,
  ServerCorpusEvidence,
  TriggerEntry,
  VariableEntry,
  VariablesData,
} from '../types';
import {
  ENGINE_IDS,
  normalizeEngineId as normalizeRegisteredEngineId,
} from './engine-registry';

export interface IndexedCommand {
  name: string;
  syntax: string;
  description: string;
  params: string[];
  kind: CommandKind;
  contexts: CommandContext[];
  aliases: string[];
  engines: EngineId[];
  minArgs?: number;
  maxArgs?: number;
  source?: HelpSource;
  snippet?: string;
  completionVerified: boolean;
  completionEnabled: boolean;
  corpusEvidence?: ServerCorpusEvidence[];
  aliasOf?: string;
  legacyShared: boolean;
  origin: 'shared' | 'engine';
}

export interface LanguageIndex {
  engine: EngineId;
  commands: IndexedCommand[];
  /** Commands with fully verified syntax and parameters. */
  commandCompletions: IndexedCommand[];
  /** Commands whose names are confirmed and may be offered without parameter snippets. */
  commandNameCompletions: IndexedCommand[];
  checks: IndexedCommand[];
  checkCompletions: IndexedCommand[];
  checkNameCompletions: IndexedCommand[];
  actions: IndexedCommand[];
  actionCompletions: IndexedCommand[];
  actionNameCompletions: IndexedCommand[];
  sayCommands: IndexedCommand[];
  sayCompletions: IndexedCommand[];
  sayNameCompletions: IndexedCommand[];
  commandByName: Map<string, IndexedCommand>;
  unsupportedCommandByName: Map<string, IndexedCommand>;
  variables: VariableEntry[];
  variableByName: Map<string, VariableEntry>;
  unsupportedVariableByName: Map<string, VariableEntry>;
  triggers: TriggerEntry[];
  triggerByName: Map<string, TriggerEntry>;
  unsupportedTriggerByName: Map<string, TriggerEntry>;
  constants: ConstantEntry[];
  constantByName: Map<string, ConstantEntry>;
  unsupportedConstantByName: Map<string, ConstantEntry>;
}

interface RankedCommand extends IndexedCommand {
  priority: number;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function addUnsupportedEntry<T extends { engines?: EngineId[] }>(
  target: Map<string, T>,
  name: string,
  incoming: T
): void {
  const current = target.get(name);
  if (!current) {
    target.set(name, incoming);
    return;
  }
  target.set(name, {
    ...current,
    engines: unique([...(current.engines || []), ...(incoming.engines || [])]),
  } as T);
}

export function normalizeEngineId(value: string | undefined): EngineId {
  return normalizeRegisteredEngineId(value);
}

export function commandToken(name: string): string {
  const trimmed = name.trim();
  return /^[A-Za-z_][A-Za-z0-9_.]*/.exec(trimmed)?.[0] || trimmed;
}

export function commandKey(name: string): string {
  return commandToken(name).toUpperCase();
}

function triggerKey(name: string): string {
  return name.trim().replace(/^\[@?/, '').replace(/\]$/, '').toUpperCase();
}

function variableKey(name: string): string {
  return name.trim().replace(/^<\$/, '').replace(/>$/, '').toUpperCase();
}

function supportsEngine(engines: EngineId[] | undefined, engine: EngineId): boolean {
  return Boolean(engines?.includes(engine));
}

function defaultContexts(kind: CommandKind): CommandContext[] {
  if (kind === 'check') return ['IF'];
  if (kind === 'say') return ['SAY'];
  if (kind === 'control') return ['ANY'];
  return ['ACT'];
}

function inferFunctionKind(name: string, info: EngineFunctionInfo): CommandKind {
  if (info.kind) return info.kind;
  if (/^(?:IMG|PLAYIMG|IMGCOUNTDOWN|IMGEX)$/i.test(name)) return 'say';
  if (/^(?:CHECK|IS|HAVE|POSE)/i.test(name) || /^(?:NOT|RANDOM|RANDOMEX)$/i.test(name)) {
    return 'check';
  }
  return 'action';
}

function splitTopLevelParams(text: string): string[] {
  const result: string[] = [];
  let current = '';
  let depth = 0;
  const opening = new Set(['(', '（', '[', '【', '{']);
  const closing = new Set([')', '）', ']', '】', '}']);
  const pushCurrent = () => {
    const value = current.trim();
    if (!value) return;
    if (/^[（(]/.test(value) && result.length > 0) {
      result[result.length - 1] += ` ${value}`;
    } else {
      result.push(value);
    }
    current = '';
  };
  for (const char of text) {
    if (opening.has(char)) depth++;
    if (closing.has(char) && depth > 0) depth--;
    if (/\s/.test(char) && depth === 0) {
      pushCurrent();
      continue;
    }
    current += char;
  }
  pushCurrent();
  return result;
}

function splitFunctionParams(info: EngineFunctionInfo): string[] {
  if (info.paramList) return info.paramList.filter(Boolean);
  const text = info.params?.trim();
  if (!text) return [];
  return splitTopLevelParams(text);
}

function buildSaySnippet(name: string, params: string[]): string | undefined {
  if (!/^(?:IMG|PLAYIMG|IMGCOUNTDOWN|IMGEX)$/i.test(name)) return undefined;
  const body = [name, ...params.map((param, index) => `\${${index + 1}:${param}}`)].join(':');
  return (/^(?:IMG|IMGCOUNTDOWN|IMGEX)$/i.test(name) ? '<&' : '<') + body + '>';
}

function replaceSyntaxName(syntax: string, oldName: string, newName: string): string {
  return syntax.replace(new RegExp(`^${escapeRegex(oldName)}(?=\\s|$)`, 'i'), newName);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeSharedCommand(
  entry: CommandEntry,
  listKind: CommandKind,
  engine: EngineId
): RankedCommand | null {
  if (!supportsEngine(entry.engines, engine)) return null;
  const variant = entry.engineVariants?.[engine];
  if (!variant?.name) return null;
  const kind = variant.kind || listKind;
  const name = commandToken(variant.name);
  return {
    name,
    syntax: variant.syntax || name,
    description: variant.description || '',
    params: variant.params || [],
    kind,
    contexts: variant.contexts || defaultContexts(kind),
    aliases: (variant.aliases || []).map(commandToken),
    engines: [engine],
    minArgs: variant.minArgs,
    maxArgs: variant.maxArgs,
    source: variant.source,
    snippet: variant.snippet,
    completionVerified: variant.completionVerified ?? false,
    completionEnabled: variant.completionEnabled ?? true,
    corpusEvidence: variant.corpusEvidence,
    legacyShared: false,
    origin: 'shared',
    priority: variant.completionVerified === true ? 40 : 25,
  };
}

function normalizeEngineFunction(
  name: string,
  info: EngineFunctionInfo,
  engine: EngineId
): RankedCommand {
  const normalizedName = commandToken(name);
  const kind = inferFunctionKind(normalizedName, info);
  const params = splitFunctionParams(info);
  return {
    name: normalizedName,
    syntax: info.syntax || (params.length ? `${normalizedName} ${params.join(' ')}` : normalizedName),
    description: info.details || '',
    params,
    kind,
    contexts: info.contexts || defaultContexts(kind),
    aliases: (info.aliases || []).map(commandToken),
    engines: [engine],
    minArgs: info.minArgs,
    maxArgs: info.maxArgs,
    source: info.source,
    snippet: info.snippet || buildSaySnippet(normalizedName, params),
    completionVerified: info.completionVerified ?? false,
    completionEnabled: info.completionEnabled ?? true,
    corpusEvidence: info.corpusEvidence,
    legacyShared: false,
    origin: 'engine',
    priority: info.completionVerified === true ? 30 : 20,
  };
}

function mergeCommands(existing: RankedCommand, incoming: RankedCommand): RankedCommand {
  const preferred = incoming.priority > existing.priority ? incoming : existing;
  const fallback = preferred === incoming ? existing : incoming;
  const displayName = existing.origin === 'shared' ? existing.name : preferred.name;
  return {
    ...fallback,
    ...preferred,
    name: displayName,
    syntax: replaceSyntaxName(preferred.syntax || fallback.syntax, preferred.name, displayName),
    description: preferred.description || fallback.description,
    params: preferred.params,
    aliases: unique([...existing.aliases, ...incoming.aliases]),
    engines: unique([...existing.engines, ...incoming.engines]),
    source: preferred.source || fallback.source,
    snippet: preferred.snippet || fallback.snippet,
    completionVerified: preferred.completionVerified,
    completionEnabled: preferred.completionEnabled,
    corpusEvidence: preferred.corpusEvidence || fallback.corpusEvidence,
    legacyShared: existing.legacyShared && incoming.legacyShared,
    priority: Math.max(existing.priority, incoming.priority),
  };
}

function buildCommandsForEngine(
  commandsData: CommandsData | null,
  catalog: EngineFunctionCatalog,
  engine: EngineId
): RankedCommand[] {
  const byCanonicalName = new Map<string, RankedCommand>();
  const add = (command: RankedCommand | null) => {
    if (!command) return;
    const key = commandKey(command.name);
    const current = byCanonicalName.get(key);
    byCanonicalName.set(key, current ? mergeCommands(current, command) : command);
  };

  for (const entry of commandsData?.commands || []) {
    add(normalizeSharedCommand(entry, 'check', engine));
  }
  for (const entry of commandsData?.execCommands || []) {
    add(normalizeSharedCommand(entry, 'action', engine));
  }
  for (const [name, info] of Object.entries(catalog[engine] || {})) {
    add(normalizeEngineFunction(name, info, engine));
  }

  return [...byCanonicalName.values()].sort((a, b) => (
    a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })
  ));
}

function commandNameMap(commands: IndexedCommand[]): Map<string, IndexedCommand> {
  const result = new Map<string, IndexedCommand>();
  for (const command of commands) {
    result.set(commandKey(command.name), command);
    for (const alias of command.aliases) result.set(commandKey(alias), command);
  }
  return result;
}

function expandAliases(commands: IndexedCommand[]): IndexedCommand[] {
  const result: IndexedCommand[] = [];
  const used = new Set<string>();
  for (const command of commands) {
    for (const name of [command.name, ...command.aliases]) {
      const key = commandKey(name);
      if (used.has(key)) continue;
      used.add(key);
      if (name === command.name) {
        result.push(command);
      } else {
        result.push({
          ...command,
          name,
          syntax: replaceSyntaxName(command.syntax, command.name, name),
          aliasOf: command.name,
        });
      }
    }
  }
  return result.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}

function activeVariables(data: VariablesData | null, engine: EngineId): VariableEntry[] {
  return (data?.variables || [])
    .filter(variable => variable.engines?.includes(engine) && variable.engineVariants?.[engine])
    .map(variable => {
      const variant = variable.engineVariants![engine]!;
      return {
        ...variant,
        engines: [engine],
      };
    });
}

function variableNameMap(variables: VariableEntry[]): Map<string, VariableEntry> {
  const result = new Map<string, VariableEntry>();
  for (const variable of variables) {
    for (const name of [variable.name, variable.full || '', ...(variable.aliases || [])]) {
      if (name) result.set(variableKey(name), variable);
    }
  }
  return result;
}

function activeTriggers(data: CommandsData | null, engine: EngineId): TriggerEntry[] {
  return (data?.triggers || [])
    .filter(trigger => trigger.engines?.includes(engine) && trigger.engineVariants?.[engine])
    .map(trigger => {
      const variant = trigger.engineVariants![engine]!;
      return {
        ...variant,
        engines: [engine],
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}

function triggerNameMap(triggers: TriggerEntry[]): Map<string, TriggerEntry> {
  const result = new Map<string, TriggerEntry>();
  for (const trigger of triggers) {
    for (const name of [trigger.name, trigger.label, ...(trigger.aliases || [])]) {
      result.set(triggerKey(name), trigger);
    }
  }
  return result;
}

function activeConstants(
  catalog: EngineConstantCatalog | undefined,
  engine: EngineId
): ConstantEntry[] {
  return (catalog?.[engine]?.constants || [])
    .filter(entry => entry.completionEnabled || entry.diagnosticSupported)
    .map(entry => ({ ...entry, engines: [engine] }));
}

function constantNameMap(constants: ConstantEntry[]): Map<string, ConstantEntry> {
  const result = new Map<string, ConstantEntry>();
  for (const constant of constants) {
    for (const name of [constant.name, constant.full, ...(constant.aliases || [])]) {
      if (name) result.set(variableKey(name), constant);
    }
  }
  return result;
}

export function buildLanguageIndex(
  commandsData: CommandsData | null,
  variablesData: VariablesData | null,
  catalog: EngineFunctionCatalog,
  engine: EngineId,
  constantCatalog?: EngineConstantCatalog
): LanguageIndex {
  const commandCatalog = new Map<EngineId, RankedCommand[]>();
  for (const candidate of ENGINE_IDS) {
    commandCatalog.set(candidate, buildCommandsForEngine(commandsData, catalog, candidate));
  }
  const commands: IndexedCommand[] = commandCatalog.get(engine) || [];
  const commandByName = commandNameMap(commands);
  const unsupportedCommandByName = new Map<string, IndexedCommand>();
  for (const candidate of ENGINE_IDS) {
    if (candidate === engine) continue;
    for (const [name, command] of commandNameMap(commandCatalog.get(candidate) || [])) {
      if (!commandByName.has(name)) addUnsupportedEntry(unsupportedCommandByName, name, command);
    }
  }

  const verifiedCommands = commands.filter(command => (
    command.completionEnabled
    && command.completionVerified
    && Boolean(command.source)
  ));
  const nameConfirmedCommands = commands.filter(command => (
    command.completionEnabled
    && Boolean(command.source)
  ));
  const commandCompletions = expandAliases(verifiedCommands);
  const commandNameCompletions = expandAliases(nameConfirmedCommands);
  const checks = commands.filter(command => command.contexts.includes('IF') || command.kind === 'check');
  const actions = commands.filter(command => command.contexts.includes('ACT') || command.kind === 'action');
  const sayCommands = commands.filter(command => command.contexts.includes('SAY') || command.kind === 'say');
  const completionKeys = (source: IndexedCommand[]) => new Set(source.map(command => commandKey(command.name)));
  const checksSet = completionKeys(checks);
  const actionsSet = completionKeys(actions);
  const saySet = completionKeys(sayCommands);

  const variables = activeVariables(variablesData, engine);
  const variableByName = variableNameMap(variables);
  const unsupportedVariableByName = new Map<string, VariableEntry>();
  for (const candidate of ENGINE_IDS) {
    if (candidate === engine) continue;
    for (const [name, variable] of variableNameMap(activeVariables(variablesData, candidate))) {
      if (!variableByName.has(name)) addUnsupportedEntry(unsupportedVariableByName, name, variable);
    }
  }
  const triggers = activeTriggers(commandsData, engine);
  const triggerByName = triggerNameMap(triggers);
  const unsupportedTriggerByName = new Map<string, TriggerEntry>();
  for (const candidate of ENGINE_IDS) {
    if (candidate === engine) continue;
    for (const [name, trigger] of triggerNameMap(activeTriggers(commandsData, candidate))) {
      if (!triggerByName.has(name)) addUnsupportedEntry(unsupportedTriggerByName, name, trigger);
    }
  }
  const constants = activeConstants(constantCatalog, engine);
  const constantByName = constantNameMap(constants);
  const unsupportedConstantByName = new Map<string, ConstantEntry>();
  for (const candidate of ENGINE_IDS) {
    if (candidate === engine) continue;
    for (const [name, constant] of constantNameMap(activeConstants(constantCatalog, candidate))) {
      if (!constantByName.has(name) && !variableByName.has(name)) {
        addUnsupportedEntry(unsupportedConstantByName, name, constant);
      }
    }
  }

  return {
    engine,
    commands,
    commandCompletions,
    commandNameCompletions,
    checks,
    checkCompletions: commandCompletions.filter(command => checksSet.has(commandKey(command.aliasOf || command.name))),
    checkNameCompletions: commandNameCompletions.filter(command => checksSet.has(commandKey(command.aliasOf || command.name))),
    actions,
    actionCompletions: commandCompletions.filter(command => actionsSet.has(commandKey(command.aliasOf || command.name))),
    actionNameCompletions: commandNameCompletions.filter(command => actionsSet.has(commandKey(command.aliasOf || command.name))),
    sayCommands,
    sayCompletions: commandCompletions.filter(command => saySet.has(commandKey(command.aliasOf || command.name))),
    sayNameCompletions: commandNameCompletions.filter(command => saySet.has(commandKey(command.aliasOf || command.name))),
    commandByName,
    unsupportedCommandByName,
    variables,
    variableByName,
    unsupportedVariableByName,
    triggers,
    triggerByName,
    unsupportedTriggerByName,
    constants,
    constantByName,
    unsupportedConstantByName,
  };
}

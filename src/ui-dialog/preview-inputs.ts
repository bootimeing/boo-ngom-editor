import { EngineId } from '../types';
import { previewVariableContract, PreviewVariableKind } from './preview-variable-contracts';
import { normalizePreviewCollectionValue, resolvePreviewCollectionExpression, evaluatePreviewCollectionCondition } from './preview-collections';
import { runtimePreviewOutputIndexes, runtimePreviewImplicitOutputs } from './preview-command-outputs';
import type { NestedVariableAnalysisOptions } from '../utils/nested-variable-analysis';
import { matchPreviewEquipmentState, parsePreviewEquipmentState, previewEquipmentStateName, previewEquipmentOrdinaryLabels, previewEquipmentParts } from './preview-equipment-state';

export interface DialogPreviewInput {
  name: string;
  kind: PreviewVariableKind;
  value?: string;
  description?: string;
  typeUncertain?: boolean;
  scenario?: 'job' | 'namelist' | 'title' | 'equipment' | 'hero' | 'equipment-layout';
  equipmentNames?: string[];
  equipmentOrdinaryLabels?: readonly string[];
  equipmentSlot?: { key: string; label: string };
  equipmentName?: string;
  equipmentNameFolding?: 'ascii';
  equipmentActor?: 'hero';
  /** GEE CHECKITEMW [SLOT] selector; this is a slot-presence flag, not an item count. */
  equipmentPart?: string;
  /** A dynamic GEE item-name expression gets a local presence toggle. */
  equipmentDynamic?: boolean;
  channel?: 'client-display';
}
export type DialogPreviewValues = Readonly<Record<string, string>>;

/** GXX QuestCheckCondition: OR ignores TrueCount; 0 or >= group size uses AND. */
export function effectivePreviewConditionThreshold(engine: EngineId, threshold: number | undefined,
  conditionCount: number, isOr = false): number | undefined {
  if (engine === 'GEE' && (isOr || threshold === 0 || (threshold !== undefined && threshold >= conditionCount))) return undefined;
  return threshold;
}

// GEE's SameText unifies ASCII case for exact item checks. Keep the spelling
// separately for labels; do not impose Unicode/locale folding on other engines.
function foldEquipmentName(value: string): string {
  return value.replace(/[a-z]/g, char => char.toUpperCase());
}
export function normalizePreviewEquipmentValues(values: DialogPreviewValues, engine: EngineId): Record<string, string> {
  return Object.fromEntries(Object.entries(values).map(([name, value]) => [
    engine === 'GEE' && /^(?:H\.)?WORN\(.+\)$/.test(name) ? foldEquipmentName(name) : name, value,
  ]));
}
// Protect literal preview text while the source grammar parses delimiters. Restore
// only after parsing, so ':', '|', tags and /@ never become new UI instructions.
export function protectPreviewText(value: string): string {
  return value.replace(/[$:|{}<>/\\]/g, char => String.fromCharCode(0xe000 + char.charCodeAt(0)));
}
export function restorePreviewText(value: string): string {
  return value.replace(/[\ue024\ue03a\ue07c\ue07b\ue07d\ue03c\ue03e\ue02f\ue05c]/g,
    char => String.fromCharCode(char.charCodeAt(0) - 0xe000));
}
export function restorePreviewTextFields(value: unknown, seen = new Set<object>()): void {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === 'string' && ['text', 'value', 'previewValue', 'label', 'caption'].includes(key)) {
      (value as Record<string, unknown>)[key] = restorePreviewText(child);
    } else restorePreviewTextFields(child, seen);
  }
}
export function previewInputName(raw: string, engine: EngineId = 'GOM'): string | undefined {
  return previewVariableContract(raw, engine)?.name;
}
export function previewInputKind(name: string, engine: EngineId = 'GOM'): DialogPreviewInput['kind'] {
  return previewVariableContract(name, engine)?.kind || 'text';
}
export function validPreviewValue(input: DialogPreviewInput, value: unknown): value is string {
  if (input.scenario === 'equipment-layout') return parsePreviewEquipmentState(value) !== undefined;
  if (input.kind === 'list' || input.kind === 'dictionary') return normalizePreviewCollectionValue(input.kind, value) !== undefined;
  if (typeof value !== 'string' || value.length > 4096) return false;
  if (input.scenario === 'job') return ['warrior', 'wizard', 'taoist'].includes(value.toLowerCase());
  if (input.kind === 'flag') return value === '0' || value === '1';
  if (input.scenario === 'equipment' && input.kind === 'number') return /^\d+$/.test(value) && Number(value) <= 2147483647;
  if (input.kind === 'number') return /^[+-]?\d+(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value));
  return !/[\r\n\x00]/.test(value);
}

const conditionAliases: Readonly<Record<string, { name: string; minimum?: boolean }>> = {
  CHECKLEVEL: { name: 'LEVEL', minimum: true }, CHECKLEVELEX: { name: 'LEVEL' },
  CHECKGOLD: { name: 'GOLDCOUNT', minimum: true }, CHECKPKPOINT: { name: 'PKPOINT', minimum: true },
  CHECKGAMEGOLD: { name: 'GAMEGOLD' }, CHECKGAMEPOINT: { name: 'GAMEPOINT' },
  CHECKGAMEDIAMOND: { name: 'GAMEDIAMOND' }, CHECKGAMEGIRD: { name: 'GAMEGIRD' },
  CHECKCREDITPOINT: { name: 'CREDITPOINT' }, CHECKHP: { name: 'HP' }, CHECKMP: { name: 'MP' },
};

function equipmentCountInteger(raw: string): number | undefined {
  if (!/^[+-]?\d+$/.test(raw)) return undefined;
  const value = Number(raw);
  return Number.isInteger(value) && value >= -2147483648 && value <= 2147483647 ? value : undefined;
}
function equipmentCountOperand(raw: string): boolean {
  if (equipmentCountInteger(raw) !== undefined) return true;
  if (previewVariableContract(raw, 'GEE')?.kind === 'number') return true;
  const templates = templatesIn(raw);
  return templates.length === 1 && templates[0].start === 0 && templates[0].end === raw.length;
}

function isGeeEquipmentCommand(command: string, engine: EngineId): boolean {
  return engine === 'GEE' && /^(?:(?:H|HERO)\.)?CHECKITEMW$/.test(command);
}

/**
 * GXX CheckItemW has four documented slot selectors in addition to item-name
 * matching.  Ring and bracelet selectors intentionally have no single slot
 * key because either of their two physical slots satisfies the condition.
 */
const geeEquipmentPartSelectors: Readonly<Record<string, { label: string; key?: string }>> = {
  '[NECKLACE]': { label: '项链', key: 'GEE:3' },
  '[RING]': { label: '戒指' },
  '[ARMRING]': { label: '手镯' },
  '[WEAPON]': { label: '武器', key: 'GEE:1' },
  '[HELMET]': { label: '头盔', key: 'GEE:4' },
};

function equipmentPartInput(command: string, parts: readonly string[], engine: EngineId): DialogPreviewInput | undefined {
  if (!isGeeEquipmentCommand(command, engine) || parts.length < 1 || parts.length > 3) return undefined;
  const selector = parts[0].toUpperCase();
  const info = geeEquipmentPartSelectors[selector];
  if (!info) return undefined;
  // The optional count/match arguments are accepted by the client parser but
  // do not change a slot selector's any-item semantics.  Keep the accepted
  // surface narrow and reject arbitrary runtime text.
  if (parts.slice(1).some(part => equipmentCountInteger(part) === undefined
    && !previewVariableContract(part, 'GEE')
    && !(templatesIn(part).length === 1 && templatesIn(part)[0].start === 0 && templatesIn(part)[0].end === part.length))) return undefined;
  const actor = /^(?:H|HERO)\.CHECKITEMW$/i.test(command) ? 'hero' as const : undefined;
  return {
    name: `${actor ? 'H.' : ''}WORN(${selector})`,
    kind: 'flag',
    scenario: 'equipment',
    equipmentPart: selector,
    ...(info.key ? { equipmentSlot: { key: `${actor ? 'H:' : ''}${info.key}`, label: info.label } } : {}),
    ...(actor ? { equipmentActor: 'hero' as const } : {}),
    description: `${info.label}部位 · 任一装备，仅影响预览`,
  };
}

function dynamicEquipmentNameInput(command: string, parts: readonly string[], engine: EngineId): DialogPreviewInput | undefined {
  if (engine !== 'GEE' || command !== 'CHECKITEMW' || parts.length !== 1) return undefined;
  const raw = parts[0];
  const templates = templatesIn(raw);
  const dynamic = (templates.length === 1 && templates[0].start === 0 && templates[0].end === raw.length)
    || previewVariableContract(raw, 'GEE')?.kind === 'text';
  if (!dynamic || raw.length > 512 || /[\r\n\x00]/.test(raw)) return undefined;
  return {
    name: `WORN_DYNAMIC(${raw})`,
    kind: 'flag',
    scenario: 'equipment',
    equipmentDynamic: true,
    description: '动态装备名 · 本地切换是否满足',
  };
}

/** Register both possible mode branches; evaluation projects only current reads. */
function equipmentModeVariants(command: string, parts: readonly string[], engine: EngineId): readonly (readonly string[])[] {
  if (!isGeeEquipmentCommand(command, engine) || parts.length !== 3 || !equipmentCountOperand(parts[2])) return [parts];
  const literal = equipmentCountInteger(parts[2]);
  return (literal === undefined ? ['0', '1'] : [literal === 0 ? '0' : '1'])
    .map(mode => [parts[0], parts[1], mode]);
}

function scenarioInput(command: string, parts: readonly string[], engine: EngineId): DialogPreviewInput | undefined {
  if (engine === 'GEE' && /^(?:H|HERO)\.CHECKITEMW$/.test(command)) {
    const input = scenarioInput('CHECKITEMW', parts, engine);
    return input ? { ...input, name: `H.${input.name}`, equipmentActor: 'hero' } : undefined;
  }
  const part = equipmentPartInput(command, parts, engine);
  if (part) return part;
  const dynamicName = dynamicEquipmentNameInput(command, parts, engine);
  if (dynamicName) return dynamicName;
  const exactSingleItem = parts.length === 1 || (parts.length === 2 && parts[1] === '1')
    || (engine === 'GEE' && parts.length === 3 && parts[1] === '1' && parts[2] === '0');
  // GEE counts matches across ordinary, jewelry-box and god-bless equipment.
  // A zero threshold still needs a found item (NpcConditionCmd.CheckItemW).
  const geeExactCount = engine === 'GEE' && parts.length >= 1 && parts.length <= 3
    && (parts.length === 1 || equipmentCountOperand(parts[1]))
    && (parts.length < 3 || parts[2] === '0');
  if (command === 'CHECKITEMW' && (engine === 'GOM' || engine === 'GEE') && (exactSingleItem || geeExactCount)) {
    const item = parts[0].replace(/^"([^"]*)"$/, '$1');
    // Only leading bracket forms may be slot selectors. A suffix such as
    // 传送戒指[限时] is part of an ordinary database item name.
    if (engine === 'GEE' && item.startsWith('[')) return undefined;
    if (item && item.length <= 512 && !/[<>$"\r\n\x00]/.test(item)) {
      return {name:`WORN(${engine === 'GEE' ? foldEquipmentName(item) : item})`,
        ...(engine === 'GEE' ? { equipmentName: item, equipmentNameFolding: 'ascii' as const } : {}),
        kind:geeExactCount && parts.length > 1 && (equipmentCountInteger(parts[1]) === undefined || Number(parts[1]) > 1) ? 'number' : 'flag',scenario:'equipment',description:'勾选表示穿戴，仅影响预览'};
    }
    return undefined;
  }
  // GOM and 996PC document the one-name existence check. A title is a
  // local scenario flag, not a script variable or a query of the live player.
  if (command === 'CHECKTITLE' && (engine === 'GOM' || engine === '996PC') && parts.length === 1) {
    const title = parts[0].replace(/^"([^"]*)"$/, '$1');
    if (title && title.length <= 512 && !/[<>$"\r\n\x00]/.test(title)) {
      return { name: `TITLE(${title})`, kind: 'flag', scenario: 'title', description: '勾选表示拥有此称号，仅影响预览' };
    }
    return undefined;
  }
  if (engine !== 'GOM' || parts.length !== 1) return undefined;
  if (command === 'CHECKJOB' && /^(warrior|wizard|taoist)$/i.test(parts[0])) {
    return {name:'JOB',kind:'text',scenario:'job',description:'本地职业条件：warrior 战士、wizard 法师、taoist 道士；不读取在线人物'};
  }
  if (command === 'CHECKNAMELIST' && !/[<>\r\n\x00]/.test(parts[0]) && parts[0].length <= 512) {
    const file = parts[0].replace(/^"|"$/g,'').replace(/\\/g,'/').toLowerCase();
    return {name:`NAMELIST(${file})`,kind:'flag',scenario:'namelist',description:`本地模拟是否在名单 ${file} 中；不读取或修改名单文件`};
  }
  return undefined;
}

function partialEquipmentItems(command: string, parts: readonly string[], engine: EngineId,
  dataOptions?: NestedVariableAnalysisOptions): readonly string[] | undefined {
  if (engine !== 'GEE' || !/^(?:(?:H|HERO)\.)?CHECKITEMW$/.test(command) || parts.length !== 3
    || !equipmentCountOperand(parts[1])
    || !/^[+-]?\d+$/.test(parts[2]) || !Number.isSafeInteger(Number(parts[2]))
    || Number(parts[2]) === 0 || Number(parts[2]) < -2147483648 || Number(parts[2]) > 2147483647) return undefined;
  const pattern = parts[0].replace(/^"([^"]*)"$/, '$1');
  if (!pattern || pattern.startsWith('[') || pattern.length > 512 || /[<>$"\r\n\x00]/.test(pattern)) return undefined;
  const items = dataOptions?.resolvePreviewEquipmentMatches?.(pattern);
  if (!items || items.length > 128) return undefined;
  // Keep injected data resolvers subject to the same bounded identity contract.
  if (items.some(item => !item || item.startsWith('[') || item.length > 512 || !item.includes(pattern) || /[<>$"\r\n\x00]/.test(item))) return undefined;
  const identities = items.map(foldEquipmentName);
  return new Set(identities).size === items.length ? items : undefined;
}

/** Only <$ starts a template; bare < remains a comparison operator. */
export function splitPreviewArguments(source: string): string[] {
  const parts: string[] = [];
  let start = -1, templates = 0, brackets = 0, parens = 0, quote = '';
  for (let i = 0; i <= source.length; i++) {
    const char = source[i];
    if (i === source.length || (!quote && !templates && !brackets && !parens && /\s/.test(char))) {
      if (start >= 0) parts.push(source.slice(start, i));
      start = -1;
      continue;
    }
    if (!quote && !templates && !brackets && !parens && char === ';' && (i === 0 || /\s/.test(source[i - 1]))) break;
    if (start < 0) start = i;
    if (quote) { if (char === quote) quote = ''; continue; }
    if (char === '"') { quote = char; continue; }
    if (char === '<' && source[i + 1] === '$') templates++;
    else if (char === '>' && templates) templates--;
    else if (char === '[') brackets++;
    else if (char === ']' && brackets) brackets--;
    else if (char === '(') parens++;
    else if (char === ')' && parens) parens--;
  }
  return parts;
}

interface PreviewTemplate { start: number; end: number; expression: string }
function templatesIn(source: string): PreviewTemplate[] {
  const result: PreviewTemplate[] = [];
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== '<' || source[i + 1] !== '$') continue;
    const start = i;
    let depth = 1;
    for (i += 2; i < source.length; i++) {
      if (source[i] === '<' && source[i + 1] === '$') { depth++; i++; }
      else if (source[i] === '>' && --depth === 0) {
        result.push({ start, end: i + 1, expression: source.slice(start + 2, i) });
        break;
      }
    }
  }
  return result;
}

type PreviewRead = (name: string) => string | undefined;

/**
 * Resolves an engine-provided function-like template such as
 * `<$ConfigTable(1,2)>`.  The normal preview contract deliberately treats
 * unknown calls as unresolved; callers that have an evidence-backed local
 * source (for example a CSVOPENCACHE alias) may opt in to resolving it.
 * `resolveArgument` applies the same nested-template rules to each argument.
 */
export type PreviewFunctionResolver = (
  name: string,
  args: readonly string[],
  resolveArgument: (raw: string) => string | undefined,
) => string | undefined;
function previewDefault(kind: PreviewVariableKind): string {
  return kind === 'flag' || kind === 'number' ? '0' : kind === 'list' ? '[]' : kind === 'dictionary' ? '{}' : '预览文字';
}

function expandTemplates(raw: string, read: PreviewRead, engine: EngineId, depth: number,
  resolveFunction?: PreviewFunctionResolver): string | undefined {
  if (depth > 12 || raw.length > 65536) return undefined;
  const templates = templatesIn(raw);
  let result = '', cursor = 0;
  for (const template of templates) {
    result += raw.slice(cursor, template.start);
    const resolved = resolveExpression(template.expression, read, engine, depth + 1, true, resolveFunction);
    if (resolved === undefined) return undefined;
    result += resolved;
    cursor = template.end;
  }
  result += raw.slice(cursor);
  return result.includes('<$') ? undefined : result;
}

function resolveExpression(raw: string, read: PreviewRead, engine: EngineId, depth: number,
  explicit = false, resolveFunction?: PreviewFunctionResolver): string | undefined {
  if (depth > 12) return undefined;
  let token = raw.trim();
  if (/^"[\s\S]*"$/.test(token)) return token.slice(1, -1);
  const constToken = /^(?:\$)?CONST\(([\s\S]*)\)$/i.exec(token);
  if (constToken) return constToken[1];
  const whole = templatesIn(token);
  if (whole.length === 1 && whole[0].start === 0 && whole[0].end === token.length) {
    return resolveExpression(whole[0].expression, read, engine, depth + 1, true, resolveFunction);
  }
  // Split function arguments before expanding nested templates.  A user value
  // such as `A,B` (or a literal `)`), supplied through `<$STR(S$key)>`, is a
  // single engine argument and must not be re-tokenized as two function args.
  const rawCall = /^([A-Za-z_\u3400-\u9fff][A-Za-z0-9_.\u3400-\u9fff]*)\(([\s\S]*)\)$/.exec(token);
  if (rawCall && resolveFunction) {
    const args = splitFunctionArguments(rawCall[2]);
    const resolved = resolveFunction(rawCall[1], args,
      argument => resolveExpression(argument, read, engine, depth + 1, false, resolveFunction));
    if (resolved !== undefined) return resolved;
  }
  const expanded = expandTemplates(token, read, engine, depth, resolveFunction);
  if (expanded === undefined) return undefined;
  token = expanded;
  const str = /^STR\(([\s\S]*)\)$/i.exec(token);
  if (str) return resolveExpression(str[1], read, engine, depth + 1, true, resolveFunction);
  // CSVOPENCACHE and a few compatible engines expose cached table reads as
  // function-like templates.  Keep the function surface opt-in: without a
  // resolver these remain unknown instead of being guessed from their name.
  // Arrays/dictionaries are evaluated through their own bounded, engine-aware contract.
  if (/^(?:GL|[LD])\$/i.test(token)) return resolvePreviewCollectionExpression(token, read, engine);
  const contract = previewVariableContract(token, engine, explicit);
  if (contract) {
    const value = read(contract.name);
    return value ?? (contract.typeUncertain ? undefined : previewDefault(contract.kind));
  }
  if (explicit || /^(?:[PDMNSIGAUTJZ]\d+|(?:GL|[NSLD])\$|(?:CSTR|STR)\()/i.test(token)) return undefined;
  return token;
}

/** Resolve nested display/condition operands without executing any script action. */
export function resolvePreviewExpression(raw: string, read: PreviewRead, engine: EngineId = 'GOM',
  resolveFunction?: PreviewFunctionResolver): string | undefined {
  return resolveExpression(raw, read, engine, 0, false, resolveFunction);
}

function splitFunctionArguments(value: string): string[] {
  const parts: string[] = [];
  let start = 0, angle = 0, parentheses = 0, quote = '';
  for (let index = 0; index <= value.length; index++) {
    const character = value[index] || '';
    if (quote) {
      if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'") { quote = character; continue; }
    if (character === '<' && value[index + 1] === '$') { angle++; index++; continue; }
    if (character === '>' && angle > 0) { angle--; continue; }
    if (character === '(') { parentheses++; continue; }
    if (character === ')' && parentheses > 0) { parentheses--; continue; }
    if ((character === ',' || index === value.length) && angle === 0 && parentheses === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  return parts.length === 1 && parts[0] === '' ? [] : parts;
}

// These commands have variable operands. Output-only file readers are listed by
// position to avoid mistaking a path/map called U101 for a preview variable.
const operandCommands = new Set(['EQUAL', 'LARGE', 'SMALL', 'COMPARETEXT', 'CHECKCONTAINSTEXT', 'MOV', 'MOVR', 'INC', 'DEC', 'MUL', 'DIV',
  'FORMULATION', 'EXTRACTSTRING', 'GETLISTVARCOUNT', 'GETLISTVARINDEX',
  'GETLISTMAXVAR', 'GETLISTMINVAR', 'SORTLIST', 'REVERSELIST', 'ADDTOLIST', 'INSERTTOLIST',
  'REPLACELISTBYINDEX', 'REPLACELISTBYCONTENT', 'REMOVELISTBYINDEX', 'REMOVELISTBYCONTENT', 'EXTRACTLIST',
  'CHECKVARINLIST', 'CHECKLISTALLDIGIT']);
const gomCollectionCommands = new Set(['JOINLIST', 'SPLITTOLIST', 'CLONELIST', 'CONCATLIST', 'UNIQUELIST', 'SUMLIST', 'COUNTINLIST', 'SHUFFLELIST', 'RANDOMPICKLIST']);
const dictionaryCommands = new Set(['CHECKINDICT', 'CHECKDICTALLDIGIT', 'GETDICTKEYCOUNT', 'GETDICTITEMS', 'GETDICTMAXVALUE', 'GETDICTMINVALUE']);

/** Read explicit references and semantically variable-bearing operands, never SAY prose. */
export function discoverPreviewInputs(text: string, values: DialogPreviewValues = {}, engine: EngineId = 'GOM', dataOptions?: NestedVariableAnalysisOptions): DialogPreviewInput[] {
  values = normalizePreviewEquipmentValues(values, engine);
  const found = new Map<string, DialogPreviewInput>();
  const declared = new Map<string, PreviewVariableKind>();
  let declarationMode = '';
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*#/.test(line)) { declarationMode = /^\s*#(IF|OR|ACT|ELSEACT|SAY|ELSESAY)(?:\s*\([^)]*\))?\s*$/i.exec(line)?.[1].toUpperCase() || ''; continue; }
    if (/^\s*\[@/.test(line)) { declarationMode = ''; continue; }
    if (!['ACT', 'ELSEACT'].includes(declarationMode)) continue;
    const match = /^\s*VAR\s+(Integer|String)\s+(HUMAN|GLOBAL|GUILD)\s+([A-Za-z0-9_\u3400-\u9fff]+)(?:\s|$)/i.exec(line);
    if (match) declared.set(`${match[2].toUpperCase()}(${match[3]})`, /^Integer$/i.test(match[1]) ? 'number' : 'text');
  }
  const add = (raw: string, explicit = false) => {
    const contract = previewVariableContract(raw, engine, explicit);
    if (!contract) return;
    const input: DialogPreviewInput = { ...contract };
    if (found.get(input.name)?.scenario) return;
    const declaration = declared.get(input.name);
    if (declaration) { input.kind = declaration; delete input.typeUncertain; }
    if (Object.prototype.hasOwnProperty.call(values, input.name) && validPreviewValue(input, values[input.name])) input.value = values[input.name];
    found.set(input.name, input);
  };
  const read: PreviewRead = name => {
    add(name);
    const input = found.get(name);
    return input?.value ?? (input ? previewDefault(input.kind) : undefined);
  };
  const discoverExpression = (raw: string, explicit = false, depth = 0): void => {
    if (depth > 12) return;
    if (/^(?:<\$)?(?:\$)?CONST\(/i.test(raw)) return;
    for (const part of templatesIn(raw)) discoverExpression(part.expression, true, depth + 1);
    let token = expandTemplates(raw, read, engine, depth);
    if (token === undefined) return;
    const wrapped = /^STR\(([\s\S]*)\)$/i.exec(token);
    if (wrapped) token = wrapped[1];
    const collection = /^((?:GL|[LD])\$[^\[\]\s]+)\[([^\[\]]*)\]$/i.exec(token);
    if (collection) { add(collection[1]); discoverExpression(collection[2], false, depth + 1); return; }
    add(token, explicit);
    if (explicit) resolveExpression(token, read, engine, depth, true);
  };
  let mode = '';
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || /^(?:;|\/\/)/.test(trimmed)) continue;
    if (/^\[@/.test(trimmed)) { mode = ''; continue; }
    if (/^#/.test(trimmed)) { mode = /^#(IF|OR|ACT|ELSEACT|SAY|ELSESAY)(?:\s*\([^)]*\))?\s*$/i.exec(trimmed)?.[1].toUpperCase() || ''; continue; }
    for (const template of templatesIn(trimmed)) discoverExpression(template.expression, true);
    if (!['IF', 'OR', 'ACT', 'ELSEACT'].includes(mode)) continue;
    const parts = splitPreviewArguments(trimmed.replace(/^(?:NOT\s+)+/i, ''));
    const command = (parts.shift() || '').toUpperCase();
    if (mode === 'IF' || mode === 'OR') {
      if (isGeeEquipmentCommand(command, engine)) {
        for (const operand of parts.slice(1,3)) if (equipmentCountOperand(operand)) discoverExpression(operand);
        if (parts.length >= 1 && parts.length <= 3) {
          const hero = /^(H|HERO)\./.test(command);
          const name = previewEquipmentStateName(hero);
          found.set(name, { name, kind: 'text', scenario: 'equipment-layout',
            ...(hero ? { equipmentActor: 'hero' as const } : {}),
            equipmentOrdinaryLabels: previewEquipmentOrdinaryLabels,
            ...(parsePreviewEquipmentState(values[name]) ? { value: values[name] } : {}),
            description: '按容器和槽位统一计算条件，仅影响预览' });
          if (hero) found.set('HERO(PRESENT)', { name: 'HERO(PRESENT)', kind: 'flag', scenario: 'hero',
            ...(values['HERO(PRESENT)'] === '0' || values['HERO(PRESENT)'] === '1' ? { value: values['HERO(PRESENT)'] } : {}) });
          // Explicit layouts support dynamic item names even with count/mode.
          if (templatesIn(parts[0]).length || previewVariableContract(parts[0], engine)?.kind === 'text') discoverExpression(parts[0], true);
        }
      }
      const dynamicName = dynamicEquipmentNameInput(command, parts, engine);
      if (dynamicName) discoverExpression(parts[0], true);
      let supportedEquipment = false;
      const scenarios = equipmentModeVariants(command, parts, engine).flatMap(variant => {
        const scenario = scenarioInput(command, variant, engine);
        const partialItems = scenario ? undefined : partialEquipmentItems(command, variant, engine, dataOptions);
        supportedEquipment ||= !!scenario || partialItems !== undefined;
        return scenario ? [scenario] : (partialItems || [])
          .map(item => scenarioInput(command, [item, variant[1]], engine))
          .filter((input): input is DialogPreviewInput => input !== undefined);
      });
      if (engine === 'GEE' && /^(?:H|HERO)\.CHECKITEMW$/.test(command) && supportedEquipment) {
        scenarios.push({ name: 'HERO(PRESENT)', kind: 'flag', scenario: 'hero', description: '仅影响预览' });
      }
      for (const scenario of scenarios) {
        if (scenario.scenario === 'equipment') {
          // Promote once for all thresholds/NOT uses; source order cannot turn
          // a count back into a flag or discard an already validated count.
          if (found.get(scenario.name)?.kind === 'number') scenario.kind = 'number';
          scenario.equipmentName = found.get(scenario.name)?.equipmentName || scenario.equipmentName;
          scenario.equipmentSlot = scenario.equipmentSlot
            || (scenario.equipmentPart ? undefined
              : dataOptions?.resolvePreviewEquipmentSlot?.(scenario.equipmentName || scenario.name.slice(5,-1)));
          if (scenario.equipmentActor === 'hero' && scenario.equipmentSlot) scenario.equipmentSlot = { ...scenario.equipmentSlot, key: `H:${scenario.equipmentSlot.key}` };
          if (scenario.equipmentSlot && !scenario.equipmentPart) scenario.description = `${scenario.equipmentSlot.label} · 同部位单选`;
          if (scenario.kind === 'number') scenario.description = '穿戴数量 · 仅影响预览';
        }
        if (Object.prototype.hasOwnProperty.call(values, scenario.name) && validPreviewValue(scenario, values[scenario.name])) scenario.value = values[scenario.name];
        found.set(scenario.name, scenario);
      }
    }
    const alias = conditionAliases[command];
    if (alias) { add(alias.name); for (const part of parts) discoverExpression(part); }
    if (['CHECK', 'SET', 'RESET'].includes(command)) {
      const flags = previewFlagNames(parts[0] || '', read, engine);
      for (const flag of flags || []) add(flag);
      if (command === 'RESET' && flags?.length === 1) {
        const count = resolvePreviewExpression(parts[2] || '', read, engine);
        if (count !== undefined && /^\d+$/.test(count) && Number(count) <= 1024) {
          const start = Number(flags[0].slice(1, -1));
          for (let i = 0; i < Number(count); i++) add(`[${start + i}]`);
        }
      }
    }
    if (['VAR', 'CHECKVAR', 'CALCVAR', 'SAVEVAR', 'LOADVAR'].includes(command)) {
      const start = command === 'VAR' ? 1 : 0;
      if (parts[start] && parts[start + 1]) add(`${parts[start]}(${parts[start + 1]})`);
      if (command === 'CHECKVAR' || command === 'CALCVAR') for (const part of parts.slice(3)) discoverExpression(part);
    }
    if (operandCommands.has(command) || (engine === 'GOM' && gomCollectionCommands.has(command))
      || (engine !== '996PC' && dictionaryCommands.has(command))) for (const operand of parts) discoverExpression(operand);
    // Share the audited write identities with resolver invalidation. Discovery
    // does not mean the command is simulated. Prefix-producing commands such as
    // SortHumVar are not direct targets; only explicit suffix references appear.
    for (const position of runtimePreviewOutputIndexes(command, engine) || []) discoverExpression(parts[position] || '');
    if (command === 'GETLISTSTRING') for (const operand of parts.slice(2)) discoverExpression(operand);
    for (const name of runtimePreviewImplicitOutputs(command, engine) || []) add(name);
  }
  for (const input of found.values()) if (input.scenario === 'equipment-layout') {
    input.equipmentNames = [...new Set([...found.values()].filter(peer => peer.scenario === 'equipment'
      && peer.equipmentActor === input.equipmentActor && !peer.equipmentPart && !peer.equipmentDynamic)
      .map(peer => peer.equipmentName || peer.name.replace(/^(?:H\.)?WORN\(|\)$/g, '')))];
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
}

/** Apply one validated local input atomically, clearing equipment peers even if hidden. */
export function applyPreviewInputValue(inputs: readonly DialogPreviewInput[], values: DialogPreviewValues,
  input: DialogPreviewInput, value: string | null,
  resolveSlot?: NestedVariableAnalysisOptions['resolvePreviewEquipmentSlot']): Record<string,string> {
  const result = normalizePreviewEquipmentValues(values, input.equipmentNameFolding === 'ascii' ? 'GEE' : 'GOM');
  if (value !== null && validPreviewValue(input, value) && Number(value) > 0 && input.scenario === 'equipment' && input.equipmentSlot) {
    for (const name of new Set([...Object.keys(result), ...inputs.map(item=>item.name)])) {
      const identity = /^(H\.)?WORN\((.+)\)$/.exec(name);
      const resolved = identity ? resolveSlot?.(identity[2]) : undefined;
      const slot = inputs.find(item=>item.name===name)?.equipmentSlot
        || (resolved && identity?.[1] ? { ...resolved, key: `H:${resolved.key}` } : resolved);
      if (name !== input.name && slot?.key === input.equipmentSlot.key) result[name] = '0';
    }
  }
  delete result[input.name];
  if (value !== null) result[input.name] = value;
  return result;
}

export function previewFlagNames(raw: string, read?: PreviewRead, engine: EngineId = 'GOM'): string[] | undefined {
  if (read) {
    const expanded = expandTemplates(raw, read, engine, 0);
    if (expanded === undefined) return undefined;
    raw = expanded;
  }
  if (!/^\[[\d,\- ]+\]$/.test(raw)) return undefined;
  const names = new Set<string>();
  for (const piece of raw.slice(1, -1).split(',')) {
    const range = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(piece.trim());
    if (!range) return undefined;
    const start = Number(range[1]), end = Number(range[2] || range[1]);
    const min = engine === '996PC' ? 0 : 1, max = engine === '996PC' ? 999 : 1024;
    if (start < min || end > max || end < start) return undefined;
    for (let n = start; n <= end; n++) names.add(`[${n}]`);
  }
  return [...names];
}

function compareDecimal(a: string, b: string): number | undefined {
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(a) || !/^[+-]?\d+(?:\.\d+)?$/.test(b)) return undefined;
  const scale = Math.max(a.split('.')[1]?.length || 0, b.split('.')[1]?.length || 0);
  const integer = (value: string) => {
    const [whole, fraction = ''] = value.split('.');
    return BigInt(whole + fraction.padEnd(scale, '0'));
  };
  const left = integer(a), right = integer(b);
  return left === right ? 0 : left > right ? 1 : -1;
}

/** Undefined is deliberately not false: NOT an unsupported condition is still unknown. */
export function evaluatePreviewCondition(source: string, read: PreviewRead, engine: EngineId = 'GOM', dataOptions?: NestedVariableAnalysisOptions,
  effects?: { heroAbsent?: boolean }, resolveFunction?: PreviewFunctionResolver): boolean | undefined {
  const parts = splitPreviewArguments(source.trim());
  let inverted = false;
  while (/^NOT$/i.test(parts[0] || '')) { parts.shift(); inverted = !inverted; }
  const command = (parts.shift() || '').toUpperCase();
  let result: boolean | undefined;
  const resolve = (raw: string) => resolvePreviewExpression(raw, read, engine, resolveFunction);
  const compare = (left: string | undefined, op: string, right: string | undefined): boolean | undefined => {
    if (left === undefined || right === undefined) return undefined;
    const comparison = compareDecimal(left, right);
    if (op === '=' || op === '==') return comparison === undefined ? left === right : comparison === 0;
    if (op === '!=' || op === '<>') return comparison === undefined ? left !== right : comparison !== 0;
    if (comparison === undefined) return undefined;
    if (op === '>') return comparison > 0;
    if (op === '<') return comparison < 0;
    if (op === '>=' || op === '?') return comparison >= 0;
    if (op === '<=') return comparison <= 0;
    return undefined;
  };
  if (isGeeEquipmentCommand(command, engine) && parts.length >= 1 && parts.length <= 3) {
    const isHero = /^(H|HERO)\./.test(command);
    const layout = parsePreviewEquipmentState(read(previewEquipmentStateName(isHero)));
    if (layout) {
      const presence = isHero ? read('HERO(PRESENT)') ?? '0' : '1';
      const name = resolve(parts[0]);
      // GXX slot-selector branches return before name-count/matching logic.
      // Ignored operands must not add fake input dependencies or block the slot.
      const partSelector = name !== undefined && !!previewEquipmentParts[name.toUpperCase()];
      const count = partSelector ? 1 : equipmentCountInteger(resolve(parts[1] ?? '1') ?? '');
      const mode = partSelector ? 0 : equipmentCountInteger(resolve(parts[2] ?? '0') ?? '');
      let result = name !== undefined && count !== undefined && mode !== undefined
        ? matchPreviewEquipmentState(layout, name, count, mode === 0) : undefined;
      if (isHero && presence === '0') { if (effects) effects.heroAbsent = true; result = false; }
      else if (isHero && presence !== '1') result = undefined;
      return result === undefined ? undefined : inverted ? !result : result;
    }
  }
  let unresolvedMatchingMode = false;
  if (isGeeEquipmentCommand(command, engine) && parts.length === 3 && equipmentCountOperand(parts[2])) {
    const matchingMode = equipmentCountInteger(resolve(parts[2]) ?? '');
    // Still collect inputs and check hero absence (which terminates the group
    // before parameter evaluation in GXX), but do not certify an invalid mode.
    unresolvedMatchingMode = matchingMode === undefined;
    parts[2] = matchingMode === 0 ? '0' : '1';
    if (unresolvedMatchingMode) parts[2] = '0';
  }
  const scenario = scenarioInput(command, parts, engine);
  const partialItems = scenario ? undefined : partialEquipmentItems(command, parts, engine, dataOptions);
  const hero = engine === 'GEE' && /^(?:H|HERO)\.CHECKITEMW$/.test(command) && (scenario || partialItems !== undefined);
  const presence = hero ? read('HERO(PRESENT)') ?? '0' : '1';
  if (partialItems !== undefined) {
    const required = equipmentCountInteger(resolve(parts[1]) ?? '');
    let total = 0, valid = true;
    // Read every candidate even after the threshold is met, to retain all
    // condition dependencies and expose controls needed to switch it back off.
    for (const item of partialItems) {
      const value = read(`${hero ? 'H.' : ''}WORN(${foldEquipmentName(item)})`) ?? '0';
      if (!/^\d+$/.test(value) || Number(value) > 2147483647) valid = false;
      else total += Number(value);
    }
    result = valid && required !== undefined ? total >= Math.max(1, required) : undefined;
  } else if (scenario) {
    const value = read(scenario.name);
    // A dynamic item-name expression is a visible condition dependency even
    // though its local presence toggle deliberately remains independent of
    // database/IDX provenance.
    if (scenario.equipmentDynamic) resolve(parts[0]);
    const required = scenario.scenario === 'equipment' && engine === 'GEE'
      ? equipmentCountInteger(resolve(parts[1] ?? '1') ?? '') : undefined;
    result = scenario.scenario === 'equipment' && engine === 'GEE' && !scenario.equipmentPart && !scenario.equipmentDynamic
      ? /^\d+$/.test(value ?? '0') && Number(value ?? '0') <= 2147483647 && required !== undefined
        ? Number(value ?? '0') >= Math.max(1, required) : undefined
      : scenario.scenario === 'job'
      ? value === undefined || !/^(warrior|wizard|taoist)$/i.test(value) ? undefined : value.toLowerCase() === parts[0].toLowerCase()
      : (value ?? '0') === '1';
  } else if (command === 'CHECK' && parts.length === 2) {
    const flags = previewFlagNames(parts[0], read, engine), expected = resolve(parts[1]);
    if (flags && (expected === '0' || expected === '1')) result = flags.every(name => (read(name) ?? '0') === expected);
  } else if (['EQUAL', 'LARGE', 'SMALL'].includes(command) && parts.length === 2) {
    result = compare(resolve(parts[0]), command === 'EQUAL' ? '=' : command === 'LARGE' ? '>' : '<', resolve(parts[1]));
  } else if ((engine === 'GOM' || engine === 'GEE') && command === 'EQUAL' && parts.length === 1
    && previewVariableContract(parts[0], engine)?.kind === 'text') {
    result = compare(resolve(parts[0]), '=', '');
  } else if (['COMPARETEXT', 'CHECKCONTAINSTEXT'].includes(command) && parts.length === 2) {
    const a = resolve(parts[0]), b = resolve(parts[1]);
    if (a !== undefined && b !== undefined) {
      const sensitive = command === 'COMPARETEXT' ? a === b : a.includes(b);
      const insensitive = command === 'COMPARETEXT' ? a.toLowerCase() === b.toLowerCase() : a.toLowerCase().includes(b.toLowerCase());
      // GOM/996PC own chapters explicitly say case-insensitive; GEE's does not.
      result = engine !== 'GEE' ? insensitive : sensitive === insensitive ? sensitive : undefined;
    }
  } else if (command === 'CHECKVAR' && parts.length === 4) {
    const contract = previewVariableContract(`${parts[0]}(${parts[1]})`, engine);
    if (contract) result = compare(read(contract.name) ?? '0', parts[2], resolve(parts[3]));
  } else if (conditionAliases[command]) {
    const alias = conditionAliases[command];
    // 996PC catalog records these legacy names only; use its documented EX form.
    if (engine === '996PC' && ['CHECKLEVEL', 'CHECKPKPOINT'].includes(command)) return undefined;
    const left = read(alias.name) ?? '0';
    if (alias.minimum && parts.length === 1) result = compare(left, '>=', resolve(parts[0]));
    else if (!alias.minimum && parts.length === 2) result = compare(left, parts[0], resolve(parts[1]));
    else if (['CHECKHP', 'CHECKMP'].includes(command) && parts.length === 4) {
      const a = compare(left, parts[0], resolve(parts[1])), b = compare(left, parts[2], resolve(parts[3]));
      result = a === false || b === false ? false : a === true && b === true ? true : undefined;
    }
  } else result = evaluatePreviewCollectionCondition(command, parts.join(' '), read, engine);
  if (unresolvedMatchingMode) result = undefined;
  if (hero && presence === '0') {
    if (effects) effects.heroAbsent = true;
    result = false;
  } else if (hero && presence !== '1') result = undefined;
  return result === undefined ? undefined : inverted ? !result : result;
}

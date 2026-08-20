import { EngineId } from '../types';

export type ScriptLabelReferenceKind = 'ui' | 'goto';

export interface ScriptLabelReference {
  kind: ScriptLabelReferenceKind;
  name: string;
  rawName: string;
  markerStart: number;
  nameStart: number;
  end: number;
}

export interface LocatedScriptLabelReference extends ScriptLabelReference {
  line: number;
}

export interface ScriptLabelDefinition {
  name: string;
  key: string;
  line: number;
  start: number;
  end: number;
}

export interface ScriptLabelResolutionOptions {
  engine?: EngineId;
  additionalDefinedLabelKeys?: ReadonlySet<string>;
  skipSectionedDataDocuments?: boolean;
  isAdditionalDefinedLabel?: (normalizedName: string) => boolean;
}

// 官方系统回调标签（按钮/对话标签中的 /@ 或 /@@ 调用），用于避免误报
const OFFICIAL_SYSTEM_UI_LABELS = new Set([
  'BUHERO',
  'BUILDGUILDNOW',
  'CASTLENAME',
  'CHECKNO',
  'COPYTOCLIPBOARD1',
  'CREATEHERO',
  'DEALGOLD',
  'DEALYBME',
  'DONATE',
  'GUILDWAR',
  'OFFLINEMSG',
  'RECEIPTS',
  'SENDMSG',
  'USEITEMNAME',
  'USEITEMNAME0',
  'USEITEMNAME1',
  'USEITEMNAME2',
  'USEITEMNAME3',
  'USEITEMNAME4',
  'USEITEMNAME5',
  'USEITEMNAME6',
  'USEITEMNAME7',
  'USEITEMNAME8',
  'USEITEMNAME9',
  'USEITEMNAME10',
  'USEITEMNAME11',
  'USEITEMNAME12',
  'INPUTSTRING',
  'INPUTSTRING1',
  'INPUTSTRING2',
  'INPUTSTRING3',
  'INPUTSTRING10',
  'INPUTSTRING22',
  'INPUTSTRING40',
  'INPUTSTRING60',
  'INPUTSTRING61',
  'INPUTSTRING62',
  'INPUTSTRING63',
  'INPUTINTEGER',
  'INPUTINTEGER1',
  'INPUTINTEGER2',
  'INPUTINTEGER3',
  'INPUTINTEGER22',
  'INPUTINTEGER41',
  'INPUTINTEGER300',
  'WITHDRAWAL',
]);

export function isScriptCommentLine(line: string): boolean {
  return /^\s*(?:;|\/\/)/.test(line);
}

function isReferenceTerminator(character: string): boolean {
  return /\s/.test(character) || character === ']' || character === '>'
    || character === '/' || character === '\\' || character === '(';
}

function isGenericAtLabelTerminator(character: string): boolean {
  return /\s/.test(character) || '[]()<>{},;:/\\'.includes(character);
}

function readUntilTerminator(
  text: string,
  start: number,
  isTerminator: (character: string) => boolean
): string {
  let end = start;
  while (end < text.length && !isTerminator(text[end])) end++;
  return text.slice(start, end);
}

function normalizeReferenceName(rawName: string, kind: ScriptLabelReferenceKind): string {
  // /@@InputStringN and /@@InputIntegerN dispatch to [@InputStringN]/[@InputIntegerN].
  if (kind === 'ui' && /^@INPUT(?:STRING|INTEGER)\d+$/i.test(rawName)) {
    return rawName.slice(1);
  }
  return rawName;
}

function createReference(
  lineText: string,
  kind: ScriptLabelReferenceKind,
  markerStart: number,
  nameStart: number
): ScriptLabelReference | undefined {
  const rawName = readUntilTerminator(lineText, nameStart, isReferenceTerminator);
  if (!rawName) return undefined;
  return {
    kind,
    name: normalizeReferenceName(rawName, kind),
    rawName,
    markerStart,
    nameStart,
    end: nameStart + rawName.length,
  };
}

export function normalizeScriptLabelKey(label: string): string {
  return label.trim().toUpperCase();
}

export function findScriptLabelDefinitions(lines: string[]): ScriptLabelDefinition[] {
  const definitions: ScriptLabelDefinition[] = [];
  for (let line = 0; line < lines.length; line++) {
    if (isScriptCommentLine(lines[line])) continue;
    const match = /^\s*\[@([^\]]+)\]/.exec(lines[line]);
    if (!match) continue;
    const markerStart = match[0].indexOf('[@');
    definitions.push({
      name: match[1],
      key: normalizeScriptLabelKey(match[1]),
      line,
      start: markerStart,
      end: markerStart + match[0].trimStart().length,
    });
  }
  return definitions;
}

export function isSectionedScriptDataDocument(lines: string[]): boolean {
  let hasSection = false;
  let hasAssignment = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || isScriptCommentLine(line)) continue;
    if (/^#(?:IF|OR|ACT|ELSEACT|SAY|ELSESAY|CALL|INCLUDE)\b/i.test(line)
      || /^\[@[^\]]+\]/.test(line)
      || /\bGOTO\s+@/i.test(line)) {
      return false;
    }
    if (/^\[(?![@~])[^\]]+\]$/.test(line)) hasSection = true;
    if (/^[^=[\]]+\s*=/.test(line)) hasAssignment = true;
  }
  return hasSection && hasAssignment;
}

export function isEngineNativeScriptLabelReference(
  reference: ScriptLabelReference
): boolean {
  if (reference.kind !== 'ui') return false;
  const key = normalizeScriptLabelKey(reference.name).replace(/^@+/, '');
  if (OFFICIAL_SYSTEM_UI_LABELS.has(key)) {
    return true;
  }
  return key === 'REQUESTCASTLEWARNOW'
    || key === 'REPAIRDOORNOW'
    || /^REPAIRWALLNOW[1-3]$/.test(key)
    || /^HIREGUARDNOW[1-4]$/.test(key)
    || /^HIREARCHERNOW(?:[1-9]|1[0-2])$/.test(key);
}

export function findScriptLabelReferences(lineText: string): ScriptLabelReference[] {
  if (isScriptCommentLine(lineText)) return [];

  const references: ScriptLabelReference[] = [];
  const uiMarker = /\/@/g;
  let match: RegExpExecArray | null;
  while ((match = uiMarker.exec(lineText)) !== null) {
    const reference = createReference(lineText, 'ui', match.index, match.index + match[0].length);
    if (reference) references.push(reference);
  }

  const gotoMarker = /\bGOTO[\t ]+@/gi;
  while ((match = gotoMarker.exec(lineText)) !== null) {
    const reference = createReference(lineText, 'goto', match.index, match.index + match[0].length);
    if (reference) references.push(reference);
  }

  return references.sort((left, right) => left.markerStart - right.markerStart);
}

export function findScriptLabelReferencesInText(text: string): ScriptLabelReference[] {
  const references: ScriptLabelReference[] = [];
  let lineStart = 0;

  while (lineStart <= text.length) {
    let lineEnd = lineStart;
    while (lineEnd < text.length && text[lineEnd] !== '\r' && text[lineEnd] !== '\n') lineEnd++;
    for (const reference of findScriptLabelReferences(text.slice(lineStart, lineEnd))) {
      references.push({
        ...reference,
        markerStart: reference.markerStart + lineStart,
        nameStart: reference.nameStart + lineStart,
        end: reference.end + lineStart,
      });
    }
    if (lineEnd >= text.length) break;
    lineStart = lineEnd + (text[lineEnd] === '\r' && text[lineEnd + 1] === '\n' ? 2 : 1);
  }

  return references;
}

export function findUndefinedScriptLabelReferences(
  lines: string[],
  definedLabelKeys: ReadonlySet<string>,
  options: ScriptLabelResolutionOptions = {}
): LocatedScriptLabelReference[] {
  if (options.skipSectionedDataDocuments && isSectionedScriptDataDocument(lines)) {
    return [];
  }
  const unresolved: LocatedScriptLabelReference[] = [];
  for (let line = 0; line < lines.length; line++) {
    for (const reference of findScriptLabelReferences(lines[line])) {
      const key = normalizeScriptLabelKey(reference.name);
      if (key === 'EXIT' || key === 'MAIN') continue;
      if (reference.name.includes('<') || /^\d+$/.test(reference.name)) continue;
      if (
        definedLabelKeys.has(key)
        || options.additionalDefinedLabelKeys?.has(key)
        || (options.isAdditionalDefinedLabel && options.isAdditionalDefinedLabel(key))
      ) continue;
      if (isEngineNativeScriptLabelReference(reference)) continue;
      unresolved.push({ ...reference, line });
    }
  }
  return unresolved;
}

export function findAtLabelTokenAt(lineText: string, character: number): string | undefined {
  if (isScriptCommentLine(lineText)) return undefined;
  const marker = /@/g;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(lineText)) !== null) {
    const nameStart = match.index + 1;
    const name = readUntilTerminator(lineText, nameStart, isGenericAtLabelTerminator);
    if (!name) continue;
    const end = nameStart + name.length;
    if (character >= match.index && character <= end) return name;
  }
  return undefined;
}

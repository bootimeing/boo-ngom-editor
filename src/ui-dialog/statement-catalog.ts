import {
  EngineId,
  StaticLanguageData,
  StaticLanguageParameter,
  StaticLanguageVariant,
} from '../types';

export type DialogStatementSyntax = 'positional' | 'key-value';

export interface DialogAnimationStatementSchema {
  variant: 'gom-playimg' | 'gom-playimgex' | 'lfm-playimg' | 'lfm-playimgex'
    | '996pc-playimg' | '996pc-frames' | '996pc-effect';
  frameCountParameter?: number;
  frameCountKey?: string;
  intervalParameter?: number;
  intervalKey?: string;
  repeatParameter?: number;
  repeatKey?: string;
  drawModeParameter?: number;
  drawModeKey?: string;
  drawModeMin: number;
  drawModeMax: number;
  repairModeParameter?: number;
  repairModeEvidence?: 'official' | 'update-log';
  captionParameter?: number;
  submitParameter?: number;
  finishFrameKey?: string;
  finishHideKey?: string;
  scaleKey?: string;
  slowCountKey?: string;
  offsetPolicy: 'ignore' | 'asset' | 'switch';
  finiteCompletion: 'hide' | 'frames-policy' | 'unknown';
}

export interface DialogStatementSchema {
  id: string;
  engine: EngineId;
  token: string;
  syntax: DialogStatementSyntax;
  description: string;
  absolute: boolean;
  sourceCoordinateBiasX: number;
  sourceCoordinateBiasY: number;
  parameterMeanings: Map<number, string>;
  parameterKeys: Map<number, string>;
  declaredParameters: StaticLanguageParameter[];
  xParameter?: number;
  yParameter?: number;
  xKey?: string;
  yKey?: string;
  widthParameter?: number;
  heightParameter?: number;
  widthKey?: string;
  heightKey?: string;
  textParameter?: number;
  textKey?: string;
  willParameter?: number;
  willKey?: string;
  imageParameter?: number;
  imageKey?: string;
  frameCountParameter?: number;
  frameCountKey?: string;
  animation?: DialogAnimationStatementSchema;
  compatibilityAlias?: boolean;
}

interface PlaceholderInfo {
  index: number;
  meaning: string;
  key?: string;
}

export function buildDialogStatementCatalog(
  data: StaticLanguageData,
  engine: EngineId
): DialogStatementSchema[] {
  const schemas: DialogStatementSchema[] = [];
  const declaredAliases: DialogStatementSchema[] = [];
  for (const entry of data.saySnippets || []) {
    const variant = entry.engineVariants?.[engine];
    if (!variant) continue;
    const schema = schemaFromVariant(entry.id, engine, variant);
    if (!schema) continue;
    schemas.push(schema);
    for (const aliasSource of variant.markupAliases || []) {
      const aliasToken = statementToken(aliasSource);
      if (!aliasToken || aliasToken.toUpperCase() === schema.token.toUpperCase()) continue;
      const sourceCoordinateBias = legacySourceCoordinateBias(aliasToken, schema.syntax);
      declaredAliases.push({
        ...schema,
        token: aliasToken,
        absolute: aliasToken.startsWith('<&'),
        sourceCoordinateBiasX: sourceCoordinateBias,
        sourceCoordinateBiasY: sourceCoordinateBias,
      });
    }
  }
  schemas.push(...declaredAliases);

  // Older GOM/GEE scripts commonly omit '&' while retaining the same parameter order.
  // Keep these aliases separate so their coordinates receive NpcMemoOffSetX/Y.
  const tokens = new Set(schemas.map(schema => schema.token.toUpperCase()));
  const aliases: DialogStatementSchema[] = [];
  for (const schema of schemas) {
    if (!schema.token.startsWith('<&')) continue;
    const token = `<${schema.token.slice(2)}`;
    if (tokens.has(token.toUpperCase())) continue;
    tokens.add(token.toUpperCase());
    aliases.push({
      ...schema,
      id: `${schema.id}-relative-compat`,
      token,
      absolute: false,
      compatibilityAlias: true,
    });
  }
  return [...schemas, ...aliases];
}

function schemaFromVariant(
  id: string,
  engine: EngineId,
  variant: StaticLanguageVariant
): DialogStatementSchema | undefined {
  const source = (variant.snippet || variant.label || '').trim();
  const flowToken = flowStatementToken(id);
  if (flowToken) {
    const placeholders = collectPlaceholders(source);
    return {
      id,
      engine,
      // These internal tokens make tokenless, user-text-first statements part
      // of the same auditable catalog. parseMarkupLine dispatches them through
      // the dedicated flow parser before trying an English command token.
      token: flowToken,
      syntax: 'positional',
      description: variant.description || variant.label,
      absolute: false,
      sourceCoordinateBiasX: 0,
      sourceCoordinateBiasY: 0,
      parameterMeanings: new Map(placeholders.map(item => [item.index, item.meaning])),
      parameterKeys: new Map(),
      declaredParameters: variant.parameters || [],
      textParameter: 1,
    };
  }
  const token = statementToken(source);
  if (!token) return undefined;
  const syntax: DialogStatementSyntax = source[token.length] === '|' ? 'key-value' : 'positional';
  const placeholders = collectPlaceholders(source);
  const meanings = new Map(placeholders.map(item => [item.index, item.meaning]));
  const keys = new Map(placeholders.flatMap(item => item.key ? [[item.index, item.key] as const] : []));
  const declared = variant.parameters || [];
  const sourceCoordinateBias = legacySourceCoordinateBias(token, syntax);

  const schema: DialogStatementSchema = {
    id,
    engine,
    token,
    syntax,
    description: variant.description || variant.label,
    absolute: token.startsWith('<&'),
    sourceCoordinateBiasX: sourceCoordinateBias,
    sourceCoordinateBiasY: sourceCoordinateBias,
    parameterMeanings: meanings,
    parameterKeys: keys,
    declaredParameters: declared,
  };

  if (syntax === 'key-value') {
    const declaredKeys = new Set([
      ...keys.values(),
      ...declared.flatMap(parameter => [parameter.key, ...(parameter.aliases || [])]),
    ].filter((value): value is string => Boolean(value)).map(value => value.toLowerCase()));
    schema.xKey = pickKey(declaredKeys, ['x']);
    schema.yKey = pickKey(declaredKeys, ['y']);
    schema.widthKey = pickKey(declaredKeys, ['width', 'w']);
    schema.heightKey = pickKey(declaredKeys, ['height', 'h']);
    schema.textKey = pickKey(declaredKeys, ['text', 'title']);
    schema.willKey = pickKey(declaredKeys, ['wil', 'wzl', 'file']);
    schema.imageKey = pickKey(declaredKeys, imageKeyPriority(id));
    schema.frameCountKey = pickKey(
      declaredKeys,
      id === 'newui-effect-996pc' ? ['num'] : ['count', 'num']
    );
  } else {
    schema.xParameter = findParameter(placeholders, isMainXMeaning);
    schema.yParameter = findParameter(placeholders, isMainYMeaning);
    schema.widthParameter = findParameter(placeholders, meaning => normalizeMeaning(meaning) === '宽度');
    schema.heightParameter = findParameter(placeholders, meaning => normalizeMeaning(meaning) === '高度');
    schema.textParameter = findParameter(placeholders, isTextMeaning);
    // BigNum's first positional field is a numeric display source. Treat it as
    // text explicitly instead of widening the generic text-meaning heuristic
    // to every statement parameter described as a "value".
    if (id === 'big-number-text') schema.textParameter = 1;
    schema.willParameter = findParameter(placeholders, isWillMeaning);
    schema.imageParameter = findImageParameter(placeholders, id);
    schema.frameCountParameter = findParameter(placeholders, isFrameCountMeaning);
    if (id === 'textatlas-996pc') {
      // The traditional 996PC manual names these fields F/N/X/Y/L rather than
      // using the newer key-value vocabulary. Keep its positional contract
      // explicit so it cannot be confused with the whole-sheet TextAtlas.
      schema.willParameter = 1;
      schema.imageParameter = 2;
      schema.xParameter = 3;
      schema.yParameter = 4;
      schema.textParameter = 5;
    }
  }
  schema.animation = animationSchema(id, engine);
  return schema;
}

/**
 * The original UI editor stores these positional command coordinates four
 * pixels beyond their painted top-left: canvas -> source adds 4 and source ->
 * canvas subtracts 4. Keep that client-facing paint bias in the typed schema
 * so absolute, relative, nested, drag, Inspector, and source writeback all use
 * one reversible coordinate contract. New 996PC key-value controls are a
 * separate layout system and must not inherit this legacy positional rule.
 */
function legacySourceCoordinateBias(token: string, syntax: DialogStatementSyntax): number {
  if (syntax !== 'positional') return 0;
  const command = token.replace(/^<&?/, '').toUpperCase();
  return ['TEXT', 'COUNTDOWN', 'INPUTTEXT', 'INPUTNUM'].includes(command) ? 4 : 0;
}

function flowStatementToken(id: string): string | undefined {
  if (id === 'text-link') return '<FLOW_TEXT_LINK';
  if (id === 'text-link-params') return '<FLOW_TEXT_LINK_PARAMS';
  if (id === 'text-color') return '<FLOW_TEXT_COLOR';
  return undefined;
}

function animationSchema(
  id: string,
  engine: EngineId
): DialogAnimationStatementSchema | undefined {
  if (id === 'playimg-absolute' && engine === 'GOM') {
    return {
      variant: 'gom-playimg',
      frameCountParameter: 3,
      intervalParameter: 4,
      drawModeParameter: 7,
      repeatParameter: 8,
      captionParameter: 9,
      repairModeParameter: 10,
      repairModeEvidence: 'update-log',
      drawModeMin: 0,
      drawModeMax: 1,
      offsetPolicy: 'switch',
      finiteCompletion: 'hide',
    };
  }
  if (id === 'playimgex-absolute' && engine === 'GOM') {
    return {
      variant: 'gom-playimgex',
      frameCountParameter: 3,
      intervalParameter: 4,
      drawModeParameter: 7,
      repeatParameter: 8,
      drawModeMin: 0,
      drawModeMax: 1,
      offsetPolicy: 'ignore',
      finiteCompletion: 'hide',
    };
  }
  if (id === 'playimg-absolute' && engine === 'GEE') {
    return {
      variant: 'lfm-playimg',
      frameCountParameter: 3,
      intervalParameter: 4,
      drawModeParameter: 7,
      captionParameter: 8,
      submitParameter: 9,
      drawModeMin: 0,
      drawModeMax: 3,
      offsetPolicy: 'asset',
      finiteCompletion: 'unknown',
    };
  }
  if (id === 'playimgex-absolute' && engine === 'GEE') {
    return {
      variant: 'lfm-playimgex',
      frameCountParameter: 3,
      intervalParameter: 4,
      repeatParameter: 5,
      drawModeParameter: 8,
      captionParameter: 9,
      submitParameter: 10,
      drawModeMin: 0,
      drawModeMax: 3,
      offsetPolicy: 'asset',
      finiteCompletion: 'unknown',
    };
  }
  if (id === 'playimg-relative-996pc' && engine === '996PC') {
    return {
      variant: '996pc-playimg',
      frameCountParameter: 3,
      intervalParameter: 4,
      drawModeParameter: 7,
      repeatParameter: 8,
      repairModeParameter: 9,
      repairModeEvidence: 'official',
      drawModeMin: 0,
      drawModeMax: 1,
      offsetPolicy: 'switch',
      finiteCompletion: 'hide',
    };
  }
  if (id === 'newui-frames-996pc' && engine === '996PC') {
    return {
      variant: '996pc-frames',
      frameCountKey: 'count',
      intervalKey: 'speed',
      repeatKey: 'loop',
      drawModeKey: 'dmode',
      finishFrameKey: 'finishframe',
      finishHideKey: 'finishhide',
      slowCountKey: 'slowcount',
      drawModeMin: 0,
      drawModeMax: 1,
      offsetPolicy: 'asset',
      finiteCompletion: 'frames-policy',
    };
  }
  if (id === 'newui-effect-996pc' && engine === '996PC') {
    return {
      variant: '996pc-effect',
      frameCountKey: 'num',
      intervalKey: 'gap',
      repeatKey: 'count',
      drawModeKey: 'dmode',
      scaleKey: 'scale',
      drawModeMin: 0,
      drawModeMax: 1,
      offsetPolicy: 'asset',
      finiteCompletion: 'unknown',
    };
  }
  return undefined;
}

function statementToken(source: string): string | undefined {
  return /^(<&?[A-Za-z_][A-Za-z0-9_.]*)/.exec(source.trim())?.[1];
}

function collectPlaceholders(source: string): PlaceholderInfo[] {
  const result: PlaceholderInfo[] = [];
  const pattern = /\$\{(\d+):([^}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const prefix = source.slice(0, match.index);
    const key = /\|([A-Za-z_][A-Za-z0-9_]*)=[^|<>]*$/.exec(prefix)?.[1];
    result.push({ index: Number(match[1]), meaning: match[2].trim(), key });
  }
  return result;
}

function pickKey(keys: Set<string>, priorities: string[]): string | undefined {
  return priorities.find(key => keys.has(key.toLowerCase()));
}

function findParameter(
  placeholders: PlaceholderInfo[],
  predicate: (meaning: string) => boolean
): number | undefined {
  return placeholders.find(item => predicate(item.meaning))?.index;
}

function findImageParameter(placeholders: PlaceholderInfo[], id: string): number | undefined {
  const priorities = imageMeaningPriority(id);
  for (const priority of priorities) {
    const found = placeholders.find(item => normalizeMeaning(item.meaning).includes(priority));
    if (found) return found.index;
  }
  return undefined;
}

function imageMeaningPriority(id: string): string[] {
  // PLAYIMGEX contains "imgex" in its id, but its N parameter is an animation
  // start frame rather than IMGEX's default-state image.
  if (/play|frames|effect/i.test(id)) return ['开始图片', '图片序号'];
  if (/imgex|button/i.test(id)) return ['默认图片', '正常图片', '图片序号'];
  if (/progress|loading/i.test(id)) return ['背景图片', '底图', '图片序号'];
  return ['图片序号', '默认图片', '背景图片', '开始图片'];
}

function imageKeyPriority(id: string): string[] {
  if (/button/i.test(id)) return ['pcnimg', 'pcimg', 'start'];
  if (/frames|effect/i.test(id)) return ['start', 'pcimg', 'pcnimg'];
  if (/progress|loading/i.test(id)) return ['pcbgimg', 'pcloadingbg', 'pcimg', 'start'];
  return ['pcimg', 'pcnimg', 'start', 'pcloadingbg', 'pcbgimg'];
}

function normalizeMeaning(value: string): string {
  return value.replace(/[()（）].*$/, '').replace(/\s+/g, '').toUpperCase();
}

function isMainXMeaning(value: string): boolean {
  return ['X', '坐标X', '位置X'].includes(normalizeMeaning(value));
}

function isMainYMeaning(value: string): boolean {
  return ['Y', '坐标Y', '位置Y'].includes(normalizeMeaning(value));
}

function isTextMeaning(value: string): boolean {
  const normalized = normalizeMeaning(value);
  return ['内容', '显示文字', '文字', '多行文字', '提示文字'].some(item => normalized === item)
    || /^第.+行(?:\|第.+行)+$/.test(normalized);
}

function isWillMeaning(value: string): boolean {
  const normalized = normalizeMeaning(value);
  return normalized.includes('WIL序号') || normalized.includes('WZL序号') || normalized.includes('资源序号') || normalized.includes('资源文件名');
}

function isFrameCountMeaning(value: string): boolean {
  const normalized = normalizeMeaning(value);
  return normalized.includes('播放张数') || normalized.includes('图片数量') || normalized === '数量';
}

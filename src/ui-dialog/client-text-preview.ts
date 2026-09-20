import { EngineId } from '../types';
import { DialogElement, DialogPagePreview, DialogScene, DialogTextPreview, DialogTextRun } from './model';
import { DialogPreviewInput, DialogPreviewValues, protectPreviewText, validPreviewValue } from './preview-inputs';
import { localControlContract, localControlIdentity } from './preview-control-submit';
import { previewVariableContract } from './preview-variable-contracts';

/** Separate from the server expression environment: STM is display-only. */
function clientContract(key: string): { input: DialogPreviewInput; slider?: string } | undefined {
  let canonical = key, kind: 'number' | 'text' = 'text', uncertain = false, slider: string | undefined;
  const sliding = /^SLIDERV_(N(?:\d+|\$[A-Za-z0-9_\u3400-\u9fff]+))$/i.exec(key);
  if (sliding) {
    const contract = previewVariableContract(sliding[1], '996PC');
    if (!contract || contract.kind !== 'number') return undefined;
    slider = contract.name; canonical = `SLIDERV_${slider}`; kind = 'number';
  } else if (/^ITEMCOUNT_/i.test(key)) {
    if (!literalClientItemName(key.slice(10))) return undefined;
    canonical = `ITEMCOUNT_${key.slice(10)}`; kind = 'number';
  } else if (/^MONEY_\d+(?:,\d+)*$/i.test(key)) {
    canonical = key.toUpperCase(); kind = 'number';
  } else if (/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) {
    canonical = key.toUpperCase();
    const contract = previewVariableContract(canonical, '996PC');
    kind = /^(?:S?ARMRING[LR]|S?RING[LR])$/.test(canonical) ? 'text' : contract?.kind === 'number' ? 'number' : 'text';
    uncertain = !contract || Boolean(contract.typeUncertain);
  } else return undefined;
  return {slider, input: {name:`STM(${canonical})`, kind, channel:'client-display', ...(uncertain ? {typeUncertain:true} : {}),
    description: slider ? '客户端显示值；自动跟随当前页唯一有效滑块，手填时覆盖；不改变服务器变量'
      : '客户端显示值；仅本地文字预览，不参与服务器条件、坐标或素材解析'}};
}

/** DB names such as 布衣(男) are literal names, not nested client functions.
 * UI delimiters and interpolation characters stay outside this finite form. */
function literalClientItemName(name: string): boolean {
  if (name !== name.trim() || !/^[A-Za-z0-9_\u3400-\u9fff][A-Za-z0-9_\u3400-\u9fff()（）\[\] .·-]*$/u.test(name)) return false;
  const stack: string[] = [];
  for (const char of name) {
    if (char === '(' || char === '（' || char === '[') stack.push(char === '(' ? ')' : char === '[' ? ']' : '）');
    else if ((char === ')' || char === '）' || char === ']') && stack.pop() !== char) return false;
    if (stack.length > 16) return false;
  }
  return stack.length === 0;
}

function* clientExpressions(text: string): Generator<{ index: number; expression: string; key: string }> {
  const pattern = /\$STM\(/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    let cursor = pattern.lastIndex, depth = 1;
    for (; cursor < text.length && depth; cursor++) {
      if (text[cursor] === '(') depth++;
      else if (text[cursor] === ')') depth--;
    }
    // Consume the complete outer form even when its contract is unknown, so
    // a nested $STM inside an unsupported function is not partially executed.
    pattern.lastIndex = cursor;
    if (depth) continue;
    const key = text.slice(match.index + match[0].length, cursor - 1);
    if (key.length && key.length <= 256 && !/[\r\n]/.test(key)) {
      yield { index: match.index, expression: text.slice(match.index, cursor), key };
    }
  }
}

/** Shared only for display diagnostics; it grants no resource or geometry capability. */
export function hasRecognizedClientTextExpression(text: string): boolean {
  for (const expression of clientExpressions(text)) {
    if (clientContract(expression.key)) return true;
  }
  return false;
}

/** A literal old-style flow tag, not a server <$...> expression. Source-owned
 * markup may pass through MOV, but protected user text cannot match this form. */
export function isClientTextFlowMarkup(text: string): boolean {
  if (!/^<\$STM\(/i.test(text) || !text.endsWith('>')) return false;
  const inner = text.slice(1, -1);
  const first = clientExpressions(inner).next().value;
  if (!first || first.index !== 0 || !clientContract(first.key)) return false;
  const suffix = inner.slice(first.expression.length);
  return /^(?:\/@[^\s<>$/|()]+|\/FCOLOR=\d+)$/i.test(suffix);
}

export function applyClientTextPreviews(scenes: readonly DialogScene[], pages: readonly DialogPagePreview[], engine: EngineId,
  values: DialogPreviewValues | undefined): DialogPreviewInput[] {
  if (engine !== '996PC') return [];
  const inputs = new Map<string, DialogPreviewInput>();
  for (const element of new Set(scenes.flatMap(scene => scene.elements))) {
    // Display surfaces only. Never rewrite parameters, tooltip IDs or raw source.
    const legacyBody = element.kind === 'text' && (element.statementId === 'flow-text' || /^text-/.test(element.statementId || ''));
    const body: DialogTextPreview | undefined = ['newui-text-996pc','newui-rtext-996pc','newui-button-996pc'].includes(element.statementId || '') || legacyBody
      ? element.textPreview || { lines: (element.text || '').split(/\r?\n/).map(text => [{ text }]), align: 'left', ...(element.color ? { color: element.color } : {}) }
      : undefined;
    const tooltip = element.statementId?.endsWith('-996pc') && element.tooltipPreview?.kind === 'text' ? element.tooltipPreview : undefined;
    const menu = element.statementId === 'newui-menuitem-996pc' ? element.menuPreview : undefined;
    const menuSurface = menu ? {lines: [...menu.items, menu.selected].map(text => [{text} as DialogTextRun])} : undefined;
    const atlas = element.statementId === 'newui-textatlas-996pc' ? element.imageTextPreview : undefined;
    const atlasSurface = atlas ? {lines: [[{text: element.text} as DialogTextRun]]} : undefined;
    if (!body && !tooltip && !menuSurface && !atlasSurface) continue;
    const page = pages.find(candidate => candidate.elements.includes(element));
    // `scenes` contains both sides of conditional SAY/ELSESAY blocks. Only an
    // element present on a currently composed page is an input-bearing display
    // surface; a hidden $STM(...) branch must not publish a left-panel field.
    if (!page) continue;
    for (const surface of [body, tooltip, menuSurface, atlasSurface]) {
      if (!surface) continue;
      let changed = false;
      surface.lines = surface.lines.map(line => line.flatMap(run => {
        const result: DialogTextRun[] = []; let cursor = 0;
        for (const match of clientExpressions(run.text)) {
          const contract = clientContract(match.key); if (!contract) continue;
          const {input, slider} = contract;
          const supplied = values && Object.prototype.hasOwnProperty.call(values,input.name) ? values[input.name] : undefined;
          if (supplied !== undefined && validPreviewValue(input,supplied)) input.value = supplied;
          inputs.set(input.name,input);
          const peers = slider ? page?.elements.filter(peer => peer.sliderPreview && localControlIdentity(peer,engine) === slider) || [] : [];
          const peer = peers.length === 1 ? peers[0] : undefined;
          const safe = peer && localControlContract(peer,engine);
          const initial = peer?.localControlState?.value ?? peer?.sliderPreview?.initialValue;
          const bound = safe?.type === 3 && Number.isFinite(initial) && initial! >= safe.minimum && initial! <= safe.maximum ? peer : undefined;
          const value = input.value ?? (bound ? String(initial) : input.kind === 'number' ? '0' : '预览文字');
          if (match.index! > cursor) result.push({...run,text:run.text.slice(cursor,match.index)});
          result.push({...run,text:protectPreviewText(value),clientValue:{inputName:input.name,expression:match.expression,kind:input.kind as 'number'|'text',
            origin:input.value !== undefined ? 'local-input' : bound ? 'local-slider' : 'placeholder',
            ...(input.value === undefined && bound ? {sliderElementId:bound.id} : {})}});
          cursor=match.index+match.expression.length; changed=true;
        }
        if (!cursor) return [run];
        if (cursor<run.text.length) result.push({...run,text:run.text.slice(cursor)});
        return result;
      }));
      if (changed && surface === body) {
        element.textPreview = body;
        updateClientText(element);
        if (legacyBody) {
          const warning = 'STM 旧式文字采用本地显示约定，未宣称游戏客户端支持；不改变源码、服务器变量、素材或动作参数';
          if (!element.warning?.includes(warning)) element.warning = [element.warning, warning].filter(Boolean).join('；');
        }
      }
      if (changed && surface === menuSurface && menu) {
        menu.clientDisplay = {items: surface.lines.slice(0, menu.items.length), selected: surface.lines[menu.items.length]};
      }
      if (changed && surface === atlasSurface && atlas) {
        atlas.clientText = surface.lines[0];
        atlas.value = atlas.clientText.map(run => run.text).join('');
        element.text = atlas.value;
        atlas.dynamicFields = [...new Set([...(atlas.dynamicFields || []), 'text' as const])];
        atlas.invalidFields = atlas.invalidFields?.filter(field => field !== 'text');
        // Provider rebuilds the glyphs from this display value and the original
        // resource contract. No image index/width/height is derived from STM.
        atlas.glyphs = /^\d+$/u.test(atlas.value) ? [...atlas.value].map(character => ({ character })) : [];
      }
    }
  }
  return [...inputs.values()];
}

function updateClientText(element: DialogElement): void {
  element.text = element.textPreview!.lines.map(line=>line.map(run=>run.text).join('')).join('\n');
}

import { EngineId } from '../types';
import { DialogElement, DialogScene, DialogTextRun } from './model';
import { restorePreviewText } from './preview-inputs';

/** Display only, after source constant expansion and client text processing, but
 * before restoring protected user literals. Never call this on restored text. */
export function applyConstantDisplayFallback(scenes: readonly DialogScene[], engine: EngineId): void {
  const pattern = engine === '996PC' ? /\$\(([^\s()$<>|{}\[\]]+)\)/g : /\(\$([^\s()$<>|{}\[\]]+)\)/g;
  for (const element of new Set(scenes.flatMap(scene => scene.elements))) {
    let changed = false;
    const replace = (value: string | undefined, field: string, kind: 'text' | 'number' = 'text'): string | undefined => {
      if (value === undefined) return value;
      return value.replace(pattern, expression => {
        const replacement = kind === 'number' ? '0' : '预览文字';
        const sources = element.displayValueSources ||= [];
        if (!sources.some(source => source.field === field && source.expression === expression && source.status === 'runtime-placeholder')) {
          sources.push({ field, kind, expression, status: 'runtime-placeholder', value: replacement });
        }
        changed = true;
        return replacement;
      });
    };
    const updateText = <T, K extends keyof T>(target: T, key: K, field: string, kind: 'text' | 'number' = 'text') => {
      const original = target[key];
      if (typeof original !== 'string') return;
      const value = replace(original, field, kind)!;
      if (value !== original) target[key] = value as T[K];
    };
    const runs = (values: DialogTextRun[], field: string, kind: 'text' | 'number' = 'text') => {
      const result = values.map((run, index) => {
        const text = replace(run.text, `${field}.${index}`, kind)!;
        return text === run.text ? run : { ...run, text };
      });
      return result.every((run, index) => run === values[index]) ? values : result;
    };
    const lines = (values: DialogTextRun[][], field: string, kind: 'text' | 'number' = 'text') => {
      const result = values.map((line, index) => runs(line, `${field}.${index}`, kind));
      return result.every((line, index) => line === values[index]) ? values : result;
    };

    const countdown = element.countdownPreview;
    const countdownSource = countdown?.displaySecondsSource;
    const countdownValue = replace(countdownSource, 'constant.countdown.seconds', 'number');
    if (countdown && countdownValue !== countdownSource) {
      countdown.initialText = countdownValue!;
      element.text = countdownValue;
      if (element.textPreview) {
        const template = element.textPreview.lines.flat()[0] || { text: '' };
        element.textPreview.lines = [[{ ...template, text: countdownValue! }]];
      }
      if (element.imageTextPreview) {
        element.imageTextPreview.value = countdownValue!;
        // Same plain display path as unknown artistic numbers; no glyph/timer.
        if (!element.displayValueSources!.some(source => source.field === 'constant.imageText.value'
          && source.expression === countdownSource && source.status === 'runtime-placeholder')) {
          element.displayValueSources!.push({ field: 'constant.imageText.value', kind: 'number',
            expression: countdownSource!, value: countdownValue!, status: 'runtime-placeholder' });
        }
      }
    }
    const atlas = element.imageTextPreview;
    if (atlas) {
      // Parser may already have reduced an invalid digit value to '?'. Its
      // protected display body retains the expression without scanning raw UI.
      const source = atlas.clientText?.map(run => run.text).join('') ?? element.text ?? atlas.value;
      const value = replace(source, 'constant.imageText.value', 'number');
      if (value !== source) {
        atlas.value = value!;
        element.text = value;
        if (atlas.clientText) atlas.clientText = runs(atlas.clientText, 'constant.imageText.run', 'number');
        // Keep glyphs, refs, dimensions and resource diagnostics unchanged. A
        // dedicated renderer fallback consumes only this display diagnostic.
      }
    }
    const bodyKind = element.statementId === 'big-number-text' ? 'number' : 'text';
    updateText(element, 'text', 'constant.text', bodyKind);
    if (element.textPreview) element.textPreview.lines = lines(element.textPreview.lines, 'constant.text', bodyKind);
    if (element.tooltipPreview?.kind === 'text') {
      element.tooltipPreview.lines = lines(element.tooltipPreview.lines, 'constant.tooltip');
    }
    if (element.inputPreview) {
      updateText(element.inputPreview, 'placeholder', 'constant.input.placeholder');
      updateText(element.inputPreview, 'errorTips', 'constant.input.errorTips');
    }
    if (element.itemPreview) element.itemPreview.label = replace(element.itemPreview.label, 'constant.item.label')!;
    if (element.costItemPreview) {
      element.costItemPreview.title = replace(element.costItemPreview.title, 'constant.costItem.title')!;
      element.costItemPreview.quantityText = replace(element.costItemPreview.quantityText, 'constant.costItem.quantity', 'number')!;
    }
    if (element.progressPreview) updateText(element.progressPreview, 'text', 'constant.progress.text');
    if (element.countdownPreview) element.countdownPreview.initialText = replace(element.countdownPreview.initialText, 'constant.countdown.text', 'number')!;
    if (element.imagePreview?.title) element.imagePreview.title.text = replace(element.imagePreview.title.text, 'constant.image.title')!;
    if (element.animationPreview) {
      updateText(element.animationPreview, 'caption', 'constant.animation.caption');
      if (element.animationPreview.title) element.animationPreview.title.text = replace(element.animationPreview.title.text, 'constant.animation.title')!;
    }
    const menu = element.menuPreview;
    if (menu) {
      const source = menu.clientDisplay || { items: menu.items.map(text => [{ text }]), selected: [{ text: menu.selected }] };
      const display = { items: source.items.map((line, index) => runs(line, `constant.menu.items.${index}`)), selected: runs(source.selected, 'constant.menu.selected') };
      const protectedCaption = [...source.items.flat(), ...source.selected]
        .some(run => restorePreviewText(run.text) !== run.text);
      if (protectedCaption || element.displayValueSources?.some(item => item.field.startsWith('constant.menu.'))) {
        // Keep the submission identity protected/source-owned; only display
        // runs are restored at the next parser phase, including literal macros.
        menu.clientDisplay = display;
      }
    }
    if (changed) appendConstantWarning(element);
  }
}

function appendConstantWarning(element: DialogElement): void {
  const message = '未解析常量仅作本地显示兜底：文字为预览文字，已知数量字段为0；不改变源码、素材、坐标、计时或动作参数';
  if (!element.warning?.includes(message)) element.warning = [element.warning, message].filter(Boolean).join('；');
}

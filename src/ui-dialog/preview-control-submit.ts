import { EngineId } from '../types';
import { DialogElement } from './model';
import { previewVariableContract } from './preview-variable-contracts';

/** Identity remains occupied even when another field makes a control unusable. */
export function localControlIdentity(element: DialogElement, engine: EngineId): string | undefined {
  if (engine !== '996PC') return undefined;
  if (element.menuPreview) {
    const menu = element.menuPreview;
    if (menu.dynamicFields?.includes('menuid')) return undefined;
    const variable = previewVariableContract(menu.menuId || '', engine);
    return variable?.kind === 'text' && /^S(?:\d|\$)/.test(variable.name) ? variable.name : undefined;
  }
  const control = element.togglePreview || element.sliderPreview;
  if (!control || control.dynamicFields?.includes('variable')) return undefined;
  const variable = previewVariableContract(control.variableName || '', engine);
  return variable?.kind === 'number' && /^(?:[A-Z]\d+|N\$)/.test(variable.name) ? variable.name : undefined;
}

/** A local event capability, not authority to assign the named server variable. */
export type LocalControlContract = {type:2|3;variable:string;minimum:number;maximum:number}
  | {type:4;variable:string;choices:readonly string[]};
export function localControlValueAccepted(contract: LocalControlContract, value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (contract.type === 4) return value.length <= 65536 && contract.choices.includes(value);
  return value.length <= 64 && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)
    && Number.isFinite(Number(value)) && Number(value) >= contract.minimum && Number(value) <= contract.maximum
    && (contract.type !== 2 || value === '0' || value === '1');
}
export function localControlContract(element: DialogElement, engine: EngineId): LocalControlContract | undefined {
  if (engine !== '996PC') return undefined;
  if (element.menuPreview) {
    const menu = element.menuPreview, variable = localControlIdentity(element, engine);
    // Only a source-owned option list grants selection authority. Style and
    // missing resource fallbacks do not change the submitted text contract.
    if (!variable || menu.dynamicFields?.some(field => ['menuid','itemname','link'].includes(field))
      || menu.invalidFields?.some(field => ['menuid','itemname','link'].includes(field)) || !menu.items.length) return undefined;
    return {type:4, variable, choices:menu.items};
  }
  const control = element.togglePreview || element.sliderPreview;
  if (!control || control.dynamicFields?.some(field => !element.localControlState || !['checked','maximum','value'].includes(field)) || control.invalidFields?.length) return undefined;
  const type = element.togglePreview ? 2 : 3;
  const variable = previewVariableContract(localControlIdentity(element, engine) || '', engine);
  if (!variable || variable.kind !== 'number' || !/^(?:[A-Z]\d+|N\$)/.test(variable.name)) return undefined;
  if (type === 3 && !/^N(?:\d|\$)/.test(variable.name)) return undefined;
  const minimum = type === 2 ? 0 : element.localControlState?.minimum ?? element.sliderPreview!.minimum;
  const maximum = type === 2 ? 1 : element.localControlState?.maximum ?? element.sliderPreview!.maximum;
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || maximum! <= minimum!) return undefined;
  return {type, variable:variable.name, minimum:minimum!, maximum:maximum!};
}

/** Completion of the existing bounded local timer, not client clock equivalence. */
export function localCompletionReady(element: DialogElement, engine: EngineId): boolean {
  if (engine !== '996PC' || element.runtimeActionPreview?.trigger !== 'completion') return false;
  if (element.countdownPreview && /^<(?:COUNTDOWN|TIMETIPS)\|/i.test(element.raw)) {
    const timer = element.countdownPreview;
    return !timer.dynamicFields?.length && !timer.invalidFields?.length
      && Number.isFinite(timer.seconds) && timer.seconds! >= 0
      && Number.isInteger(timer.repeatCount) && timer.repeatCount! > 0;
  }
  if (element.progressPreview && /^<LoadingBar\|/i.test(element.raw)) {
    const progress = element.progressPreview;
    return !progress.dynamicFields?.length && !progress.invalidFields?.length
      && [progress.value, progress.endValue, progress.maximum, progress.valueIntervalMs, progress.valueStep].every(Number.isFinite)
      && progress.maximum! > 0 && progress.valueIntervalMs! > 0 && progress.valueStep! > 0;
  }
  return false;
}

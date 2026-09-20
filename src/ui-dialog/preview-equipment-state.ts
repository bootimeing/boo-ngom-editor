/** Local GXX/GEE-family equipment snapshot. Never an online object or resource ID. */
export type PreviewEquipmentContainer = 'ordinary' | 'jewelry' | 'godbless';
export interface PreviewEquipmentItem {
  name: string;
  container: PreviewEquipmentContainer;
  slot: number;
}
export interface PreviewEquipmentState { version: 1; items: PreviewEquipmentItem[] }

// GXX Grobal2: MAX_USE_ITEM_COUNT=30, JewelryBox[0..5], GodBless[0..11].
export const previewEquipmentContainerSizes = { ordinary: 30, jewelry: 6, godbless: 12 } as const;
export const previewEquipmentOrdinaryLabels = ['衣服', '武器', '勋章', '项链', '头盔', '左手镯', '右手镯',
  '左戒指', '右戒指', '毒符', '腰带', '鞋子', '宝石', '斗笠', '军鼓', '马牌', '盾牌', '灵玉',
  '时装衣服', '时装武器', '时装项链', '时装头盔', '时装左手镯', '时装右手镯', '时装左戒指', '时装右戒指',
  '时装勋章', '时装腰带', '时装鞋子', '时装宝石'] as const;
export const previewEquipmentParts: Readonly<Record<string, readonly number[]>> = {
  '[NECKLACE]': [3], '[RING]': [7, 8], '[ARMRING]': [5, 6], '[WEAPON]': [1], '[HELMET]': [4],
};
export function previewEquipmentStateName(hero = false): string { return `EQUIPMENT(${hero ? 'hero' : 'player'})`; }

export function parsePreviewEquipmentState(value: unknown): PreviewEquipmentState | undefined {
  if (typeof value !== 'string' || value.length > 32768) return undefined;
  try {
    const state = JSON.parse(value);
    if (!state || state.version !== 1 || !Array.isArray(state.items) || state.items.length > 48
      || Object.keys(state).some(key => key !== 'version' && key !== 'items')) return undefined;
    const occupied = new Set<string>();
    for (const item of state.items) {
      if (!item || typeof item !== 'object' || Object.keys(item).some(key => !['name', 'container', 'slot'].includes(key))
        || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 512 || /[\r\n\x00]/.test(item.name)
        || !Object.prototype.hasOwnProperty.call(previewEquipmentContainerSizes, item.container)
        || !Number.isInteger(item.slot) || item.slot < 0
        || item.slot >= previewEquipmentContainerSizes[item.container as PreviewEquipmentContainer]) return undefined;
      const identity = `${item.container}:${item.slot}`;
      if (occupied.has(identity)) return undefined;
      occupied.add(identity);
    }
    return state;
  } catch { return undefined; }
}

export function matchPreviewEquipmentState(state: PreviewEquipmentState, name: string, count: number, fullName: boolean): boolean | undefined {
  const part = previewEquipmentParts[name.toUpperCase()];
  if (part) return state.items.some(item => item.container === 'ordinary' && part.includes(item.slot));
  // Unknown bracket selectors are not silently reinterpreted as item names.
  if (!name || name.startsWith('[')) return undefined;
  const fold = (value: string) => value.replace(/[a-z]/g, char => char.toUpperCase());
  const matches = state.items.filter(item => fullName ? fold(item.name) === fold(name) : item.name.includes(name));
  return matches.length >= Math.max(1, count);
}

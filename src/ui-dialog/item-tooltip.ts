import { DialogItemPreview, DialogTooltipPreview, DialogTooltipRun } from './model';

export type DialogItemDatabaseFields = Record<string, string | undefined>;

const DATABASE_FIELD_LABELS: Array<[string, string]> = [
  ['Name', '名称'],
  ['StdMode', 'StdMode'],
  ['Shape', 'Shape'],
  ['Weight', '重量'],
  ['Looks', 'Looks'],
  ['DuraMax', '持久上限'],
];

export function buildDialogItemTooltip(
  item: DialogItemPreview,
  fields: DialogItemDatabaseFields = {}
): DialogTooltipPreview | undefined {
  if (item.showTips !== true) return undefined;
  const lines: DialogTooltipRun[][] = [];
  const databaseBacked = item.mode === 'database-index' || item.mode === 'database-name';
  if (databaseBacked) {
    lines.push([{ text: '数据库基础属性预览' }]);
    lines.push([{ text: item.label }]);
    for (const [field, label] of DATABASE_FIELD_LABELS) {
      const value = fields[field];
      if (value === undefined || String(value).trim() === '') continue;
      lines.push([{ text: `${label} ${String(value).trim()}` }]);
    }
    if (item.quantity !== undefined) lines.push([{ text: `数量 ${item.quantity}` }]);
    lines.push([{ text: '运行时极品、鉴定、强化和唯一属性不在数据库静态预览中' }]);
  } else {
    lines.push([{ text: '运行时属性无法离线还原' }]);
    lines.push([{ text: item.label }]);
    lines.push([{ text: 'Ctrl+F12 仅展示脚本开关、装备位和物品框边界' }]);
  }
  return {
    raw: item.label,
    kind: 'item',
    lines,
    offsetX: 0,
    offsetY: 0,
    ...(item.itemIndex !== undefined ? { itemIndex: item.itemIndex } : {}),
  };
}

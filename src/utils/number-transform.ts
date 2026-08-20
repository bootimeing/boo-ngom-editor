export type BatchNumberOperation = 'add' | 'sub' | 'mul' | 'div' | 'incrementAdd';

export interface BatchNumberTransformResult {
  texts: string[];
  count: number;
}

function formatBatchNumber(value: number): string {
  const absolute = String(Math.abs(value));
  const padded = absolute.length < 3 ? (`000${absolute}`).slice(-3) : absolute;
  return value < 0 ? `-${padded}` : padded;
}

export function transformBatchNumbers(
  texts: string[],
  operation: BatchNumberOperation,
  operand: number
): BatchNumberTransformResult {
  if (!Number.isFinite(operand)) throw new Error('批量运算值必须是有限数字');

  let count = 0;
  const transformed = texts.map(text => text.replace(/(-?\d+(?:\.\d+)?)/g, match => {
    const value = Number(match);
    count += 1;
    switch (operation) {
      case 'add': return formatBatchNumber(value + operand);
      case 'sub': return formatBatchNumber(value - operand);
      case 'mul': return formatBatchNumber(value * operand);
      case 'div': return operand === 0 ? match : formatBatchNumber(Math.round(value / operand));
      case 'incrementAdd': return formatBatchNumber(value + operand * count);
      default: return match;
    }
  }));

  return { texts: transformed, count };
}

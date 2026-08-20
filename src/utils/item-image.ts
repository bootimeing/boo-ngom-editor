export interface ItemImageReference {
  looks: number;
  pakName: string;
  imageIndex: number;
}

export function resolveItemImageReference(looksValue: unknown): ItemImageReference | undefined {
  if (looksValue === null || looksValue === undefined) return undefined;
  if (typeof looksValue === 'string' && looksValue.trim() === '') return undefined;
  const looks = Number(looksValue);
  if (!Number.isInteger(looks) || looks < 0 || looks > 99999) return undefined;
  const pakNumber = Math.floor(looks / 10000);
  return {
    looks,
    pakName: pakNumber === 0 ? 'Items' : `Items${pakNumber}`,
    imageIndex: looks % 10000,
  };
}

export function findItemLooksValue(fields: Record<string, unknown>): unknown {
  const key = Object.keys(fields).find(field => field.toLowerCase() === 'looks');
  return key ? fields[key] : undefined;
}

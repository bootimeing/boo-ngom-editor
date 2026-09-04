export interface ItemImageReference {
  looks: number;
  pakName: string;
  imageIndex: number;
}

export function resolveItemImageReference(looksValue: unknown): ItemImageReference | undefined {
  return resolveLooksImageReference(looksValue, 'Items');
}

export function resolveStdItemImageReference(
  looksValue: unknown,
  maximumLooks = 99999
): ItemImageReference | undefined {
  return resolveLooksImageReference(looksValue, 'StdItem', maximumLooks);
}

export function resolveItemImageReferenceForSource(
  looksValue: unknown,
  source: 'items' | 'std-item' | undefined,
  sourceDynamic: boolean,
  maximumLooks = 99999
): ItemImageReference | undefined {
  if (sourceDynamic) return undefined;
  return source === 'std-item'
    ? resolveStdItemImageReference(looksValue, maximumLooks)
    : resolveLooksImageReference(looksValue, 'Items', maximumLooks);
}

export function resolveStateItemImageReference(
  looksValue: unknown
): ItemImageReference | undefined {
  return resolveLooksImageReference(looksValue, 'StateItem');
}

function resolveLooksImageReference(
  looksValue: unknown,
  archiveBaseName: string,
  maximumLooks = 99999
): ItemImageReference | undefined {
  if (looksValue === null || looksValue === undefined) return undefined;
  if (typeof looksValue === 'string' && looksValue.trim() === '') return undefined;
  const looks = Number(looksValue);
  if (!Number.isInteger(looks) || looks < 0 || looks > maximumLooks) return undefined;
  const pakNumber = Math.floor(looks / 10000);
  return {
    looks,
    pakName: pakNumber === 0 ? archiveBaseName : `${archiveBaseName}${pakNumber}`,
    imageIndex: looks % 10000,
  };
}

export function findItemLooksValue(fields: Record<string, unknown>): unknown {
  const key = Object.keys(fields).find(field => field.toLowerCase() === 'looks');
  return key ? fields[key] : undefined;
}

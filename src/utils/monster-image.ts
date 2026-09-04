export interface MonsterRepresentativeAssetReference {
  appr: number;
  archiveName: string;
  imageIndex: number;
}

/**
 * Resolves the static body frame already used by BOO's monster database preview.
 * This is a representative frame only; it does not encode action/direction strides.
 */
export function resolveMonsterRepresentativeAsset(
  value: unknown
): MonsterRepresentativeAssetReference | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const appr = Number(value);
  if (!Number.isInteger(appr) || appr < 0) return undefined;
  return {
    appr,
    archiveName: `Mon${Math.floor(appr / 10) + 1}`,
    imageIndex: (appr % 10) * 360 + 40,
  };
}

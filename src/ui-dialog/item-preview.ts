import { EngineId } from '../types';
import { DialogAssetReference } from './model';

export function defaultItemFrameImageIndex(engine: EngineId): number {
  return engine === 'GEE' ? 250 : 47;
}

export function resolveItemFrameAssetReference(
  engine: EngineId,
  frameValue: unknown
): DialogAssetReference | undefined {
  const numeric = Number(frameValue);
  if (!Number.isInteger(numeric) || numeric <= 0) return undefined;
  return {
    archiveName: 'NewopUI',
    imageIndex: numeric === 1 ? defaultItemFrameImageIndex(engine) : numeric,
  };
}

import { DialogAssetReference } from './model';

/**
 * Builds the visualizer's sequential fill-frame requests from ProgressBar P/C.
 * The manuals document P as the progress image and C as its playback count,
 * but do not spell out the archive-index formula. BOO follows the same
 * consecutive-frame convention used by the legacy WIL animation controls.
 */
export function sequentialFrameAssetReferences(
  start: DialogAssetReference | undefined,
  frameCount: number | undefined,
  maximumFrames = 240
): DialogAssetReference[] {
  if (!start || !Number.isInteger(start.imageIndex) || start.imageIndex! < 0) return [];
  if (start.willIndex !== undefined
    && (!Number.isInteger(start.willIndex) || start.willIndex < 0)) return [];
  if (!start.archiveName?.trim() && !start.archiveRole && start.willIndex === undefined) return [];
  if (!Number.isInteger(frameCount) || frameCount! <= 0) return [];
  if (!Number.isInteger(maximumFrames) || maximumFrames <= 0) return [];
  const requested = frameCount!;
  const limit = maximumFrames;
  const base: DialogAssetReference = { ...start };
  delete base.frameCount;
  return Array.from({ length: Math.min(requested, limit) }, (_, index) => ({
    ...base,
    imageIndex: start.imageIndex! + index,
  }));
}

/** Backwards-compatible name retained for existing progress-bar consumers. */
export const progressFrameAssetReferences = sequentialFrameAssetReferences;

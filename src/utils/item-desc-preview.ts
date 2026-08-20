export interface ItemDescriptionAnimation {
  frames: string[];
  speedMs: number;
}

export interface ItemDescriptionMedia {
  images: Record<string, string>;
  animations: Record<string, ItemDescriptionAnimation>;
}

export interface ItemDescriptionMediaLimits {
  maxFramesPerAnimation?: number;
  maxTotalAnimationFrames?: number;
}

const DEFAULT_MAX_FRAMES_PER_ANIMATION = 32;
const DEFAULT_MAX_TOTAL_ANIMATION_FRAMES = 96;

function parseInteger(value: string | undefined): number | undefined {
  if (value === undefined || !/^-?\d+$/.test(value.trim())) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export function resolveItemDescriptionMedia(
  text: string,
  resolveImage: (archiveIndex: number, imageIndex: number) => string,
  limits: ItemDescriptionMediaLimits = {}
): ItemDescriptionMedia {
  const images: Record<string, string> = {};
  const animations: Record<string, ItemDescriptionAnimation> = {};
  const maxFramesPerAnimation = Math.max(
    1,
    limits.maxFramesPerAnimation ?? DEFAULT_MAX_FRAMES_PER_ANIMATION
  );
  let remainingFrames = Math.max(
    1,
    limits.maxTotalAnimationFrames ?? DEFAULT_MAX_TOTAL_ANIMATION_FRAMES
  );

  for (const match of text.matchAll(/<&?img:([^>]+)>/gi)) {
    const raw = match[0];
    if (images[raw]) continue;
    const fields = match[1].split(':');
    const imageIndex = parseInteger(fields[0]);
    const archiveIndex = parseInteger(fields[1]);
    if (imageIndex === undefined || archiveIndex === undefined) continue;
    const image = resolveImage(archiveIndex, imageIndex);
    if (image) images[raw] = image;
  }

  for (const match of text.matchAll(/<&?playimg:([^>]+)>/gi)) {
    const raw = match[0];
    if (animations[raw] || remainingFrames <= 0) continue;
    const fields = match[1].split(':');
    const archiveIndex = parseInteger(fields[0]);
    const startImageIndex = parseInteger(fields[1]);
    const requestedFrames = parseInteger(fields[2]);
    const requestedSpeed = parseInteger(fields[3]);
    if (
      archiveIndex === undefined
      || startImageIndex === undefined
      || requestedFrames === undefined
      || requestedFrames <= 0
    ) continue;

    const frameCount = Math.min(
      requestedFrames,
      maxFramesPerAnimation,
      remainingFrames
    );
    const frames: string[] = [];
    for (let offset = 0; offset < frameCount; offset++) {
      frames.push(resolveImage(archiveIndex, startImageIndex + offset) || '');
    }
    if (!frames.some(Boolean)) continue;
    remainingFrames -= frameCount;
    animations[raw] = {
      frames,
      speedMs: Math.max(40, Math.min(5000, requestedSpeed ?? 100)),
    };
  }

  return { images, animations };
}

import { EngineId } from '../types';

/**
 * Static light-effect contract evidenced by the GXX client
 * `NpcItemButtonPaintLight` implementation.  The archive names are kept
 * extension-free because the normal dialog asset resolver selects `.pak`,
 * `.jpk`, `.wil` or `.wzl` from the active client layout.
 */
export interface DialogItemLightEffectSpec {
  archiveName: string;
  startIndex: number;
  frameCount: number;
  offsetX: number;
  offsetY: number;
  intervalMs: 200;
  blendMode: 'src-alpha-color';
}

/**
 * Resolve only the GXX/GEE contract.  Similar-looking light fields in other
 * engines must not inherit this mapping without their own client evidence.
 */
export function resolveGxxItemLightEffect(
  engine: EngineId,
  lightCode: unknown
): DialogItemLightEffectSpec | undefined {
  if (engine !== 'GEE') return undefined;
  const code = Number(lightCode);
  if (!Number.isSafeInteger(code) || code <= 0) return undefined;

  if (code === 1) return spec('Prguse2', 230, 20);
  if (code === 2) return spec('Prguse2', 250, 8);
  if (code === 3) return spec('Prguse2', 260, 6);
  if (code >= 4 && code <= 8) return spec('Prguse3', 750 + ((code - 4) * 2), 2);
  if (code === 9) return spec('StateItem', 3580, 25);
  if (code === 10) return spec('StateItem', 3910, 9);
  if (code === 11) return spec('StateEffect', 640, 15, 16, 20);
  if (code === 12) return spec('StateEffect', 680, 25, 16, 20);
  if (code === 13) return spec('StateEffect', 720, 25, 16, 20);
  if (code === 14) return spec('Prguse', 640, 8, 16, 20);
  if (code >= 100 && code <= 699) {
    const group = Math.floor(code / 100);
    return spec(`HeadgearEffect${group === 1 ? '' : group}`, (code % 100) * 20, 20);
  }
  return undefined;
}

function spec(
  archiveName: string,
  startIndex: number,
  frameCount: number,
  offsetX = 0,
  offsetY = 0
): DialogItemLightEffectSpec {
  return {
    archiveName,
    startIndex,
    frameCount,
    offsetX,
    offsetY,
    intervalMs: 200,
    blendMode: 'src-alpha-color',
  };
}

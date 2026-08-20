import * as path from 'path';
import { EngineId } from '../types';
import { ArchiveExtension } from './archive-types';
import {
  isPathInsideAny,
  selectPreferredArchiveFile,
} from './client-resources';

export type OfficialNpcArchiveName = 'npc' | 'npc2' | 'npc3' | 'npc4';

export interface OfficialNpcAnimationPlan {
  archiveName: OfficialNpcArchiveName;
  startIndex: number;
  frameWindow: number;
  interval: number;
}

const PLAN_DEFAULTS = {
  frameWindow: 10,
  interval: 200,
} as const;

// Official NPC archives contain several historical layouts, so the verified
// discontinuities are kept explicit instead of forcing one arithmetic formula.
export function resolveOfficialNpcAnimationPlan(
  appearance: number,
  engine: EngineId
): OfficialNpcAnimationPlan | undefined {
  if (!Number.isInteger(appearance) || appearance < 0 || appearance >= 10000) return undefined;

  const npcStart = resolveNpcStart(appearance);
  if (npcStart !== undefined) return plan('npc', npcStart, frontFrameWindow(appearance));
  const npc2Start = resolveNpc2Start(appearance);
  if (npc2Start !== undefined) return plan('npc2', npc2Start, frontFrameWindow(appearance));
  const npc3Start = resolveNpc3Start(appearance);
  if (npc3Start !== undefined) return plan('npc3', npc3Start);
  const npc4Start = resolveNpc4Start(appearance, engine);
  return npc4Start === undefined ? undefined : plan('npc4', npc4Start);
}

export function selectOfficialNpcArchiveFile(
  archiveName: OfficialNpcArchiveName,
  archiveFiles: readonly string[],
  resourceRoots: readonly string[],
  customPatchDirectories: readonly string[],
  engine: EngineId
): string | undefined {
  const packageExtensions: ArchiveExtension[] = engine === '996PC'
    ? ['jpk', 'pak']
    : ['pak'];
  const packaged = selectPreferredArchiveFile(
    archiveFiles,
    archiveName,
    resourceRoots,
    packageExtensions
  );
  if (packaged) return packaged;

  const clientRoots = resourceRoots.filter(root => !isPathInsideAny(root, customPatchDirectories));
  return selectPreferredArchiveFile(
    archiveFiles,
    archiveName,
    clientRoots.length > 0 ? clientRoots : resourceRoots,
    ['wzl', 'wil']
  );
}

export function officialNpcArchiveBaseName(filePath: string): string {
  return path.basename(filePath, path.extname(filePath));
}

function plan(
  archiveName: OfficialNpcArchiveName,
  startIndex: number,
  frameWindow: number = PLAN_DEFAULTS.frameWindow
): OfficialNpcAnimationPlan {
  return { archiveName, startIndex, frameWindow, interval: PLAN_DEFAULTS.interval };
}

function frontFrameWindow(appearance: number): number {
  if (appearance >= 71 && appearance <= 75) return 4;
  if (appearance === 209) return 4;
  if (appearance === 225) return 1;
  return PLAN_DEFAULTS.frameWindow;
}

function resolveNpcStart(appearance: number): number | undefined {
  if (appearance >= 0 && appearance <= 14) return appearance * 60 + 10;
  if (appearance === 15) return 920;
  if (appearance >= 16 && appearance <= 21) return appearance * 60 + 10;
  if (appearance === 22) return 1360;
  if (appearance === 23) return 1390;
  if (appearance >= 24 && appearance <= 32) return appearance * 60 + 70;
  if (appearance >= 33 && appearance <= 41) return appearance * 60 + 80;
  if (appearance >= 42 && appearance <= 43) return appearance * 60 + 60;
  if (appearance >= 48 && appearance <= 50) return 2720 + (appearance - 48) * 60;
  if (appearance === 51) return 2890;
  if (appearance === 52) return 2980;
  if (appearance >= 54 && appearance <= 59) return 4490 + (appearance - 54) * 10;
  if (appearance >= 60 && appearance <= 67) return 3070 + (appearance - 60) * 60;
  if (appearance === 68) return 3610;
  if (appearance >= 70 && appearance <= 75) return 3780 + (appearance - 70) * 10;
  if (appearance === 76) return 3850;
  if (appearance === 77) return 3910;
  if (appearance === 78) return 4070;
  if (appearance === 79) return 4130;
  if (appearance === 80) return 4190;
  if (appearance === 81) return 3960;
  if (appearance === 82) return 3980;
  if (appearance === 83) return 4000;
  if (appearance === 84) return 4030;
  if (appearance >= 90 && appearance <= 92) return 3750 + (appearance - 90) * 10;
  if (appearance >= 94 && appearance <= 98) return 4490 + (appearance - 94) * 10;
  if (appearance === 130) return 4240;
  if (appearance === 131) return 4560;
  if (appearance === 132) return 4770;
  if (appearance === 133) return 4820;
  return undefined;
}

function resolveNpc2Start(appearance: number): number | undefined {
  if (appearance >= 100 && appearance <= 107) return 10 + (appearance - 100) * 70;
  if (appearance === 109) return 640;
  if (appearance === 209) return 710;
  if (appearance === 210) return 750;
  if (appearance >= 211 && appearance <= 217) return 810 + (appearance - 211) * 10;
  if (appearance === 218) return 900;
  if (appearance === 219) return 930;
  if (appearance === 220) return 970;
  if (appearance === 221) return 980;
  if (appearance === 222) return 990;
  if (appearance === 223) return 1000;
  if (appearance === 224) return 1030;
  if (appearance === 225) return 1060;
  return undefined;
}

function resolveNpc3Start(appearance: number): number | undefined {
  if (appearance >= 226 && appearance <= 235) return 20 + (appearance - 226) * 40;
  if (appearance === 236) return 410;
  if (appearance >= 237 && appearance <= 244) return 480 + (appearance - 237) * 70;
  if (appearance === 245) return 1010;
  return undefined;
}

function resolveNpc4Start(appearance: number, engine: EngineId): number | undefined {
  if (appearance >= 246 && appearance <= 252) return 40 + (appearance - 246) * 90;
  if (appearance >= 253 && appearance <= 258) return 750 + (appearance - 253) * 90;
  if (appearance >= 259 && appearance <= 263) return 1370 + (appearance - 259) * 90;
  if (appearance === 264) return 1900;
  if (appearance === 265) return 2070;
  if (appearance >= 266 && appearance <= 269) return 2160 + (appearance - 266) * 90;
  if (appearance === 270) return 2600;
  if (appearance === 271) return 2770;
  if (appearance === 272) return 2860;
  if (appearance === 273 && engine === 'GEE') return 2950;
  return undefined;
}

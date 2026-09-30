/** Safe diagnostic transport. Never infer a cause from localized error messages. */
export type ArchiveErrorStage = 'global-header' | 'index' | 'image-header' | 'decompression'
  | 'pixels' | 'source' | 'runtime' | 'unknown';
export type ArchiveErrorReason = 'password-check-failed' | 'password-or-profile-mismatch'
  | 'password-required' | 'unsupported-global-header' | 'unsupported-image-layout'
  | 'truncated-data' | 'index-truncated' | 'index-out-of-bounds' | 'duplicate-offset'
  | 'overlapping-blocks' | 'invalid-dimensions' | 'payload-out-of-bounds'
  | 'invalid-compression-header' | 'decompression-failed' | 'decoded-size-mismatch'
  | 'trailing-compressed-data' | 'source-changed' | 'resource-limit'
  | 'missing-runtime-data' | 'invalid-image-block' | 'unknown';
export interface ArchiveDiagnostic {
  stage: ArchiveErrorStage;
  reasonCode: ArchiveErrorReason;
  family?: 'PAK' | 'GOM' | 'GEE' | 'GEE2' | 'GEE3' | 'HXM' | 'PACK4' | 'JPK' | 'WIL' | 'WZL';
  profileId?: string;
  logicalIndex?: number;
  offset?: number;
  length?: number;
}
const stages = new Set<string>(['global-header', 'index', 'image-header', 'decompression', 'pixels', 'source', 'runtime', 'unknown']);
const reasons = new Set<string>(['password-check-failed', 'password-or-profile-mismatch', 'password-required',
  'unsupported-global-header', 'unsupported-image-layout', 'truncated-data', 'index-truncated',
  'index-out-of-bounds', 'duplicate-offset', 'overlapping-blocks', 'invalid-dimensions',
  'payload-out-of-bounds', 'invalid-compression-header', 'decompression-failed', 'decoded-size-mismatch',
  'trailing-compressed-data', 'source-changed', 'resource-limit', 'missing-runtime-data', 'invalid-image-block', 'unknown']);
const families = new Set<string>(['PAK', 'GOM', 'GEE', 'GEE2', 'GEE3', 'HXM', 'PACK4', 'JPK', 'WIL', 'WZL']);
const profiles = new Set<string>(['gom-gameofmir-v2', 'gom-gameofmir2-v2', 'gee2-v2',
  'gee3-main-v2', 'gee3-legacy-v2', 'gee3-alternate-global-v2', 'hxm2-lz-v0', 'hxm2-lz-v1',
  'pack4-plain-bgra', 'pack4-ksf-bgra', 'jpk-GameLib', 'jpk-996M2']);

/** Whitelist fields at trust/process boundaries; no message, path, password, key or decrypted header. */
export function sanitizeArchiveDiagnostic(value: unknown): ArchiveDiagnostic {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const result: ArchiveDiagnostic = {
    stage: stages.has(String(input.stage)) ? input.stage as ArchiveErrorStage : 'unknown',
    reasonCode: reasons.has(String(input.reasonCode)) ? input.reasonCode as ArchiveErrorReason : 'unknown',
  };
  if (families.has(String(input.family))) result.family = input.family as ArchiveDiagnostic['family'];
  if (typeof input.profileId === 'string' && profiles.has(input.profileId)) result.profileId = input.profileId;
  for (const key of ['logicalIndex', 'offset', 'length'] as const) {
    if (typeof input[key] === 'number' && Number.isSafeInteger(input[key]) && input[key] >= 0) result[key] = input[key];
  }
  return result;
}

export class ArchiveStructureError extends Error {
  readonly diagnostic: ArchiveDiagnostic;
  constructor(message: string, diagnostic: ArchiveDiagnostic) {
    super(message);
    this.name = 'ArchiveStructureError';
    this.diagnostic = Object.freeze(sanitizeArchiveDiagnostic(diagnostic));
  }
}

export function getArchiveDiagnostic(error: unknown, fallback?: Partial<ArchiveDiagnostic>): ArchiveDiagnostic {
  const value = error && typeof error === 'object' ? (error as { diagnostic?: unknown }).diagnostic : undefined;
  return sanitizeArchiveDiagnostic({ ...fallback, ...(value && typeof value === 'object' ? value : {}) });
}

/** Preserve existing subclasses/slotCode so diagnostics do not change decoder control flow. */
export function annotateArchiveError<T extends Error>(error: T, diagnostic: ArchiveDiagnostic): T & { diagnostic: ArchiveDiagnostic } {
  Object.defineProperty(error, 'diagnostic', { configurable: true, enumerable: true,
    value: Object.freeze(sanitizeArchiveDiagnostic(diagnostic)) });
  return error as T & { diagnostic: ArchiveDiagnostic };
}

/** Node's documented stream/output-limit failures; host/type/allocation faults are not image damage. */
export function isArchiveZlibDataError(error: unknown): boolean {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  return code === 'Z_DATA_ERROR' || code === 'Z_BUF_ERROR' || code === 'Z_NEED_DICT' || code === 'ERR_BUFFER_TOO_LARGE';
}

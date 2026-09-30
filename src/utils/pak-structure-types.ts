/** Non-secret physical metadata emitted by the production readers.
 * Offsets are file-relative unless explicitly described as decoded-index offsets.
 * This is structural evidence, not a claim that image payloads were decoded.
 */
export interface PakPhysicalStructure {
  profileId: string;
  headerSize: number;
  globalHeaderOffset: number;
  indexOffset: number;
  indexSize: number;
  /** Decoded record width; omitted by existing 4-byte offset profiles. */
  indexRecordSize?: number;
  indexDecodedPrefix: number;
  indexEncoding: string;
  imageHeaderSize: number;
  version?: number;
  bitCount?: number;
  versionReservedBytes?: number[];
  rejectedBlocks?: Array<{ logicalIndex: number; headerOffset: number; reasonCode: string }>;
}

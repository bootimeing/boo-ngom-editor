import type { ArchiveIndexBlock, ArchiveIndexSummary } from './archive-index';

/** Read-only decoder contract, not reconstructed original header bytes or game animation semantics. */
export function describeArchiveImage(summary: ArchiveIndexSummary, block: ArchiveIndexBlock) {
  const { format, profileId } = summary;
  const { imageType: type, flags } = block;
  let pixelFormat = '未确定', alpha = '未确定';
  let compression = block.compressedSize > 0 ? 'zlib' : 'raw';
  if (format === 'PACK4') {
    pixelFormat = 'BGRA32'; alpha = '内嵌 A8';
  } else if (format === 'JPK') {
    pixelFormat = ({ 8: '索引色 8', 16: 'RGB565', 24: 'BGR24', 32: 'BGRX32' } as Record<number, string>)[type] || '未确定';
    // GameLib keeps a separate A8 plane even for 32-bit color; byte 4 is not its alpha.
    alpha = flags ? '独立 A8' : type === 8 ? '调色板 A8' : '不透明';
  } else if (format === 'HXM') {
    pixelFormat = ({ 3: '索引色 8', 5: 'RGB565', 6: 'BGR24', 7: 'BGRX32' } as Record<number, string>)[type] || '未确定';
    const v0 = profileId === 'hxm2-lz-v0';
    if (v0) compression = ({ 0: 'raw', 1: 'RLE', 2: 'zlib' } as Record<number, string>)[flags] || '未支持';
    alpha = !v0 && flags === 1 ? '独立 A8' : type === 3 ? '调色板 A8' : '无独立 alpha（解码器色键）';
    if (!v0 && type === 5 && !flags && block.width % 2) alpha = 'SD 布局未确定';
  } else if (format === 'WIL' || format === 'WZL') {
    pixelFormat = ({ 3: '索引色 8', 5: 'RGB565', 6: 'BGR24', 8: '嵌入图片' } as Record<number, string>)[type] || '未确定';
    alpha = type === 8 ? '取决于嵌入图片' : flags === 9 && type === 5 ? '独立 A4' : '解码器色键';
    if (type === 8) compression = '嵌入图片';
  } else if (format === 'GOM' || format === 'GEE') {
    pixelFormat = ({ 3: '索引色 8', 5: 'RGB565', 6: 'BGR24', 7: 'BGRA32' } as Record<number, string>)[type] || '未确定';
    if (type === 7 && !flags) pixelFormat = 'BGRX32';
    alpha = flags === 1 ? (type === 7 ? '内嵌 A8' : type === 6 ? '独立 A8' : '未确定')
      : flags === 0 ? (format === 'GOM' ? '无独立 alpha（解码器色键）' : '无独立 alpha') : '未确定';
    if (type === 3 && !flags) alpha = '调色板 A8';
  }
  return {
    profileId, format, width: block.width, height: block.height,
    offsetX: profileId === 'gee3-legacy-v2' ? undefined : block.offsetX,
    offsetY: profileId === 'gee3-legacy-v2' ? undefined : block.offsetY,
    imageType: type, flags, payloadOffset: block.payloadOffset, payloadSize: block.payloadSize,
    compressedSize: block.compressedSize, rawSize: block.rawSize, pixelFormat, compression, alpha,
    fieldSource: 'normalized-index',
  };
}

export type ArchiveFormat = 'GEE' | 'GOM' | 'HXM' | 'PACK4' | 'JPK' | 'WIL' | 'WZL';

export type ArchiveExtension = 'pak' | 'jpk' | 'wil' | 'wzl';

export type ArchiveAssetSource = 'pak' | 'jpk' | 'wil' | 'wzl';

export type ArchiveSlotStatus = 'empty' | 'indexed-unverified' | 'decoded' | 'recovered' | 'unsupported' | 'corrupt';

export interface ArchiveRejectedSlot {
  logicalIndex: number;
  reasonCode: string;
  status: 'unsupported' | 'corrupt';
}

export function rejectedSlot(logicalIndex: number, reasonCode: string): ArchiveRejectedSlot {
  return { logicalIndex, reasonCode, status: reasonCode === 'unsupported-image-layout' ? 'unsupported' : 'corrupt' };
}

export function isPairedArchiveExtension(
  extension: string
): extension is 'wil' | 'wzl' {
  return extension === 'wil' || extension === 'wzl';
}

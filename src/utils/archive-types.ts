export type ArchiveFormat = 'GEE' | 'GOM' | 'JPK' | 'WIL' | 'WZL';

export type ArchiveExtension = 'pak' | 'jpk' | 'wil' | 'wzl';

export type ArchiveAssetSource = 'pak' | 'jpk' | 'wil' | 'wzl';

export function isPairedArchiveExtension(
  extension: string
): extension is 'wil' | 'wzl' {
  return extension === 'wil' || extension === 'wzl';
}

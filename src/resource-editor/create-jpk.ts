import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { deriveJpkRc4State, rc4Crypt, parseJpkFileWithState } from '../utils/jpk-reader';
/** Canonical empty GameLib pack. Only confirmed header/index fields are emitted. */
export function createEmptyJpk(targetPath: string, password: string, count: number) {
  if (!Number.isInteger(count) || count < 0 || count > 999999 || typeof password !== 'string') throw new Error('INVALID_PARAMS');
  if (path.extname(targetPath).toLowerCase() !== '.jpk') throw new Error('INVALID_TARGET');
  const target = path.join(fs.realpathSync(path.dirname(path.resolve(targetPath))), path.basename(targetPath));
  if (fs.existsSync(target)) throw new Error('TARGET_EXISTS');
  const key = deriveJpkRc4State(password), header = Buffer.alloc(80);
  header[0] = 7; header.write('GameLib', 1); header.writeUInt32LE(80, 44); header.writeUInt32LE(count, 48); header.writeUInt32LE(80, 52);
  const stage = path.join(path.dirname(target), '.boo-new-jpk-' + crypto.randomBytes(16).toString('hex'));
  let created = false;
  try {
    const fd = fs.openSync(stage, 'wx'); created = true;
    try { fs.writeFileSync(fd, Buffer.concat([rc4Crypt(header, key), Buffer.alloc(count * 4)])); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    const parsed = parseJpkFileWithState(stage, key);
    if (parsed.slotCount !== count || parsed.blocks.length || parsed.trailerSize) throw new Error('VERIFY_STRUCTURE');
    fs.linkSync(stage, target);
    return target;
  } finally { key.fill(0); if (created) fs.unlinkSync(stage); }
}

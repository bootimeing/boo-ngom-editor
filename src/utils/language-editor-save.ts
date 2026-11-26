import * as fs from 'fs';
import { randomUUID } from 'crypto';

export interface LanguageFileEdit {
  path: string;
  before: string;
  after: string;
}

/** Hold all file locks through the settings commit. Only fully written siblings are renamed into place. */
export async function saveLanguageFiles(files: LanguageFileEdit[], saveSettings?: () => Thenable<void>): Promise<void> {
  const locks: string[] = [];
  const temporary: string[] = [];
  const committed: { file: LanguageFileEdit; backup: string }[] = [];
  const recovery = new Set<string>();
  const nonce = randomUUID();
  try {
    for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
      const lock = file.path + '.boo-save.lock';
      fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
      locks.push(lock);
      if (fs.readFileSync(file.path, 'utf8') !== file.before) throw new Error('文件已改变，请重新打开补全编辑器');
    }
    const prepared = files.map(file => {
      const stage = file.path + '.' + nonce + '.new';
      const backup = file.path + '.' + nonce + '.bak';
      temporary.push(stage, backup);
      fs.writeFileSync(stage, file.after, { flag: 'wx' });
      fs.writeFileSync(backup, file.before, { flag: 'wx' });
      return { file, stage, backup };
    });
    for (const { file, stage, backup } of prepared) {
      fs.renameSync(stage, file.path);
      committed.push({ file, backup });
    }
    await saveSettings?.();
  } catch (error) {
    for (const { file, backup } of committed.reverse()) {
      try { fs.renameSync(backup, file.path); }
      catch { recovery.add(backup); }
    }
    if (recovery.size) throw new Error('保存中断，保留原始副本用于恢复 ' + [...recovery].join('、'));
    throw error;
  } finally {
    for (const file of [...temporary, ...locks]) {
      if (!recovery.has(file)) fs.rmSync(file, { force: true });
    }
  }
}

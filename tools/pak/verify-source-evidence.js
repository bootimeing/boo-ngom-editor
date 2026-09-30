// Read-only verification of explicitly supplied engine-source root. No source execution.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const manifest = require('../../docs/specifications/pak-source-evidence.json');
if (process.argv.length !== 3) {
  console.error('用法: node tools/pak/verify-source-evidence.js <GameOfGeeM2目录>');
  process.exitCode = 1;
} else {
  const root = path.resolve(process.argv[2]);
  const files = manifest.files.map(entry => {
    const file = path.resolve(root, entry.path), relative = path.relative(root, file);
    if (path.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + path.sep)) {
      throw Error('证据路径越过指定目录');
    }
    try {
      const sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      return { path: entry.path, matches: sha256 === entry.sha256, sha256 };
    } catch (error) { return { path: entry.path, matches: false, error: error.code || 'read-failed' }; }
  });
  console.log(JSON.stringify({ sourceFamily: manifest.sourceFamily, files }, null, 2));
  if (files.some(file => !file.matches)) process.exitCode = 2;
}

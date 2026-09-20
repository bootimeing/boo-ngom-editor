// Bounded, read-only signature inventory. Explicit roots only; no disk-wide scan.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const roots = process.argv.slice(2).map(value => path.resolve(value));
if (!roots.length) throw Error('Pass explicit sample directories');
const files = [], errors = [], signatures = {}, rootCounts = {};
for (const root of roots) {
  if (path.parse(root).root === root) throw Error('Drive-wide inventory is forbidden');
  rootCounts[root] = 0;
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop();
    let entries;
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); }
    catch (error) { errors.push({ path: directory, error: error.code }); continue; }
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { pending.push(file); continue; }
      if (!entry.isFile() || !/\.pak$/i.test(entry.name)) continue;
      try {
        const handle = fs.openSync(file, 'r'), header = Buffer.alloc(16);
        let read;
        try { read = fs.readSync(handle, header, 0, header.length, 0); } finally { fs.closeSync(handle); }
        // Delphi ShortString formats prefix the signature with its byte length.
        const ascii = header.subarray(header[0] <= 15 ? 1 : 0, read).toString('latin1');
        const signature = /^GEEPAK2/.test(ascii) ? 'GEEPAK2' : /^GEEPAK3/.test(ascii) ? 'GEEPAK3'
          : /^GAMEOFM/.test(ascii) ? 'GAMEOFM*' : /^GEEM2/.test(ascii) ? 'GEEM2' : /^HXM2/.test(ascii) ? 'HXM2' : 'unknown';
        signatures[signature] = (signatures[signature] || 0) + 1; rootCounts[root]++;
        files.push({ path: file, size: fs.statSync(file).size, signature, prefixHex: header.subarray(0, read).toString('hex') });
      } catch (error) { errors.push({ path: file, error: error.code || String(error) }); }
    }
  }
}
const canonical = JSON.stringify(files.sort((a, b) => a.path.localeCompare(b.path)));
console.log(JSON.stringify({ roots, rootCounts, total: files.length, signatures, errors, manifestSha256: crypto.createHash('sha256').update(canonical).digest('hex'), files, boundary: 'Only explicit roots and .pak headers; unknown does not imply unsupported; no format or pixel compatibility inferred from signature.' }, null, 2));

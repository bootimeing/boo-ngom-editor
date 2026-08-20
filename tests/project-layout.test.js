const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

const rootVsix = fs.readdirSync(root).filter(name => name.toLowerCase().endsWith('.vsix'));
assert.deepEqual(rootVsix, [], 'VSIX release files must stay under artifacts/releases');

for (const relativePath of [
  'artifacts/README.md',
  'data/README.md',
  'docs/README.md',
  'docs/plans/996PC_INTEGRATION_PLAN.md',
  'docs/plans/ARCHIVE_DIRECT_PREVIEW_PLAN.md',
  'docs/plans/PERFORMANCE_OPTIMIZATION_PLAN.md',
  'docs/reports/CODE_CLEANUP_AUDIT.md',
  'docs/reports/ENGINE_HELP_AUDIT.md',
  'docs/reports/THREE_ENGINE_COMPARISON.md',
  'docs/releases/OPENVSX_FIRST_PUBLISH.md',
  'tools/release/package-vsix.js',
  'tools/release/verify-packaged-dependencies.js',
  'tools/README.md',
]) {
  assert.ok(exists(relativePath), `Missing classified project file: ${relativePath}`);
}

for (const obsoletePath of [
  'data/backups',
  'OpenVSX首次发布',
  'tools/verify-packaged-dependencies.js',
  'tools/PakBridge/src/__pycache__',
  'Reference',
  'docs/engine-reference',
  'artifacts/backups',
  'artifacts/open-source-verification',
  'artifacts/tmp-research',
  'artifacts/tutorial-doc',
  'artifacts/verification',
  '996PC_INTEGRATION_PLAN.md',
  'CODE_CLEANUP_AUDIT.md',
]) {
  assert.ok(!exists(obsoletePath), `Legacy project path still exists: ${obsoletePath}`);
}

assert.equal(manifest.scripts.package, 'node tools/release/package-vsix.js');
assert.equal(
  manifest.scripts['verify:packaged-dependencies'],
  'node tools/release/verify-packaged-dependencies.js',
);

const vscodeIgnore = fs.readFileSync(path.join(root, '.vscodeignore'), 'utf8');
assert.match(vscodeIgnore, /^artifacts\/\*\*$/m, 'artifacts must never be included in a VSIX');

const releaseRoot = path.join(root, 'artifacts', 'releases');
if (fs.existsSync(releaseRoot)) {
  const allowedRelease = `${manifest.name}-${manifest.version}.vsix`.toLowerCase();
  const pending = [releaseRoot];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(absolute);
      else {
        assert.ok(!entry.name.endsWith('.candidate.vsix'), `Stale package candidate: ${absolute}`);
        assert.ok(!entry.name.endsWith('.previous.vsix'), `Stale package rollback file: ${absolute}`);
        assert.equal(
          entry.name.toLowerCase(),
          allowedRelease,
          `Only the current release may stay in the project artifacts directory: ${absolute}`,
        );
      }
    }
  }
}

console.log('Project layout test passed.');

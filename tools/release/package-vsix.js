const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..', '..');
const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const forwardedArgs = process.argv.slice(2);
const hasCustomOutput = forwardedArgs.some((value, index) => (
  value === '--out'
    ? Boolean(forwardedArgs[index + 1])
    : value.startsWith('--out=')
));

const releaseDirectory = path.join(projectRoot, 'artifacts', 'releases', 'vscode-marketplace');
const finalPath = path.join(releaseDirectory, `${manifest.name}-${manifest.version}.vsix`);
const candidatePath = path.join(releaseDirectory, `${manifest.name}-${manifest.version}.candidate.vsix`);
const previousPath = path.join(releaseDirectory, `${manifest.name}-${manifest.version}.previous.vsix`);
const vsceEntry = path.join(projectRoot, 'node_modules', '@vscode', 'vsce', 'vsce');

if (!fs.existsSync(vsceEntry)) {
  throw new Error('VSCE is not installed. Run npm install before packaging.');
}

fs.mkdirSync(releaseDirectory, { recursive: true });
if (!hasCustomOutput) {
  fs.rmSync(candidatePath, { force: true });
  if (fs.existsSync(previousPath)) {
    if (fs.existsSync(finalPath)) fs.rmSync(previousPath, { force: true });
    else fs.renameSync(previousPath, finalPath);
  }
}

const outputArgs = hasCustomOutput ? forwardedArgs : [...forwardedArgs, '--out', candidatePath];
const result = spawnSync(process.execPath, [vsceEntry, 'package', ...outputArgs], {
  cwd: projectRoot,
  env: process.env,
  stdio: 'inherit',
});

if (result.error) throw result.error;
if (result.status !== 0) {
  if (!hasCustomOutput) fs.rmSync(candidatePath, { force: true });
  process.exit(result.status ?? 1);
}

if (!hasCustomOutput) {
  if (!fs.existsSync(candidatePath)) throw new Error(`VSIX was not created: ${candidatePath}`);
  if (fs.existsSync(finalPath)) fs.renameSync(finalPath, previousPath);
  try {
    fs.renameSync(candidatePath, finalPath);
    fs.rmSync(previousPath, { force: true });
  } catch (error) {
    if (!fs.existsSync(finalPath) && fs.existsSync(previousPath)) {
      fs.renameSync(previousPath, finalPath);
    }
    throw error;
  }
  console.log(`VSIX ready: ${finalPath}`);
}

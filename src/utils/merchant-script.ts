import * as fs from 'fs';
import * as path from 'path';
import { findEnvirRootForPath } from './quick-files';
import { isPathInside, ScriptPathResolution } from './path';

export interface MerchantScriptResolution extends ScriptPathResolution { relativePath?: string }

function segments(value: string): string[] | undefined {
  if (!value || /^[\\/]/.test(value) || /[<>:"|?*\u0000-\u001f]/.test(value)) return undefined;
  const parts = value.split(/[\\/]/);
  return parts.some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part)) ? undefined : parts;
}

/** Resolve the nearest existing ancestor, so a missing child cannot hide a junction escape. */
function physicalPath(file: string): string {
  let current = path.resolve(file);
  const missing: string[] = [];
  for (;;) {
    try { return path.join(fs.realpathSync.native(current), ...missing); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      missing.unshift(path.basename(current)); current = parent;
    }
  }
}

function merchantRoot(wsRoot: string, sourceFile: string): string | undefined {
  if (path.basename(sourceFile).toLowerCase() !== 'merchant.txt' || !isPathInside(wsRoot, sourceFile)) return undefined;
  const envir = findEnvirRootForPath(sourceFile);
  return envir && isPathInside(wsRoot, envir) ? path.join(envir, 'Market_Def') : undefined;
}

export function isMerchantScriptTargetSafe(wsRoot: string, sourceFile: string, target: string): boolean {
  const root = merchantRoot(wsRoot, sourceFile);
  if (!root || !isPathInside(root, target) || path.resolve(root) === path.resolve(target)) return false;
  try {
    const physicalRoot = physicalPath(root), physicalTarget = physicalPath(target);
    return isPathInside(physicalPath(wsRoot), physicalRoot)
      && isPathInside(physicalPath(path.dirname(root)), physicalRoot)
      && isPathInside(physicalRoot, physicalTarget);
  } catch { return false; }
}

/** Already-derived relative filename, shared by the click command and Ctrl+Q. */
export function resolveMerchantScriptTarget(wsRoot: string, sourceFile: string, relativeFile: string): ScriptPathResolution {
  const root = merchantRoot(wsRoot, sourceFile), parts = segments(relativeFile);
  if (!root || !parts) return { candidates: [] };
  let name = parts.pop()!;
  if (!path.extname(name)) name += '.txt';
  if (!/\.txt$/i.test(name)) return { candidates: [] };
  const target = path.join(root, ...parts, name);
  if (!isMerchantScriptTargetSafe(wsRoot, sourceFile, target)) return { candidates: [] };
  try {
    if (fs.statSync(target).isFile()) return { candidates: [target], existingPath: target };
    return { candidates: [] }; // A directory occupying the filename is not a creatable script.
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? { candidates: [target], createPath: target } : { candidates: [] };
  }
}

/** Merchant column 1 + column 2, anchored to this document's own Envir. No I/O writes. */
export function resolveMerchantScriptReference(wsRoot: string, sourceFile: string, scriptRef: string, mapName: string): MerchantScriptResolution {
  const parts = segments(scriptRef), map = mapName.replace(/^\$/, '');
  if (!parts || !segments(map) || /[\\/]/.test(map)) return { candidates: [] };
  const stem = parts.pop()!.replace(/\.txt$/i, '');
  if (!stem) return { candidates: [] };
  const relativePath = path.join(...parts, `${stem}-${map}.txt`);
  const primary = resolveMerchantScriptTarget(wsRoot, sourceFile, relativePath);
  if (!primary.candidates.length) return { candidates: [] };
  const fallback = resolveMerchantScriptTarget(wsRoot, sourceFile, path.join(...parts, `${stem}.txt`));
  return { candidates: [...primary.candidates, ...fallback.candidates], relativePath,
    existingPath: primary.existingPath || fallback.existingPath, createPath: primary.createPath };
}

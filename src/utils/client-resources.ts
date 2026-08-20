import * as fs from 'fs';
import * as path from 'path';
import { ArchiveExtension } from './archive-types';

export interface ClientResourceLayout {
  clientDirectory: string;
  availableCustomPatchDirectories: string[];
  customPatchDirectories: string[];
  dataRoots: string[];
  mapRoots: string[];
  wavRoots: string[];
  graphicsRoots: string[];
}

export interface SavedClientResourceLocation {
  clientDirectory?: string;
  dataDirectory?: string;
  customPatchName?: string;
}

const ARCHIVE_EXTENSIONS = new Set<ArchiveExtension>(['pak', 'jpk', 'wil', 'wzl']);
const STANDARD_CLIENT_DIRECTORIES = new Set([
  'cache',
  'config',
  'data',
  'debug',
  'font',
  'graphics',
  'images',
  'map',
  'resources',
  'wav',
]);

export function discoverClientResourceLayout(
  clientDirectory: string,
  customPatchName = ''
): ClientResourceLayout {
  const clientRoot = path.resolve(clientDirectory);
  const availableCustomPatchDirectories: string[] = [];
  const customPatchDirectories: string[] = [];
  const dataRoots: string[] = [];
  const mapRoots: string[] = [];
  const wavRoots: string[] = [];
  const graphicsRoots: string[] = [];

  if (!isDirectory(clientRoot)) {
    return {
      clientDirectory: clientRoot,
      availableCustomPatchDirectories,
      customPatchDirectories,
      dataRoots,
      mapRoots,
      wavRoots,
      graphicsRoots,
    };
  }

  const children = readDirectories(clientRoot)
    .filter(directory => !STANDARD_CLIENT_DIRECTORIES.has(path.basename(directory).toLowerCase()))
    .map(directory => ({ directory, resources: findResourceDirectories(directory) }))
    .filter(candidate => isCustomPatchDirectory(candidate.directory, candidate.resources))
    .sort((left, right) => left.directory.localeCompare(
      right.directory,
      'zh-CN',
      { numeric: true, sensitivity: 'base' }
    ));

  availableCustomPatchDirectories.push(...children.map(candidate => candidate.directory));
  const requestedCustomPatch = customPatchName.trim().toLowerCase();
  const selectedChildren = requestedCustomPatch
    ? children.filter(candidate => path.basename(candidate.directory).toLowerCase() === requestedCustomPatch)
    : children.length === 1
      ? children
      : [];

  for (const candidate of selectedChildren) {
    customPatchDirectories.push(candidate.directory);
    appendUnique(dataRoots, candidate.resources.data);
    appendUnique(mapRoots, candidate.resources.map);
    appendUnique(wavRoots, candidate.resources.wav);
    appendUnique(graphicsRoots, candidate.resources.graphics);
  }

  const clientResources = findResourceDirectories(clientRoot);
  appendUnique(dataRoots, clientResources.data);
  appendUnique(mapRoots, clientResources.map);
  appendUnique(wavRoots, clientResources.wav);
  appendUnique(graphicsRoots, clientResources.graphics);

  return {
    clientDirectory: clientRoot,
    availableCustomPatchDirectories,
    customPatchDirectories,
    dataRoots,
    mapRoots,
    wavRoots,
    graphicsRoots,
  };
}

export function clientResourceLayoutFromState(
  state: SavedClientResourceLocation | undefined
): ClientResourceLayout | undefined {
  const selectedClient = state?.clientDirectory?.trim();
  if (selectedClient && isDirectory(selectedClient)) {
    return discoverClientResourceLayout(selectedClient, state?.customPatchName);
  }

  const legacyData = state?.dataDirectory?.trim();
  if (!legacyData || !isDirectory(legacyData)) return undefined;
  const inferredClient = inferClientDirectoryFromLegacyDataDirectory(legacyData);
  const layout = discoverClientResourceLayout(inferredClient, state?.customPatchName);
  if (!layout.dataRoots.some(root => samePath(root, legacyData))) {
    layout.dataRoots.unshift(path.resolve(legacyData));
  }
  return layout;
}

export function inferClientDirectoryFromLegacyDataDirectory(dataDirectory: string): string {
  const resolvedData = path.resolve(dataDirectory);
  if (path.basename(resolvedData).toLowerCase() !== 'data') return resolvedData;

  const immediateParent = path.dirname(resolvedData);
  const clientCandidate = path.dirname(immediateParent);
  const parentResources = findResourceDirectories(immediateParent);
  const clientResources = findResourceDirectories(clientCandidate);
  if (
    clientResources.data
    && !samePath(clientResources.data, resolvedData)
    && (parentResources.map || parentResources.wav || parentResources.graphics)
  ) {
    return clientCandidate;
  }
  return immediateParent;
}

export function isUsableClientResourceLayout(layout: ClientResourceLayout): boolean {
  return isDirectory(layout.clientDirectory) && layout.dataRoots.length > 0;
}

export async function scanClientArchiveFiles(
  resourceRoots: readonly string[],
  allowedExtensions: readonly ArchiveExtension[] = [...ARCHIVE_EXTENSIONS]
): Promise<string[]> {
  const allowed = new Set(allowedExtensions.map(extension => extension.toLowerCase()));
  const preferredByKey = new Map<string, string>();

  for (const resourceRoot of uniquePaths(resourceRoots)) {
    if (!isDirectory(resourceRoot)) continue;
    const files = await scanArchiveRoot(resourceRoot, allowed);
    for (const filePath of files) {
      const key = archiveFileKey(filePath);
      if (!preferredByKey.has(key)) preferredByKey.set(key, filePath);
    }
  }
  return [...preferredByKey.values()];
}

export function archiveFileKey(filePath: string): string {
  const extension = path.extname(filePath).slice(1).toLowerCase();
  const basename = path.basename(filePath, path.extname(filePath)).toLowerCase();
  return `${basename}.${extension}`;
}

export function archiveBaseKey(filePath: string): string {
  return path.basename(filePath, path.extname(filePath)).toLowerCase();
}

export function selectPreferredArchiveFile(
  archiveFiles: readonly string[],
  archiveName: string,
  resourceRoots: readonly string[],
  archiveExtensions: readonly ArchiveExtension[]
): string | undefined {
  const requestedName = archiveBaseKey(archiveName);
  const extensionRanks = new Map(
    archiveExtensions.map((extension, index) => [extension.toLowerCase(), index])
  );
  return archiveFiles
    .filter(filePath => archiveBaseKey(filePath) === requestedName)
    .map(filePath => ({
      filePath,
      rootRank: resourceRootRank(filePath, resourceRoots),
      extensionRank: extensionRanks.get(
        path.extname(filePath).slice(1).toLowerCase()
      ),
    }))
    .filter(candidate => (
      candidate.rootRank !== Number.MAX_SAFE_INTEGER
      && candidate.extensionRank !== undefined
    ))
    .sort((left, right) => (
      left.rootRank - right.rootRank
      || left.extensionRank! - right.extensionRank!
      || left.filePath.localeCompare(
        right.filePath,
        'zh-CN',
        { numeric: true, sensitivity: 'base' }
      )
    ))[0]?.filePath;
}

export function resourceRootRank(filePath: string, resourceRoots: readonly string[]): number {
  const resolvedPath = path.resolve(filePath);
  for (let index = 0; index < resourceRoots.length; index++) {
    if (isPathInside(resolvedPath, resourceRoots[index])) return index;
  }
  return Number.MAX_SAFE_INTEGER;
}

export function isPathInsideAny(filePath: string, resourceRoots: readonly string[]): boolean {
  return resourceRoots.some(root => isPathInside(filePath, root));
}

export function resolveResourceFile(
  resourceRoots: readonly string[],
  names: readonly string[],
  extension: string
): string | undefined {
  for (const rawName of names) {
    const resourceName = path.basename(String(rawName || '').replace(
      new RegExp(`${escapeRegExp(extension)}$`, 'i'),
      ''
    ));
    if (!resourceName) continue;
    for (const resourceRoot of resourceRoots) {
      const match = findChildFile(resourceRoot, `${resourceName}${extension}`);
      if (match) return match;
    }
  }
  return undefined;
}

export function relativeClientResourcePath(
  layout: ClientResourceLayout,
  filePath: string
): string {
  const relative = path.relative(layout.clientDirectory, path.resolve(filePath));
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative)
    ? relative
    : path.basename(filePath);
}

function findResourceDirectories(root: string): {
  data?: string;
  map?: string;
  wav?: string;
  graphics?: string;
} {
  const resourcesRoot = findChildDirectory(root, 'resources');
  return {
    data: findChildDirectory(root, 'data') || (resourcesRoot ? findChildDirectory(resourcesRoot, 'data') : undefined),
    map: findChildDirectory(root, 'map') || (resourcesRoot ? findChildDirectory(resourcesRoot, 'map') : undefined),
    wav: findChildDirectory(root, 'wav') || (resourcesRoot ? findChildDirectory(resourcesRoot, 'wav') : undefined),
    graphics: findChildDirectory(root, 'graphics')
      || (resourcesRoot ? findChildDirectory(resourcesRoot, 'graphics') : undefined),
  };
}

function isCustomPatchDirectory(
  directory: string,
  resources: ReturnType<typeof findResourceDirectories>
): boolean {
  if (!resources.data) return false;
  if (resources.map || resources.wav || resources.graphics) return true;
  return /(?:patch|resource|补丁)/i.test(path.basename(directory));
}

async function scanArchiveRoot(
  root: string,
  allowedExtensions: ReadonlySet<string>
): Promise<string[]> {
  const result: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await fs.promises.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(
      right.name,
      'zh-CN',
      { numeric: true, sensitivity: 'base' }
    ));
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
        continue;
      }
      const extension = path.extname(entry.name).slice(1).toLowerCase();
      if (entry.isFile() && allowedExtensions.has(extension)) {
        result.push(path.resolve(entryPath));
      }
    }
  };
  await visit(path.resolve(root));
  return result;
}

function findChildDirectory(root: string, name: string): string | undefined {
  if (!isDirectory(root)) return undefined;
  const key = name.toLowerCase();
  try {
    const entry = fs.readdirSync(root, { withFileTypes: true })
      .find(candidate => candidate.isDirectory() && candidate.name.toLowerCase() === key);
    return entry ? path.join(root, entry.name) : undefined;
  } catch {
    return undefined;
  }
}

function findChildFile(root: string, name: string): string | undefined {
  if (!isDirectory(root)) return undefined;
  const key = name.toLowerCase();
  try {
    const entry = fs.readdirSync(root, { withFileTypes: true })
      .find(candidate => candidate.isFile() && candidate.name.toLowerCase() === key);
    return entry ? path.join(root, entry.name) : undefined;
  } catch {
    return undefined;
  }
}

function readDirectories(root: string): string[] {
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => path.join(root, entry.name));
  } catch {
    return [];
  }
}

function appendUnique(target: string[], candidate: string | undefined): void {
  if (!candidate) return;
  const resolved = path.resolve(candidate);
  if (!target.some(existing => samePath(existing, resolved))) target.push(resolved);
}

function uniquePaths(paths: readonly string[]): string[] {
  const unique = new Map<string, string>();
  for (const candidate of paths) {
    const resolved = path.resolve(candidate);
    const key = normalizePath(resolved);
    if (!unique.has(key)) unique.set(key, resolved);
  }
  return [...unique.values()];
}

function isPathInside(filePath: string, directory: string): boolean {
  const relative = path.relative(path.resolve(directory), path.resolve(filePath));
  return relative === '' || (
    !relative.startsWith(`..${path.sep}`)
    && relative !== '..'
    && !path.isAbsolute(relative)
  );
}

function isDirectory(candidate: string): boolean {
  try { return fs.statSync(candidate).isDirectory(); } catch { return false; }
}

function samePath(left: string, right: string): boolean {
  return normalizePath(left) === normalizePath(right);
}

function normalizePath(filePath: string): string {
  return path.normalize(path.resolve(filePath)).toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

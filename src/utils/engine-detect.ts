import * as fs from 'fs';
import * as path from 'path';
import { EngineId } from '../types';
import { ENGINE_IDS } from './engine-registry';

export interface EngineDetectionResult {
  engine: EngineId | null;
  scores: Record<EngineId, number>;
  evidence: string[];
  confidence: 'high' | 'medium' | 'none';
}

interface Indicator {
  engine: EngineId;
  relativePath: string;
  score: number;
  label: string;
}

const INDICATORS: Indicator[] = [
  { engine: 'GOM', relativePath: 'GameOfMir引擎控制器.exe', score: 8, label: 'GameOfMir引擎控制器.exe' },
  { engine: 'GOM', relativePath: 'GameOfMir登录器生成器.exe', score: 5, label: 'GameOfMir登录器生成器.exe' },
  { engine: 'GOM', relativePath: 'GameOfMir引擎使用说明书.chm', score: 3, label: 'GameOfMir引擎使用说明书.chm' },
  { engine: 'GOM', relativePath: 'GameLogin.exe', score: 2, label: 'GameLogin.exe' },
  { engine: 'GEE', relativePath: path.join('Mir200', 'server.dll'), score: 5, label: 'Mir200/server.dll' },
  { engine: 'GEE', relativePath: path.join('Mir200', '系统插件.ini'), score: 3, label: 'Mir200/系统插件.ini' },
  { engine: 'GEE', relativePath: 'WIL编辑器.exe', score: 2, label: 'WIL编辑器.exe' },
  { engine: '996PC', relativePath: '996M2引擎PC端帮助文档.chm', score: 3, label: '996PC 帮助文档' },
];

export function detectEngineDetails(wsRoot: string): EngineDetectionResult {
  const root = resolveEngineRoot(wsRoot);
  const result: EngineDetectionResult = {
    engine: null,
    scores: Object.fromEntries(ENGINE_IDS.map(engine => [engine, 0])) as Record<EngineId, number>,
    evidence: [],
    confidence: 'none',
  };
  if (!root) return result;

  const hasServerLayout = hasAny(root, [
    path.join('Mir200', 'M2Server.exe'),
    path.join('Mir200', 'Mir.dat'),
  ]);
  for (const indicator of INDICATORS) {
    if (!fs.existsSync(path.join(root, indicator.relativePath))) continue;
    result.scores[indicator.engine] += indicator.score;
    result.evidence.push(`${indicator.engine}: ${indicator.label}`);
  }
  add996PcEvidence(root, result);

  const ranked = ENGINE_IDS
    .map(engine => ({ engine, score: result.scores[engine] }))
    .sort((a, b) => b.score - a.score);
  const winner = ranked[0];
  const margin = winner.score - (ranked[1]?.score || 0);
  if ((hasServerLayout || winner.score >= 8) && winner.score >= 5 && margin >= 3) {
    result.engine = winner.engine;
    result.confidence = winner.score >= 8 ? 'high' : 'medium';
  }
  return result;
}

export function resolveEngineRoot(wsRoot: string): string {
  if (!wsRoot) return '';
  const initial = path.resolve(wsRoot);
  if (
    path.basename(initial).toLowerCase() === 'mir200'
    && hasAny(initial, ['M2Server.exe', 'Mir.dat'])
  ) {
    return path.dirname(initial);
  }

  const directServerRoot = findDirectServerRoot(initial);
  if (directServerRoot) return directServerRoot;

  let current = initial;
  for (let depth = 0; depth <= 3; depth++) {
    if (hasAny(current, [
      path.join('Mir200', 'M2Server.exe'),
      path.join('Mir200', 'Mir.dat'),
    ])) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return initial;
}

function findDirectServerRoot(root: string): string {
  try {
    const candidates = fs.readdirSync(root, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => ({
        name: entry.name,
        fullPath: path.join(root, entry.name),
      }))
      .filter(entry => hasAny(entry.fullPath, [
        path.join('Mir200', 'M2Server.exe'),
        path.join('Mir200', 'Mir.dat'),
      ]));
    const namedMirServer = candidates.find(
      candidate => candidate.name.toLowerCase() === 'mirserver'
    );
    if (namedMirServer) return namedMirServer.fullPath;
    return candidates.length === 1 ? candidates[0].fullPath : '';
  } catch {
    return '';
  }
}

function add996PcEvidence(root: string, result: EngineDetectionResult): void {
  const setupCandidates = [
    path.join(root, 'Mir200', 'Setup.json'),
    path.join(root, 'Setup.json'),
  ];
  if (setupCandidates.some(candidate => jsonHasOwnKey(candidate, 'M2DB-Config'))) {
    addEvidence(result, '996PC', 8, 'Setup.json 包含 M2DB-Config');
  }

  const deployedDataDirectories = [
    path.join(root, 'Mir200', 'Envir', 'Data'),
    path.join(root, 'Envir', 'Data'),
  ];
  if (deployedDataDirectories.some(has996CoreTables)) {
    addEvidence(result, '996PC', 10, 'Envir/Data 包含 cfg_item/cfg_monster/cfg_magic.xls');
  }
  if (has996CoreTables(path.join(root, '表格'))) {
    addEvidence(result, '996PC', 6, '表格目录包含三张 996PC 核心表');
  }

  const extendedTableDirectories = [
    ...deployedDataDirectories,
    path.join(root, '表格'),
  ];
  if (extendedTableDirectories.some(directory => hasAny(directory, [
    'cfg_JobAction.xls',
    'cfg_redpoint.xls',
    'cfg_kuafuval.xls',
  ]))) {
    addEvidence(result, '996PC', 4, '存在 996PC 扩展 cfg 表');
  }

  if (
    hasAny(root, [path.join('Mir200', 'SystemModule.dll')])
    && hasAny(root, [path.join('Mir200', 'Lua5.1.dll')])
  ) {
    addEvidence(result, '996PC', 3, 'SystemModule.dll + Lua5.1.dll');
  }
}

function addEvidence(
  result: EngineDetectionResult,
  engine: EngineId,
  score: number,
  label: string
): void {
  result.scores[engine] += score;
  result.evidence.push(`${engine}: ${label}`);
}

function has996CoreTables(directory: string): boolean {
  return ['cfg_item.xls', 'cfg_monster.xls', 'cfg_magic.xls']
    .every(fileName => fs.existsSync(path.join(directory, fileName)));
}

function hasAny(root: string, relativePaths: string[]): boolean {
  return relativePaths.some(relativePath => fs.existsSync(path.join(root, relativePath)));
}

function jsonHasOwnKey(filePath: string, key: string): boolean {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
    return Boolean(
      value
      && typeof value === 'object'
      && Object.prototype.hasOwnProperty.call(value, key)
    );
  } catch {
    return false;
  }
}

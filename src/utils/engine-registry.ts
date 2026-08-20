import { EngineId } from '../types';

export interface EngineDefinition {
  id: EngineId;
  label: string;
  shortLabel: string;
  settingsDescription: string;
  functionFile: string;
  constantsFile: string;
  statusColor: string;
  webviewId: 'gom' | 'lingfeng' | '996pc';
  archiveExtensions: readonly ('pak' | 'jpk')[];
  languageCatalogVerified: boolean;
  uiCodeGenerationVerified: boolean;
  databaseVerified: boolean;
  mapPreviewVerified: boolean;
  reloadVerified: boolean;
}

export const ENGINE_DEFINITIONS: readonly EngineDefinition[] = [
  {
    id: 'GOM',
    label: 'GOM引擎',
    shortLabel: 'GOM',
    settingsDescription: 'NGOM引擎(922G)',
    functionFile: 'functions.json',
    constantsFile: 'constants-gom.json',
    statusColor: '#f59e0b',
    webviewId: 'gom',
    archiveExtensions: ['pak'],
    languageCatalogVerified: true,
    uiCodeGenerationVerified: true,
    databaseVerified: true,
    mapPreviewVerified: true,
    reloadVerified: true,
  },
  {
    id: 'GEE',
    label: '翎风引擎',
    shortLabel: '翎风',
    settingsDescription: '翎风引擎',
    functionFile: 'functions-gee.json',
    constantsFile: 'constants-gee.json',
    statusColor: '#8b5cf6',
    webviewId: 'lingfeng',
    archiveExtensions: ['pak'],
    languageCatalogVerified: true,
    uiCodeGenerationVerified: true,
    databaseVerified: true,
    mapPreviewVerified: true,
    reloadVerified: true,
  },
  {
    id: '996PC',
    label: '996PC引擎',
    shortLabel: '996PC',
    settingsDescription: '996PC引擎',
    functionFile: 'functions-996pc.json',
    constantsFile: 'constants-996pc.json',
    statusColor: '#22c55e',
    webviewId: '996pc',
    archiveExtensions: ['jpk'],
    languageCatalogVerified: true,
    uiCodeGenerationVerified: true,
    databaseVerified: true,
    mapPreviewVerified: true,
    reloadVerified: true,
  },
] as const;

export const ENGINE_IDS: readonly EngineId[] = ENGINE_DEFINITIONS.map(engine => engine.id);

export function normalizeEngineId(value: string | undefined): EngineId {
  const normalized = value?.trim().toUpperCase();
  return ENGINE_IDS.find(engine => engine === normalized) || ENGINE_DEFINITIONS[0].id;
}

export function getEngineDefinition(engine: string | undefined): EngineDefinition {
  const id = normalizeEngineId(engine);
  return ENGINE_DEFINITIONS.find(candidate => candidate.id === id) || ENGINE_DEFINITIONS[0];
}

export function nextEngineId(engine: string | undefined): EngineId {
  const current = normalizeEngineId(engine);
  const index = ENGINE_IDS.indexOf(current);
  return ENGINE_IDS[(index + 1) % ENGINE_IDS.length];
}

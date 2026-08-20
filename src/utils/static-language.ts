import {
  EngineId,
  StaticLanguageData,
  StaticLanguageEntry,
  StaticLanguageVariant,
} from '../types';

export interface ActiveStaticLanguageEntry extends StaticLanguageVariant {
  id: string;
  engines: EngineId[];
}

export const EMPTY_STATIC_LANGUAGE_DATA: StaticLanguageData = {
  schemaVersion: 1,
  revision: '',
  saySnippets: [],
  mapInfoParams: [],
};

export function activeStaticLanguageEntries(
  entries: StaticLanguageEntry[] | undefined,
  engine: EngineId
): ActiveStaticLanguageEntry[] {
  const result: ActiveStaticLanguageEntry[] = [];
  for (const entry of entries || []) {
    const variant = entry.engineVariants?.[engine];
    if (!variant?.label || !variant.source?.page) continue;
    result.push({
      ...variant,
      id: entry.id,
      engines: [engine],
    });
  }
  return result;
}

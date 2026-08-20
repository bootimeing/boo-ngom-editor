import { EngineId } from '../types';
import { ArchiveExtension } from './archive-types';
import { getEngineDefinition } from './engine-registry';

const READ_ONLY_PAIR_EXTENSIONS: readonly ArchiveExtension[] = ['wil', 'wzl'];

export function uiEditorArchiveExtensions(engine: EngineId): ArchiveExtension[] {
  return [...new Set<ArchiveExtension>([
    ...getEngineDefinition(engine).archiveExtensions,
    ...READ_ONLY_PAIR_EXTENSIONS,
  ])];
}

export function uiEditorArchiveLabel(engine: EngineId): string {
  return uiEditorArchiveExtensions(engine)
    .map(extension => extension.toUpperCase())
    .join('/');
}

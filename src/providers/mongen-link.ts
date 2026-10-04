import * as path from 'path';
import * as vscode from 'vscode';
import { getEngineDefinition } from '../utils/engine-registry';
import { parseMonGenLine } from '../utils/map-entities';
import { isStaticMapInfoEntry } from '../utils/map-preview';
import { createMonsterDropFileResolver, isMonGenDocumentPath } from '../utils/mongen-drop-files';
import { findEnvirRootForPath } from '../utils/quick-files';

export class MonGenLinkProvider implements vscode.DocumentLinkProvider {
  provideDocumentLinks(document: vscode.TextDocument): vscode.DocumentLink[] {
    if (document.uri.scheme !== 'file' || !isMonGenDocumentPath(document.fileName)) return [];
    const envirRoot = findEnvirRootForPath(document.fileName);
    if (!envirRoot || path.resolve(path.dirname(document.fileName)).toLowerCase() !== envirRoot.toLowerCase()) return [];
    // One directory snapshot per query, not one MonItems scan per spawn row.
    const resolveDrop = createMonsterDropFileResolver(document.fileName);
    const engine = vscode.workspace.getConfiguration('boo', document.uri).get<string>('engine', 'GOM');
    const mapSupported = getEngineDefinition(engine).mapPreviewVerified;
    const links: vscode.DocumentLink[] = [];
    for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex++) {
      const parsed = parseMonGenLine(document.lineAt(lineIndex).text, lineIndex + 1);
      if (!parsed) continue;
      if (mapSupported && isStaticMapInfoEntry({ mapId: parsed.spawn.mapName, originalMapId: parsed.spawn.mapName })) {
        const column = parsed.columns[0];
        const args = JSON.stringify([document.uri.toString(), parsed.spawn.lineNumber]);
        const link = new vscode.DocumentLink(
          new vscode.Range(lineIndex, column.start, lineIndex, column.end),
          vscode.Uri.parse(`command:boo.openMonGenOriginalMap?${encodeURIComponent(args)}`)
        );
        link.tooltip = 'Ctrl+左键：打开此刷怪原始地图';
        links.push(link);
      }
      const target = resolveDrop?.(parsed.spawn.monsterName);
      if (!target) continue;
      const column = parsed.columns[3];
      const args = JSON.stringify([document.uri, parsed.spawn.monsterName, 'monGen', parsed.spawn.lineNumber]);
      const link = new vscode.DocumentLink(
        new vscode.Range(lineIndex, column.start, lineIndex, column.end),
        target.existingPath ? vscode.Uri.file(target.existingPath)
          : vscode.Uri.parse(`command:boo.createMissingFile?${encodeURIComponent(args)}`)
      );
      link.tooltip = target.existingPath
        ? 'Ctrl+左键：打开怪物爆率文件' : 'Ctrl+左键：爆率文件不存在，可选择创建文本';
      links.push(link);
    }
    return links;
  }
}

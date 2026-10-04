import * as path from 'path';
import * as vscode from 'vscode';
import { getEngineDefinition } from '../utils/engine-registry';
import { isStaticMapInfoEntry, parseMapInfoLine } from '../utils/map-preview';
import { findEnvirRootForPath } from '../utils/quick-files';

export class MapInfoLinkProvider implements vscode.DocumentLinkProvider {
  provideDocumentLinks(document: vscode.TextDocument): vscode.DocumentLink[] {
    if (document.uri.scheme !== 'file' || path.basename(document.fileName).toLowerCase() !== 'mapinfo.txt') return [];
    const envirRoot = findEnvirRootForPath(document.fileName);
    if (!envirRoot || path.resolve(path.dirname(document.fileName)).toLowerCase() !== envirRoot.toLowerCase()) {
      return [];
    }
    const engine = vscode.workspace.getConfiguration('boo', document.uri).get<string>('engine', 'GOM');
    if (!getEngineDefinition(engine).mapPreviewVerified) return [];
    const links: vscode.DocumentLink[] = [];
    for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex++) {
      const parsed = parseMapInfoLine(document.lineAt(lineIndex).text, lineIndex + 1);
      if (!parsed?.nameSpan || !isStaticMapInfoEntry(parsed.entry)) continue;
      const argumentsJson = JSON.stringify([document.uri.toString(), parsed.entry.lineNumber]);
      const link = new vscode.DocumentLink(
        new vscode.Range(lineIndex, parsed.nameSpan.start, lineIndex, parsed.nameSpan.end),
        vscode.Uri.parse(`command:boo.openMapInfoOriginalMap?${encodeURIComponent(argumentsJson)}`)
      );
      link.tooltip = 'Ctrl+左键：打开此原始地图';
      links.push(link);
    }
    return links;
  }
}

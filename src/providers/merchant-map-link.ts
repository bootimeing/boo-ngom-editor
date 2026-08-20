import * as path from 'path';
import * as vscode from 'vscode';
import { parseMerchantLine } from '../utils/map-entities';

const OPEN_MERCHANT_NPC_COMMAND = 'boo.openMerchantNpcOnMap';

export class MerchantMapLinkProvider implements vscode.DocumentLinkProvider {
  provideDocumentLinks(document: vscode.TextDocument): vscode.DocumentLink[] {
    if (path.basename(document.fileName).toLowerCase() !== 'merchant.txt') return [];
    const links: vscode.DocumentLink[] = [];
    for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex++) {
      const parsed = parseMerchantLine(document.lineAt(lineIndex).text, lineIndex + 1);
      const displayNameColumn = parsed?.columns[4];
      if (!parsed || !displayNameColumn) continue;
      const range = new vscode.Range(
        lineIndex,
        displayNameColumn.start,
        lineIndex,
        displayNameColumn.end
      );
      const argumentsJson = JSON.stringify([document.uri.toString(), parsed.npc.lineNumber]);
      const target = vscode.Uri.parse(
        `command:${OPEN_MERCHANT_NPC_COMMAND}?${encodeURIComponent(argumentsJson)}`
      );
      const link = new vscode.DocumentLink(range, target);
      link.tooltip = 'Ctrl+左键：在原始地图定位此 NPC';
      links.push(link);
    }
    return links;
  }
}

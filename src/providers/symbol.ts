import * as vscode from 'vscode';
import { findScriptSectionSymbols } from '../utils/document-symbols';

const DOC_SELECTOR: vscode.DocumentSelector = [
  { language: 'gomscript', scheme: 'file' },
  { language: 'plaintext', scheme: 'file', pattern: '**/*.txt' }
];

export function registerSymbolProvider(context: vscode.ExtensionContext): void {
  const provider = vscode.languages.registerDocumentSymbolProvider(DOC_SELECTOR, {
    provideDocumentSymbols(document) {
      const allText = document.getText();
      return findScriptSectionSymbols(allText).map(section => {
        const range = new vscode.Range(
          document.positionAt(section.rangeStart),
          document.positionAt(section.rangeEnd)
        );
        const selectionRange = new vscode.Range(
          document.positionAt(section.selectionStart),
          document.positionAt(section.selectionEnd)
        );
        return new vscode.DocumentSymbol(
          section.name,
          '',
          section.kind === 'function' ? vscode.SymbolKind.Module : vscode.SymbolKind.Boolean,
          range,
          selectionRange
        );
      });
    }
  });
  context.subscriptions.push(provider);
}

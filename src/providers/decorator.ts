import * as vscode from 'vscode';
import { postToSidebar } from '../utils/sidebar-bridge';
import { TABLE_CONFIGS, matchTableFile, parseTableColumns } from '../utils/table-configs';

// 传奇引擎标准256色调色板（CHM颜色值列表）
	const GOM_PALETTE: string[] = [
	  '#000000','#800000','#008000','#808000','#000080','#800080','#008080','#c0c0c0','#558097','#9db9c8','#7b7373','#2d2929','#5a5252','#635a5a','#423939','#1d1818','#181010','#291818','#100808','#f27971','#e1675f','#ff5a5a','#ff3131','#d65a52','#941000','#942918','#390800','#731000','#b51800','#bd6352','#421810','#ffaa99','#000000','#733929','#a54a31','#947b73','#bd5231','#522110','#7b3118','#2d1810','#8c4a31','#942900','#bd3100','#c67352','#6b3118','#c66b42','#ce4a00','#a56339','#5a3118','#2a1000','#150800','#3a1800','#080000','#290000','#4a0000','#9d0000','#dc0000','#de0000','#fb0000','#9c7352','#946b4a','#734a29','#523118','#8c4a18','#884411','#4a2100','#211810','#d6945a','#c66b21','#ef6b00','#ff7700','#a59484','#423121','#181008','#291808','#211000','#392918','#8c6339','#422910','#6b4218','#7b4a18','#944a00','#8c847b','#6b635a','#4a4239','#292118','#463929','#b5a594','#7b6b5a','#ceb194','#a58c73','#8c735a','#b59473','#d6a573','#efa54a','#efc68c','#7b6342','#6b5639','#bd945a','#633900','#d6c6ad','#524229','#946318','#efd6ad','#a58c63','#635a4a','#bda57b','#5a4218','#bd8c31','#353129','#948463','#7b6b4a','#a58c5a','#5a4a29','#9c7b39','#423110','#efad21','#181000','#292100','#9c6b00','#94845a','#524218','#6b5a29','#7b6321','#9c7b21','#dea500','#5a5239','#312910','#cebd7b','#635a39','#94844a','#c6a529','#109c18','#428c4a','#318c42','#109429','#081810','#081818','#082910','#184229','#a5b5ad','#6b7373','#182929','#18424a','#31424a','#63c6de','#44ddff','#8cd6ef','#736b39','#f7de39','#f7ef8c','#f7e700','#6b6b5a','#5a8ca5','#39b5ef','#4a9cce','#3184b5','#31526b','#deded6','#bdbdb5','#8c8c84','#f7f7de','#000818','#081839','#081029','#081800','#082900','#0052a5','#007bde','#10294a','#10396b','#10528c','#215aa5','#10315a','#104284','#315284','#182131','#4a5a7b','#526ba5','#293963','#104ade','#292921','#4a4a39','#292918','#4a4a29','#7b7b42','#9c9c4a','#5a5a29','#424214','#393900','#595900','#ca352c','#6b7321','#293100','#313910','#313918','#424a00','#526318','#5a7329','#314a18','#182100','#183100','#183910','#63844a','#6bbd4a','#63b54a','#63bd4a','#5a9c4a','#4a8c39','#63c64a','#63d64a','#52844a','#317329','#63c65a','#52bd4a','#10ff00','#182918','#4a884a','#4ae74a','#005a00','#008800','#009400','#00de00','#00ee00','#00fb00','#4a5a94','#6373b5','#7b8cd6','#6b7bd6','#7788ff','#c6c6ce','#94949c','#9c94c6','#313139','#291884','#180084','#4a4252','#52427b','#635a73','#ceb5f7','#8c7b9c','#7722cc','#ddaaff','#f0b42a','#df009f','#e317b3','#fffbf0','#a0a0a4','#808080','#ff0000','#00ff00','#ffff00','#0000ff','#ff00ff','#00ffff','#ffffff'
	];
	function gomColor(idx: number): string {
	  const i = Math.max(0, Math.min(255, idx));
	  return GOM_PALETTE[i] || "#ffffff";
	}

export function registerFColorDecorator(context: vscode.ExtensionContext): void {
  const decorationType = vscode.window.createTextEditorDecorationType({
    border: '1px solid rgba(255,255,255,0.5)',
    borderRadius: '2px',
  });

  function isBooEditor(editor: vscode.TextEditor | undefined, doc?: vscode.TextDocument): boolean {
    if (!editor) return false;
    const d = doc || editor.document;
    return d.languageId === 'gomscript' || d.fileName.endsWith('.txt');
  }

  function updateDecorations(editor: vscode.TextEditor) {
    if (!editor) return;
    const cfg = vscode.workspace.getConfiguration('boo');
    if (!cfg.get<boolean>('enableFColor', true)) {
      editor.setDecorations(decorationType, []);
      return;
    }
    const doc = editor.document;
    const text = doc.getText();
    const decorations: vscode.DecorationOptions[] = [];
    const re = /(?:(?<=\b(?:fcolor|fc|fcolour)\s*=\s*)|(?<=\{fcolor\s*=\s*))\d{1,3}/gi;
    let m;
    while ((m = re.exec(text)) !== null) {
      const idx = parseInt(m[0]);
      if (idx >= 0 && idx <= 255) {
        const startPos = doc.positionAt(m.index);
        const endPos = doc.positionAt(m.index + m[0].length);
        decorations.push({
          range: new vscode.Range(startPos, endPos),
          renderOptions: {
            before: {
              contentText: '■ ',
              color: gomColor(idx),
              fontWeight: 'bold',
            }
          }
        });
      }
    }
    editor.setDecorations(decorationType, decorations);
  }

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (isBooEditor(editor)) updateDecorations(editor!);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(event => {
      const editor = vscode.window.activeTextEditor;
      if (isBooEditor(editor, event.document)) updateDecorations(editor!);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(doc => {
      const editor = vscode.window.activeTextEditor;
      if (isBooEditor(editor, doc)) updateDecorations(editor!);
    })
  );

  if (vscode.window.activeTextEditor) {
    updateDecorations(vscode.window.activeTextEditor);
  }
}

// ── merchant.txt / MonGen.txt 表格列分隔 + 表头装饰 ──
// TABLE_CONFIGS, parseTableColumns, matchTableFile 从 ../utils/table-configs 导入

export function registerMerchantTableDecorator(context: vscode.ExtensionContext): void {
  const sepDecoration = vscode.window.createTextEditorDecorationType({
    after: {
      color: '#555555',
      fontStyle: 'normal',
      fontWeight: 'normal',
      margin: '0 2px 0 0',
    },
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
  });

  const headerDecoration = vscode.window.createTextEditorDecorationType({
    before: {
      color: '#ff8c00',
      backgroundColor: '#2a2a2a',
      border: '1px solid #555',
      fontStyle: 'normal',
      fontWeight: 'bold',
      margin: '0 0 6px 0',
      textDecoration: 'none; white-space: pre;',
    },
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
  });

  function update(editor: vscode.TextEditor) {
    const fileKey = matchTableFile(editor.document.fileName);
    if (!fileKey) return;
    const doc = editor.document;
    const sepOpts: vscode.DecorationOptions[] = [];

    for (let i = 0; i < doc.lineCount; i++) {
      const text = doc.lineAt(i).text;
      if (!text.trim() || text.trim().startsWith(';')) continue;
      const cols = parseTableColumns(text);
      if (cols.length < 2) continue;
      for (let j = 0; j < cols.length - 1; j++) {
        sepOpts.push({
          range: new vscode.Range(i, cols[j].end, i, cols[j].end),
          renderOptions: { after: { contentText: ' │' } }
        });
      }
    }
    editor.setDecorations(sepDecoration, sepOpts);

    const hdr = TABLE_CONFIGS[fileKey];
    editor.setDecorations(headerDecoration, [{
      range: new vscode.Range(0, 0, 0, 0),
      renderOptions: { before: { contentText: hdr + '\n' } }
    }]);

    postToSidebar({
      type: 'showTableHeader',
      fileName: fileKey,
      columns: hdr.split('│').map(c => c.trim()),
      header: hdr
    });
  }

  function isTableFile(editor: vscode.TextEditor | undefined, doc?: vscode.TextDocument): boolean {
    if (!editor) return false;
    return matchTableFile((doc || editor.document).fileName) !== null;
  }

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => { if (editor) update(editor); })
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(event => {
      const editor = vscode.window.activeTextEditor;
      if (editor && isTableFile(editor, event.document)) update(editor);
    })
  );
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(doc => {
      const editor = vscode.window.activeTextEditor;
      if (editor && isTableFile(editor, doc)) update(editor);
    })
  );
  if (vscode.window.activeTextEditor) update(vscode.window.activeTextEditor);
}

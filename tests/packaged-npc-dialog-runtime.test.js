const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  REQUIRED_NPC_DIALOG_DYNAMIC_ENTRY_FILES,
  REQUIRED_NPC_DIALOG_RUNTIME_FILES,
  verifyLocalModuleClosure,
  verifyRequiredPackagedFiles,
} = require('../tools/release/verify-packaged-dependencies');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');

const expectedFiles = [
  'data/static-language.json',
  'media/npc-dialog-visual.css',
  'media/npc-dialog-visual.html',
  'media/npc-dialog-visual.js',
  'out/providers/npc-dialog-visual.js',
  'out/ui-dialog/adddlg-companion.js',
  'out/ui-dialog/item-preview.js',
  'out/ui-dialog/item-tooltip.js',
  'out/ui-dialog/model.js',
  'out/ui-dialog/offsets.js',
  'out/ui-dialog/progress-preview.js',
  'out/ui-dialog/source-parser.js',
  'out/ui-dialog/source-patcher.js',
  'out/ui-dialog/statement-catalog.js',
  'out/ui-dialog/variable-resolver.js',
];

assert.deepEqual(REQUIRED_NPC_DIALOG_RUNTIME_FILES, expectedFiles,
  'the release verifier no longer protects the dedicated Ctrl+F12 runtime surface');
assert.deepEqual(REQUIRED_NPC_DIALOG_DYNAMIC_ENTRY_FILES, [
  'out/utils/archive-image-worker.js',
], 'the release verifier no longer protects the dynamically loaded Ctrl+F12 worker');

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-packaged-npc-dialog-contract-'));
try {
  for (const relative of expectedFiles) {
    const absolute = path.join(temporary, ...relative.split('/'));
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, 'fixture');
  }

  assert.doesNotThrow(
    () => verifyRequiredPackagedFiles(temporary, REQUIRED_NPC_DIALOG_RUNTIME_FILES, 'Ctrl+F12'),
    'a complete packaged Ctrl+F12 runtime should satisfy the release contract'
  );

  const missingRelative = 'media/npc-dialog-visual.js';
  fs.rmSync(path.join(temporary, ...missingRelative.split('/')));
  assert.throws(
    () => verifyRequiredPackagedFiles(temporary, REQUIRED_NPC_DIALOG_RUNTIME_FILES, 'Ctrl+F12'),
    error => error instanceof assert.AssertionError
      && error.message.includes('Ctrl+F12')
      && error.message.includes(missingRelative),
    'the release contract must identify a missing Ctrl+F12 runtime file'
  );
} finally {
  removeTemporaryDirectory(temporary);
}

const closureFixture = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-packaged-npc-dialog-closure-'));
try {
  const writeFixture = (relative, content) => {
    const absolute = path.join(closureFixture, ...relative.split('/'));
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content);
  };
  writeFixture('out/entry.js', [
    "require('node:fs');",
    "require('vscode');",
    "require('./nested/transitive');",
    "const ignored = \"require('./string-only')\";",
    "// require('./comment-only');",
  ].join('\n'));
  writeFixture('out/nested/transitive.js', "require('../../data/config.json');\n");
  writeFixture('data/config.json', '{"fixture":true}');
  writeFixture('out/worker.js', "require('./worker-helper');\n");
  writeFixture('out/worker-helper.js', 'module.exports = true;\n');

  const resolved = verifyLocalModuleClosure(
    closureFixture,
    ['out/entry.js'],
    ['out/worker.js'],
    'Ctrl+F12'
  );
  assert.deepEqual(resolved, [
    'data/config.json',
    'out/entry.js',
    'out/nested/transitive.js',
    'out/worker-helper.js',
    'out/worker.js',
  ]);

  fs.rmSync(path.join(closureFixture, 'out', 'worker-helper.js'));
  assert.throws(
    () => verifyLocalModuleClosure(
      closureFixture,
      ['out/entry.js'],
      ['out/worker.js'],
      'Ctrl+F12'
    ),
    error => error instanceof assert.AssertionError
      && error.message.includes('Ctrl+F12')
      && error.message.includes('out/worker.js')
      && error.message.includes('./worker-helper'),
    'the local closure gate must identify a missing dynamic-worker dependency'
  );

  const outside = path.join(path.dirname(closureFixture), 'boo-packaged-npc-dialog-outside.js');
  fs.writeFileSync(outside, 'module.exports = true;\n');
  try {
    writeFixture('out/escape.js', "require('../../boo-packaged-npc-dialog-outside');\n");
    assert.throws(
      () => verifyLocalModuleClosure(closureFixture, ['out/escape.js'], [], 'Ctrl+F12'),
      error => error instanceof assert.AssertionError
        && error.message.includes('outside packaged root'),
      'the local closure gate must reject a relative require that escapes the packaged root'
    );
  } finally {
    fs.rmSync(outside, { force: true });
  }
} finally {
  removeTemporaryDirectory(closureFixture);
}

console.log(`packaged-npc-dialog-runtime.test.js: PASS (${expectedFiles.length} dedicated files + local closure)`);

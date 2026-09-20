const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createHash } = require('node:crypto');
const runtimeRoot = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
const { resolvePreviewScriptSource: resolve } = require(path.join(runtimeRoot, 'out/ui-dialog/preview-script-source'));
const iconv = require(path.join(runtimeRoot, 'node_modules/iconv-lite'));

function run() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-preview-script-source-'));
  let assertions = 0;
  const check = (actual, expected, reason) => { assert.equal(actual, expected, reason); assertions++; };
  const write = (filePath, content) => {
    assert.ok(path.relative(temporary, filePath) && !path.relative(temporary, filePath).startsWith('..'));
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
    return filePath;
  };
  const workspace = path.join(temporary, 'workspace');
  fs.mkdirSync(workspace);
  const standard = (...parts) => path.join(workspace, 'Mir200', 'Envir', 'QuestDiary', ...parts);
  const alternate = (...parts) => path.join(workspace, 'Envir', 'QuestDiary', ...parts);
  const open = (filePath, text = '未保存文字', documentVersion = 7) => ({ filePath,
    fileName: path.basename(filePath), uri: pathToFileURL(filePath).toString(), text, documentVersion });
  try {
    const missing = resolve(workspace, '\\任务\\缺失.txt');
    check(missing.status, 'missing', 'missing files are watchable, not blocked');
    assert.deepEqual(missing.candidateFilePaths, [standard('任务', '缺失.txt'), alternate('任务', '缺失.txt')]);
    const defines = path.join(workspace, 'Mir200', 'Envir', 'Defines', '同名.ini');
    const constantsCall = standard('同名.ini');
    write(defines, '#DEFINE $标题 Defines');
    write(constantsCall, '[@常量]\n{\n#DEFINE $(标题) QuestDiary\n}');
    check(resolve(workspace, '同名.ini').status, 'blocked', 'ordinary CALL remains TXT-only');
    check(resolve(workspace, '同名.ini', [], 'defines-ini').source.filePath, defines, 'INCLUDE is rooted in Defines');
    check(resolve(workspace, '\\同名.ini', [], 'questdiary-constants-ini').source.filePath, constantsCall, 'explicit constants CALL uses QuestDiary');
    check(resolve(workspace, '同名.txt', [], 'defines-ini').status, 'blocked');
    check(resolve(workspace, '../同名.ini', [], 'defines-ini').status, 'blocked');
    check(resolve(workspace, '同名.ini', [], 'unknown-purpose').status, 'blocked');
    check(resolve(workspace, '同名.ini', [open(defines, '未保存常量', 23)], 'defines-ini').source.text, '未保存常量');
    const file = write(standard('任务', '示例.TXT'), '[@main]\r\n#SAY\r\n<测试/@结束>');
    const source = resolve(workspace, '\\任务\\示例.TXT');
    check(source.status, 'found');
    check(source.source.text, fs.readFileSync(file, 'utf8'));
    check(source.source.filePath, file);
    check(source.source.uri, pathToFileURL(file).toString());
    check(source.source.documentVersion, 0);
    check(source.source.encoding, 'utf8');
    check(source.source.sha256, createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
    check(source.source.textSha256, createHash('sha256').update(source.source.text).digest('hex'));
    check(resolve(workspace, '任务/示例.TXT').status, 'found', 'both documented separator forms');
    const withBom = write(standard('BOM.txt'), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('中文 UTF8')]));
    check(resolve(workspace, 'BOM.txt').source.encoding, 'utf8-bom');
    check(resolve(workspace, 'BOM.txt').source.text, '中文 UTF8');
    write(standard('GBK.txt'), iconv.encode('[@主标签]\r\n中文脚本', 'gbk'));
    check(resolve(workspace, 'GBK.txt').source.encoding, 'gbk');
    check(resolve(workspace, 'GBK.txt').source.text, '[@主标签]\r\n中文脚本');
    write(standard('空白.txt'), '');
    check(resolve(workspace, '空白.txt').source.text, '', 'empty script is a valid source');
    write(standard('边界.txt'), Buffer.alloc(2 * 1024 * 1024, 65));
    check(resolve(workspace, '边界.txt').status, 'found');
    write(standard('超限.txt'), Buffer.alloc(2 * 1024 * 1024 + 1, 65));
    check(resolve(workspace, '超限.txt').status, 'blocked');
    write(standard('伪文本.txt'), Buffer.from([0xff, 0xfe, 0x41, 0]));
    check(resolve(workspace, '伪文本.txt').status, 'blocked', 'do not decode UTF16/binary as a GBK script');
    fs.mkdirSync(standard('目录.txt'));
    check(resolve(workspace, '目录.txt').status, 'blocked');
    for (const raw of ['', ' ', '\\\\server\\share\\x.txt', '//server/share/x.txt', '\\\\?\\C:\\x.txt',
      '\\\\.\\pipe\\x.txt', 'C:\\x.txt', 'C:x.txt', 'https://example/x.txt', 'file:///C:/x.txt',
      '../x.txt', '..\\x.txt', 'a/../x.txt', './x.txt', 'a//x.txt', 'a\\\\x.txt',
      'a.txt:stream', 'a.txt.exe', 'a.txt.', 'a.txt ', ' a.txt', 'a.xlsx', 'a.txt/',
      'NUL.txt', 'con/file.txt', 'COM1.txt', 'LPT².txt', '<$STR(S$文件)>.txt', '$STR(S0).txt',
      '${name}.txt', '%name%.txt', '*.txt', '?x.txt', '[file].txt', 'a\0.txt', 'a\n.txt']) {
      const result = resolve(workspace, raw);
      check(result.status, 'blocked', `unsafe/unknown path: ${JSON.stringify(raw)}`);
      check(result.candidateFilePaths.length, 0, 'no filesystem candidate for rejected raw syntax');
    }
    check(resolve('relative-workspace', 'x.txt').status, 'blocked');
    check(resolve('\\\\server\\share', 'x.txt').status, 'blocked');
    const unsaved = open(file, '未保存的新内容', 19);
    const edited = resolve(workspace, '\\任务\\示例.TXT', [unsaved]);
    check(edited.status, 'found');
    check(edited.source.text, unsaved.text);
    check(edited.source.documentVersion, 19);
    check(edited.source.sha256, undefined, 'open buffer does not claim disk bytes identity');
    check(edited.source.textSha256, createHash('sha256').update(unsaved.text).digest('hex'));
    const forgedHash = resolve(workspace, '\\任务\\示例.TXT', [{ ...unsaved, sha256: 'old disk', textSha256: 'old text' }]);
    check(forgedHash.source.sha256, undefined);
    check(forgedHash.source.textSha256, edited.source.textSha256, 'do not trust supplied buffer identity');
    check(fs.readFileSync(file, 'utf8'), source.source.text, 'resolver never writes unsaved buffers to disk');
    check(resolve(workspace, '\\任务\\示例.TXT', [open(file, '', 20)]).source.text, '', 'explicit empty unsaved text');
    check(resolve(workspace, '\\任务\\示例.TXT', [unsaved, { ...unsaved, documentVersion: 20 }]).status,
      'ambiguous', 'do not select one document version by order');
    check(resolve(workspace, '\\任务\\示例.TXT', [unsaved, { ...unsaved }]).status, 'ambiguous', 'duplicate sources are ambiguous even at same version');
    for (const bad of [
      { ...unsaved, uri: pathToFileURL(withBom).toString() },
      { ...unsaved, filePath: withBom },
      { ...unsaved, uri: 'untitled:other.txt' },
      { ...unsaved, uri: unsaved.uri + '?version=2' },
      { ...unsaved, uri: unsaved.uri + '#fragment' },
      { ...unsaved, filePath: 'relative.txt' },
      { ...unsaved, documentVersion: -1 }, { ...unsaved, documentVersion: 1.5 },
      { ...unsaved, documentVersion: NaN }, { ...unsaved, text: 'a\0b' },
      { ...unsaved, text: '中'.repeat(700000) },
    ]) check(resolve(workspace, '\\任务\\示例.TXT', [bad]).status, 'blocked', 'URI/path/version/text identity is independent of buffer availability');
    const notSaved = standard('新增.txt');
    check(resolve(workspace, '新增.txt', [open(notSaved)]).status, 'found', 'safe open document can exist before disk save');
    check(fs.existsSync(notSaved), false);
    write(alternate('任务', '示例.TXT'), 'another root');
    check(resolve(workspace, '\\任务\\示例.TXT').status, 'ambiguous');
    check(resolve(workspace, '\\任务\\示例.TXT', [unsaved]).status, 'ambiguous', 'open document cannot choose between Envir roots');
    const onlyAlternate = write(alternate('仅另一根.txt'), 'alternate');
    check(resolve(workspace, '仅另一根.txt').source.filePath, onlyAlternate);
    const identityFile = write(standard('identity.txt'), 'same-size-A');
    const identityBefore = resolve(workspace, 'identity.txt');
    const identityStat = fs.statSync(identityFile);
    write(identityFile, 'same-size-B');
    fs.utimesSync(identityFile, identityStat.atime, identityStat.mtime);
    const identityAfter = resolve(workspace, 'identity.txt');
    check(identityAfter.status, 'found');
    check(identityAfter.source.sha256 === identityBefore.source.sha256, false, 'same-size/restored-mtime changes get a fresh byte hash');
    check(identityAfter.source.textSha256 === identityBefore.source.textSha256, false, 'same-size/restored-mtime changes get a fresh text hash');
    const envirWorkspace = path.join(temporary, 'direct', 'Envir');
    const directFile = write(path.join(envirWorkspace, 'QuestDiary', '直接.txt'), 'direct');
    check(resolve(envirWorkspace, '直接.txt').source.filePath, directFile, 'workspace itself may be Envir');

    const outside = path.join(temporary, 'outside');
    write(path.join(outside, '越界.txt'), 'outside script');
    fs.symlinkSync(outside, standard('junction'), process.platform === 'win32' ? 'junction' : 'dir');
    check(resolve(workspace, 'junction/越界.txt').status, 'blocked', 'directory junction is never followed');
    check(resolve(workspace, 'junction/未存在.txt', [open(standard('junction', '未存在.txt'))]).status,
      'blocked', 'open document cannot bypass an unsafe ancestor');
    const redirectedWorkspace = path.join(temporary, 'redirected-workspace');
    fs.symlinkSync(workspace, redirectedWorkspace, process.platform === 'win32' ? 'junction' : 'dir');
    check(resolve(redirectedWorkspace, 'GBK.txt').status, 'blocked', 'workspace symlink itself is rejected');
    fs.linkSync(withBom, standard('hardlink.txt'));
    check(resolve(workspace, 'hardlink.txt').status, 'blocked', 'hard links cannot silently access another file identity');

    const raceFile = write(standard('race.txt'), 'old content');
    const originalRead = fs.readSync;
    let injected = false;
    try {
      fs.readSync = function (...args) {
        const result = originalRead.apply(this, args);
        if (!injected) { injected = true; fs.writeFileSync(raceFile, 'new longer content'); }
        return result;
      };
      check(resolve(workspace, 'race.txt').status, 'blocked', 'descriptor/path identity is rechecked after read');
    } finally { fs.readSync = originalRead; }
    const otherRace = write(standard('other-race.txt'), 'stable first root');
    injected = false;
    try {
      fs.readSync = function (...args) {
        const result = originalRead.apply(this, args);
        if (!injected) { injected = true; write(alternate('other-race.txt'), 'appeared during read'); }
        return result;
      };
      check(resolve(workspace, 'other-race.txt').status, 'blocked', 'all candidate roots are rechecked for newly appearing ambiguity');
    } finally { fs.readSync = originalRead; }
    check(fs.readFileSync(otherRace, 'utf8'), 'stable first root');
    console.log(`PASS preview script source: ${assertions} checks; bounded TXT/encoding, open-buffer identity, roots, links and read races`);
  } finally {
    assert.equal(path.dirname(temporary), os.tmpdir());
    assert.ok(path.basename(temporary).startsWith('boo-preview-script-source-'));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

if (require.main === module) run();
module.exports = { run };

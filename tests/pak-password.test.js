const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function main() {
  const {
    findPasswordInPakConfig,
    findPasswordInPakTxt,
    readPakPasswordRecords,
    rebaseConfiguredPakPath,
    resolvePakPasswordFromRecords,
  } = require('../out/utils/pak-password');

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-pak-password-'));
  try {
    const dataDirectory = path.join(tempRoot, 'current-client', 'data');
    const nestedDirectory = path.join(dataDirectory, 'ui');
    const configPath = path.join(tempRoot, 'Pak.txt');
    fs.mkdirSync(nestedDirectory, { recursive: true });
    const dialogPak = path.join(dataDirectory, 'Dialog.pak');
    const simplePak = path.join(dataDirectory, 'Simple.pak');
    const nestedPak = path.join(nestedDirectory, 'Items1.pak');
    const titleJpk = path.join(dataDirectory, 'Title.jpk');
    fs.writeFileSync(dialogPak, 'pak');
    fs.writeFileSync(simplePak, 'pak');
    fs.writeFileSync(nestedPak, 'pak');
    fs.writeFileSync(titleJpk, 'jpk');
    fs.writeFileSync(configPath, [
      'Z:\\old-client\\data\\Dialog.pak|dialog-password|0',
      'D:\\another-client\\DATA\\ui\\Items1.pak|items-password|0',
      'E:\\legacy-client\\Simple.pak|simple-password|0',
      'Q:\\old-client\\Resources\\Data\\Title.jpk|jpk-password|0',
      'invalid line',
    ].join('\r\n'));

    assert.equal(
      findPasswordInPakConfig(dialogPak, configPath, dataDirectory),
      'dialog-password',
      'a stale absolute path must rebase from its data segment'
    );
    assert.equal(
      findPasswordInPakConfig(nestedPak, configPath, dataDirectory),
      'items-password',
      'a nested path below data must retain its relative directory'
    );
    assert.equal(
      findPasswordInPakConfig(simplePak, configPath, dataDirectory),
      'simple-password',
      'an absolute legacy path without a data segment must rebase by PAK file name'
    );
    assert.equal(
      findPasswordInPakConfig(titleJpk, configPath, dataDirectory),
      'jpk-password',
      'Pak.txt records must resolve 996PC JPK passwords too'
    );
    assert.equal(
      rebaseConfiguredPakPath('E:\\legacy-client\\Simple.pak', dataDirectory),
      simplePak,
      'the configured directory must be replaced with the selected data directory'
    );
    const parsedRecords = readPakPasswordRecords(configPath);
    assert.equal(parsedRecords[0].password, 'dialog-password');
    assert.equal(parsedRecords[0].option, '0');

    const ambiguousPath = path.join(dataDirectory, 'SameName.pak');
    const ambiguousRecords = [
      { configuredPath: 'D:\\one\\data\\SameName.pak', password: 'first', configPath },
      { configuredPath: 'D:\\two\\data\\SameName.pak', password: 'second', configPath },
    ];
    assert.equal(
      resolvePakPasswordFromRecords(ambiguousRecords, ambiguousPath, dataDirectory),
      undefined,
      'different passwords at the same match priority must remain ambiguous'
    );

    const exactRecords = parsedRecords;
    exactRecords.push({ configuredPath: dialogPak, password: 'exact-password', configPath });
    assert.equal(
      resolvePakPasswordFromRecords(exactRecords, dialogPak, dataDirectory),
      'exact-password',
      'an exact current path must override stale paths'
    );

    const outerWorkspace = path.join(tempRoot, '996-workspace');
    const jpkDataDirectory = path.join(outerWorkspace, 'custom-patch', 'Data');
    const launcherDirectory = path.join(outerWorkspace, 'Mirserver', '登录器生成器');
    const directlyOpenedJpk = path.join(jpkDataDirectory, 'DirectOpen.jpk');
    fs.mkdirSync(jpkDataDirectory, { recursive: true });
    fs.mkdirSync(launcherDirectory, { recursive: true });
    fs.writeFileSync(directlyOpenedJpk, 'jpk');
    fs.writeFileSync(
      path.join(launcherDirectory, 'JpkList.txt'),
      'F:\\legacy-client\\Data\\DirectOpen.jpk|direct-open-password\r\n'
    );
    assert.equal(
      findPasswordInPakTxt(directlyOpenedJpk, outerWorkspace),
      'direct-open-password',
      'opening a new JPK must discover Mirserver/登录器生成器/JpkList.txt from an outer workspace'
    );
    assert.equal(
      findPasswordInPakTxt(directlyOpenedJpk, path.join(outerWorkspace, 'Mirserver')),
      'direct-open-password',
      'opening a new JPK must also work when Mirserver itself is the workspace'
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
  console.log('pak-password.test.js: PASS');
}

main();

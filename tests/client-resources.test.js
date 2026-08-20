const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function main() {
  const {
    archiveFileKey,
    clientResourceLayoutFromState,
    discoverClientResourceLayout,
    inferClientDirectoryFromLegacyDataDirectory,
    isPathInsideAny,
    isUsableClientResourceLayout,
    relativeClientResourcePath,
    selectPreferredArchiveFile,
    resolveResourceFile,
    resourceRootRank,
    scanClientArchiveFiles,
  } = require('../out/utils/client-resources');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-client-resources-'));
  try {
    const clientRoot = path.join(root, 'Client');
    const clientData = path.join(clientRoot, 'data');
    const clientMap = path.join(clientRoot, 'Map');
    const clientWav = path.join(clientRoot, 'wav');
    const customRoot = path.join(clientRoot, 'CustomPatch');
    const customData = path.join(customRoot, 'Data');
    const customMap = path.join(customRoot, 'map');
    const customWav = path.join(customRoot, 'Wav');
    const customGraphics = path.join(customRoot, 'Graphics');
    for (const directory of [
      clientData,
      clientMap,
      clientWav,
      customData,
      customMap,
      customWav,
      customGraphics,
      path.join(clientRoot, 'Cache'),
    ]) fs.mkdirSync(directory, { recursive: true });

    fs.writeFileSync(path.join(customData, 'Dialog.PAK'), 'custom');
    fs.writeFileSync(path.join(clientData, 'dialog.pak'), 'client');
    fs.writeFileSync(path.join(clientData, 'Magic.wil'), 'wil');
    fs.writeFileSync(path.join(clientData, 'Magic.wix'), 'wix');
    fs.writeFileSync(path.join(clientData, 'Magic8.wzl'), 'wzl');
    fs.writeFileSync(path.join(clientData, 'Magic8.wzx'), 'wzx');
    fs.writeFileSync(path.join(customData, 'Tiles.wzl'), 'custom-wzl');
    fs.writeFileSync(path.join(customData, 'Tiles.wzx'), 'custom-wzx');
    fs.writeFileSync(path.join(clientData, 'Tiles.pak'), 'client-pak');
    fs.writeFileSync(path.join(customData, 'Objects.pak'), 'custom-pak');
    fs.writeFileSync(path.join(customData, 'Objects.wil'), 'custom-wil');
    fs.writeFileSync(path.join(customData, 'Objects.wix'), 'custom-wix');
    fs.writeFileSync(path.join(customData, 'Objects.wzl'), 'custom-wzl');
    fs.writeFileSync(path.join(customData, 'Objects.wzx'), 'custom-wzx');
    fs.writeFileSync(path.join(clientData, 'Ignored.txt'), 'text');
    fs.writeFileSync(path.join(customMap, '0.map'), 'custom-map');
    fs.writeFileSync(path.join(clientMap, '0.map'), 'client-map');
    fs.writeFileSync(path.join(clientMap, '1.map'), 'fallback-map');

    const layout = discoverClientResourceLayout(clientRoot);
    assert.equal(isUsableClientResourceLayout(layout), true);
    assert.deepEqual(layout.customPatchDirectories, [customRoot]);
    assert.deepEqual(layout.dataRoots, [customData, clientData]);
    assert.deepEqual(layout.mapRoots, [customMap, clientMap]);
    assert.deepEqual(layout.wavRoots, [customWav, clientWav]);
    assert.deepEqual(layout.graphicsRoots, [customGraphics]);
    assert.equal(resourceRootRank(path.join(customData, 'Dialog.PAK'), layout.dataRoots), 0);
    assert.equal(resourceRootRank(path.join(clientData, 'dialog.pak'), layout.dataRoots), 1);
    assert.equal(isPathInsideAny(path.join(customData, 'Dialog.PAK'), layout.dataRoots), true);
    assert.equal(relativeClientResourcePath(layout, path.join(customData, 'Dialog.PAK')), path.join('CustomPatch', 'Data', 'Dialog.PAK'));

    const archives = await scanClientArchiveFiles(layout.dataRoots, ['pak', 'wil', 'wzl']);
    assert.deepEqual(
      archives.map(filePath => archiveFileKey(filePath)),
      [
        'dialog.pak',
        'objects.pak',
        'objects.wil',
        'objects.wzl',
        'tiles.wzl',
        'magic.wil',
        'magic8.wzl',
        'tiles.pak',
      ],
      'custom resources must win exact-name duplicates and WIX/WZX companions must not be listed'
    );
    assert.equal(archives[0], path.join(customData, 'Dialog.PAK'));
    assert.equal(
      selectPreferredArchiveFile(
        archives,
        'Tiles',
        layout.dataRoots,
        ['pak', 'wil', 'wzl']
      ),
      path.join(customData, 'Tiles.wzl'),
      'a custom-patch WZL must override a same-name client PAK'
    );
    assert.equal(
      selectPreferredArchiveFile(
        archives,
        'Objects',
        layout.dataRoots,
        ['pak', 'wil', 'wzl']
      ),
      path.join(customData, 'Objects.pak'),
      'within one resource root the engine PAK must win over WIL and WZL'
    );
    assert.equal(
      selectPreferredArchiveFile(
        archives,
        'Missing',
        layout.dataRoots,
        ['pak', 'wil', 'wzl']
      ),
      undefined
    );
    assert.equal(resolveResourceFile(layout.mapRoots, ['0'], '.map'), path.join(customMap, '0.map'));
    assert.equal(resolveResourceFile(layout.mapRoots, ['missing', '1'], '.map'), path.join(clientMap, '1.map'));

    assert.equal(inferClientDirectoryFromLegacyDataDirectory(customData), clientRoot);
    assert.equal(
      clientResourceLayoutFromState({ dataDirectory: customData }).clientDirectory,
      clientRoot,
      'legacy custom data selections must migrate to the owning client root'
    );

    const secondCustomRoot = path.join(clientRoot, 'SecondPatch');
    fs.mkdirSync(path.join(secondCustomRoot, 'data'), { recursive: true });
    fs.mkdirSync(path.join(secondCustomRoot, 'map'), { recursive: true });
    const ambiguousLayout = discoverClientResourceLayout(clientRoot);
    assert.equal(ambiguousLayout.availableCustomPatchDirectories.length, 2);
    assert.deepEqual(
      ambiguousLayout.customPatchDirectories,
      [],
      'multiple custom patches must not be merged without a workspace selection'
    );
    assert.deepEqual(ambiguousLayout.dataRoots, [clientData]);
    const selectedLayout = discoverClientResourceLayout(clientRoot, 'SecondPatch');
    assert.deepEqual(selectedLayout.customPatchDirectories, [secondCustomRoot]);
    assert.deepEqual(selectedLayout.dataRoots, [path.join(secondCustomRoot, 'data'), clientData]);
    assert.deepEqual(
      discoverClientResourceLayout(clientRoot, 'secondpatch').customPatchDirectories,
      [secondCustomRoot],
      'English custom patch folder names must match case-insensitively'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log('client-resources.test.js: PASS');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function main() {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'providers', 'map-preview.ts'),
    'utf8'
  );

  assert.match(
    source,
    /vscode\.Uri\.file\(cachedImage\.pak\.cacheDir\)/,
    '地图预览必须将命中的 PAK 精确缓存目录加入 Webview 本地资源白名单'
  );
  assert.match(
    source,
    /context\.workspaceState\.get<SavedPatchManagerState>/,
    '地图资源必须读取当前工作区绑定的客户端状态'
  );
  assert.match(
    source,
    /const mapRoots = \[\s*\.\.\.clientMapRoots,[\s\S]*resolveResourceFile\(mapRoots, mapNames, '\.map'\)/,
    '原始地图必须优先查自定义补丁 Map，再查客户端 Map，最后回退服务端 Map'
  );
  assert.match(
    source,
    /uiEditorArchiveExtensions\(definition\.id\)/,
    '地图素材必须兼容当前引擎的 PAK/JPK 与 WIL/WZL'
  );
  assert.match(
    source,
    /miniMapArchiveCandidates\(reference\.pakName\)/,
    '经典客户端的 mmap0 引用必须回退到 mmap.wil 或 mmap.wzl'
  );
  assert.match(
    source,
    /scanClientArchiveFiles\(resourceRoots, supportedExtensions\)/,
    '原始地图必须从当前工作区绑定的客户端建立实际素材源清单'
  );
  assert.match(
    source,
    /resolveCachedPatchArchiveByName\(/,
    '原始地图必须按客户端真实资源优先级命中精确缓存，不能按缓存时间猜同名格式'
  );
  assert.match(
    source,
    /findUniqueCurrentCachedPatchPakByName\(/,
    '当前客户端缺少经典地图资源时，允许复用唯一且仍有效的共享 WIL/WZL 缓存'
  );
  assert.match(source, /status: 'shared-cache'/, '共享缓存命中必须使用独立状态');
  assert.match(source, /复用共享官方缓存/, '共享官方缓存必须在地图状态栏中明确提示');
  assert.match(source, /客户端缺少/, '缺少源文件必须与未读取缓存分别提示');
  assert.match(source, /尚未读取/, '存在源文件但没有索引时必须明确提示尚未读取');
  assert.match(source, /缓存已失效/, '源文件变化后必须明确提示缓存失效');

  console.log('map-preview-resource-roots.test.js: PASS');
}

main();

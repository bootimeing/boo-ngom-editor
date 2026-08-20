#!/usr/bin/env node

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');
const CORE_DATABASE_FILES = ['cfg_item.xls', 'cfg_monster.xls', 'cfg_magic.xls'];
const EXPECTED_TABLE_LABELS = ['物品数据库', '怪物数据库', '技能数据库'];
const REQUIRED_JPK_FORMATS = [
  'JPK_A8_PALETTE',
  'JPK_R5G6B5',
  'JPK_R8G8B8',
  'JPK_A8R8G8B8',
];

function option(name, fallback = '') {
  const prefix = `--${name}=`;
  const value = process.argv.find(argument => argument.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function fileSha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function listFiles(root, extension) {
  const files = [];
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.isFile() && path.extname(entry.name).toLowerCase() === extension) {
        files.push(fullPath);
      }
    }
  };
  visit(root);
  return files.sort((left, right) => left.localeCompare(right, 'zh-CN', { numeric: true }));
}

function pageRequest(tableId, overrides = {}) {
  return {
    tableId,
    offset: 0,
    limit: 20,
    query: '',
    searchColumn: '',
    matchMode: 'contains',
    filters: [],
    sortColumn: '',
    sortDirection: 'asc',
    ...overrides,
  };
}

async function auditDatabase(serverRoot) {
  const { resolveEngineRoot } = require(path.join(
    projectRoot,
    'out',
    'utils',
    'engine-detect'
  ));
  const { DatabaseBrowserSession } = require(path.join(
    projectRoot,
    'out',
    'utils',
    'database-browser'
  ));

  const engineRoot = resolveEngineRoot(serverRoot);
  const dataDirectory = path.join(engineRoot, 'Mir200', 'Envir', 'Data');
  const sourceFiles = CORE_DATABASE_FILES.map(fileName => path.join(dataDirectory, fileName));
  for (const filePath of sourceFiles) {
    assert.ok(fs.statSync(filePath).isFile(), `缺少 996PC 数据库: ${filePath}`);
  }
  const sourceHashes = Object.fromEntries(sourceFiles.map(filePath => [
    path.basename(filePath),
    fileSha256(filePath),
  ]));
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-996pc-db-audit-'));

  try {
    for (const filePath of sourceFiles) {
      fs.copyFileSync(filePath, path.join(temporaryDirectory, path.basename(filePath)));
    }

    const session = new DatabaseBrowserSession(temporaryDirectory, '996pc');
    const catalog = await session.initialize();
    assert.deepEqual(catalog.tables.map(table => table.label), EXPECTED_TABLE_LABELS);
    assert.ok(catalog.tables.every(table => table.kind === 'biff8' && table.editable));
    assert.ok(catalog.tables.every(table => !table.schemaEditable));

    const tableMetrics = [];
    for (const table of catalog.tables) {
      const page = await session.loadPage(
        pageRequest(table.id, {
          sortColumn: table.columns[0],
          sortDirection: 'desc',
        }),
        () => false
      );
      assert.ok(page.rows.length > 0, `${table.label} 没有可验证的数据行`);
      assert.ok(page.rows.every(row => Number.isInteger(row.__booRowId)));
      tableMetrics.push({
        label: table.label,
        rows: table.rowCount,
        columns: table.columns.length,
        firstField: table.columns[0],
        lastField: table.columns[table.columns.length - 1],
      });
    }

    const item = catalog.tables[0];
    const itemPage = await session.loadPage(pageRequest(item.id), () => false);
    const originalRow = itemPage.rows.find(row => String(row.Name || '').trim());
    assert.ok(originalRow, '物品数据库没有可验证的命名记录');
    const originalName = String(originalRow.Name);
    const auditName = `${originalName}__BOO_AUDIT__`;
    await session.updateRow(item.id, originalRow.__booRowId, { Name: auditName });
    const searched = await session.loadPage(
      pageRequest(item.id, {
        query: auditName,
        searchColumn: 'Name',
        matchMode: 'exact',
      }),
      () => false
    );
    assert.equal(searched.total, 1, '996PC XLS 精确查询或单元格保存失败');
    await session.updateRow(item.id, originalRow.__booRowId, { Name: originalName });

    const beforeCreate = item.rowCount;
    const created = await session.createRow(item.id, {});
    assert.equal(created.rowCount, beforeCreate + 1);
    const deleted = await session.deleteRow(item.id, created.rowId);
    assert.equal(deleted.rowCount, beforeCreate);
    await assert.rejects(session.updateSchema(item.id, []), /协议|前三行/);
    session.dispose();

    const reopened = new DatabaseBrowserSession(temporaryDirectory, '996pc');
    const reopenedCatalog = await reopened.initialize();
    assert.deepEqual(
      reopenedCatalog.tables.map(table => table.rowCount),
      catalog.tables.map(table => table.rowCount),
      '临时副本写入后重新打开的行数不一致'
    );
    reopened.dispose();

    const backups = fs.existsSync(path.join(temporaryDirectory, 'boo-database-backups'))
      ? listFiles(path.join(temporaryDirectory, 'boo-database-backups'), '.bak').length
      : 0;
    assert.ok(backups >= 4, '每次 996PC XLS 修改都应生成临时副本备份');

    for (const filePath of sourceFiles) {
      assert.equal(
        fileSha256(filePath),
        sourceHashes[path.basename(filePath)],
        `实服数据库被意外修改: ${filePath}`
      );
    }

    return {
      engineRoot,
      dataDirectory,
      sourceFilesProtected: sourceFiles.length,
      tableMetrics,
      temporaryMutations: {
        updateAndRestore: true,
        createAndDelete: true,
        reopen: true,
        backups,
      },
    };
  } finally {
    const resolved = path.resolve(temporaryDirectory);
    const tempRoot = path.resolve(os.tmpdir()) + path.sep;
    if (resolved.startsWith(tempRoot)) fs.rmSync(resolved, { recursive: true, force: true });
  }
}

function normalizeRelative(filePath) {
  return filePath.replace(/\\/g, '/').toLowerCase();
}

function selectPassword(records, filePath, root) {
  const { resolvePakPasswordFromRecords } = require(path.join(
    projectRoot,
    'out',
    'utils',
    'pak-password'
  ));
  const exact = resolvePakPasswordFromRecords(records, filePath, root);
  if (exact) return exact;
  const passwords = new Set(records.map(record => record.password).filter(Boolean));
  return passwords.size === 1 ? [...passwords][0] : undefined;
}

function auditJpk(jpkRoot, passwordFile, referenceReportPath = '') {
  const {
    parseJpkFile,
    readJpkPayload,
    renderJpkRgba,
  } = require(path.join(projectRoot, 'out', 'utils', 'jpk-reader'));
  const { readPakPasswordRecords } = require(path.join(
    projectRoot,
    'out',
    'utils',
    'pak-password'
  ));
  const parser = require(path.join(projectRoot, 'media', 'geepak3_exact.js'));

  const records = readPakPasswordRecords(passwordFile);
  assert.ok(records.length > 0, '密码文件中没有 JPK 记录');
  const reference = referenceReportPath
    ? JSON.parse(fs.readFileSync(referenceReportPath, 'utf8'))
    : undefined;
  const referenceFiles = reference
    ? new Map((reference.files || []).map(file => [
        normalizeRelative(file.path),
        file,
      ]))
    : undefined;
  const files = listFiles(jpkRoot, '.jpk');
  assert.ok(files.length > 0, `没有找到 JPK: ${jpkRoot}`);

  const totals = {
    files: files.length,
    slots: 0,
    blocks: 0,
    emptyArchives: 0,
    formats: {},
  };
  const representatives = new Map();
  let firstFile;
  let firstPassword;

  for (const filePath of files) {
    const password = selectPassword(records, filePath, jpkRoot);
    assert.ok(password, `无法匹配 JPK 密码: ${path.relative(jpkRoot, filePath)}`);
    const relativePath = normalizeRelative(path.relative(jpkRoot, filePath));
    let archive;
    try {
      archive = parseJpkFile(filePath, password);
    } catch (error) {
      throw new Error(
        `${relativePath} 解析失败: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    const expected = referenceFiles?.get(relativePath);
    if (referenceFiles) {
      assert.ok(expected, `参考报告缺少 JPK: ${relativePath}`);
      assert.equal(archive.slotCount, expected.slots, `${relativePath} 槽位数不一致`);
      assert.equal(archive.blocks.length, expected.blocks, `${relativePath} 图片块数不一致`);
      assert.equal(archive.indexOffset, expected.indexOffset, `${relativePath} 索引偏移不一致`);
    }

    totals.slots += archive.slotCount;
    totals.blocks += archive.blocks.length;
    if (archive.blocks.length === 0) totals.emptyArchives++;
    for (const block of archive.blocks) {
      totals.formats[block.format] = (totals.formats[block.format] || 0) + 1;
      const current = representatives.get(block.format);
      if (!current || block.payloadSize < current.block.payloadSize) {
        representatives.set(block.format, { filePath, password, archive, block });
      }
    }
    firstFile ||= filePath;
    firstPassword ||= password;
  }

  if (reference) {
    assert.equal(totals.files, reference.totals.files);
    assert.equal(totals.slots, reference.totals.slots);
    assert.equal(totals.blocks, reference.totals.blocks);
    assert.equal(totals.emptyArchives, reference.totals.emptyArchives);
    assert.deepEqual(totals.formats, reference.formats);
  }

  const decodedFormats = {};
  const formatsToDecode = reference
    ? REQUIRED_JPK_FORMATS
    : [...representatives.keys()].sort();
  assert.ok(formatsToDecode.length > 0, '实际 JPK 中没有可解码的图片格式样本');
  for (const format of formatsToDecode) {
    const sample = representatives.get(format);
    assert.ok(sample, `缺少 ${format} 实样本`);
    const handle = fs.openSync(sample.filePath, 'r');
    try {
      let raw;
      let rgba;
      try {
        raw = readJpkPayload(handle, sample.block, sample.archive.rc4State);
        rgba = renderJpkRgba(raw, sample.block, parser.A8_PALETTE_BGRA);
      } catch (error) {
        throw new Error(
          `${format} ${path.relative(jpkRoot, sample.filePath).replace(/\\/g, '/')} `
          + `图片 ${sample.block.logicalIndex} 解码失败: `
          + `${error instanceof Error ? error.message : String(error)}`
        );
      }
      assert.equal(rgba.length, sample.block.width * sample.block.height * 4);
      decodedFormats[format] = {
        file: path.relative(jpkRoot, sample.filePath).replace(/\\/g, '/'),
        imageIndex: sample.block.logicalIndex,
        width: sample.block.width,
        height: sample.block.height,
        rgbaSha256: crypto.createHash('sha256').update(rgba).digest('hex'),
      };
    } finally {
      fs.closeSync(handle);
    }
  }

  assert.throws(
    () => parseJpkFile(firstFile, `${firstPassword}_wrong`),
    /密码错误/,
    '错误 JPK 密码必须被拒绝'
  );
  return {
    root: path.resolve(jpkRoot),
    files: totals.files,
    slots: totals.slots,
    blocks: totals.blocks,
    emptyArchives: totals.emptyArchives,
    formats: totals.formats,
    decodedFormats,
    wrongPasswordRejected: true,
    referenceVerified: !!reference,
  };
}

async function auditPatchSelection(serverRoot, patchRoot) {
  const { loadPakIndex } = require(path.join(projectRoot, 'out', 'utils', 'pak'));
  const {
    filterRequiredPatchPakFiles,
    findMissingEffectImageArchives,
    scanPatchPakFiles,
  } = require(path.join(projectRoot, 'out', 'utils', 'patch-cache'));

  const index = loadPakIndex(serverRoot);
  assert.ok(index, `无法从服务端读取 EffectImageList.txt: ${serverRoot}`);
  const archivePaths = (await scanPatchPakFiles(patchRoot))
    .filter(filePath => path.extname(filePath).toLowerCase() === '.jpk');
  const effectImageNames = index.pakList.map(item => item.name);
  const required = filterRequiredPatchPakFiles(archivePaths, effectImageNames);
  const missing = findMissingEffectImageArchives(archivePaths, effectImageNames);
  const calledNames = new Set(effectImageNames.map(name => name.toLowerCase()));
  const calledArchives = archivePaths.filter(filePath =>
    calledNames.has(path.basename(filePath, path.extname(filePath)).toLowerCase())
  );

  assert.ok(archivePaths.length > 0, `补丁目录没有 JPK: ${patchRoot}`);
  assert.ok(required.length >= calledArchives.length, '需求 JPK 筛选遗漏了 EffectImageList.txt 条目');
  return {
    root: path.resolve(patchRoot),
    effectImageEntries: effectImageNames.length,
    allJpkFiles: archivePaths.length,
    calledJpkFilesFound: calledArchives.length,
    requiredJpkFilesSelected: required.length,
    calledJpkFilesMissing: missing,
  };
}

async function main() {
  const serverRoot = option('server-root');
  const jpkRoot = option('jpk-root');
  const passwordFile = option('password-file');
  const referenceReport = option('jpk-report');
  const patchRoot = option('patch-root');
  if (!serverRoot && !jpkRoot) {
    throw new Error(
      '至少指定 --server-root=<996PC服务端>，或同时指定 '
      + '--jpk-root=<JPK目录> --password-file=<Pak.txt> [--jpk-report=<参考报告>]'
    );
  }
  if (jpkRoot && !passwordFile) {
    throw new Error('JPK 审计需要 --password-file');
  }
  if (patchRoot && !serverRoot) {
    throw new Error('补丁筛选审计需要 --server-root');
  }

  const report = {
    generatedAt: new Date().toISOString(),
    database: serverRoot ? await auditDatabase(path.resolve(serverRoot)) : undefined,
    patchSelection: patchRoot
      ? await auditPatchSelection(path.resolve(serverRoot), path.resolve(patchRoot))
      : undefined,
    jpk: jpkRoot
      ? auditJpk(
          path.resolve(jpkRoot),
          path.resolve(passwordFile),
          referenceReport ? path.resolve(referenceReport) : ''
        )
      : undefined,
  };
  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) {
  main().catch(error => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  auditDatabase,
  auditJpk,
  auditPatchSelection,
};

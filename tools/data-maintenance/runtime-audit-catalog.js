const crypto = require('node:crypto');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const loader = require(path.join(root, 'out/data/loader'));
const { buildLanguageIndex } = require(path.join(root, 'out/utils/command-index'));
const { ENGINE_IDS } = require(path.join(root, 'out/utils/engine-registry'));

function loadAuditCatalog() {
  const log = () => {};
  const commands = loader.loadCommandsData(root, log);
  const variables = loader.loadVariablesData(root, log);
  const catalogs = loader.loadEngineFunctionCatalog(root, log);
  const constants = loader.loadEngineConstantCatalog(root, log);
  const staticLanguage = loader.loadStaticLanguageData(root, log);
  const indexes = Object.fromEntries(ENGINE_IDS.map(engine => [
    engine, buildLanguageIndex(commands, variables, catalogs, engine, constants),
  ]));
  const fingerprint = crypto.createHash('sha256')
    .update(JSON.stringify([commands, variables, catalogs, constants, staticLanguage]))
    .digest('hex');
  return { commands, variables, catalogs, constants, staticLanguage, indexes, fingerprint };
}

function corpusDigest(corpus) {
  const hash = crypto.createHash('sha256');
  for (const page of [...corpus.pages].sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'en'))) {
    hash.update(page.relativePath.replace(/\\/g, '/')).update('\0').update(page.hash).update('\0');
  }
  return hash.digest('hex');
}

module.exports = { loadAuditCatalog, corpusDigest, ENGINE_IDS };

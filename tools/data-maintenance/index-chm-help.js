#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error('Usage: index-chm-help.js --engine NAME --root DIR --toc FILE --out FILE');
    }
    args[key.slice(2)] = value;
  }
  for (const key of ['engine', 'root', 'toc', 'out']) {
    if (!args[key]) throw new Error(`Missing --${key}`);
  }
  return args;
}

function decodeEntities(value) {
  const named = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const hexadecimal = entity[1]?.toLowerCase() === 'x';
      const number = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      return Number.isFinite(number) ? String.fromCodePoint(number) : match;
    }
    return named[entity.toLowerCase()] ?? match;
  });
}

function decodeDocument(filePath) {
  const buffer = fs.readFileSync(filePath);
  const prefix = buffer.subarray(0, 8192).toString('latin1');
  const declared = prefix.match(/charset\s*=\s*["']?\s*([a-z0-9_-]+)/i)?.[1]?.toLowerCase();
  if (declared?.includes('utf')) return buffer.toString('utf8');
  if (declared && /^(gb|cp936|windows-936)/.test(declared)) return iconv.decode(buffer, 'gb18030');

  const utf8 = buffer.toString('utf8');
  const replacements = (utf8.match(/\ufffd/g) || []).length;
  return replacements === 0 ? utf8 : iconv.decode(buffer, 'gb18030');
}

function parseParams(token) {
  const params = {};
  for (const match of token.matchAll(/([a-z][a-z0-9_-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    params[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return params;
}

function parseToc(tocPath) {
  const html = decodeDocument(tocPath);
  const tokens = html.match(/<\/?ul\b[^>]*>|<object\b[^>]*>|<\/object>|<param\b[^>]*>/gi) || [];
  const topics = [];
  const parents = new Map();
  let depth = 0;
  let current;
  let lastTopic;

  for (const token of tokens) {
    if (/^<ul\b/i.test(token)) {
      if (lastTopic && lastTopic.depth === depth) parents.set(depth, lastTopic);
      depth += 1;
      continue;
    }
    if (/^<\/ul/i.test(token)) {
      depth = Math.max(0, depth - 1);
      parents.delete(depth);
      lastTopic = undefined;
      continue;
    }
    if (/^<object\b/i.test(token)) {
      current = {};
      continue;
    }
    if (/^<param\b/i.test(token) && current) {
      const params = parseParams(token);
      if (params.name) current[params.name.toLowerCase()] = params.value || '';
      continue;
    }
    if (/^<\/object/i.test(token) && current) {
      const name = current.name?.trim();
      if (name) {
        const parentNames = [];
        for (let parentDepth = 1; parentDepth < depth; parentDepth += 1) {
          const parent = parents.get(parentDepth);
          if (parent) parentNames.push(parent.name);
        }
        lastTopic = {
          name,
          local: current.local?.trim() || '',
          depth,
          path: [...parentNames, name],
        };
        topics.push(lastTopic);
      }
      current = undefined;
    }
  }
  return topics;
}

function normalizeLocalPath(localPath) {
  const withoutFragment = localPath.split('#', 1)[0].split('?', 1)[0];
  return decodeURIComponent(withoutFragment.replace(/\//g, path.sep));
}

function htmlToText(html) {
  let value = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|object)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|table|ul|ol)>/gi, '\n')
    .replace(/<\/(td|th)>/gi, '\t')
    .replace(/<[^>]+>/g, ' ');
  value = decodeEntities(value).replace(/\r/g, '');
  return value
    .split('\n')
    .map(line => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function extractTitle(html) {
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '';
  return decodeEntities(title.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function commandTokens(value) {
  const tokens = new Set();
  for (const match of value.matchAll(/(^|[^A-Za-z0-9_])([A-Za-z][A-Za-z0-9_.]{2,})(?=$|[^A-Za-z0-9_])/g)) {
    const token = match[2].toUpperCase();
    if (!/^(ASCII|CHM|HTML?|HTTP|HTTPS|NPC|M2|RGB|SQL|UTF|URL|WWW|XLSX?|JSON|INI|CSV|DLL|EXE|IP|ID|IDX|DB)$/.test(token)) {
      tokens.add(token);
    }
  }
  return [...tokens].sort();
}

function main() {
  const args = parseArgs(process.argv);
  const root = path.resolve(args.root);
  const tocPath = path.resolve(args.toc);
  if (!fs.statSync(root).isDirectory()) throw new Error(`Not a directory: ${root}`);
  if (!fs.statSync(tocPath).isFile()) throw new Error(`TOC not found: ${tocPath}`);

  const topics = parseToc(tocPath).map(topic => {
    if (!topic.local || !/\.(html?|txt)$/i.test(topic.local)) {
      return { ...topic, fileExists: false, title: '', text: '', tokens: [] };
    }
    const local = normalizeLocalPath(topic.local);
    const filePath = path.resolve(root, local);
    if (!filePath.toLowerCase().startsWith(`${root.toLowerCase()}${path.sep}`) || !fs.existsSync(filePath)) {
      return { ...topic, fileExists: false, title: '', text: '', tokens: [] };
    }
    const html = decodeDocument(filePath);
    const text = htmlToText(html);
    return {
      ...topic,
      local,
      fileExists: true,
      title: extractTitle(html),
      text,
      tokens: commandTokens(`${topic.name}\n${text}`),
    };
  });

  const tokenTopics = new Map();
  for (let index = 0; index < topics.length; index += 1) {
    for (const token of topics[index].tokens) {
      const indices = tokenTopics.get(token) || [];
      indices.push(index);
      tokenTopics.set(token, indices);
    }
  }

  const output = {
    schemaVersion: 1,
    engine: args.engine,
    root,
    toc: tocPath,
    summary: {
      topics: topics.length,
      linkedDocuments: topics.filter(topic => topic.fileExists).length,
      categoryTopics: topics.filter(topic => !topic.local).length,
      missingDocuments: topics.filter(topic => topic.local && !topic.fileExists).length,
      commandTokens: tokenTopics.size,
    },
    tokenTopics: Object.fromEntries([...tokenTopics.entries()].sort(([a], [b]) => a.localeCompare(b))),
    topics,
  };
  fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
  fs.writeFileSync(path.resolve(args.out), JSON.stringify(output, null, 2), 'utf8');
  console.log(JSON.stringify(output.summary));
}

if (require.main === module) main();

module.exports = {
  commandTokens,
  decodeDocument,
  htmlToText,
  parseToc,
};

/**
 * BOO脚本助手 — VS Code扩展 (直接API版，无需LSP服务器)
 */
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { scanM2Windows } from './reload';
import { findInvalidDynamicReferences } from './utils/dynamic-reference';
import {
  postToSidebar,
  resolveCachedPatchPakImage,
  resolveCachedPatchPakImageAsset,
  resolvePakImage,
  resolvePakImageAsset,
} from "./utils/sidebar-bridge";
import { escapeRegex } from './utils/regex';
import {
  findScriptCommandPathReferences,
  findScriptPathReferenceAt,
  findScriptPathReferences,
  getScriptBaseDirs,
  isPathInside,
  resolveScriptPathReference,
} from './utils/path';
import { decodeTextFile, readFileGBK } from './utils/text';
import {
  findAutoRunRobotLabelAt,
  findScriptLabelPosition,
  resolveRobotManageFile,
} from './utils/robot-definition';
import {
  findScriptLabelDefinitions,
  findScriptLabelReferences,
  findScriptLabelReferencesInText,
  findUndefinedScriptLabelReferences,
  isScriptCommentLine,
  normalizeScriptLabelKey,
} from './utils/script-labels';
import { findHostScriptLabelKeys } from './utils/script-call-context';
import {
  compactVariableTypeLabel,
  formatVariableGroupLabel,
  normalizeScriptVariableName,
  recordVariableUsage,
} from './utils/variable-statistics';
import {
  analyzeNestedVariables,
  isNestedVariableBaseOffset,
  NestedConfigValueRequest,
  NestedConfigValueResult,
  NestedListDataRequest,
  NestedListDataResult,
  NestedTableDataRequest,
  NestedTableDataResult,
  normalizeNestedVariableReference,
  normalizePersonalFlagReference,
} from './utils/nested-variable-analysis';
import { isBinarySpreadsheet, parseScriptTableData } from './utils/table-data';
import {
  CommandEntry,
  CommandsData,
  ConstantEntry,
  EngineConstantCatalog,
  EngineFunctionCatalog,
  EngineId,
  StaticLanguageData,
  VariablesData,
} from './types';
import {
  loadCommandsData,
  loadEngineConstantCatalog,
  loadEngineFunctionCatalog,
  loadStaticLanguageData,
  loadVariablesData,
} from './data/loader';
import { registerFoldingProvider } from './providers/folding';
import { registerSymbolProvider } from './providers/symbol';
import { registerCodeLensProvider } from './providers/codelens';
import { registerFColorDecorator, registerMerchantTableDecorator } from './providers/decorator';
import { detectEngineDetails, resolveEngineRoot } from './utils/engine-detect';
import {
  buildLanguageIndex,
  commandKey,
  commandToken,
  IndexedCommand,
  LanguageIndex,
  normalizeEngineId,
} from './utils/command-index';
import {
  buildSemanticCommandIndex,
  classifySemanticCommand,
  findCommandCandidates,
  SemanticCommandKind,
} from './utils/semantic-commands';
import {
  ENGINE_DEFINITIONS,
  getEngineDefinition,
  nextEngineId,
} from './utils/engine-registry';
import {
  DatabaseBrowserSession,
  DatabasePageRequest,
  DatabaseRequestCancelledError,
  DatabaseRowUpdate,
  DatabaseSchemaColumnUpdate,
} from './utils/database-browser';
import {
  databaseViewerWebviewHtml,
  databaseViewerWebviewOptions,
} from './utils/database-viewer-webview';
import { findMiniMapReference } from './utils/minimap';
import {
  findCachedPatchImage,
  PATCH_MANAGER_STATE_KEY,
  patchManagerStateKey,
  SavedPatchManagerState,
} from './utils/patch-cache';
import { getPatchCacheRoot } from './utils/cache-storage';
import {
  cachedPatchImageUri,
  webviewResourceRoots,
} from './utils/archive-resource-provider';
import { clientResourceLayoutFromState } from './utils/client-resources';
import { uiEditorArchiveExtensions } from './utils/ui-archive';
import { findItemLooksValue, resolveItemImageReference } from './utils/item-image';
import { resolveItemDescriptionMedia } from './utils/item-desc-preview';
import {
  buildMonsterIconPreviews,
  classifyDatabaseDetail,
  describeMonsterBodyAppearance,
  loadMonsterDatabaseDetail,
} from './utils/database-detail';
import { secureWebviewHtml } from './utils/webview-security';
import { parseMerchantLine } from './utils/map-entities';
import { getReloadOptions, normalizeReloadSelection } from './utils/reload-options';
import {
  activeStaticLanguageEntries,
  EMPTY_STATIC_LANGUAGE_DATA,
} from './utils/static-language';
import {
  buildSayMarkupIndex,
  findSayMarkupParameterAt,
  findSayMarkupTokenAt,
  findSayMarkupTokens,
  SayMarkupParameterSpan,
  sayMarkupParameterMeanings,
  SayMarkupToken,
} from './utils/say-markup';
import {
  findAtLabelReplacementStart,
  findCommandReplacementStart,
  findDirectiveReplacementStart,
  findMapInfoReplacementStart,
  findPathPartialReplacementStart,
  findSayMarkupReplacementStart,
  findSectionLabelReplacementStart,
  findVariableReplacementStart,
} from './utils/completion-range';
import {
  buildChineseCommandFilterText,
  findChineseCommandSearch,
  scoreChineseCommandSearch,
} from './utils/completion-search';
import {
  isWorkspaceScriptAuditPath,
  workspaceScriptAuditGlobs,
} from './utils/script-audit-scope';
import { BatchNumberOperation, transformBatchNumbers } from './utils/number-transform';
import { collectVariableWrapEdits } from './utils/variable-wrap';
import {
  CandidateUsage,
  CandidateVariableFamily,
  collectCandidateUsage,
  createCandidateUsage,
  mergeCandidateUsage,
  unusedPersonalFlagCandidates,
  unusedVariableCandidates,
} from './utils/variable-candidates';
import {
  findScriptCommandArgumentAt,
  formatCommandParameterMeaning,
} from './utils/command-arguments';
import {
  collectConfiguredMapCodes,
  findMapCodeRangesInLine,
  findMapCodeRangesInText,
  isOffsetInTextRanges,
} from './utils/map-code-context';
import {
  createEmptyCustomLanguageData,
  customLanguageEntries,
  customSayMarkupEntries,
  CustomLanguageCategory,
  CustomLanguageData,
  CUSTOM_LANGUAGE_STATE_KEY,
  replaceCustomLanguageEntries,
  sanitizeCustomLanguageData,
} from './utils/custom-language';

function createEmptyEngineFunctionCatalog(): EngineFunctionCatalog {
  const catalog = {} as EngineFunctionCatalog;
  for (const definition of ENGINE_DEFINITIONS) catalog[definition.id] = {};
  return catalog;
}

function createEmptyEngineConstantCatalog(): EngineConstantCatalog {
  const catalog = {} as EngineConstantCatalog;
  for (const definition of ENGINE_DEFINITIONS) {
    catalog[definition.id] = {
      schemaVersion: 1,
      engine: definition.id,
      generated: '',
      constants: [],
    };
  }
  return catalog;
}

let outputChannel: vscode.OutputChannel;
let commandsData: CommandsData | null = null;
let variablesData: VariablesData | null = null;
let engineFunctionCatalog: EngineFunctionCatalog = createEmptyEngineFunctionCatalog();
let engineConstantCatalog: EngineConstantCatalog = createEmptyEngineConstantCatalog();
let customLanguageData: CustomLanguageData = createEmptyCustomLanguageData();
let staticLanguageData: StaticLanguageData = EMPTY_STATIC_LANGUAGE_DATA;
let isCurrentEngineDefaultScriptLabel = (_labelKey: string) => false;
let languageIndex: LanguageIndex = buildLanguageIndex(
  commandsData,
  variablesData,
  engineFunctionCatalog,
  'GOM',
  engineConstantCatalog,
  customLanguageData
);
isCurrentEngineDefaultScriptLabel = buildDefaultScriptLabelMatcher(languageIndex);

function buildTriggerTemplatePattern(triggerKey: string): RegExp | null {
  if (!/[X]+/i.test(triggerKey)) return null;
  const escaped = triggerKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wildcarded = escaped.replace(/X+/gi, '\\\\d+');
  return new RegExp(`^${wildcarded}$`, 'i');
}

function buildDefaultScriptLabelMatcher(index: LanguageIndex): (labelKey: string) => boolean {
  const exactLabels = new Set(index.triggerByName.keys());
  const templates = [...index.triggerByName.keys()]
    .map(buildTriggerTemplatePattern)
    .filter((item): item is RegExp => item !== null);
  return (labelKey: string) => {
    if (exactLabels.has(labelKey)) return true;
    for (const template of templates) {
      if (template.test(labelKey)) return true;
    }
    return false;
  };
}

let databasePanel: vscode.WebviewPanel | undefined;
const mapViewerPanels = new Set<vscode.WebviewPanel>();

// --- 补全上下文缓存 ---
interface BlockInfo {
  type: string;  // 'IF' | 'ACT' | 'SAY' | 'ELSEACT' | 'ELSESAY' | 'OR'
  line: number;
}

class BlockStackCache {
  private cachedUri: string = '';
  private cachedVersion: number = -1;
  private stack: BlockInfo[] = [];

  getContext(document: vscode.TextDocument, line: number): { inCondition: boolean; inAction: boolean; inSay: boolean } {
    const uri = document.uri.toString();
    if (uri !== this.cachedUri || document.version !== this.cachedVersion) {
      this.rebuild(document);
    }

    let inCondition = false, inAction = false, inSay = false;
    for (const block of this.stack) {
      if (block.line > line) break;
      const t = block.type;
      if (t === 'IF' || t === 'OR') { inCondition = true; inAction = false; inSay = false; }
      else if (t === 'ACT' || t === 'ELSEACT') { inAction = true; inCondition = false; inSay = false; }
      else if (t === 'SAY' || t === 'ELSESAY') { inSay = true; inCondition = false; inAction = false; }
    }
    return { inCondition, inAction, inSay };
  }

  private rebuild(document: vscode.TextDocument) {
    this.cachedUri = document.uri.toString();
    this.cachedVersion = document.version;
    this.stack = [];
    const re = /^#(IF|ACT|SAY|ELSEACT|ELSESAY|OR)\b/i;
    for (let i = 0; i < document.lineCount; i++) {
      const text = document.lineAt(i).text.trimStart();
      const m = re.exec(text);
      if (m) {
        this.stack.push({ type: m[1].toUpperCase(), line: i });
      }
    }
  }

  invalidate() {
    this.cachedVersion = -1;
  }
}

let _refreshVarTree: (() => void) | null = null;
export function refreshVariableTree() { if (_refreshVarTree) _refreshVarTree(); }
// 变量跳转循环
const _varOccurrences = new Map<string, {file: string, line: number}[]>();
const _varCycleIdx = new Map<string, number>();
async function gotoVarOccurrence(name: string) {
  const key = normalizeScriptVariableName(name);
  const occs = _varOccurrences.get(key);
  if (!occs || occs.length === 0) return;
  let idx = _varCycleIdx.get(key) || 0;
  if (idx >= occs.length) idx = 0;
  const occ = occs[idx];
  _varCycleIdx.set(key, (idx + 1) % occs.length);
  try {
    const uri = vscode.Uri.file(occ.file);
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    const pos = new vscode.Position(occ.line, 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    vscode.window.setStatusBarMessage(`跳转到 ${name} (${idx+1}/${occs.length})`, 3000);
  } catch { /* ignore */ }
}
// 跨文件 HUMAN/GUILD 变量声明缓存
const _humanDecls = new Set<string>();
const _guildDecls = new Set<string>();
async function scanHumanGuildDecls() {
  if (!vscode.workspace.workspaceFolders?.[0]) return;
  _humanDecls.clear(); _guildDecls.clear();
  const files = await vscode.workspace.findFiles('**/*.txt', '**/node_modules/**');
  const hRe = /VAR\s+Integer\s+HUMAN\s+(\S+)/gi;
  const gRe = /VAR\s+Integer\s+GUILD\s+(\S+)/gi;
  for (const f of files) {
    try {
      const raw = await vscode.workspace.fs.readFile(f);
      const ft = readFileGBK(raw);
      let hm; hRe.lastIndex = 0; while ((hm = hRe.exec(ft)) !== null) _humanDecls.add(hm[1].toUpperCase());
      let gm; gRe.lastIndex = 0; while ((gm = gRe.exec(ft)) !== null) _guildDecls.add(gm[1].toUpperCase());
    } catch { /* skip */ }
  }
}

export function activateAssistant(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('BOO脚本助手');
  outputChannel.appendLine('BOO脚本助手正在激活...');
  const log = (msg: string) => outputChannel.appendLine(msg);
  customLanguageData = sanitizeCustomLanguageData(
    context.globalState.get<CustomLanguageData>(CUSTOM_LANGUAGE_STATE_KEY)
  );

  // 路径补全文件夹展开: 延迟触发补全
  context.subscriptions.push(
    vscode.commands.registerCommand('boo.retriggerPathComplete', () => {
      setTimeout(() => {
        void vscode.commands.executeCommand('editor.action.triggerSuggest').then(
          undefined,
          error => log(`重新触发路径补全失败: ${error instanceof Error ? error.message : String(error)}`)
        );
      }, 50);
    })
  );

  const blockCache = new BlockStackCache();
  const pendingMissingFileCreations = new Map<string, Promise<vscode.Uri | undefined>>();
  const mapCodeCache = new Map<string, { stamp: string; codes: Set<string> }>();
  let candidateUsageCache: { workspaceKey: string; usage: CandidateUsage } | undefined;
  let candidateUsageGeneration = 0;
  const completionEditorSaveState = { pending: false };
  const beginCompletionEditorSave = (): boolean => {
    if (completionEditorSaveState.pending) return false;
    completionEditorSaveState.pending = true;
    return true;
  };
  const endCompletionEditorSave = (): void => {
    completionEditorSaveState.pending = false;
  };
  const replaceActiveCustomLanguageData = (next: CustomLanguageData): void => {
    customLanguageData = next;
  };

  function commandLookupKeys(typedName: string): string[] {
    const result: string[] = [];
    let candidate = typedName;
    while (candidate) {
      const key = commandKey(candidate);
      if (!result.includes(key)) result.push(key);
      const separator = candidate.indexOf('.');
      if (separator < 0) break;
      candidate = candidate.slice(separator + 1);
    }
    return result;
  }

  function resolveIndexedCommandToken(typedName: string): IndexedCommand | undefined {
    for (const key of commandLookupKeys(typedName)) {
      const command = languageIndex.commandByName.get(key);
      if (command) return command;
    }
    return undefined;
  }

  function resolveUnsupportedCommandToken(typedName: string): IndexedCommand | undefined {
    for (const key of commandLookupKeys(typedName)) {
      const command = languageIndex.unsupportedCommandByName.get(key);
      if (command) return command;
    }
    return undefined;
  }

  function mapInfoPathForFile(filePath: string): string | undefined {
    const envirRoot = findAncestorDirectory(filePath, 'Envir');
    const candidates = envirRoot
      ? [path.join(envirRoot, 'MapInfo.txt')]
      : (vscode.workspace.workspaceFolders || []).flatMap(folder => [
          path.join(folder.uri.fsPath, 'Mir200', 'Envir', 'MapInfo.txt'),
          path.join(folder.uri.fsPath, 'Envir', 'MapInfo.txt'),
        ]);
    return candidates.find(candidate => fs.existsSync(candidate));
  }

  function configuredMapCodesForFile(filePath: string): Set<string> {
    const mapInfoPath = mapInfoPathForFile(filePath);
    if (!mapInfoPath) return new Set<string>();
    try {
      const stat = fs.statSync(mapInfoPath);
      const stamp = `${stat.size}:${stat.mtimeMs}`;
      const cacheKey = path.resolve(mapInfoPath).toLowerCase();
      const cached = mapCodeCache.get(cacheKey);
      if (cached?.stamp === stamp) return cached.codes;
      const codes = collectConfiguredMapCodes(readFileGBK(fs.readFileSync(mapInfoPath)));
      mapCodeCache.set(cacheKey, { stamp, codes });
      return codes;
    } catch {
      return new Set<string>();
    }
  }

  function configuredMapCodesForDocument(document: vscode.TextDocument): Set<string> {
    const mapInfoPath = mapInfoPathForFile(document.fileName);
    if (!mapInfoPath) return new Set<string>();
    const normalizedPath = path.resolve(mapInfoPath).toLowerCase();
    const openMapInfo = vscode.workspace.textDocuments.find(item => (
      path.resolve(item.fileName).toLowerCase() === normalizedPath
    ));
    return openMapInfo
      ? collectConfiguredMapCodes(openMapInfo.getText())
      : configuredMapCodesForFile(document.fileName);
  }

  function invalidateCandidateUsage(): void {
    candidateUsageCache = undefined;
    candidateUsageGeneration++;
  }

  async function scanCandidateUsage(): Promise<CandidateUsage | undefined> {
    const folders = vscode.workspace.workspaceFolders || [];
    if (folders.length === 0) {
      void vscode.window.showWarningMessage('请先打开传奇服务端工作区');
      return undefined;
    }
    const workspaceKey = folders.map(folder => folder.uri.toString()).join('|');
    if (candidateUsageCache?.workspaceKey === workspaceKey) return candidateUsageCache.usage;
    const scanGeneration = candidateUsageGeneration;

    return vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'BOO 正在扫描未使用变量与个人标识',
      cancellable: true,
    }, async (progress, cancellation) => {
      const directories = ['MapQuest_Def', 'Market_Def', 'QuestDiary', 'Robot_def', 'Npc_Def'];
      const searches: Thenable<vscode.Uri[]>[] = [];
      for (const folder of folders) {
        for (const directory of directories) {
          for (const extension of ['txt', 'ini']) {
            searches.push(vscode.workspace.findFiles(
              new vscode.RelativePattern(folder, `**/Envir/${directory}/**/*.${extension}`),
              '**/{node_modules,.git}/**'
            ));
            searches.push(vscode.workspace.findFiles(
              new vscode.RelativePattern(folder, `${directory}/**/*.${extension}`),
              '**/{node_modules,.git}/**'
            ));
          }
        }
      }
      const discovered = (await Promise.all(searches)).flat();
      const files = [...new Map(discovered.map(uri => [uri.toString().toLowerCase(), uri])).values()]
        .sort((left, right) => left.fsPath.localeCompare(right.fsPath, 'zh-CN'));
      const openDocuments = new Map(
        vscode.workspace.textDocuments.map(document => [document.uri.toString().toLowerCase(), document])
      );
      const usage = createCandidateUsage();
      for (let index = 0; index < files.length; index++) {
        if (cancellation.isCancellationRequested) return undefined;
        const uri = files[index];
        try {
          const openDocument = openDocuments.get(uri.toString().toLowerCase());
          const text = openDocument?.getText()
            ?? readFileGBK(await vscode.workspace.fs.readFile(uri));
          const excludedRanges = findMapCodeRangesInText(
            text,
            uri.fsPath,
            configuredMapCodesForFile(uri.fsPath),
            resolveIndexedCommandToken
          );
          mergeCandidateUsage(usage, collectCandidateUsage(text, {
            excludedRanges,
            resolveConfigValues: request => resolveNestedConfigValues(uri.fsPath, request),
            resolveTableData: request => resolveNestedTableData(uri.fsPath, request),
            resolveListData: request => resolveNestedListData(uri.fsPath, request),
          }));
        } catch (error) {
          log(`候选变量扫描跳过 ${uri.fsPath}: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (index === files.length - 1 || index % 25 === 0) {
          progress.report({
            message: `${index + 1}/${files.length}`,
            increment: files.length ? 2500 / files.length : 100,
          });
        }
      }
      if (scanGeneration !== candidateUsageGeneration) {
        return scanCandidateUsage();
      }
      candidateUsageCache = { workspaceKey, usage };
      return usage;
    });
  }

  async function pickUnusedScriptCandidate(args: {
    kind?: 'variable' | 'personalFlag';
    family?: CandidateVariableFamily;
    uri?: string;
    line?: number;
    start?: number;
    end?: number;
    expected?: string;
  }): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !args.uri || editor.document.uri.toString() !== args.uri) {
      void vscode.window.showWarningMessage('候选插入位置已经失效，请回到原脚本重新选择');
      return;
    }
    const usage = await scanCandidateUsage();
    if (!usage) return;
    const family = args.family;
    const values = args.kind === 'variable' && family
      ? unusedVariableCandidates(family, usage)
      : unusedPersonalFlagCandidates(usage);
    if (values.length === 0) {
      void vscode.window.showInformationMessage(
        args.kind === 'variable' && family
          ? `${family} 类变量已经全部使用`
          : '个人标识 1-1024 已经全部使用'
      );
      return;
    }
    const pick = await vscode.window.showQuickPick(
      values.map(value => ({
        label: args.kind === 'variable' && family ? `${family}${value}` : `[${value}]`,
        description: '未使用',
        value,
      })),
      {
        title: args.kind === 'variable' && family ? `选择未使用的 ${family} 类变量` : '选择未使用的个人标识',
        placeHolder: '可输入编号进行模糊筛选',
        matchOnDescription: true,
      }
    );
    if (!pick) return;
    const line = Number(args.line);
    const start = Number(args.start);
    const end = Number(args.end);
    if (![line, start, end].every(Number.isInteger) || line < 0 || start < 0 || end < start) return;
    const range = new vscode.Range(line, start, line, end);
    if (editor.document.getText(range) !== String(args.expected || '')) {
      void vscode.window.showWarningMessage('候选插入位置的文字已经变化，请重新选择');
      return;
    }
    const replacement = args.kind === 'variable' && family ? `${family}${pick.value}` : `[${pick.value}]`;
    const applied = await editor.edit(edit => edit.replace(range, replacement));
    if (!applied) return;
    const cursor = new vscode.Position(line, start + replacement.length);
    editor.selection = new vscode.Selection(cursor, cursor);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('boo.pickUnusedScriptCandidate', pickUnusedScriptCandidate),
    vscode.workspace.onDidChangeTextDocument(invalidateCandidateUsage),
    vscode.workspace.onDidSaveTextDocument(invalidateCandidateUsage),
    vscode.workspace.onDidChangeWorkspaceFolders(invalidateCandidateUsage)
  );

  // 自动识别引擎类型
  async function autoDetectEngine() {
    const wsFolders = vscode.workspace.workspaceFolders;
    if (!wsFolders || wsFolders.length === 0) { log('引擎识别: 无工作区'); return; }
    const wsRoot = wsFolders[0].uri.fsPath;
    const cfg = vscode.workspace.getConfiguration('boo');
    if (!cfg.get<boolean>('autoDetectEngine', true)) {
      log('引擎识别: 已由用户关闭');
      return;
    }
    const detection = detectEngineDetails(wsRoot);
    const detected = detection.engine;
    if (!detected) {
      log(`引擎识别: 证据不足，保留当前选择 (${detection.evidence.join(', ') || '未发现引擎特征'})`);
      return;
    }
    const autoStateKey = `boo.autoDetectedEngine:${wsRoot.toLowerCase()}`;
    const previousAutoValue = context.workspaceState.get<EngineId>(autoStateKey);
    const inspected = cfg.inspect<string>('engine');
    const workspaceValue = inspected?.workspaceFolderValue || inspected?.workspaceValue;
    const hasManualWorkspaceChoice = !!workspaceValue && workspaceValue !== previousAutoValue;
    if (hasManualWorkspaceChoice) {
      log(`引擎识别: 保留工作区手动选择 ${workspaceValue}`);
      return;
    }
    const current = cfg.get<string>('engine', 'GOM');
    if (current !== detected) {
      try {
        await cfg.update('engine', detected, vscode.ConfigurationTarget.Workspace);
        await context.workspaceState.update(autoStateKey, detected);
        log(`已自动切换引擎: ${getEngineDefinition(detected).label} (${detection.evidence.join(', ')})`);
      } catch (e: unknown) {
        log(`引擎切换失败: ${e}`);
      }
    } else if (!workspaceValue) {
      await context.workspaceState.update(autoStateKey, detected);
    }
  }
  void autoDetectEngine();

  // 工作区变化时重新检测
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => void autoDetectEngine())
  );

  function rebuildLanguageIndex(reloadCatalog = false) {
    const engine = normalizeEngineId(vscode.workspace.getConfiguration('boo').get<string>('engine', 'GOM'));
    if (reloadCatalog) {
      engineFunctionCatalog = loadEngineFunctionCatalog(context.extensionPath, log);
      engineConstantCatalog = loadEngineConstantCatalog(context.extensionPath, log);
    }
    languageIndex = buildLanguageIndex(
      commandsData,
      variablesData,
      engineFunctionCatalog,
      engine,
      engineConstantCatalog,
      customLanguageData
    );
    isCurrentEngineDefaultScriptLabel = buildDefaultScriptLabelMatcher(languageIndex);
    vscode.commands.executeCommand('setContext', 'boo.currentEngine', engine);
    log(`语言索引: ${engine} ${languageIndex.commands.length} 条命令, ${languageIndex.variables.length} 个变量, ${languageIndex.triggers.length} 个触发器`);
  }

  try {
    commandsData = loadCommandsData(context.extensionPath, log);
    variablesData = loadVariablesData(context.extensionPath, log);
    engineFunctionCatalog = loadEngineFunctionCatalog(context.extensionPath, log);
    engineConstantCatalog = loadEngineConstantCatalog(context.extensionPath, log);
    staticLanguageData = loadStaticLanguageData(context.extensionPath, log)
      || EMPTY_STATIC_LANGUAGE_DATA;
    rebuildLanguageIndex();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    outputChannel.appendLine(`加载数据失败: ${msg}`);
  }

  // ---- 代码补全 ----
  const completionProvider = vscode.languages.registerCompletionItemProvider(
    [
      { language: 'gomscript', scheme: 'file' },
      { language: 'gomscript', scheme: 'untitled' },
      { language: 'plaintext', scheme: 'file', pattern: '**/*.txt' },
      { language: 'plaintext', scheme: 'untitled', pattern: '**/*.txt' }
    ],
    {
      provideCompletionItems(document, position) {
        if (!vscode.workspace.getConfiguration("boo").get("enableCompletion", true)) return [];
        const line = document.lineAt(position.line).text;
        const linePrefix = line.substring(0, position.character);
        const upper = linePrefix.toUpperCase().trim();
        const items: vscode.CompletionItem[] = [];

        // 检测上下文: 使用缓存快速判定当前块
        let { inCondition, inAction, inSay } = blockCache.getContext(document, position.line);
        // 当前行本身可能改变了块
        if (upper.startsWith('#IF(') || upper.startsWith('#IF ') || upper === '#IF' || upper.startsWith('#IF	') || upper.startsWith('#OR')) { inCondition = true; inAction = false; inSay = false; }
        if (upper.startsWith('#ACT') || upper.startsWith('#ELSEACT')) { inAction = true; inCondition = false; inSay = false; }
        if (upper.startsWith('#SAY') || upper.startsWith('#ELSESAY')) { inSay = true; inCondition = false; inAction = false; }

        // ---- 变量补全: <$ 触发 ----
        const variableReplaceStart = findVariableReplacementStart(linePrefix);
        const variablePrefix = variableReplaceStart >= 0
          ? linePrefix.slice(variableReplaceStart)
          : '';
        const isScopedSayVariable = inSay && /^[NSD]\$/i.test(variablePrefix);
        const isAngleVariable = variablePrefix === '<' || variablePrefix.startsWith('<$');
        if (variableReplaceStart >= 0 && (isAngleVariable || isScopedSayVariable)) {
          if (languageIndex.variables.length > 0 || languageIndex.constants.length > 0) {
            const replaceRange = new vscode.Range(
              position.line,
              variableReplaceStart,
              position.line,
              position.character
            );
            for (const v of languageIndex.variables) {
              const desc = (v.scope ? `[${v.scope}] ` : '') + (v.desc || v.description || '');
              const engineLabel = formatEntryEngineCategory(v.engines);
              const item = new vscode.CompletionItem({ label: v.full || `<$${v.name}>`, description: desc }, vscode.CompletionItemKind.Constant);
              item.range = replaceRange;
              item.detail = `[${engineLabel}] ${desc}`;
              const documentation = new vscode.MarkdownString(
                `${desc}\n\n当前引擎: **${engineLabel}**`
              );
              item.documentation = documentation;
              item.sortText = '0' + (v.name || '');
              items.push(item);
            }
            const variableNames = new Set(
              languageIndex.variables.map(variable => variable.name.toUpperCase())
            );
            for (const constant of languageIndex.constants) {
              if (
                !constant.completionEnabled
                || !constant.completionVerified
                || variableNames.has(constant.name.toUpperCase())
              ) continue;
              const item = new vscode.CompletionItem(
                { label: constant.full, description: constant.description },
                vscode.CompletionItemKind.Constant
              );
              item.range = replaceRange;
              item.detail = `[${getEngineDefinition(languageIndex.engine).label}常量] ${constant.description}`;
              const documentation = new vscode.MarkdownString(
                `${constant.description}\n\n当前引擎: **${getEngineDefinition(languageIndex.engine).label}**`
              );
              item.documentation = documentation;
              item.sortText = `1${constant.name}`;
              items.push(item);
            }
          }
          // 在 #SAY 中仅输入 "<" 时，同时展示界面标签模板。
          if (!(inSay && variablePrefix === '<')) return items;
        }

        // ---- 未使用变量/个人标识候选 ----
        const numberedCandidate = /([UTAG])$/i.exec(linePrefix);
        if (numberedCandidate) {
          const start = position.character - numberedCandidate[1].length;
          const previous = start > 0 ? linePrefix.charAt(start - 1) : '';
          if (!previous || !/[A-Za-z0-9_$]/.test(previous)) {
            const family = numberedCandidate[1].toUpperCase() as CandidateVariableFamily;
            const expected = numberedCandidate[1];
            const item = new vscode.CompletionItem('候选变量', vscode.CompletionItemKind.Variable);
            item.detail = `选择当前统计中未使用的 ${family} 类变量`;
            item.documentation = new vscode.MarkdownString('复用当前变量统计结果，按编号顺序列出尚未使用的变量。');
            item.insertText = expected;
            item.filterText = expected;
            item.range = new vscode.Range(position.line, start, position.line, position.character);
            item.sortText = '0000';
            item.preselect = true;
            item.command = {
              command: 'boo.pickUnusedScriptCandidate',
              title: '选择未使用变量',
              arguments: [{
                kind: 'variable',
                family,
                uri: document.uri.toString(),
                line: position.line,
                start,
                end: position.character,
                expected,
              }],
            };
            items.push(item);
          }
        }
        const bracketStart = position.character - 1;
        const flagCommandContext = /(?:^|\s)(?:CHECK|SET|RESET)\s+\[$/i.test(linePrefix);
        if (bracketStart >= 0 && linePrefix.endsWith('[') && (linePrefix.trim() === '[' || flagCommandContext)) {
          const item = new vscode.CompletionItem('候选标识', vscode.CompletionItemKind.Value);
          item.detail = '选择当前统计中未使用的个人标识';
          item.documentation = new vscode.MarkdownString('复用当前个人标识统计结果，按编号顺序列出尚未使用的标识。');
          item.insertText = '[';
          item.filterText = '[';
          item.range = new vscode.Range(position.line, bracketStart, position.line, position.character);
          item.sortText = '0000';
          item.preselect = true;
          item.command = {
            command: 'boo.pickUnusedScriptCandidate',
            title: '选择未使用个人标识',
            arguments: [{
              kind: 'personalFlag',
              uri: document.uri.toString(),
              line: position.line,
              start: bracketStart,
              end: position.character,
              expected: '[',
            }],
          };
          items.push(item);
        }

        // ---- 标签补全: <@ 或 /@ 触发 ----
        const sectionReplaceStart = findSectionLabelReplacementStart(linePrefix);
        const tagReplaceStart = findAtLabelReplacementStart(linePrefix);
        if (tagReplaceStart >= 0 && sectionReplaceStart < 0) {
          const replaceRange = new vscode.Range(
            position.line,
            tagReplaceStart,
            position.line,
            position.character
          );
          const docLabels = extractDocLabels(document.getText());
          for (const lbl of docLabels) {
            const item = new vscode.CompletionItem(`@${lbl}`, vscode.CompletionItemKind.Reference);
            item.detail = `跳转到 [@${lbl}]`;
            item.documentation = new vscode.MarkdownString(`跳转到本文件的 \`[@${lbl}]\` 标签定义`);
            item.insertText = `@${lbl}`;
            item.range = replaceRange;
            items.push(item);
          }
          const exitItem = newItem('@exit', '关闭NPC对话框', vscode.CompletionItemKind.Keyword);
          exitItem.range = replaceRange;
          items.push(exitItem);
          const mainItem = newItem('@main', '回到NPC主页面', vscode.CompletionItemKind.Keyword);
          mainItem.range = replaceRange;
          items.push(mainItem);
          return items;
        }

        // ---- 当前单词匹配 (大小写不敏感) ----
        const wordMatch = linePrefix.match(/([A-Za-z_$][A-Za-z_0-9.$]*)$/);
        const currentWord = wordMatch ? wordMatch[1].toUpperCase() : '';
        const chineseCommandSearch = inSay ? null : findChineseCommandSearch(linePrefix);
        const commandReplaceStart = chineseCommandSearch?.start
          ?? findCommandReplacementStart(linePrefix);
        const commandReplaceRange = new vscode.Range(
          position.line,
          commandReplaceStart >= 0 ? commandReplaceStart : position.character,
          position.line,
          position.character
        );
        const directiveReplaceStart = findDirectiveReplacementStart(linePrefix);
        const directiveReplaceRange = directiveReplaceStart >= 0
          ? new vscode.Range(
              position.line,
              directiveReplaceStart,
              position.line,
              position.character
            )
          : undefined;

        // 去重：防止同一 label 被多个代码路径重复添加导致 detail 丢失
        const addedLabels = new Set<string>();

        // 构建命令补全的辅助函数
        function addCmdItem(cmd: IndexedCommand, prefix: string, detailPrefix: string, sortPrefix: string) {
          const upperName = cmd.name.toUpperCase();
          const chineseSearchScore = chineseCommandSearch && cmd.completionVerified
            ? scoreChineseCommandSearch(cmd, detailPrefix, chineseCommandSearch.query)
            : null;
          const matchesSearch = chineseCommandSearch
            ? chineseSearchScore !== null
            : (!currentWord || upperName.startsWith(currentWord));
          if (matchesSearch && !addedLabels.has(prefix.toUpperCase() + upperName)) {
            addedLabels.add(prefix.toUpperCase() + upperName);
            const item = new vscode.CompletionItem({ label: prefix + cmd.name, description: cmd.description || '' }, vscode.CompletionItemKind.Function);
            const engineLabel = formatIndexedCommandEngineCategory(cmd);
            const aliasLabel = cmd.aliasOf ? `，兼容别名：${cmd.aliasOf}` : '';
            const verificationLabel = cmd.completionVerified ? '' : ' [仅指令名]';
            item.detail = `${detailPrefix}${verificationLabel} [${engineLabel}] ${cmd.description || ''}${aliasLabel}`;
            const documentation = new vscode.MarkdownString();
            documentation.appendMarkdown(`**${cmd.completionVerified ? cmd.syntax : prefix + cmd.name}**\n\n${cmd.description || ''}\n\n`);
            if (!cmd.completionVerified) {
              documentation.appendMarkdown('仅提供已确认的指令名，不自动插入尚未完整核验的参数。\n\n');
            }
            documentation.appendMarkdown(`当前引擎: **${engineLabel}**`);
            item.documentation = documentation;
            item.insertText = cmd.completionVerified
              ? (cmd.snippet
                  ? new vscode.SnippetString(cmd.snippet)
                  : buildSnippet({ ...cmd, name: prefix + cmd.name }))
              : new vscode.SnippetString(prefix + cmd.name);
            item.range = commandReplaceRange;
            item.sortText = chineseCommandSearch
              ? `${sortPrefix}${String(chineseSearchScore).padStart(2, '0')}${cmd.name}`
              : sortPrefix + cmd.name;
            item.filterText = chineseCommandSearch
              ? buildChineseCommandFilterText(cmd, detailPrefix, chineseCommandSearch.query)
              : cmd.name;
            items.push(item);
          }
        }

        // 根据上下文决定显示哪些命令（优先），但也始终提供所有命令作为后备
        if (inCondition) {
          // #IF块: 优先检测命令
          for (const cmd of languageIndex.checkNameCompletions) addCmdItem(cmd, '', '[检测]', '1');
          const ifItem = newSnippetItem('#IF', '#IF\n${1}', '条件检测块开始', vscode.CompletionItemKind.Keyword);
          ifItem.range = directiveReplaceRange;
          items.push(ifItem);
          const orItem = newSnippetItem('#OR', '#OR\n${1}', '或条件检测', vscode.CompletionItemKind.Keyword);
          orItem.range = directiveReplaceRange;
          items.push(orItem);
        } else if (inAction) {
          // #ACT块: 优先执行命令
          for (const cmd of languageIndex.actionNameCompletions) addCmdItem(cmd, '', '[执行]', '1');
        } else if (inSay) {
          // #SAY块: 界面命令模板
          for (const cmd of languageIndex.sayNameCompletions) addCmdItem(cmd, '', '[界面]', '1');
          for (const entry of activeSayMarkupEntries(languageIndex.engine)) {
            const engineLabel = formatEntryEngineCategory(entry.engines);
            const kind = entry.id.endsWith('-variable')
              ? vscode.CompletionItemKind.Variable
              : vscode.CompletionItemKind.Reference;
            const item = newSnippetItem(
              entry.label,
              entry.snippet || entry.label,
              `[${engineLabel}] ${entry.description}`,
              kind
            );
            const sayMarkupStart = findSayMarkupReplacementStart(linePrefix);
            if (sayMarkupStart >= 0) {
              item.range = new vscode.Range(
                position.line,
                sayMarkupStart,
                position.line,
                position.character
              );
            }
            item.documentation = new vscode.MarkdownString(
              `${entry.description}\n\n当前引擎: **${engineLabel}**`
            );
            items.push(item);
          }
        }

        // 任何上下文：输入英文指令前缀或中文详情搜索词时，显示全部匹配命令。
        if (currentWord.length >= 1 || chineseCommandSearch) {
          for (const cmd of languageIndex.commandNameCompletions) {
            if (!chineseCommandSearch && !cmd.name.toUpperCase().startsWith(currentWord)) continue;
            const detail = cmd.kind === 'check' ? '[检测]' : cmd.kind === 'say' ? '[界面]' : '[执行]';
            const sort = cmd.kind === 'check' ? '3' : cmd.kind === 'say' ? '4' : '5';
            addCmdItem(cmd, '', detail, sort);
          }
        }

        // 无上下文时：也显示块关键字
        if (!inCondition && !inAction && !inSay) {
          if (sectionReplaceStart >= 0) {
            const sectionReplaceEnd = line.charAt(position.character) === ']'
              ? position.character + 1
              : position.character;
            const sectionReplaceRange = new vscode.Range(
              position.line,
              sectionReplaceStart,
              position.line,
              sectionReplaceEnd
            );
            const mainSectionItem = newSnippetItem(
              '[@main]',
              '[@main]\n#SAY\n${1}\n#ACT\n${2}',
              'NPC主入口',
              vscode.CompletionItemKind.Class
            );
            mainSectionItem.range = sectionReplaceRange;
            items.push(mainSectionItem);
            for (const trigger of languageIndex.triggers) {
              const hasNumericSuffix = /X\]$/i.test(trigger.label);
              const bodyLabel = hasNumericSuffix
                ? trigger.label.replace(/X\]$/i, '${1:0}]')
                : trigger.label;
              const firstBlockIndex = hasNumericSuffix ? 2 : 1;
              const description = trigger.description || `${trigger.name} 触发`;
              const item = newSnippetItem(
                trigger.label,
                `${bodyLabel}\n#IF\n\${${firstBlockIndex}}\n#ACT\n\${${firstBlockIndex + 1}}`,
                `[${formatEntryEngineCategory(trigger.engines)}] ${description}`,
                vscode.CompletionItemKind.Event
              );
              item.range = sectionReplaceRange;
              item.documentation = new vscode.MarkdownString(
                `${description}\n\n当前引擎: **${formatEntryEngineCategory(trigger.engines)}**`
              );
              items.push(item);
            }
          }
          const blockItems = [
            newSnippetItem('#IF', '#IF\n${1}', '条件检测块开始', vscode.CompletionItemKind.Keyword),
            newSnippetItem('#ACT', '#ACT\n${1}', '执行操作块开始', vscode.CompletionItemKind.Keyword),
            newSnippetItem('#CALL', '#CALL [\\\\${1:路径}\\\\${2:文件}.txt] @${3:标签}', '调用外部脚本', vscode.CompletionItemKind.Keyword),
            newSnippetItem('#INCLUDE', '#INCLUDE ${1:文件名.ini}', '包含常量文件', vscode.CompletionItemKind.Keyword),
          ];
          for (const item of blockItems) {
            item.range = directiveReplaceRange;
            items.push(item);
          }
        }

        // 路径补全: ..\→Envir, 纯[\→QuestDiary, 子目录自动向下展开
        const pathMatch = linePrefix.match(/((?:\.\.?)?[\\\/](?:[^\\\/]*[\\\/])*)([^\\\/]*)$/);
        const pathStr = pathMatch?.[1] || '';
        if (pathStr.length > 0) {
          const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (wsRoot) {
            const docPath = document.fileName.replace(/\\/g, '/');
            const envirIdx = docPath.toLowerCase().lastIndexOf('/envir/');
            const envirDir = envirIdx >= 0 ? docPath.substring(0, envirIdx + 6) : path.dirname(docPath);
            // 基准目录
            let baseDir = envirDir;
            if (pathStr.startsWith('\\') || pathStr.startsWith('/')) {
              // \ 开头 → 基准为QuestDiary
              const qd = path.join(envirDir, 'QuestDiary');
              baseDir = fs.existsSync(qd) ? qd : envirDir;
            }
            if (pathStr.startsWith('..')) {
              const upCount = (pathStr.match(/\.\./g) || []).length;
              for (let i = 1; i < upCount; i++) baseDir = path.dirname(baseDir);
            }
            // 子路径: 去掉 ..\ 和 首层 \，转为 /
            let subPath = pathMatch ? pathMatch[1].replace(/\\/g, '/') : '';
            subPath = subPath.replace(/^\.\.?\//, ''); // 去掉开头的 ..\ 或 .\
            subPath = subPath.replace(/^[\/]/, '');    // 去掉开头的 \
            const partial = pathMatch ? (pathMatch[2] || '').trim() : '';
            const pathReplaceStart = findPathPartialReplacementStart(linePrefix);
            const pathReplaceRange = pathReplaceStart >= 0
              ? new vscode.Range(
                  position.line,
                  pathReplaceStart,
                  position.line,
                  position.character
                )
              : undefined;
            const targetPath = subPath ? path.join(baseDir, subPath) : baseDir;
            try {
              if (fs.existsSync(targetPath)) {
                const entries = fs.readdirSync(targetPath, { withFileTypes: true });
                const matchLower = partial.toLowerCase();
                let count = 0;
                // 文件夹优先,然后文件
                const dirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.'));
                const files = entries.filter(e => !e.isDirectory() && !e.name.startsWith('.'));
                const sorted = [...dirs, ...files];
                for (const e of sorted) {
                  if (partial && !e.name.toLowerCase().startsWith(matchLower)) continue;
                  const isDir = e.isDirectory();
                  const item = new vscode.CompletionItem(e.name, isDir ? vscode.CompletionItemKind.Folder : vscode.CompletionItemKind.File);
                  const relPath = path.relative(wsRoot, path.join(targetPath, e.name)).replace(/\\/g, '/');
                  item.detail = isDir ? `📁 ${relPath}` : `📄 ${relPath}`;
                  item.insertText = isDir ? e.name + '\\' : e.name;
                  item.range = pathReplaceRange;
                  item.sortText = '0' + (isDir ? '0' : '1') + e.name;
                  // 选择文件夹后自动展开下一级目录
                  if (isDir) {
                    item.command = {
                      command: 'boo.retriggerPathComplete',
                      title: '展开文件夹',
                      arguments: []
                    };
                  }
                  items.push(item);
                  if (++count >= 50) break;
                }
                if (items.length > 0) return items; // 有路径结果就只返回路径，不混入命令补全
              }
            } catch (_) { /* skip */ }
          }
        }

        // MapInfo 地图参数补全
        const docName = path.basename(document.fileName).toUpperCase();
        if (docName === 'MAPINFO.TXT' || docName === 'MAPINFO') {
          const mapInfoReplaceStart = findMapInfoReplacementStart(linePrefix);
          let mapInfoReplaceEnd = position.character;
          if (
            mapInfoReplaceStart >= 0
            && linePrefix.slice(mapInfoReplaceStart).includes('(')
            && line.charAt(position.character) === ')'
          ) {
            mapInfoReplaceEnd++;
          }
          const mapInfoReplaceRange = mapInfoReplaceStart >= 0
            ? new vscode.Range(
                position.line,
                mapInfoReplaceStart,
                position.line,
                mapInfoReplaceEnd
              )
            : undefined;
          for (const param of activeMapInfoParams(languageIndex.engine)) {
            const item = new vscode.CompletionItem(param.label, vscode.CompletionItemKind.Property);
            const engineLabel = formatEntryEngineCategory(param.engines);
            item.detail = `[${engineLabel}] ${param.description}`;
            item.documentation = new vscode.MarkdownString(
              `${param.description}\n\n当前引擎: **${engineLabel}**`
            );
            item.range = mapInfoReplaceRange;
            item.sortText = '5' + param.label;
            items.push(item);
          }
        }

        return items;
      }
    },
    '@', '$', '<', '(', '[', '\\', '#' // 触发字符
  );

  // ---- 悬停文档 ----
  const hoverProvider = vscode.languages.registerHoverProvider(
    [
      { language: 'gomscript', scheme: 'file' },
      { language: 'plaintext', scheme: 'file', pattern: '**/*.txt' }
    ],
    {
      provideHover(document, position) {
        const lineText = document.lineAt(position.line).text;
        const sayContext = blockCache.getContext(document, position.line);
        if (sayContext.inSay) {
          const sayMarkupIndex = buildSayMarkupIndex(activeSayMarkupEntries(languageIndex.engine));
          const sayParameter = findSayMarkupParameterAt(
            lineText,
            position.character,
            sayMarkupIndex
          );
          if (sayParameter) {
            return new vscode.Hover(
              buildSayMarkupParameterHover(sayParameter),
              new vscode.Range(
                position.line,
                sayParameter.start,
                position.line,
                sayParameter.end
              )
            );
          }
          const sayMarkup = findSayMarkupTokenAt(
            lineText,
            position.character,
            sayMarkupIndex
          );
          if (sayMarkup) {
            return new vscode.Hover(
              buildSayMarkupHover(sayMarkup),
              new vscode.Range(
                position.line,
                sayMarkup.start,
                position.line,
                sayMarkup.end
              )
            );
          }
        }
        const argumentAtPosition = findScriptCommandArgumentAt(
          lineText,
          position.character,
          resolveIndexedCommandToken
        );
        if (argumentAtPosition) {
          const command = argumentAtPosition.invocation.command;
          const parameter = command.completionVerified
            ? command.params[argumentAtPosition.index]
            : undefined;
          if (parameter) {
            const argument = argumentAtPosition.argument;
            return new vscode.Hover(
              buildIndexedCommandParameterHover(
                parameter,
                argumentAtPosition.index
              ),
              new vscode.Range(
                position.line,
                argument.start,
                position.line,
                argument.end
              )
            );
          }
        }

        const mapCodes = configuredMapCodesForDocument(document);
        const mapCodeRange = findMapCodeRangesInLine(
          lineText,
          document.fileName,
          mapCodes,
          resolveIndexedCommandToken
        ).find(item => item.start <= position.character && position.character < item.end);
        if (mapCodeRange) {
          const md = new vscode.MarkdownString();
          md.appendMarkdown(`### \`${mapCodeRange.text}\` [地图代码]\n\n`);
          md.appendMarkdown('该值已在当前服务端的 `MapInfo.txt` 中定义，此处按地图代码处理，不计为脚本变量。');
          return new vscode.Hover(md, new vscode.Range(
            position.line,
            mapCodeRange.start,
            position.line,
            mapCodeRange.end
          ));
        }

        const range = document.getWordRangeAtPosition(position, /[A-Za-z_$][A-Za-z_0-9.$]*/);
        if (!range) return null;
        const word = document.getText(range).toUpperCase();
        const cleanWord = word.replace(/^[HCM]\./, '');

        const indexedCommand = resolveIndexedCommandToken(word);
        if (indexedCommand) {
          return new vscode.Hover(buildIndexedCommandHover(indexedCommand));
        }
        const unsupportedCommand = resolveUnsupportedCommandToken(word);
        if (unsupportedCommand) {
          const md = buildIndexedCommandHover(unsupportedCommand);
          md.value = `> **兼容提示：当前选择 ${formatEngineList([languageIndex.engine])}，此命令归入 ${formatIndexedCommandEngineCategory(unsupportedCommand)}。**\n\n${md.value}`;
          return new vscode.Hover(md);
        }

        const trigger = languageIndex.triggerByName.get(word);
        if (trigger) {
          const md = new vscode.MarkdownString();
          md.appendMarkdown(`### \`${trigger.label}\` [引擎函数]\n\n`);
          md.appendMarkdown(`${trigger.description || `${trigger.name} 触发`}\n\n`);
          md.appendMarkdown(`当前引擎: **${formatEntryEngineCategory(trigger.engines)}**`);
          return new vscode.Hover(md);
        }
        const variable = languageIndex.variableByName.get(word)
          || languageIndex.variableByName.get(cleanWord);
        if (variable) {
          const md = new vscode.MarkdownString();
          md.supportHtml = true; md.isTrusted = false;
          md.appendMarkdown(`### <span style="color:#4ec94e">\`${variable.full || `<$${variable.name}>`}\`</span> [系统常量]\n\n`);
          md.appendMarkdown(`${variable.desc || variable.description || ''}\n\n`);
          md.appendMarkdown(`作用域: ${variable.scope || '系统'}\n\n`);
          md.appendMarkdown(`当前引擎: **${formatEntryEngineCategory(variable.engines)}**`);
          return new vscode.Hover(md);
        }
        const constant = languageIndex.constantByName.get(word)
          || languageIndex.constantByName.get(cleanWord);
        if (constant) {
          const md = new vscode.MarkdownString();
          md.appendMarkdown(`### \`${constant.full}\` [常量]\n\n`);
          md.appendMarkdown(`${constant.description}\n\n`);
          md.appendMarkdown(`当前引擎: **${getEngineDefinition(languageIndex.engine).label}**`);
          return new vscode.Hover(md);
        }
        const unsupportedVariable = languageIndex.unsupportedVariableByName.get(word)
          || languageIndex.unsupportedVariableByName.get(cleanWord);
        if (unsupportedVariable) {
          return new vscode.Hover(new vscode.MarkdownString(
            `> **兼容提示：\`${unsupportedVariable.full || `<$${unsupportedVariable.name}>`}\` 不属于当前 ${formatEngineList([languageIndex.engine])} 分类。**`
          ));
        }
        const unsupportedConstant = languageIndex.unsupportedConstantByName.get(word)
          || languageIndex.unsupportedConstantByName.get(cleanWord);
        if (unsupportedConstant) {
          return new vscode.Hover(new vscode.MarkdownString(
            `> **引擎提示：\`${unsupportedConstant.full}\` 未收录在当前 ${getEngineDefinition(languageIndex.engine).label} 常量库中。**`
          ));
        }
        // 变量定义位置搜索 (N$/S$等自定义变量)
        if (/^[NSLDnsld]\$/.test(word) || /^GL\$/i.test(word) || /^[PDMNSIGAUTJZ]\d+$/i.test(word)) {
          const text = document.getText();
          const defPatterns = [
            new RegExp(`(MOV|INC|DEC|MUL|DIV|MOVR|CALCVAR)\\s+${escapeRegex(word)}\\b`, 'gi'),
            new RegExp(`LOADVAR\\s+HUMAN\\s+${escapeRegex(word)}`, 'gi'),
            new RegExp(`VAR\\s+String\\s+${escapeRegex(word)}`, 'gi')
          ];
          const defLines: string[] = [];
          for (const re of defPatterns) {
            let m;
            while ((m = re.exec(text)) !== null) {
              const lineNum = document.positionAt(m.index).line;
              const lineText = document.lineAt(lineNum).text.trim();
              if (!defLines.includes(lineText)) defLines.push(`第${lineNum + 1}行: ${lineText}`);
              if (defLines.length >= 5) break;
            }
            if (defLines.length >= 5) break;
          }
          if (defLines.length > 0) {
            const md = new vscode.MarkdownString();
            md.supportHtml = true; md.isTrusted = false;
            md.appendMarkdown(`### <span style="color:#4ec94e">\`${word}\`</span>\n\n`);
            md.appendMarkdown(`**定义/赋值位置:**\n\n${defLines.map(l => `- \`${l}\``).join('\n')}`);
            return new vscode.Hover(md);
          }
        }
        // MapInfo 地图参数悬停
        const fileName = path.basename(document.fileName).toUpperCase();
        if (fileName === 'MAPINFO.TXT' || fileName === 'MAPINFO') {
          const lineText = document.lineAt(position.line).text;
          for (const param of activeMapInfoParams(languageIndex.engine)) {
            const baseName = param.label.replace(/\(.*/, '(');
            const idx = lineText.toUpperCase().indexOf(baseName.toUpperCase());
            if (idx >= 0 && position.character >= idx && position.character <= idx + param.label.length) {
              const md = new vscode.MarkdownString();
              md.supportHtml = true;
              md.appendMarkdown(`### <span style="color:#00d4ff">**${param.label}**</span>

`);
              md.appendMarkdown(`${param.description}`);
              md.appendMarkdown(`\n\n当前引擎: **${formatEntryEngineCategory(param.engines)}**`);
              return new vscode.Hover(md);
            }
          }
        }
        return null;
      }
    }
  );

  // ---- 标签定义跳转 (支持 GOTO/@标签, #CALL跨文件) ----
  const definitionProvider = vscode.languages.registerDefinitionProvider(
    [
      { language: 'gomscript', scheme: 'file' },
      { language: 'plaintext', scheme: 'file', pattern: '**/*.txt' }
    ],
    {
      async provideDefinition(document, position) {
        const line = document.lineAt(position.line).text;
        const charPos = position.character;

        // AutoRunRobot 中的 @函数固定定义在同目录 RobotManage.txt。
        const robotLabel = findAutoRunRobotLabelAt(document.fileName, line, charPos);
        if (robotLabel) {
          const robotManagePath = resolveRobotManageFile(document.uri.fsPath);
          if (robotManagePath) {
            try {
              const targetText = decodeTextFile(fs.readFileSync(robotManagePath)).text;
              const target = findScriptLabelPosition(targetText, robotLabel);
              if (target) {
                return new vscode.Location(
                  vscode.Uri.file(robotManagePath),
                  new vscode.Position(target.line, target.character)
                );
              }
            } catch (e) {
              console.warn('[BOO] RobotManage 定义跳转失败:', e instanceof Error ? e.message : String(e));
            }
          }
          return null;
        }

        const scriptLabelReferences = findScriptLabelReferences(line);
        let match: RegExpExecArray | null;

        // 1. 查找 <text/@label>、/@@InputStringXX 等界面引用 (同文件)
        for (const reference of scriptLabelReferences.filter(item => item.kind === 'ui')) {
          if (charPos >= reference.markerStart && charPos <= reference.end) {
            const label = reference.name;
            const allText = document.getText();
            const labelRegex = new RegExp(`\\[@${escapeRegex(label)}\\]`, 'g');
            const lm = labelRegex.exec(allText);
            if (lm) {
              const pos = document.positionAt(lm.index);
              return new vscode.Location(document.uri, pos);
            }
          }
        }

        // 1.7 查找裸 /@NNN (纯数字) → QFunction-0.txt [@dlgbuttonclickNNN]
        const bareAtNumRegex = /\/@(\d+)/g;
        while ((match = bareAtNumRegex.exec(line)) !== null) {
          if (charPos >= match.index && charPos <= match.index + match[0].length) {
            const num = match[1];
            const wsRootB = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (wsRootB) {
              const qfPaths = [
                path.join(wsRootB, 'Mir200', 'Envir', 'Market_Def', 'QFunction-0.txt'),
                path.join(wsRootB, 'Envir', 'Market_Def', 'QFunction-0.txt')
              ];
              for (const qfp of qfPaths) {
                try {
                  if (fs.existsSync(qfp)) {
                    const qfDoc = await vscode.workspace.openTextDocument(vscode.Uri.file(qfp));
                    const qfText = qfDoc.getText();
                    const dlgRe = new RegExp(`\\[@dlgbuttonclick${escapeRegex(num)}\\]`, 'gi');
                    const dlm = dlgRe.exec(qfText);
                    if (dlm) {
                      return new vscode.Location(vscode.Uri.file(qfp), qfDoc.positionAt(dlm.index));
                    }
                  }
                } catch (e) {
                  console.warn('[BOO] 定义跳转文件查找失败:', e instanceof Error ? e.message : String(e));
                }
              }
            }
            return null;
          }
        }

        // 2. 查找 GOTO @label (同文件)
        for (const reference of scriptLabelReferences.filter(item => item.kind === 'goto')) {
          if (charPos >= reference.markerStart && charPos <= reference.end) {
            const label = reference.name;
            const allText = document.getText();
            const labelRegex = new RegExp(`\\[@${escapeRegex(label)}\\]`, 'g');
            const lm = labelRegex.exec(allText);
            if (lm) {
              const pos = document.positionAt(lm.index);
              return new vscode.Location(document.uri, pos);
            }
          }
        }

        // 3. 命令路径跳转: #CALL/#CALLEX → QuestDiary，#INCLUDE → Defines。
        const commandPathReference = findScriptCommandPathReferences(line)
          .find(reference => charPos >= reference.matchStart && charPos <= reference.matchEnd);
        if (commandPathReference) {
          const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
          const wsRoot = workspaceFolder?.uri.fsPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (!wsRoot) return null;
          const baseKind = commandPathReference.kind === 'scriptCall' ? 'questDiary' : 'defines';
          const resolution = resolveScriptPathReference(
            wsRoot,
            document.uri.fsPath,
            commandPathReference.path,
            baseKind
          );
          if (!resolution.existingPath) return null;
          if (commandPathReference.kind === 'scriptCall' && commandPathReference.label) {
            const location = await findLabelInFile(resolution.existingPath, commandPathReference.label);
            if (location) return location;
          }
          return new vscode.Location(vscode.Uri.file(resolution.existingPath), new vscode.Position(0, 0));
        }

        // 4. 路径引用跳转: 定义查询必须无副作用，Ctrl 悬停也会触发这里。
        const pathReference = findScriptPathReferenceAt(line, charPos);
        if (pathReference) {
          const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
          const wsRoot = workspaceFolder?.uri.fsPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (!wsRoot) return null;
          const resolution = resolveScriptPathReference(wsRoot, document.uri.fsPath, pathReference.path);
          if (resolution.existingPath) {
            return new vscode.Location(vscode.Uri.file(resolution.existingPath), new vscode.Position(0, 0));
          }
          return null;
        }

        // 5. merchant.txt NPC引用跳转: [目录\]文件名 → Market_Def\[目录\]文件名-地图名.txt
        if (/merchant\.txt$/i.test(document.fileName)) {
          const merchantLine = parseMerchantLine(line, position.line + 1);
          const scriptColumn = merchantLine?.columns[0];
          if (
            merchantLine
            && scriptColumn
            && charPos >= scriptColumn.start
            && charPos <= scriptColumn.end
          ) {
            const merchParts = merchantLine.npc.fields;
            const ref = merchantLine.npc.scriptRef;
            // 如果有路径分隔符 → dir=目录 file=文件名, 否则 dir=空 file=ref
            const sep = ref.includes('\\') ? '\\' : (ref.includes('/') ? '/' : '');
            const slashIdx = sep ? ref.lastIndexOf(sep) : -1;
            const dir = slashIdx >= 0 ? ref.substring(0, slashIdx) : '';
            const file = slashIdx >= 0 ? ref.substring(slashIdx + 1) : ref;
            // 文件命名: 文件名-地图名.txt (desc = 地图名去掉$前缀)
            const desc = merchParts.length > 1 ? merchParts[1].replace(/^\$/, '') : '';
            const wsRootM = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (wsRootM) {
              const bases = [path.join(wsRootM, 'Mir200', 'Envir', 'Market_Def'), path.join(wsRootM, 'Envir', 'Market_Def')];
              for (const base of bases) {
                for (const fname of [`${file}-${desc}.txt`, `${file}.txt`]) {
                  const mp = dir ? path.join(base, dir, fname) : path.join(base, fname);
                  try {
                    if (fs.existsSync(mp)) {
                      return new vscode.Location(vscode.Uri.file(mp), new vscode.Position(0, 0));
                    }
                  } catch (e) {
                    console.warn('[BOO] NPC脚本文件检查失败:', e instanceof Error ? e.message : String(e));
                  }
                }
              }
            }
          }
        }

        return null;
      }
    }
  );

  // 缺失路径通过文档链接命令创建；命令仅在 Ctrl+左键真正点击链接后执行。
  const scriptPathLinkProvider = vscode.languages.registerDocumentLinkProvider(
    [
      { language: 'gomscript', scheme: 'file' },
      { language: 'plaintext', scheme: 'file', pattern: '**/*.txt' }
    ],
    {
      provideDocumentLinks(document) {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
        const wsRoot = workspaceFolder?.uri.fsPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!wsRoot) return [];

        const links: vscode.DocumentLink[] = [];
        for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
          const line = document.lineAt(lineNumber).text;
          const commandReferences = findScriptCommandPathReferences(line);
          for (const reference of commandReferences) {
            const baseKind = reference.kind === 'scriptCall' ? 'questDiary' : 'defines';
            const resolution = resolveScriptPathReference(
              wsRoot,
              document.uri.fsPath,
              reference.path,
              baseKind
            );
            if (!resolution.existingPath && !resolution.createPath) continue;

            // 已存在的脚本调用交给 DefinitionProvider，以便准确跳到 @标签。
            if (reference.kind === 'scriptCall' && resolution.existingPath) continue;
            const range = new vscode.Range(lineNumber, reference.start, lineNumber, reference.end);
            if (resolution.existingPath) {
              const link = new vscode.DocumentLink(range, vscode.Uri.file(resolution.existingPath));
              link.tooltip = 'Ctrl+左键：打开引用文件';
              links.push(link);
              continue;
            }

            const argumentsJson = JSON.stringify([document.uri, reference.path, reference.kind]);
            const link = new vscode.DocumentLink(
              range,
              vscode.Uri.parse(`command:boo.createMissingFile?${encodeURIComponent(argumentsJson)}`)
            );
            link.tooltip = 'Ctrl+左键：文件不存在，可选择创建文本';
            links.push(link);
          }

          for (const reference of findScriptPathReferences(line)) {
            if (commandReferences.some(command => (
              reference.start >= command.start && reference.end <= command.end
            ))) continue;
            const resolution = resolveScriptPathReference(wsRoot, document.uri.fsPath, reference.path);
            if (!resolution.existingPath && !resolution.createPath) continue;

            const range = new vscode.Range(
              lineNumber,
              reference.start,
              lineNumber,
              reference.end
            );
            if (resolution.existingPath) {
              const link = new vscode.DocumentLink(range, vscode.Uri.file(resolution.existingPath));
              link.tooltip = 'Ctrl+左键：打开引用文件';
              links.push(link);
              continue;
            }

            const argumentsJson = JSON.stringify([document.uri, reference.path, 'pathReference']);
            const link = new vscode.DocumentLink(
              range,
              vscode.Uri.parse(`command:boo.createMissingFile?${encodeURIComponent(argumentsJson)}`)
            );
            link.tooltip = 'Ctrl+左键：文件不存在，可选择创建文本';
            links.push(link);
          }
        }
        return links;
      }
    }
  );

  // ---- 引用查找 ----
  const referenceProvider = vscode.languages.registerReferenceProvider(
    [
      { language: 'gomscript', scheme: 'file' },
      { language: 'plaintext', scheme: 'file', pattern: '**/*.txt' }
    ],
    {
      provideReferences(document, position, _context, _token) {
        const line = document.lineAt(position.line).text;
        // 判断是否在 [@xxx] 标签上
        const lb = line.indexOf('[@');
        const le = lb >= 0 ? line.indexOf(']', lb) : -1;
        let label: string | null = null;
        if (lb >= 0 && le > lb && position.character >= lb && position.character <= le) {
          label = line.substring(lb + 2, le);
        }
        // 判断是否在 N$/S$ 变量上
        const varMatch = line.match(/\b([NSLDnsld]\$[A-Za-z0-9_\u4e00-\u9fff]*|[Gg][Ll]\$[A-Za-z0-9_\u4e00-\u9fff]*|[PDMNSIGAUTJZpdmnigautjz]\d+)\b/g);
        if (!label && varMatch) {
          for (const vm of varMatch) {
            const mi = line.indexOf(vm);
            if (position.character >= mi && position.character <= mi + vm.length) {
              label = vm;
              break;
            }
          }
        }
        if (!label) return null;

        const allText = document.getText();
        const refs: vscode.Location[] = [];
        if (label.startsWith('N$') || label.startsWith('S$') || label.startsWith('D$') || label.startsWith('n$') || label.startsWith('s$') || label.startsWith('d$') || /^[PDMNSIGAUTJ]\d+$/i.test(label)) {
          // 变量引用：搜索文档中所有出现
          const escaped = escapeRegex(label);
          const varRe = new RegExp(`\\b${escaped}\\b`, 'g');
          let m;
          while ((m = varRe.exec(allText)) !== null) {
            refs.push(new vscode.Location(document.uri, document.positionAt(m.index)));
          }
        } else {
          // 标签引用：搜索 /@label、@label、GOTO @label
          const escaped = escapeRegex(label);
          const labelKey = normalizeScriptLabelKey(label);
          for (const reference of findScriptLabelReferencesInText(allText)) {
            if (normalizeScriptLabelKey(reference.name) === labelKey) {
              refs.push(new vscode.Location(document.uri, document.positionAt(reference.markerStart)));
            }
          }
          // 也包含定义本身
          const defRe = new RegExp(`\\[@${escaped}\\]`, 'g');
          let dm;
          while ((dm = defRe.exec(allText)) !== null) {
            refs.push(new vscode.Location(document.uri, document.positionAt(dm.index)));
          }
        }
        return refs.length > 0 ? refs : null;
      }
    }
  );

  // ---- 文档符号 (Outline) ----
  registerSymbolProvider(context);

  // ---- 代码折叠 ----
  registerFoldingProvider(context);

  // ---- CodeLens ----
  registerCodeLensProvider(context);

  // ---- 语义着色 ----
  // 类型: keyword(0) variable(1)
  // keyword.cmd 保留为检测命令，兼容用户已有的颜色设置。
  const MOD_CHECK = 1;  // 1 << 0
  const MOD_ACTION = 2; // 1 << 1
  const MOD_FLOW = 4;   // 1 << 2
  const MOD_LABEL = 8;  // 1 << 3
  const MOD_PATH = 16;  // 1 << 4
  const MOD_SAY = 32;   // 1 << 5
  const tokenLegend = new vscode.SemanticTokensLegend(
    ['keyword','variable'],
    ['cmd','action','flow','label','path','say']
  );

  let semanticCommandIndex = buildSemanticCommandIndex(languageIndex);
  const semanticRefreshEmitter = new vscode.EventEmitter<void>();
  function rebuildSemanticCommandIndex() {
    semanticCommandIndex = buildSemanticCommandIndex(languageIndex);
    semanticRefreshEmitter.fire();
  }
  rebuildSemanticCommandIndex();

  const semanticProvider = vscode.languages.registerDocumentSemanticTokensProvider(
    [
      { language: 'gomscript', scheme: 'file' },
      { language: 'plaintext', scheme: 'file', pattern: '**/*.txt' }
    ],
    {
      onDidChangeSemanticTokens: semanticRefreshEmitter.event,
      provideDocumentSemanticTokens(document) {
        const builder = new vscode.SemanticTokensBuilder(tokenLegend);
        const configuredMapCodes = configuredMapCodesForDocument(document);
        const lines: string[] = [];
        for (let li = 0; li < document.lineCount; li++) {
          lines.push(document.lineAt(li).text);
        }

        let commandContext: SemanticCommandKind = 'action';
        let inSayContext = false;
        const sayMarkupIndex = buildSayMarkupIndex(activeSayMarkupEntries(languageIndex.engine));
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // 跳过注释行 — ; 是BOO脚本注释符，本行不应再做语义着色
          if (isScriptCommentLine(line)) continue;
          const directive = line.trimStart().toUpperCase();
          if (/^#(?:IF|OR)\b/.test(directive)) {
            commandContext = 'check';
            inSayContext = false;
          }
          if (/^#(?:ACT|ELSEACT)\b/.test(directive)) {
            commandContext = 'action';
            inSayContext = false;
          }
          if (/^#(?:SAY|ELSESAY)\b/.test(directive)) {
            commandContext = 'action';
            inSayContext = true;
          }
          const len = line.length;
          const covered = new Array(len).fill(false);
          const mapCodeRanges = findMapCodeRangesInLine(
            line,
            document.fileName,
            configuredMapCodes,
            resolveIndexedCommandToken
          );

          function push(s: number, e: number, type: number, mod: number) {
            s = Math.max(0, s);
            e = Math.min(len, e);
            if (s >= e) return;
            for (let x = s; x < e; x++) { if (covered[x]) return; }
            for (let x = s; x < e; x++) covered[x] = true;
            try { builder.push(i, s, e - s, type, mod); } catch (e2) { console.warn('[BOO] 语义着色推送失败:', e2 instanceof Error ? e2.message : String(e2)); }
          }

          // 1. 标签 [@xxx] → 红色
          const lb = line.indexOf('[@');
          const le = lb >= 0 ? line.indexOf(']', lb) : -1;
          if (lb >= 0 && le > lb) push(lb, le + 1, 0, MOD_LABEL);

          const lt = line.indexOf('[~');
          const lte = lt >= 0 ? line.indexOf(']', lt) : -1;
          if (lt >= 0 && lte > lt) push(lt, lte + 1, 0, MOD_LABEL);

          // 2. @引用 /@xxx → 红色, 独立@xxx → 红色
          let ai = 0;
          while ((ai = line.indexOf('/@', ai)) !== -1) {
            const rest = line.substring(ai);
            const ae = rest.search(/[\s<>\)\]]/);
            const end = ae > 0 ? ai + ae : Math.min(ai + rest.length, len);
            push(ai, end, 0, MOD_LABEL);
            ai = end;
          }
          // 2b. 独立 @xxx 引用 (前面不是/和字母数字)
          const atRe = /(?<![\/A-Za-z0-9_])@[A-Za-z0-9_\u4e00-\u9fff]+/g;
          let atm;
          while ((atm = atRe.exec(line)) !== null) {
            if (!covered[atm.index]) {
              push(atm.index, atm.index + atm[0].length, 0, MOD_LABEL);
            }
            if (atRe.lastIndex >= len) break;
          }

          // 3. <$变量> → 绿色 (优先覆盖，防止命令误入)
          let vi = 0;
          while ((vi = line.indexOf('<', vi)) !== -1) {
            if (vi + 1 < len && line[vi + 1] === '$') {
              const ve = line.indexOf('>', vi);
              if (ve > vi) {
                // push 会自动设置 covered，这样 <$str(n$xxx)> 整体着色绿色
                push(vi, ve + 1, 1, 0);
                vi = ve + 1;
                continue;
              }
            }
            vi++;
          }

          // 4. 自定义变量 N$xxx S$xxx P0 等 → 绿色 (排除<$>内)
          const cvRe = /[NSLDnsld]\$[A-Za-z0-9_\u4e00-\u9fff]*|[Gg][Ll]\$[A-Za-z0-9_\u4e00-\u9fff]*|[PDMNSIGAUTJZpdmnigautjz]\d+/g;
          let cvm;
          while ((cvm = cvRe.exec(line)) !== null) {
            // 跳过已覆盖区域
            if (!covered[cvm.index] && !isOffsetInTextRanges(cvm.index, mapCodeRanges)) {
              push(cvm.index, cvm.index + cvm[0].length, 1, 0);
            }
            if (cvRe.lastIndex >= len) break;
          }

          // 5. 路径 → 橙色 (支持有/无文件后缀)
          const pathRe = /(?:\.\.|\.?[a-zA-Z]:)?[\\\/][A-Za-z0-9_\u4e00-\u9fff\\\/.]+/g;
          let pm;
          while ((pm = pathRe.exec(line)) !== null) {
            const m = pm[0];
            if (m.length >= 3 && !covered[pm.index]) {
              push(pm.index, pm.index + m.length, 0, MOD_PATH);
            }
            if (pm.index + m.length >= len) break;
          }

          // 6. #SAY 界面指令。只使用当前引擎已收录的静态语言目录。
          if (inSayContext) {
            for (const markup of findSayMarkupTokens(line, sayMarkupIndex)) {
              push(markup.start, markup.end, 0, MOD_SAY);
            }
          }

          // 7. 命令和关键字。候选扫描保留 M./H./FS. 等对象前缀。
          for (const candidate of findCommandCandidates(line)) {
            if (covered[candidate.start]) continue;
            const word = candidate.name;
            const wu = word.toUpperCase();

            if (wu === 'CALL') {
              const hashIdx = line.lastIndexOf('#', candidate.start);
              if (hashIdx >= 0) push(hashIdx, Math.min(candidate.end, len), 0, MOD_FLOW);
            } else if (/^(IF|ACT|SAY|ELSEACT|ELSESAY|INCLUDE|OR)$/i.test(word)) {
              const hashIdx = line.lastIndexOf('#', candidate.start);
              if (hashIdx >= 0) push(hashIdx, Math.min(candidate.end, len), 0, MOD_FLOW);
            } else {
              const commandKind = classifySemanticCommand(
                semanticCommandIndex,
                word,
                commandContext
              );
              if (commandKind === 'check') {
                push(candidate.start, candidate.end, 0, MOD_CHECK);
              } else if (commandKind === 'action') {
                push(candidate.start, candidate.end, 0, MOD_ACTION);
              }
            }
          }
        }
        return builder.build();
      }
    },
    tokenLegend
  );
  context.subscriptions.push(semanticRefreshEmitter);

  context.subscriptions.push(
    completionProvider,
    hoverProvider,
    definitionProvider,
    scriptPathLinkProvider,
    referenceProvider,
    semanticProvider
  );

  // ---- 内联颜色装饰器 (fcolor显示实际颜色) ----
  registerFColorDecorator(context);
  // ---- merchant.txt 表格列分隔 + 表头 ----
  registerMerchantTableDecorator(context);

  // ---- 脚本诊断 - GPTea ----
  const diagnosticCollection = vscode.languages.createDiagnosticCollection('booScript');
  context.subscriptions.push(diagnosticCollection);

  // 诊断逻辑：输入行数组，输出诊断列表 (不依赖 TextDocument)
  function computeDiagnostics(lines: string[], docUri?: vscode.Uri): vscode.Diagnostic[] {
    const diagnostics: vscode.Diagnostic[] = [];
    const isComment = isScriptCommentLine;
    const engineLanguageVerified = getEngineDefinition(
      languageIndex.engine
    ).languageCatalogVerified;

    // 1. 收集所有 [@xxx] 标签定义
    const labelDefinitions = findScriptLabelDefinitions(lines);
    const definedLabels = new Set(labelDefinitions.map(definition => definition.key));
    for (let i = 0; i < lines.length; i++) {
      if (isComment(lines[i])) continue;
      // 检查未闭合的 [@
      if (/\[@[^\]]*$/.test(lines[i]) && !/\[@[^\]]+\]/.test(lines[i])) {
        const range = new vscode.Range(i, 0, i, lines[i].length);
        diagnostics.push(new vscode.Diagnostic(range, '标签未闭合: 缺少 ]', vscode.DiagnosticSeverity.Error));
      }
    }

    // 2. 检查引用不存在的标签。特殊字符属于标签名，只有结构定界符才结束标签。
    const workspaceRoot = docUri
      ? vscode.workspace.getWorkspaceFolder(docUri)?.uri.fsPath
        || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
      : undefined;
    const hostLabelKeys = docUri && workspaceRoot
      ? findHostScriptLabelKeys(workspaceRoot, docUri.fsPath)
      : new Set<string>();
    for (const reference of findUndefinedScriptLabelReferences(lines, definedLabels, {
      engine: languageIndex.engine,
      additionalDefinedLabelKeys: hostLabelKeys,
      skipSectionedDataDocuments: true,
      isAdditionalDefinedLabel: isCurrentEngineDefaultScriptLabel,
    })) {
      const range = new vscode.Range(reference.line, reference.markerStart, reference.line, reference.end);
      diagnostics.push(new vscode.Diagnostic(range,
        `引用了未定义的标签 @${reference.name}`, vscode.DiagnosticSeverity.Warning));
    }

    // 2.5 检查动态引用 <$XXX(content)> 中的 content 是否为有效变量
    // 如 <$STR(活动要求)> 缺少 N$/S$ 或 G/A/T/U/J/Z/P/D/M/I 等变量前缀, 视为错误
    if (engineLanguageVerified) {
      for (const reference of findInvalidDynamicReferences(lines)) {
        const range = new vscode.Range(
          reference.line,
          reference.start,
          reference.line,
          reference.end
        );
        diagnostics.push(new vscode.Diagnostic(
          range,
          `动态引用缺少有效变量: ${reference.text}`,
          vscode.DiagnosticSeverity.Warning
        ));
      }
    }

    // 3. 检查重复标签定义
    const seenLabels = new Map<string, typeof labelDefinitions>();
    for (const definition of labelDefinitions) {
      const definitions = seenLabels.get(definition.key) || [];
      definitions.push(definition);
      seenLabels.set(definition.key, definitions);
    }
    for (const [name, definitions] of seenLabels) {
      if (definitions.length > 1) {
        for (const definition of definitions.slice(1)) {
          const range = new vscode.Range(
            definition.line,
            definition.start,
            definition.line,
            definition.end
          );
          diagnostics.push(new vscode.Diagnostic(range,
            `标签 [@${name}] 重复定义 (首次在第${definitions[0].line + 1}行)`, vscode.DiagnosticSeverity.Information));
        }
      }
    }

    // 4. 检查 #IF/#OR 后面缺少合法块 (#ACT/#ELSEACT/#SAY/#ELSESAY)
    for (let i = 0; i < lines.length; i++) {
      if (isComment(lines[i])) continue;
      const up = lines[i].trim().toUpperCase();
      if (up.startsWith('#IF(') || up.startsWith('#IF ') || up === '#IF' || up.startsWith('#OR')) {
        let hasBlock = false;
        for (let j = i + 1; j < Math.min(i + 101, lines.length); j++) {
          const uj = lines[j].trim().toUpperCase();
          if (uj.startsWith('#ACT') || uj.startsWith('#ELSEACT') || uj.startsWith('#SAY') || uj.startsWith('#ELSESAY')) { hasBlock = true; break; }
          if (uj.startsWith('#IF(') || uj.startsWith('#IF ') || uj === '#IF' || uj.startsWith('#OR') || uj.startsWith('[@')) break;
        }
        if (!hasBlock) {
          const range = new vscode.Range(i, 0, i, lines[i].length);
          diagnostics.push(new vscode.Diagnostic(range,
            '#IF块缺少对应的#ACT/#ELSEACT/#SAY/#ELSESAY', vscode.DiagnosticSeverity.Warning));
        }
      }
    }

    // 5. 检查 #CALL/#CALLEX 文件与标签。调用方已按原文件编码解码。
    if (docUri) {
      const wsFolders2 = vscode.workspace.workspaceFolders;
      if (wsFolders2 && wsFolders2.length > 0) {
        const wsRoot2 = wsFolders2[0].uri.fsPath;
        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
          if (isComment(lines[lineNum])) continue;
          const callReferences = findScriptCommandPathReferences(lines[lineNum])
            .filter(reference => reference.kind === 'scriptCall');
          for (const reference of callReferences) {
            const resolution = resolveScriptPathReference(
              wsRoot2,
              docUri.fsPath,
              reference.path,
              'questDiary'
            );
            const range = new vscode.Range(
              lineNum,
              reference.matchStart,
              lineNum,
              reference.matchEnd
            );
            if (!resolution.existingPath) {
              diagnostics.push(new vscode.Diagnostic(
                range,
                `${reference.directive}引用的文件可能不存在: ${reference.path}`,
                vscode.DiagnosticSeverity.Information
              ));
              continue;
            }
            if (!reference.label) continue;
            try {
              const targetText = decodeTextFile(fs.readFileSync(resolution.existingPath)).text;
              const labelRe = new RegExp(`\\[@${escapeRegex(reference.label)}\\]`, 'i');
              if (!labelRe.test(targetText)) {
                diagnostics.push(new vscode.Diagnostic(
                  range,
                  `${reference.directive}引用的标签不存在: ${resolution.existingPath} 中缺少 [@${reference.label}]`,
                  vscode.DiagnosticSeverity.Warning
                ));
              }
            } catch (e) {
              console.warn('[BOO] 脚本调用标签检查失败:', e instanceof Error ? e.message : String(e));
            }
          }
        }
      }
    }

    // 6. 检查 <$human(*)> <$GUILD(*)> 声明存在性（跨文件声明检测）
    if (engineLanguageVerified) {
      const humanRe = /<\$human\(([^)]+)\)>/gi;
      const guildRe = /<\$GUILD\(([^)]+)\)>/gi;
      for (let i = 0; i < lines.length; i++) {
        if (isComment(lines[i])) continue;
        let hm; while ((hm = humanRe.exec(lines[i])) !== null) {
          if (!_humanDecls.has(hm[1].trim().toUpperCase())) {
            diagnostics.push(new vscode.Diagnostic(new vscode.Range(i, hm.index, i, hm.index + hm[0].length), `HUMAN变量未声明: ${hm[1]}(需 VAR Integer HUMAN ${hm[1]})`, vscode.DiagnosticSeverity.Warning));
          }
        }
        let gm; while ((gm = guildRe.exec(lines[i])) !== null) {
          if (!_guildDecls.has(gm[1].trim().toUpperCase())) {
            diagnostics.push(new vscode.Diagnostic(new vscode.Range(i, gm.index, i, gm.index + gm[0].length), `GUILD变量未声明: ${gm[1]}(需 VAR Integer GUILD ${gm[1]})`, vscode.DiagnosticSeverity.Warning));
          }
        }
      }
    }

    // 7. 检查 merchant.txt NPC引用文件存在性 (仅merchant.txt本身触发)
    if (docUri && /merchant\.txt$/i.test(docUri.fsPath)) {
      const wsRoot3 = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (wsRoot3) {
        const marketDefDir = path.join(wsRoot3, 'Mir200', 'Envir', 'Market_Def');
        const altMarketDir = path.join(wsRoot3, 'Envir', 'Market_Def');
        // merchant.txt格式: 脚本路径/文件名 地图名 X Y NPC显示名 0 外观编号 0 0 0 ...
        for (let i = 0; i < lines.length; i++) {
          if (isComment(lines[i]) || !lines[i].trim()) continue;
          const parts = lines[i].trim().split(/\s+/);
          if (parts.length < 3) continue;
          const ref = parts[0]; // 如: 0新手接待/开始游戏 或 0新手接待/开始游戏
          // 文件名-地图名.txt, 动态地图$前缀需去掉
          const mapName = parts.length > 1 ? parts[1].replace(/^\$/, '') : '';
          const descPart = mapName || '';
          const refParts = ref.split(/[\/\\]/);
          // 无分隔符=根目录; 有分隔符=最后一段文件名,前面是目录 (支持多层嵌套)
          const fileName2 = refParts[refParts.length - 1];
          const dir2 = refParts.length > 1 ? refParts.slice(0, -1).join('\\') : '';
          const descSuffix = descPart ? '-' + descPart : '';
          const targetName = fileName2 + descSuffix + '.txt';
          let found = false;
          for (const base of [marketDefDir, altMarketDir]) {
            try {
              const fullPath = dir2 ? path.join(base, dir2, targetName) : path.join(base, targetName);
              if (fs.existsSync(fullPath)) { found = true; break; }
              const altPath = dir2 ? path.join(base, dir2, fileName2 + '.txt') : path.join(base, fileName2 + '.txt');
              if (fs.existsSync(altPath)) { found = true; break; }
            } catch (e) {
              console.warn('[BOO] 诊断文件检查失败:', e instanceof Error ? e.message : String(e));
            }
          }
          if (!found) {
            const range = new vscode.Range(i, 0, i, ref.length);
            diagnostics.push(new vscode.Diagnostic(range,
              `merchant.txt引用的NPC脚本可能不存在: ${dir2}/${targetName}`, vscode.DiagnosticSeverity.Warning));
          }
        }
      }
    }

    return diagnostics;
  }

  const diagnosticTimeouts = new Map<string, NodeJS.Timeout>();
  const MAX_DIAG_LINES = 10000;
  let workspaceAuditVersion = 0;

  function isEnvirTextDocument(document: vscode.TextDocument): boolean {
    return (document.languageId === 'gomscript' || /\.txt$/i.test(document.fileName))
      && /[\/\\]Envir[\/\\]/i.test(document.fileName);
  }

  function diagnosticsForLines(
    allLines: string[],
    uri: vscode.Uri
  ): vscode.Diagnostic[] {
    const linesToCheck = allLines.length > MAX_DIAG_LINES
      ? allLines.slice(0, MAX_DIAG_LINES)
      : allLines;
    const diagnostics = computeDiagnostics(linesToCheck, uri);
    if (allLines.length > MAX_DIAG_LINES) {
      diagnostics.push(new vscode.Diagnostic(
        new vscode.Range(MAX_DIAG_LINES, 0, MAX_DIAG_LINES, 0),
        `文件较大(${allLines.length}行)，仅诊断前${MAX_DIAG_LINES}行`,
        vscode.DiagnosticSeverity.Information
      ));
    }
    return diagnostics;
  }

  function diagnoseDocumentNow(document: vscode.TextDocument): void {
    if (!vscode.workspace.getConfiguration('boo').get('enableDiagnostics', true)) {
      diagnosticCollection.delete(document.uri);
      return;
    }
    if (!isEnvirTextDocument(document)) return;
    const allLines: string[] = [];
    for (let index = 0; index < document.lineCount; index++) {
      allLines.push(document.lineAt(index).text);
    }
    diagnosticCollection.set(document.uri, diagnosticsForLines(allLines, document.uri));
  }

  function updateDiagnostics(document: vscode.TextDocument): void {
    if (!vscode.workspace.getConfiguration('boo').get('enableDiagnostics', true)) {
      diagnosticCollection.delete(document.uri);
      return;
    }
    if (!isEnvirTextDocument(document)) return;
    const timeoutKey = document.uri.toString();
    const existingTimeout = diagnosticTimeouts.get(timeoutKey);
    if (existingTimeout) clearTimeout(existingTimeout);
    diagnosticTimeouts.set(timeoutKey, setTimeout(() => {
      diagnosticTimeouts.delete(timeoutKey);
      diagnoseDocumentNow(document);
    }, 500));
  }

  async function diagnoseFileFromDisk(file: vscode.Uri): Promise<number> {
    try {
      const raw = await vscode.workspace.fs.readFile(file);
      const text = decodeTextFile(Buffer.from(raw)).text;
      const diagnostics = diagnosticsForLines(text.split(/\r?\n/), file);
      diagnosticCollection.set(file, diagnostics);
      return diagnostics.length;
    } catch (error) {
      diagnosticCollection.delete(file);
      console.warn('[BOO] 代码审查文件读取失败:', error instanceof Error ? error.message : String(error));
      return 0;
    }
  }

  async function findWorkspaceAuditFiles(): Promise<vscode.Uri[]> {
    const groups = await Promise.all(
      workspaceScriptAuditGlobs().map(glob => (
        vscode.workspace.findFiles(glob, '**/node_modules/**')
      ))
    );
    const files = new Map<string, vscode.Uri>();
    for (const file of groups.flat()) {
      if (isWorkspaceScriptAuditPath(file.fsPath)) files.set(file.toString(), file);
    }
    return [...files.values()].sort((left, right) => (
      left.fsPath.localeCompare(right.fsPath, 'zh-CN', { numeric: true, sensitivity: 'base' })
    ));
  }

  // 并发池辅助函数
  async function runConcurrent<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
    let idx = 0;
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (idx < items.length) {
        const i = idx++;
        await fn(items[i]);
      }
    });
    await Promise.all(workers);
  }

  async function diagnoseWorkspaceScriptFiles(showProgress: boolean): Promise<void> {
    const wsFolders = vscode.workspace.workspaceFolders;
    if (!wsFolders || wsFolders.length === 0) {
      if (showProgress) vscode.window.showWarningMessage('未打开工作区');
      return;
    }
    if (!vscode.workspace.getConfiguration('boo').get('enableDiagnostics', true)) {
      diagnosticCollection.clear();
      return;
    }
    const version = ++workspaceAuditVersion;
    const execute = async (
      progress?: vscode.Progress<{ increment?: number; message?: string }>,
      token?: vscode.CancellationToken
    ): Promise<void> => {
      const files = await findWorkspaceAuditFiles();
      const total = files.length;
      let done = 0;
      let issuesCount = 0;
      await runConcurrent(files, 8, async (file) => {
        if (token?.isCancellationRequested || version !== workspaceAuditVersion) return;
        const fileIssues = await diagnoseFileFromDisk(file);
        issuesCount += fileIssues;
        done++;
        progress?.report({ increment: 100 / Math.max(1, total), message: `${done}/${total}` });
      });
      if (token?.isCancellationRequested || version !== workspaceAuditVersion) return;
      const fileSet = new Set(files.map(f => f.toString()));
      diagnosticCollection.forEach((uri) => {
        if (isWorkspaceScriptAuditPath(uri.fsPath) && !fileSet.has(uri.toString())) {
          diagnosticCollection.delete(uri);
        }
      });
      if (showProgress) {
        vscode.window.showInformationMessage(
          `BOO审查完成：${done} 个文件, 发现 ${issuesCount} 个问题`
        );
      }
    };
    if (!showProgress) {
      await execute();
      return;
    }
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'BOO 代码审查',
      cancellable: true,
    }, (progress, token) => execute(progress, token));
  }

  async function diagnoseAllFiles(): Promise<void> {
    await diagnoseWorkspaceScriptFiles(true);
  }

  // ---- 全工作区变量统计 - GPTea ----
  function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] ?? c));
  }

  function reportVariableCategory(name: string): string | undefined {
    const numeric = /^([PDMNSIGAUTJZ])\d+$/i.exec(name);
    if (numeric) return numeric[1].toUpperCase() + '类变量';
    if (/^GL\$/i.test(name)) return 'GL$ 全局列表';
    const custom = /^([NSLD])\$/i.exec(name);
    if (custom) return custom[1].toUpperCase() + '$ 自定义变量';
    return undefined;
  }

  function sidebarVariableType(name: string): string {
    return compactVariableTypeLabel(name);
  }

  function maskScriptCommentLines(text: string): string {
    return text.replace(/^[ \t]*;[^\r\n]*/gm, line => ' '.repeat(line.length));
  }

  function getLineOffsets(text: string, lines: readonly string[]): number[] {
    const offsets: number[] = [];
    let offset = 0;
    for (const line of lines) {
      offsets.push(offset);
      offset += line.length;
      if (text[offset] === '\r' && text[offset + 1] === '\n') offset += 2;
      else if (text[offset] === '\n' || text[offset] === '\r') offset++;
    }
    return offsets;
  }

  type IniSections = Map<string, Map<string, string[]>>;
  const nestedConfigCache = new Map<string, { stamp: string; sections: IniSections }>();
  const nestedTableCache = new Map<string, {
    stamp: string;
    result: NestedTableDataResult | undefined;
  }>();
  const nestedListCache = new Map<string, {
    stamp: string;
    result: NestedListDataResult | undefined;
  }>();

  function resolveNestedConfigValues(
    sourceFile: string,
    request: NestedConfigValueRequest,
  ): NestedConfigValueResult | undefined {
    if (!request.path || /<\$/i.test(request.path)) return undefined;
    const envirRoot = findAncestorDirectory(sourceFile, 'Envir');
    if (!envirRoot) return undefined;
    const relativePath = request.path.replace(/^['"]|['"]$/g, '');
    const withoutParentPrefix = relativePath.replace(/^(?:\.\.[\\/])+/, '');
    const candidates = [
      path.resolve(path.dirname(sourceFile), relativePath),
      path.resolve(envirRoot, 'Market_Def', relativePath),
      path.resolve(envirRoot, relativePath),
      path.resolve(envirRoot, withoutParentPrefix),
    ];
    const configPath = candidates.find(candidate => {
      try { return fs.statSync(candidate).isFile(); } catch { return false; }
    });
    if (!configPath) return undefined;

    let stat: fs.Stats;
    try { stat = fs.statSync(configPath); } catch { return undefined; }
    const stamp = `${stat.size}:${stat.mtimeMs}`;
    let cached = nestedConfigCache.get(configPath);
    if (!cached || cached.stamp !== stamp) {
      try {
        cached = { stamp, sections: parseIniSections(readFileGBK(fs.readFileSync(configPath))) };
        nestedConfigCache.set(configPath, cached);
      } catch {
        return undefined;
      }
    }

    const dynamicSection = /<\$/i.test(request.section);
    const dynamicKey = /<\$/i.test(request.key);
    const sections = dynamicSection
      ? [...cached.sections.values()]
      : [cached.sections.get(
        request.section.replace(/^['"]|['"]$/g, '').trim().toUpperCase(),
      )].filter((section): section is Map<string, string[]> => section !== undefined);
    if (sections.length === 0) return undefined;
    if (dynamicKey) {
      const values = sections.flatMap(section => [...section.values()].flat());
      return values.length > 0 ? { values, complete: true } : undefined;
    }
    const key = request.key.replace(/^['"]|['"]$/g, '').trim().toUpperCase();
    const values = sections.flatMap(section => section.get(key) || []);
    return values && values.length > 0 ? { values, complete: true } : undefined;
  }

  function resolveNestedTableData(
    sourceFile: string,
    request: NestedTableDataRequest,
  ): NestedTableDataResult | undefined {
    if (!request.path || /<\$/i.test(request.path)) return undefined;
    const tablePath = resolveNestedDataFile(sourceFile, request.path);
    if (!tablePath) return undefined;

    let stat: fs.Stats;
    try { stat = fs.statSync(tablePath); } catch { return undefined; }
    const stamp = `${stat.size}:${stat.mtimeMs}`;
    const cacheKey = `${request.format}:${tablePath}`;
    const cached = nestedTableCache.get(cacheKey);
    if (cached?.stamp === stamp) return cached.result;

    let result: NestedTableDataResult | undefined;
    try {
      const raw = fs.readFileSync(tablePath);
      if (!isBinarySpreadsheet(raw)) {
        result = {
          rows: parseScriptTableData(decodeTextFile(raw).text, request.format),
          complete: true,
        };
      }
    } catch {
      result = undefined;
    }
    nestedTableCache.set(cacheKey, { stamp, result });
    return result;
  }

  function resolveNestedListData(
    sourceFile: string,
    request: NestedListDataRequest,
  ): NestedListDataResult | undefined {
    if (!request.path || /<\$/i.test(request.path)) return undefined;
    const listPath = resolveNestedDataFile(sourceFile, request.path);
    if (!listPath) return undefined;

    let stat: fs.Stats;
    try { stat = fs.statSync(listPath); } catch { return undefined; }
    const stamp = `${stat.size}:${stat.mtimeMs}`;
    const cached = nestedListCache.get(listPath);
    if (cached?.stamp === stamp) return cached.result;

    let result: NestedListDataResult | undefined;
    try {
      result = {
        lines: decodeTextFile(fs.readFileSync(listPath)).text.split(/\r\n|\n|\r/),
        complete: true,
      };
    } catch {
      result = undefined;
    }
    nestedListCache.set(listPath, { stamp, result });
    return result;
  }

  function resolveNestedDataFile(sourceFile: string, rawPath: string): string | undefined {
    const envirRoot = findAncestorDirectory(sourceFile, 'Envir');
    if (!envirRoot) return undefined;
    const relativePath = rawPath.replace(/^['"]|['"]$/g, '');
    const withoutParentPrefix = relativePath.replace(/^(?:\.\.[\\/])+/, '');
    const candidates = [
      path.resolve(path.dirname(sourceFile), relativePath),
      path.resolve(envirRoot, 'Market_Def', relativePath),
      path.resolve(envirRoot, relativePath),
      path.resolve(envirRoot, withoutParentPrefix),
    ];
    return candidates.find(candidate => {
      try { return fs.statSync(candidate).isFile(); } catch { return false; }
    });
  }

  function findAncestorDirectory(filePath: string, directoryName: string): string | undefined {
    let current = path.dirname(filePath);
    while (true) {
      if (path.basename(current).toUpperCase() === directoryName.toUpperCase()) return current;
      const parent = path.dirname(current);
      if (parent === current) return undefined;
      current = parent;
    }
  }

  function parseIniSections(text: string): IniSections {
    const sections: IniSections = new Map();
    let current: Map<string, string[]> | undefined;
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || isScriptCommentLine(line)) continue;
      const section = /^\[([^\]]+)\]$/.exec(line);
      if (section) {
        const name = section[1].trim().toUpperCase();
        current = sections.get(name) || new Map<string, string[]>();
        sections.set(name, current);
        continue;
      }
      if (!current) continue;
      const separator = line.indexOf('=');
      if (separator <= 0) continue;
      const key = line.slice(0, separator).trim().toUpperCase();
      const values = current.get(key) || [];
      values.push(line.slice(separator + 1).trim());
      current.set(key, values);
    }
    return sections;
  }

  async function analyzeVariables() {
    const wsFolders = vscode.workspace.workspaceFolders;
    if (!wsFolders || wsFolders.length === 0) {
      vscode.window.showWarningMessage('未打开工作区');
      return;
    }

    return vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'BOO 变量统计',
      cancellable: true
    }, async (progress, token) => {
      const files = await vscode.workspace.findFiles('**/*.txt', '**/node_modules/**');
      const total = files.length;
      let done = 0;

      // 按类别聚合: 类别名 -> { 变量名 -> { count: 使用次数, files: Set<文件路径> } }
      type VarInfo = { count: number; files: Set<string> };
      const categories: Map<string, Map<string, VarInfo>> = new Map();

      function addVar(cat: string, name: string, filePath: string) {
        if (!categories.has(cat)) categories.set(cat, new Map());
        const catMap = categories.get(cat)!;
        recordVariableUsage(catMap, name, filePath, () => ({
          count: 0,
          files: new Set<string>(),
        }));
      }

      // 已知命令关键字 (避免单字母+数字误匹配)
      const cmdKeywords = new Set<string>([
        'ACT','BREAK','CALL','CHECK','CLOSE','DEC','DIV','ELSEACT','ELSESAY',
        'GIVE','GOTO','INC','MAPMOVE','MOV','MUL','OR','SENDMSG','TAKE'
      ]);

      for (const file of files) {
        if (token.isCancellationRequested) break;
        done++;
        progress.report({ increment: 100 / total, message: `${done}/${total}` });

        try {
          const raw = await vscode.workspace.fs.readFile(file);
          const text = readFileGBK(raw);
          const activeText = maskScriptCommentLines(text);
          const fp = file.fsPath;
          const mapCodeRanges = findMapCodeRangesInText(
            activeText,
            fp,
            configuredMapCodesForFile(fp),
            resolveIndexedCommandToken
          );
          const nested = analyzeNestedVariables(text, {
            resolveConfigValues: request => resolveNestedConfigValues(fp, request),
            resolveTableData: request => resolveNestedTableData(fp, request),
            resolveListData: request => resolveNestedListData(fp, request),
          });

          for (const reference of nested.references) {
            for (const variable of reference.variables) {
              const category = reportVariableCategory(variable);
              if (category) addVar(category, variable, fp);
            }
            if (reference.status !== 'resolved') {
              const category = reference.status === 'partial'
                ? '嵌套变量（部分推导）'
                : '嵌套变量（运行时确定）';
              addVar(category, normalizeNestedVariableReference(reference), fp);
            }
          }

          for (const reference of nested.personalFlags) {
            for (const flag of reference.flags) {
              addVar('个人标识 [1-1024]', flag, fp);
            }
            if (reference.status !== 'resolved') {
              const category = reference.status === 'partial'
                ? '个人标识（部分推导）'
                : '个人标识（运行时确定）';
              addVar(category, normalizePersonalFlagReference(reference), fp);
            }
          }

          // (a) 数字型变量 A/G/U/T (0-499: 1-3位数字)
          let m;
          const reAGUT = /\b([AGUT])(\d{1,3})\b/gi;
          while ((m = reAGUT.exec(activeText)) !== null) {
            if (isNestedVariableBaseOffset(m.index, nested.references)) continue;
            if (isOffsetInTextRanges(m.index, mapCodeRanges)) continue;
            const prefix = m[1].toUpperCase();
            const varName = prefix + m[2];
            if (!cmdKeywords.has(varName.toUpperCase())) {
              const num = parseInt(m[2], 10);
              if (num <= 499) addVar(prefix + '类变量', varName, fp);
            }
          }

          // (a2) 数字型变量 P/D/M/N/S/I (0-99: 1-2位数字)
          const rePDMNIS = /\b([PDMNIS])(\d{1,2})\b/gi;
          while ((m = rePDMNIS.exec(activeText)) !== null) {
            if (isNestedVariableBaseOffset(m.index, nested.references)) continue;
            if (isOffsetInTextRanges(m.index, mapCodeRanges)) continue;
            const prefix = m[1].toUpperCase();
            const varName = prefix + m[2];
            if (!cmdKeywords.has(varName.toUpperCase())) {
              const num = parseInt(m[2], 10);
              if (num <= 99) addVar(prefix + '类变量', varName, fp);
            }
          }

          // (a3) J/Z 字符串变量
          const reJZ = /\b([JZ])(\d+)\b/gi;
          while ((m = reJZ.exec(activeText)) !== null) {
            if (isNestedVariableBaseOffset(m.index, nested.references)) continue;
            if (isOffsetInTextRanges(m.index, mapCodeRanges)) continue;
            const prefix = m[1].toUpperCase();
            const varName = prefix + m[2];
            addVar(prefix + '类变量', varName, fp);
          }

          // (b) 自定义变量 N$xxx / S$xxx (支持中文变量名) - GPTea -
          const reNS = /([NSLDnsld])\$([\w\u4e00-\u9fff]+)|([Gg][Ll])\$([\w\u4e00-\u9fff]+)/g;
          while ((m = reNS.exec(activeText)) !== null) {
            if (isNestedVariableBaseOffset(m.index, nested.references)) continue;
            if (m[3]) { addVar('GL$ 全局列表', m[3].toUpperCase() + '$' + m[4], fp); continue; }
            const prefix = m[1].toUpperCase();
            const varName = prefix + '$' + m[2];
            addVar(prefix + '$ 自定义变量', varName, fp);
          }

        } catch (e) {
          console.warn('[BOO] 变量统计文件读取失败:', e instanceof Error ? e.message : String(e));
        }
      }

      if (token.isCancellationRequested) return;

      // ---- 构建 Webview HTML ----
      let html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#1e1e1e;color:#d4d4d4;font-family:'Microsoft YaHei',monospace;padding:16px}
h1{color:#ff8c00;font-size:18px;border-bottom:2px solid #444;padding-bottom:8px;margin-bottom:10px}
h2{color:#4ec9b0;font-size:15px;margin:20px 0 8px;border-left:4px solid #4ec9b0;padding-left:10px}
.summary{color:#aaa;font-size:13px;margin-bottom:12px}
table{border-collapse:collapse;width:100%;margin-bottom:16px;font-size:13px}
th{background:#333;color:#ff8c00;padding:6px 10px;text-align:left;position:sticky;top:0;z-index:1}
td{padding:5px 10px;border-bottom:1px solid #333}
tr:hover{background:#2a2a2a}
.col-name{color:#9cdcfe;font-weight:bold;width:140px}
.col-count{color:#b5cea8;width:80px;text-align:center}
.col-files{color:#aaa;max-width:500px;word-break:break-all}
.no-data{color:#666;font-style:italic;padding:10px}
</style>
</head>
<body>
<h1>BOO 变量统计报告</h1>
<div class="summary">扫描文件: ${done} 个 &nbsp;|&nbsp; 变量种类: <span id="totalTypes">-</span></div>`;

      const catOrder = [
        'A类变量', 'G类变量', 'U类变量', 'T类变量',
        'J类变量', 'Z类变量',
        'P类变量', 'D类变量', 'M类变量', 'N类变量', 'S类变量', 'I类变量',
        'N$ 自定义变量', 'S$ 自定义变量', 'D$ 自定义变量', 'L$ 自定义变量',
        'GL$ 全局列表', '个人标识 [1-1024]',
        '个人标识（部分推导）', '个人标识（运行时确定）',
        '嵌套变量（部分推导）', '嵌套变量（运行时确定）'
      ];

      let totalTypes = 0;
      for (const cat of catOrder) {
        const catMap = categories.get(cat);
        if (!catMap || catMap.size === 0) continue;
        totalTypes++;

        // 按变量名排序: 数字型按数值排序, 自定义按字母排序
        const entries = [...catMap.entries()];
        entries.sort((a, b) => {
          const aNum = /^(?:[A-Z](\d+)|\[(\d+)\])/.exec(a[0]);
          const bNum = /^(?:[A-Z](\d+)|\[(\d+)\])/.exec(b[0]);
          if (aNum && bNum) {
            const an = parseInt(aNum[1] || aNum[2], 10);
            const bn = parseInt(bNum[1] || bNum[2], 10);
            if (an !== bn) return an - bn;
          }
          return a[0].localeCompare(b[0]);
        });

        html += `<h2>${escapeHtml(cat)} (${entries.length} 个)</h2>`;
        html += '<table><tr><th>变量名</th><th>使用次数</th><th>涉及文件</th></tr>';
        for (const [name, info] of entries) {
          const fileList = [...info.files].map(f => {
            const idx = f.lastIndexOf('\\');
            return idx >= 0 ? f.substring(idx + 1) : f;
          }).join(', ');
          html += `<tr><td class="col-name">${escapeHtml(name)}</td><td class="col-count">${info.count}</td><td class="col-files">${escapeHtml(fileList)}</td></tr>`;
        }
        html += '</table>';
      }

      if (totalTypes === 0) {
        html += '<p class="no-data">未发现变量引用</p>';
      }

      html += `<script>document.getElementById('totalTypes').textContent='${totalTypes}'</script>`;
      html += '</body></html>';

      const panel = vscode.window.createWebviewPanel(
        'booVarStats', 'BOO 变量统计', vscode.ViewColumn.Active,
        { enableScripts: false, retainContextWhenHidden: true }
      );
      panel.webview.html = secureWebviewHtml(
        panel.webview,
        html,
        { enableScripts: false }
      );
    });
  }

  // 监听文档变化
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(event => {
      blockCache.invalidate();
      if (/^mapinfo(?:\.txt)?$/i.test(path.basename(event.document.fileName))) {
        mapCodeCache.clear();
        semanticRefreshEmitter.fire();
      }
      updateDiagnostics(event.document);
    })
  );
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(doc => updateDiagnostics(doc))
  );
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(doc => {
      if (!isEnvirTextDocument(doc)) return;
      const timeoutKey = doc.uri.toString();
      const existingTimeout = diagnosticTimeouts.get(timeoutKey);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
        diagnosticTimeouts.delete(timeoutKey);
      }
      diagnoseDocumentNow(doc);
    })
  );
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument(doc => {
      const timeoutKey = doc.uri.toString();
      const existingTimeout = diagnosticTimeouts.get(timeoutKey);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
        diagnosticTimeouts.delete(timeoutKey);
      }
      if (isWorkspaceScriptAuditPath(doc.fileName)) {
        void diagnoseFileFromDisk(doc.uri);
      } else {
        diagnosticCollection.delete(doc.uri);
      }
    })
  );
  context.subscriptions.push(
    vscode.workspace.onDidDeleteFiles(event => {
      for (const file of event.files) diagnosticCollection.delete(file);
    })
  );
  context.subscriptions.push(
    vscode.workspace.onDidRenameFiles(event => {
      for (const file of event.files) {
        diagnosticCollection.delete(file.oldUri);
        if (isWorkspaceScriptAuditPath(file.newUri.fsPath)) {
          void diagnoseFileFromDisk(file.newUri);
        }
      }
    })
  );

  // ---- 代码操作 (Quick Fix) ----
  const codeActionProvider = vscode.languages.registerCodeActionsProvider(
    [
      { language: 'gomscript', scheme: 'file' },
      { language: 'plaintext', scheme: 'file', pattern: '**/*.txt' }
    ],
    {
      provideCodeActions(document, _range, context) {
        const actions: vscode.CodeAction[] = [];
        for (const diag of context.diagnostics) {
          // Quick fix: 添加缺失的 [@label] 定义
          const labelMatch = diag.message.match(/引用了未定义的标签 @(\S+)/);
          if (labelMatch) {
            const action = new vscode.CodeAction(
              `创建 [@${labelMatch[1]}] 标签定义`,
              vscode.CodeActionKind.QuickFix
            );
            action.diagnostics = [diag];
            action.command = {
              command: 'boo.addLabelToCurrentFile',
              title: '添加标签到当前文件',
              arguments: [document.uri, labelMatch[1]]
            };
            action.isPreferred = true;
            actions.push(action);
          }
          // Quick fix: #CALL/#CALLEX引用的标签不存在 → 在目标文件中添加标签定义
          const callLabelMatch = diag.message.match(/#(?:CALL|CALLEX)引用的标签不存在: (.+) 中缺少 \[@(\S+)\]/);
          if (callLabelMatch) {
            const targetFile = callLabelMatch[1];
            const targetLabel = callLabelMatch[2];
            const action = new vscode.CodeAction(
              `在 ${targetFile} 中创建 [@${targetLabel}]`,
              vscode.CodeActionKind.QuickFix
            );
            action.diagnostics = [diag];
            action.command = {
              command: 'boo.addLabelToFile',
              title: '添加标签到目标文件',
              arguments: [document.uri, targetFile, targetLabel]
            };
            action.isPreferred = true;
            actions.push(action);
          }
          // Quick fix: #IF块缺少执行块
          if (diag.message.includes('#IF块缺少对应的#ACT')) {
            const action = new vscode.CodeAction(
              '添加 #ACT 执行块',
              vscode.CodeActionKind.QuickFix
            );
            action.diagnostics = [diag];
            action.edit = new vscode.WorkspaceEdit();
            action.edit.insert(document.uri,
              new vscode.Position(diag.range.end.line + 1, 0), '#ACT\n');
            actions.push(action);
          }
          // Quick fix: 创建不存在的文件 (#CALL/#CALLEX引用 / merchant.txt引用)
          const fileMatch = diag.message.match(/#(?:CALL|CALLEX)引用的文件可能不存在: (.+)/);
          const merchMatch = diag.message.match(/merchant\.txt引用的NPC脚本可能不存在: (.+)/);
          const missingFile = fileMatch ? fileMatch[1] : (merchMatch ? merchMatch[1] : null);
          if (missingFile) {
            const action = new vscode.CodeAction(
              `创建文件: ${missingFile}`,
              vscode.CodeActionKind.QuickFix
            );
            action.diagnostics = [diag];
            action.command = {
              command: 'boo.createMissingFile',
              title: '创建缺失文件',
              arguments: fileMatch
                ? [document.uri, missingFile, 'scriptCall']
                : [document.uri, missingFile]
            };
            action.isPreferred = true;
            actions.push(action);
          }
        }
        return actions;
      }
    }
  );
  context.subscriptions.push(codeActionProvider);

  // 注册「自动快速修复」命令 — Ctrl+Q直接执行首选修复
  context.subscriptions.push(
    vscode.commands.registerCommand('boo.quickFix', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const pos = editor.selection.active;
      const diags = diagnosticCollection.get(editor.document.uri) || [];
      const atCursor = diags.filter(d => d.range.contains(pos));
      if (atCursor.length === 0) {
        // 无诊断时回退到标准Quick Fix菜单
        await vscode.commands.executeCommand('editor.action.quickFix');
        return;
      }
      // 收集所有CodeAction
      const actions: vscode.CodeAction[] = [];
      for (const diag of atCursor) {
        // 复制codeActionProvider中的逻辑: 匹配诊断消息
        const labelMatch = diag.message.match(/引用了未定义的标签 @(\S+)/);
        if (labelMatch) {
          const action = new vscode.CodeAction(`创建 [@${labelMatch[1]}] 标签定义`, vscode.CodeActionKind.QuickFix);
          action.command = { command: 'boo.addLabelToCurrentFile', title: '添加标签到当前文件', arguments: [editor.document.uri, labelMatch[1]] };
          action.isPreferred = true;
          actions.push(action);
        }
        if (diag.message.includes('#IF块缺少对应的#ACT')) {
          const action = new vscode.CodeAction('添加 #ACT 执行块', vscode.CodeActionKind.QuickFix);
          action.edit = new vscode.WorkspaceEdit();
          action.edit.insert(editor.document.uri, new vscode.Position(diag.range.end.line + 1, 0), '#ACT\n');
          action.isPreferred = true;
          actions.push(action);
        }
        const fileMatch = diag.message.match(/#(?:CALL|CALLEX)引用的文件可能不存在: (.+)/);
        const merchMatch = diag.message.match(/merchant\.txt引用的NPC脚本可能不存在: (.+)/);
        const missingFile = fileMatch ? fileMatch[1] : (merchMatch ? merchMatch[1] : null);
        if (missingFile) {
          const action = new vscode.CodeAction(`创建文件: ${missingFile}`, vscode.CodeActionKind.QuickFix);
          action.command = {
            command: 'boo.createMissingFile',
            title: '创建缺失文件',
            arguments: fileMatch
              ? [editor.document.uri, missingFile, 'scriptCall']
              : [editor.document.uri, missingFile]
          };
          action.isPreferred = true;
          actions.push(action);
        }
        const callLabelMatch = diag.message.match(/#(?:CALL|CALLEX)引用的标签不存在: (.+) 中缺少 \[@(\S+)\]/);
        if (callLabelMatch) {
          const action = new vscode.CodeAction(`创建 [@${callLabelMatch[2]}]`, vscode.CodeActionKind.QuickFix);
          action.command = { command: 'boo.addLabelToFile', title: '添加标签到目标文件', arguments: [editor.document.uri, callLabelMatch[1], callLabelMatch[2]] };
          action.isPreferred = true;
          actions.push(action);
        }
      }
      // 找到第一个isPreferred的action并直接执行
      const preferred = actions.find(a => a.isPreferred);
      if (preferred) {
        if (preferred.edit) {
          await vscode.workspace.applyEdit(preferred.edit);
        } else if (preferred.command) {
          await vscode.commands.executeCommand(preferred.command.command, ...(preferred.command.arguments || []));
        }
      } else {
        await vscode.commands.executeCommand('editor.action.quickFix');
      }
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('boo.createMissingFile', async (
      docUri: vscode.Uri,
      missingFile: string,
      referenceKind: 'pathReference' | 'scriptCall' | 'include' | undefined
    ): Promise<vscode.Uri | undefined> => {
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(docUri);
      const wsRoot = workspaceFolder?.uri.fsPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!wsRoot) { vscode.window.showErrorMessage('未打开工作区'); return; }
      const docDir = path.dirname(docUri.fsPath);
      const cleanMissingFile = String(missingFile || '')
        .trim()
        .replace(/^['"]|['"]$/g, '')
        .replace(/^[\\/]+/, '');
      if (!cleanMissingFile && referenceKind !== 'pathReference') {
        vscode.window.showErrorMessage('缺失文件路径为空');
        return;
      }
      // merchant.txt 引用 → 创建到 Market_Def/ 下
      const isMerchant = /merchant\.txt$/i.test(docUri.fsPath);
      let targetPath: string;
      if (referenceKind === 'pathReference' || referenceKind === 'scriptCall' || referenceKind === 'include') {
        const baseKind = referenceKind === 'scriptCall'
          ? 'questDiary'
          : referenceKind === 'include'
            ? 'defines'
            : 'auto';
        const resolution = resolveScriptPathReference(wsRoot, docUri.fsPath, missingFile, baseKind);
        targetPath = resolution.existingPath || resolution.createPath || '';
        if (!targetPath) {
          vscode.window.showErrorMessage(`无法在当前工作区解析路径: ${missingFile}`);
          return;
        }
      } else if (isMerchant) {
        const marketDefBase = path.join(wsRoot, 'Mir200', 'Envir', 'Market_Def');
        const altBase = path.join(wsRoot, 'Envir', 'Market_Def');
        const base = fs.existsSync(marketDefBase) ? marketDefBase : (fs.existsSync(altBase) ? altBase : marketDefBase);
        targetPath = path.resolve(base, cleanMissingFile);
      } else {
        // #CALL 引用 → Envir 目录下解析
        const bestDir = getBestCreateDir(wsRoot, docDir);
        targetPath = bestDir ? path.resolve(bestDir, cleanMissingFile) : path.resolve(docDir, cleanMissingFile);
      }
      const finalPath = /\.(?:txt|ini|csv)$/i.test(targetPath) ? targetPath : targetPath + '.txt';
      if (!isPathInside(wsRoot, finalPath)) {
        vscode.window.showErrorMessage('拒绝创建工作区以外的文件');
        return;
      }

      const requestKey = path.normalize(finalPath).toLocaleLowerCase();
      const pending = pendingMissingFileCreations.get(requestKey);
      if (pending) return pending;
      const request = (async (): Promise<vscode.Uri | undefined> => {
        try {
          if (!fs.existsSync(finalPath)) {
            const relativePath = path.relative(wsRoot, finalPath) || path.basename(finalPath);
            const choice = await vscode.window.showWarningMessage(
              `引用文件不存在：${relativePath}\n是否自动创建空白文本文件？`,
              { modal: true },
              '创建文本'
            );
            if (choice !== '创建文本') return undefined;
            fs.mkdirSync(path.dirname(finalPath), { recursive: true });
            try {
              fs.writeFileSync(finalPath, '', { encoding: 'utf-8', flag: 'wx' });
            } catch (e: unknown) {
              if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
            }
          }
          const uri = vscode.Uri.file(finalPath);
          const doc = await vscode.workspace.openTextDocument(uri);
          await vscode.window.showTextDocument(doc);
          vscode.window.setStatusBarMessage(`已创建或打开: ${path.basename(finalPath)}`, 3000);
          return uri;
        } catch (e: unknown) {
          vscode.window.showErrorMessage(`创建文件失败: ${e instanceof Error ? e.message : String(e)}`);
          return undefined;
        }
      })();
      pendingMissingFileCreations.set(requestKey, request);
      try {
        return await request;
      } finally {
        pendingMissingFileCreations.delete(requestKey);
      }
    })
  );

  // 注册「添加标签到当前文件」命令（创建后跳转）
  context.subscriptions.push(
    vscode.commands.registerCommand('boo.addLabelToCurrentFile', async (docUri: vscode.Uri, label: string) => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        const doc = await vscode.workspace.openTextDocument(docUri);
        await vscode.window.showTextDocument(doc);
        // editor可能仍为null如果文档未激活，通过WorkspaceEdit插入
      }
      const activeEditor = vscode.window.activeTextEditor;
      if (!activeEditor) return;
      const insertText = `\n[@${label}]\n#IF\n#ACT\n`;
      const insertPos = new vscode.Position(activeEditor.document.lineCount, 0);
      await activeEditor.edit(eb => eb.insert(insertPos, insertText));
      // 跳转到新创建的标签
      const newPos = new vscode.Position(activeEditor.document.lineCount - 3, 0); // [@label] 在第3行
      activeEditor.selection = new vscode.Selection(newPos, newPos);
      activeEditor.revealRange(new vscode.Range(newPos, newPos), vscode.TextEditorRevealType.InCenter);
      vscode.window.setStatusBarMessage(`已创建 [@${label}]`, 3000);
    })
  );

  // 注册「添加标签到目标文件」命令
  context.subscriptions.push(
    vscode.commands.registerCommand('boo.addLabelToFile', async (_docUri: vscode.Uri, targetFile: string, targetLabel: string) => {
      const found = targetFile; // 直接使用完整路径（诊断时已解析）
      try {
        const raw = fs.readFileSync(found);
        const text = readFileGBK(raw);
        const insert = `\n[@${targetLabel}]\n#IF\n#ACT\n`;
        const newText = text + insert;
        const iconv = require('iconv-lite');
        const gbkBuf = iconv.encode(newText, 'gbk');
        fs.writeFileSync(found, Buffer.from(gbkBuf));
        // 打开目标文件并跳转到新添加的标签处
        const uri = vscode.Uri.file(found);
        const doc = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(doc);
        // 查找 [@标签] 位置并跳转
        const allText = doc.getText();
        const labelRe = new RegExp(`\\[@${escapeRegex(targetLabel)}\\]`, 'i');
        const lm = labelRe.exec(allText);
        if (lm) {
          const pos = doc.positionAt(lm.index);
          editor.selection = new vscode.Selection(pos, pos);
          editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
        }
        vscode.window.setStatusBarMessage(`已添加 [@${targetLabel}] 到 ${path.basename(found)}`, 3000);
      } catch (e: unknown) {
        vscode.window.showErrorMessage(`添加标签失败: ${e instanceof Error ? e.message : String(e)}`);
      }
    })
  );

  // 初始诊断当前打开的脚本文件
  vscode.workspace.textDocuments.forEach(doc => updateDiagnostics(doc));

  // 后台递归审查四个主要脚本目录，诊断保留到文件被保存、删除或引擎切换。
  void scanHumanGuildDecls()
    .then(() => diagnoseWorkspaceScriptFiles(false))
    .catch(error => console.warn(
      '[BOO] 初始代码审查失败:',
      error instanceof Error ? error.message : String(error)
    ));
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void scanHumanGuildDecls()
        .then(() => diagnoseWorkspaceScriptFiles(false))
        .catch(error => console.warn(
          '[BOO] 工作区代码审查失败:',
          error instanceof Error ? error.message : String(error)
        ));
    })
  );

  // ---- 变量侧边栏 ----
  class BooVarProvider implements vscode.TreeDataProvider<BooVarItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<BooVarItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    refresh() { this._onDidChangeTreeData.fire(); }

    getTreeItem(element: BooVarItem): vscode.TreeItem {
      return element;
    }

    getChildren(element?: BooVarItem): BooVarItem[] {
      if (element) return element.children || [];
      if (this.cachedItems) return this.cachedItems;
      if (this.scanning) return [new BooVarItem("(正在扫描变量...)", "", vscode.TreeItemCollapsibleState.None)];
      this.scanning = true;
      void this.doAsyncScan();
      return [new BooVarItem("(正在扫描变量...)", "", vscode.TreeItemCollapsibleState.None)];
    }
    clearCache() { this.cachedItems = null; }
    private cachedItems: BooVarItem[] | null = null;
    private scanning = false;
    private async doAsyncScan(): Promise<void> {
      try {
        this.cachedItems = await this.scanVariables();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        outputChannel.appendLine(`变量扫描失败: ${message}`);
        this.cachedItems = [new BooVarItem("(变量扫描失败，请查看输出)", "", vscode.TreeItemCollapsibleState.None)];
      } finally {
        this.scanning = false;
        this.refresh();
      }
    }
    private async scanVariables(): Promise<BooVarItem[]> {
      const wsFolders = vscode.workspace.workspaceFolders;
      if (!wsFolders || wsFolders.length === 0) return [new BooVarItem("(未打开工作区)", "", vscode.TreeItemCollapsibleState.None)];
      const wsRoot = wsFolders[0].uri.fsPath;
      const scanDirs = ["MapQuest_Def", "Market_Def", "QuestDiary", "Robot_def", "Npc_Def"];
      const varSet = new Map<string, { type: string; count: number; files: Set<string> }>();
      _varOccurrences.clear(); _varCycleIdx.clear();
      const varRe = /\b([NSLDnsld]\$[A-Za-z0-9_\u4e00-\u9fff]+|[Gg][Ll]\$[A-Za-z0-9_\u4e00-\u9fff]+|[PDMNSIGAUTJZpdmnigautjz]\d+)\b/g;
      function recordOccurrence(name: string, file: string, line: number) {
        const key = normalizeScriptVariableName(name);
        if (!_varOccurrences.has(key)) _varOccurrences.set(key, []);
        _varOccurrences.get(key)!.push({ file, line });
      }
      function scanDir(basePath: string) {
        if (!fs.existsSync(basePath)) return;
        try {
          const entries = fs.readdirSync(basePath, { withFileTypes: true });
          for (const entry of entries) {
            const full = path.join(basePath, entry.name);
            if (entry.isDirectory()) { scanDir(full); }
            else if (entry.name.endsWith(".txt") || entry.name.endsWith(".ini")) {
              try {
                const raw = fs.readFileSync(full);
                const text = readFileGBK(raw);
                const lines = text.split(/\r?\n/);
                const lineOffsets = getLineOffsets(text, lines);
                const mapCodeRanges = findMapCodeRangesInText(
                  text,
                  full,
                  configuredMapCodesForFile(full),
                  resolveIndexedCommandToken
                );
                const nested = analyzeNestedVariables(text, {
                  resolveConfigValues: request => resolveNestedConfigValues(full, request),
                  resolveTableData: request => resolveNestedTableData(full, request),
                  resolveListData: request => resolveNestedListData(full, request),
                });
                const nestedByLine = new Map<number, typeof nested.references>();
                for (const reference of nested.references) {
                  const current = nestedByLine.get(reference.line) || [];
                  current.push(reference);
                  nestedByLine.set(reference.line, current);
                }
                const personalFlagsByLine = new Map<number, typeof nested.personalFlags>();
                for (const reference of nested.personalFlags) {
                  const current = personalFlagsByLine.get(reference.line) || [];
                  current.push(reference);
                  personalFlagsByLine.set(reference.line, current);
                }
                for (let li = 0; li < lines.length; li++) {
                  const line = lines[li];
                  if (isScriptCommentLine(line)) continue;

                  for (const reference of personalFlagsByLine.get(li) || []) {
                    for (const flag of reference.flags) {
                      recordVariableUsage(varSet, flag, entry.name, () => ({
                        type: '个人标识 [1-1024]',
                        count: 0,
                        files: new Set<string>(),
                      }));
                      recordOccurrence(flag, full, li);
                    }
                    if (reference.status !== 'resolved') {
                      const name = normalizePersonalFlagReference(reference);
                      recordVariableUsage(varSet, name, entry.name, () => ({
                        type: reference.status === 'partial'
                          ? '个人标识（部分推导）'
                          : '个人标识（运行时确定）',
                        count: 0,
                        files: new Set<string>(),
                      }));
                      recordOccurrence(name, full, li);
                    }
                  }

                  for (const reference of nestedByLine.get(li) || []) {
                    for (const variable of reference.variables) {
                      recordVariableUsage(varSet, variable, entry.name, () => ({
                        type: sidebarVariableType(variable),
                        count: 0,
                        files: new Set<string>(),
                      }));
                      recordOccurrence(variable, full, li);
                    }
                    if (reference.status !== 'resolved') {
                      const nestedName = normalizeNestedVariableReference(reference);
                      recordVariableUsage(varSet, nestedName, entry.name, () => ({
                        type: reference.status === 'partial'
                          ? '嵌套变量（部分推导）'
                          : '嵌套变量（运行时确定）',
                        count: 0,
                        files: new Set<string>(),
                      }));
                      recordOccurrence(nestedName, full, li);
                    }
                  }

                  // 常规变量
                  let m; varRe.lastIndex = 0;
                  while ((m = varRe.exec(line)) !== null) {
                    const absoluteOffset = lineOffsets[li] + m.index;
                    if (isNestedVariableBaseOffset(absoluteOffset, nested.references)) continue;
                    if (isOffsetInTextRanges(absoluteOffset, mapCodeRanges)) continue;
                    const name = normalizeScriptVariableName(m[1]);
                    recordVariableUsage(varSet, name, entry.name, () => ({
                      type: sidebarVariableType(name),
                      count: 0,
                      files: new Set<string>(),
                    }));
                    recordOccurrence(name, full, li);
                  }
                }
              } catch (e) {
                console.warn('[BOO] 变量扫描文件读取失败:', e instanceof Error ? e.message : String(e));
              }
            }
          }
        } catch (e) {
          console.warn('[BOO] 变量扫描目录读取失败:', e instanceof Error ? e.message : String(e));
        }
      }
      const envirBases = [path.join(wsRoot, "Mir200", "Envir"), path.join(wsRoot, "Envir")];
      for (const envirBase of envirBases) {
        for (const dir of scanDirs) scanDir(path.join(envirBase, dir));
      }
      if (varSet.size === 0) return [new BooVarItem("(未发现变量)", "", vscode.TreeItemCollapsibleState.None)];
      const groups = new Map<string, BooVarItem[]>();
      const varDescs: Record<string, string> = context.workspaceState.get("boo.varDescs", {});
      for (const [name, info] of varSet) {
        if (!groups.has(info.type)) groups.set(info.type, []);
        const fileList = [...info.files].slice(0, 3).join(",");
        const desc = varDescs[name] || info.count+"次 ["+fileList+(info.files.size>3?"...":"")+"]";
        const vItem = new BooVarItem(name, desc, vscode.TreeItemCollapsibleState.None);
        if (_varOccurrences.has(normalizeScriptVariableName(name))) {
          vItem.command = { command: 'boo.gotoVarOccurrence', title: '跳转', arguments: [name] };
          vItem.tooltip = (varDescs[name] || (info.count+'次')) + ' — 点击跳转，再次点击循环';
        }
        if (varDescs[name]) { vItem.iconPath = new vscode.ThemeIcon("bookmark"); }
        groups.get(info.type)!.push(vItem);
      }
      const items: BooVarItem[] = [];
      for (const [group, vars] of groups) {
        vars.sort(function(a,b){return naturalCompare(String(a.label), String(b.label))});
        const groupItem = new BooVarItem(
          formatVariableGroupLabel(group, vars.length),
          "",
          vscode.TreeItemCollapsibleState.Collapsed
        );
        groupItem.children = vars;
        items.push(groupItem);
      }
      return items;
    }
  }

  class BooVarItem extends vscode.TreeItem {
    children: BooVarItem[] | undefined;
    constructor(
      label: string, description: string,
      collapsible: vscode.TreeItemCollapsibleState,
      public line?: number
    ) {
      super(label, collapsible);
      this.description = description;
      if (collapsible === vscode.TreeItemCollapsibleState.None) {
        this.iconPath = new vscode.ThemeIcon('symbol-variable');
      } else {
        this.iconPath = new vscode.ThemeIcon('folder');
      }
      if (line !== undefined) {
        this.command = {
          command: 'boo.gotoVarLine',
          title: '跳转到变量',
          arguments: [line]
        };
        this.tooltip = `第 ${line + 1} 行`;
      }
    }
  }

  const varProvider = new BooVarProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('boo.varView', varProvider)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('boo.refreshVariables', () => {
      varProvider.clearCache(); varProvider.refresh();
      vscode.window.setStatusBarMessage('变量列表已刷新', 2000);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('boo.gotoVarOccurrence', (name: string) => gotoVarOccurrence(name)),
    vscode.commands.registerCommand('boo.gotoVarLine', (line: number) => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        const pos = new vscode.Position(line, 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos));
      }
    })
  );

  // 变量刷新函数（仅由reload.ts在M2重载时调用）
  const refreshVarTree = () => { varProvider.clearCache(); varProvider.refresh(); };
  _refreshVarTree = refreshVarTree;

  // ---- 自动切换语言 ----
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(async (doc) => {
      if ((doc.languageId === 'plaintext' || doc.languageId === 'txt') && doc.fileName.endsWith('.txt')) {
        const text = doc.getText().substring(0, 1000).toUpperCase();
        // 脚本文件特征: #IF/#ACT/[@/#SAY/引擎命令
        const isScript = text.includes('#IF') || text.includes('#ACT') || text.includes('[@') ||
            text.includes('#SAY') || text.includes('CHECKLEVELEX') || text.includes('GAMEGOLD');
        // MirServer配置文件特征: 路径在Mir200/Envir下, 或内容含常见配置格式
        const isConfig = doc.fileName.replace(/\\/g, '/').includes('Mir200') ||
            /^[^; \t].*\s+\S+\s+\d+\s+\d+/.test(doc.getText().substring(0, 2000)) ||
            /^\[.*\]/.test(text);
        if (isScript || isConfig) {
          try {
            await vscode.languages.setTextDocumentLanguage(doc, 'gomscript');
            outputChannel.appendLine(`已切换语言: ${doc.fileName}`);
            // 检测是否为 GBK 文件被误读为 UTF-8（传奇脚本默认 GBK 编码）
            const sample = doc.getText().substring(0, 200);
            const garbled = /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(sample) || (sample.includes('�'));
            if (garbled) {
              vscode.window.showWarningMessage('文件可能为 GBK 编码被误读为 UTF-8，导致中文乱码', '用 GB2312 重开', '查看说明').then(choice => {
                if (choice === '用 GB2312 重开') {
                  vscode.commands.executeCommand('workbench.action.reopenEditorWithEncoding');
                } else if (choice === '查看说明') {
                  vscode.env.openExternal(vscode.Uri.parse('https://docs.qq.com/doc/DUnpVdlZOVW1lR2tZ'));
                }
              });
            }
          } catch (e) { console.warn('[BOO] 语言切换失败:', e instanceof Error ? e.message : String(e)); }
        }
      }
    })
  );

  // 面板跟踪: 防止重复打开, 在当前列打开不拆分
  const trackedPanels = new Map<string, vscode.WebviewPanel>();
  function getOrCreatePanel(id: string, title: string, html: string): vscode.WebviewPanel {
    const existing = trackedPanels.get(id);
    if (existing) { existing.reveal(); return existing; }
    const panel = vscode.window.createWebviewPanel(id, title, { viewColumn: vscode.ViewColumn.Active, preserveFocus: true }, { enableScripts: true });
    panel.webview.html = secureWebviewHtml(
      panel.webview,
      html,
      { allowInlineEventHandlers: true }
    );
    panel.onDidDispose(() => trackedPanels.delete(id));
    trackedPanels.set(id, panel);
    return panel;
  }

  // 注册命令
  context.subscriptions.push(
    vscode.commands.registerCommand('boo.showStats', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const text = editor.document.getText();
      const labels = (text.match(/\[@[^\]]+\]/g) || []).length;
      const ifCount = (text.match(/#IF/gi) || []).length;
      const actCount = (text.match(/#ACT/gi) || []).length;
      const sayCount = (text.match(/#SAY/gi) || []).length;
      const callCount = (text.match(/#CALL/gi) || []).length;
      const gotoCount = (text.match(/GOTO\s+@/gi) || []).length;
      const vars = (text.match(/\b[NSLDnsld]\$\w+|\b[Gg][Ll]\$\w+/g) || []).length;
      const numVars = (text.match(/\b[PDMNSIGAUTJ]\d+\b/g) || []).length;
      const lines = editor.document.lineCount;

      const panel = vscode.window.createWebviewPanel(
        'booStats', `BOO 脚本统计 - ${path.basename(editor.document.fileName)}`, vscode.ViewColumn.Active, {}
      );
      panel.webview.html = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8">
<style>
*{margin:0;padding:0}body{background:#1e1e1e;color:#d4d4d4;font-family:monospace;padding:20px}
h2{color:#ff8c00;margin-bottom:16px;font-size:18px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.card{background:#2a2a2a;border-radius:8px;padding:16px;border:1px solid #333}
.card .num{font-size:32px;font-weight:bold;color:#00d4ff}
.card .label{font-size:13px;color:#888;margin-top:4px}
progress{width:100%;height:12px;border-radius:6px;overflow:hidden;margin-top:12px}
progress::-webkit-progress-bar{background:#333;border-radius:6px}
progress::-webkit-progress-value{background:linear-gradient(90deg,#0ea5e9,#00d4ff);border-radius:6px}
</style></head>
<body>
<h2>${path.basename(editor.document.fileName)} 脚本统计报告</h2>
<div class="grid">
<div class="card"><div class="num">${lines}</div><div class="label">总行数</div></div>
<div class="card"><div class="num">${labels}</div><div class="label">[@标签]</div></div>
<div class="card"><div class="num">${ifCount}</div><div class="label">#IF条件块</div></div>
<div class="card"><div class="num">${actCount}</div><div class="label">#ACT执行块</div></div>
<div class="card"><div class="num">${sayCount}</div><div class="label">#SAY对话框</div></div>
<div class="card"><div class="num">${callCount}</div><div class="label">#CALL调用</div></div>
<div class="card"><div class="num">${gotoCount}</div><div class="label">GOTO跳转</div></div>
<div class="card"><div class="num">${vars + numVars}</div><div class="label">变量引用</div></div>
</div>
<div style="margin-top:16px;color:#888;font-size:12px">
变量详情: N$/S$/D$ 自定义变量 ${vars} 处 | 数字变量(P/D/M/N/S/I/G/A/U/T) ${numVars} 处
</div>
</body></html>`;
      panel.webview.html = secureWebviewHtml(
        panel.webview,
        panel.webview.html,
        { enableScripts: false }
      );
    }),

    // ---- MapInfo参数参考 ----
    vscode.commands.registerCommand('boo.showMapInfo', () => {
      const mapInfoParams = activeMapInfoParams(languageIndex.engine);
      let h = '<html><body style="font-family:monospace;background:#1e1e1e;color:#d4d4d4;padding:15px"><h2 style="color:#ff8c00;margin-bottom:10px">MapInfo.txt 地图参数参考 (' + mapInfoParams.length + '个)</h2><table style="border-collapse:collapse;width:100%;font-size:13px"><tr style="background:#333"><th style="padding:8px;text-align:left;color:#ff8c00">参数</th><th style="padding:8px;text-align:left;color:#ff8c00">分类</th><th style="padding:8px;text-align:left;color:#ff8c00">说明</th></tr>';
      for (const p of mapInfoParams) {
        h += '<tr style="border-bottom:1px solid #333"><td style="padding:6px 8px;color:#9cdcfe;white-space:nowrap">' + escapeStaticHtml(p.label) + '</td><td style="padding:6px 8px;color:#c586c0;white-space:nowrap">' + escapeStaticHtml(formatEntryEngineCategory(p.engines)) + '</td><td style="padding:6px 8px;color:#aaa">' + escapeStaticHtml(p.description) + '</td></tr>';
      }
      h += '</table></body></html>';
      getOrCreatePanel('booMapInfo', 'BOO MapInfo 地图参数参考', h);
    }),
    vscode.commands.registerCommand('boo.showColorChart', () => {
      getOrCreatePanel('booColor', 'BOO颜色代码表(0-255)', buildColorChart());
    }),
    vscode.commands.registerCommand('boo.showEquipSlots', () => {
      getOrCreatePanel('booEquip', 'BOO装备位置代码表', buildEquipTable());
    }),
    vscode.commands.registerCommand('boo.showStdMode', () => {
      getOrCreatePanel('booStd', 'BOO StdMode代码表', buildStdModeTable());
    }),
    vscode.commands.registerCommand('boo.formatScript', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const text = editor.document.getText();
      // 格式化：规范化缩进和空行
      const lines = text.split(/\r?\n/);
      const result: string[] = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        const up = trimmed.toUpperCase();

        // 预处理块标记
        if (up.startsWith('#IF') || up.startsWith('#OR')) {
          result.push(trimmed);
          continue;
        }
        if (up.startsWith('#ACT') || up.startsWith('#ELSEACT') || up.startsWith('#SAY') || up.startsWith('#ELSESAY')) {
          result.push(trimmed);
          continue;
        }
        if (trimmed.startsWith('[@')) {
          if (i > 0 && result[result.length - 1] !== '') result.push('');
          result.push(trimmed);
          continue;
        }

        // 标签后的内容
        if (trimmed.startsWith('#CALL') || trimmed.startsWith('#INCLUDE')) {
          result.push(trimmed);
          continue;
        }

        if (trimmed.length === 0) {
          if (result.length > 0 && result[result.length - 1] !== '') result.push('');
          continue;
        }

        result.push(trimmed);
      }

      const formatted = result.join('\n');
      if (formatted !== text) {
        const fullRange = new vscode.Range(
          editor.document.positionAt(0),
          editor.document.positionAt(text.length)
        );
        await editor.edit(eb => eb.replace(fullRange, formatted));
        vscode.window.setStatusBarMessage('BOO: 脚本已格式化', 3000);
      }
    }),
    vscode.commands.registerCommand('boo.quickColor', () => {
      const panel = vscode.window.createWebviewPanel(
        'booQuickColor', 'BOO快速颜色', vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true }
      );
      panel.webview.html = secureWebviewHtml(
        panel.webview,
        buildQuickColorHTML()
      );
      panel.webview.onDidReceiveMessage(msg => {
        if (msg.type === 'insertColor') {
          const editor = vscode.window.activeTextEditor;
          if (editor) {
            editor.edit(eb => {
              eb.insert(editor.selection.active, `${msg.value}`);
            });
          }
          panel.dispose();
        }
      });
    }),

    // ---- 批量数值编辑 (Alt+X) ----
    vscode.commands.registerCommand('boo.batchEditNumbers', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.selections.every(s => s.isEmpty)) {
        vscode.window.showInformationMessage('请先选中包含数字的文本，再使用批量数值编辑');
        return;
      }
      // 检查所有选区是否都包含数字
      const allTexts = editor.selections.map(s => editor.document.getText(s));
      if (!allTexts.some(t => /\d/.test(t))) {
        vscode.window.showInformationMessage('选中文本中没有数字');
        return;
      }
      const op = await vscode.window.showQuickPick([
        { label: '$(add) 加 (+)', value: 'add', description: '所有数字增加固定值' },
        { label: '$(arrow-up) 递增+', value: 'incrementAdd', description: '第 N 个数字增加 N × 递增值' },
        { label: '$(remove) 减 (-)', value: 'sub', description: '所有数字减少固定值' },
        { label: '$(close) 乘 (×)', value: 'mul', description: '所有数字乘以固定值' },
        { label: '$(split-horizontal) 除 (÷)', value: 'div', description: '所有数字除以固定值' }
      ], { placeHolder: '选择运算方式' });
      if (!op) return;

      const valStr = await vscode.window.showInputBox({
        prompt: op.value === 'incrementAdd'
          ? '输入递增值：第 N 个数字将增加 N × 此值'
          : `输入${op.label}的数值`,
        validateInput: v => !v.trim() || !Number.isFinite(Number(v)) ? '请输入有效数字' : null
      });
      if (!valStr) return;

      const num = Number(valStr);
      const orderedSelections = editor.selections
        .map((selection, index) => ({ selection, index }))
        .sort((left, right) => left.selection.start.compareTo(right.selection.start) || left.index - right.index);
      const transformed = transformBatchNumbers(
        orderedSelections.map(item => editor.document.getText(item.selection)),
        op.value as BatchNumberOperation,
        num
      );
      await editor.edit(eb => {
        for (let index = orderedSelections.length - 1; index >= 0; index--) {
          if (transformed.texts[index] !== editor.document.getText(orderedSelections[index].selection)) {
            eb.replace(orderedSelections[index].selection, transformed.texts[index]);
          }
        }
      });
      vscode.window.setStatusBarMessage(
        `BOO: 已${op.value === 'incrementAdd' ? '按顺序递增' : op.label.replace(/[$( )]/g, '').slice(0, 3)} ${num}，处理 ${transformed.count} 个数字`, 4000
      );
    }),

    // ---- 字符串大小写转换 (Alt+Shift+U) ----
    vscode.commands.registerCommand('boo.stringTransform', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.selection.isEmpty) {
        vscode.window.showInformationMessage('请先选中文本再使用字符串转换');
        return;
      }
      const selection = editor.selection;
      const text = editor.document.getText(selection);
      const up = text.toUpperCase();
      let transformed = text;
      if (text === up) {
        transformed = text.toLowerCase();
        vscode.window.setStatusBarMessage('已转换为小写', 3000);
      } else if (text === text.toLowerCase()) {
        transformed = up;
        vscode.window.setStatusBarMessage('已转换为大写', 3000);
      } else {
        transformed = up;
        vscode.window.setStatusBarMessage('已转换为大写', 3000);
      }
      editor.edit(eb => eb.replace(selection, transformed));
    }),

    // ---- 变量转STR包裹 (Ctrl+D) ----
    vscode.commands.registerCommand('boo.wrapVariable', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const selections = editor.selections.filter(selection => !selection.isEmpty);
      if (selections.length === 0) return;

      const orderedEdits = collectVariableWrapEdits(selections.map(selection => ({
        start: editor.document.offsetAt(selection.start),
        text: editor.document.getText(selection),
      })), editor.document.getText());
      if (orderedEdits.length === 0) {
        vscode.window.showInformationMessage(
          '选区中没有可包裹的变量，或变量已在 <$...> 表达式中'
        );
        return;
      }

      const applied = await editor.edit(editBuilder => {
        for (const edit of orderedEdits) {
          editBuilder.replace(
            new vscode.Range(
              editor.document.positionAt(edit.start),
              editor.document.positionAt(edit.end)
            ),
            edit.replacement
          );
        }
      });
      if (applied) {
        vscode.window.setStatusBarMessage(
          `BOO: 已批量包裹 ${orderedEdits.length} 个变量`,
          4000
        );
      }
    }),

    // ---- 英文转大写 ----
    vscode.commands.registerCommand('boo.toUpperCase', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.selection.isEmpty) {
        vscode.window.showInformationMessage('请先选中文本再转大写');
        return;
      }
      const selection = editor.selection;
      const text = editor.document.getText(selection);
      const transformed = text.toUpperCase();
      if (text === transformed) {
        vscode.window.showInformationMessage('已全部大写，无需转换');
        return;
      }
      editor.edit(eb => eb.replace(selection, transformed));
      vscode.window.setStatusBarMessage('已转为大写', 3000);
    }),

	    // ---- 所有脚本英文转大写 (Envir目录递归) ----
	    vscode.commands.registerCommand('boo.toUpperCaseAll', async () => {
	      const wsFolders = vscode.workspace.workspaceFolders;
	      if (!wsFolders || wsFolders.length === 0) {
	        vscode.window.showWarningMessage('未打开工作区');
	        return;
	      }
	      const wsRoot = wsFolders[0].uri.fsPath;

	      // 定位 Envir 目录
	      const envirCandidates = [
	        path.join(wsRoot, 'Mir200', 'Envir'),
	        path.join(wsRoot, 'Envir'),
	      ];
	      let envirDir = '';
	      for (const c of envirCandidates) {
	        if (fs.existsSync(c)) { envirDir = c; break; }
	      }
	      if (!envirDir) {
	        vscode.window.showErrorMessage('未找到 Envir 目录。请确认工作区已打开 MirServer。');
	        return;
	      }

	      // 确认对话框
	      const confirm = await vscode.window.showWarningMessage(
	        `将对 ${path.basename(wsRoot)} 的 Envir 目录下所有 .txt / .ini 文件执行英文转大写。\n\n此操作不可撤销，建议先备份。`,
	        { modal: false },
	        '确定执行'
	      );
	      if (confirm !== '确定执行') return;

	      return vscode.window.withProgress({
	        location: vscode.ProgressLocation.Notification,
	        title: 'BOO 全部英文转大写',
	        cancellable: true
	      }, async (progress, token) => {
	        // 递归收集 Envir 下所有 .txt / .ini 文件
	        const files: vscode.Uri[] = [];
	        function collectFiles(dir: string) {
	          if (token.isCancellationRequested) return;
	          try {
	            const entries = fs.readdirSync(dir, { withFileTypes: true });
	            for (const e of entries) {
	              const full = path.join(dir, e.name);
	              if (e.isDirectory()) {
	                collectFiles(full);
	              } else if (e.name.endsWith('.txt') || e.name.endsWith('.ini')) {
	                files.push(vscode.Uri.file(full));
	              }
	            }
	          } catch (err) {
	            console.warn('[BOO] 扫描目录失败:', err instanceof Error ? err.message : String(err));
	          }
	        }
	        collectFiles(envirDir);

	        const total = files.length;
	        if (total === 0) {
	          vscode.window.showInformationMessage('Envir 目录下未找到 .txt / .ini 文件');
	          return;
	        }

	        let changed = 0;
	        let unchanged = 0;
	        let failed = 0;
	        let done = 0;

	        const iconv = require('iconv-lite');
	        await runConcurrent(files, 8, async (file) => {
	          if (token.isCancellationRequested) return;
	          try {
	            const raw = await vscode.workspace.fs.readFile(file);
	            const text = readFileGBK(raw);
	            const transformed = text.replace(/[a-z]/g, (ch: string) => ch.toUpperCase());
	            if (transformed === text) {
	              unchanged++;
	            } else {
	              const gbkBuf = iconv.encode(transformed, 'gbk');
	              await vscode.workspace.fs.writeFile(file, Buffer.from(gbkBuf));
	              changed++;
	            }
	          } catch (e) {
	            failed++;
	            console.warn('[BOO] 转大写失败:', file.fsPath, e instanceof Error ? e.message : String(e));
	          }
	          done++;
	          progress.report({ increment: 100 / total, message: `${done}/${total}` });
	        });

	        if (token.isCancellationRequested) {
	          vscode.window.showWarningMessage(`转大写已取消。已完成 ${done}/${total} 个文件。`);
	          return;
	        }

	        vscode.window.showInformationMessage(
	          `BOO 全部转大写完成：${total} 个文件 | ${changed} 个已转换 | ${unchanged} 个无变化${failed > 0 ? ' | ' + failed + ' 个失败' : ''}`
	        );
	      });
	    }),
    // ---- 自动加载设置 ----
    vscode.commands.registerCommand('boo.autoLoadSettings', () => {
      const panel = vscode.window.createWebviewPanel(
        'booAutoLoad', 'BOO 自动加载设置', vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true }
      );
      const autoReload = context.workspaceState.get('boo.autoReload', true);
      const autoOpen = context.workspaceState.get('boo.autoOpenEditor', true);
      const autoCompletion = vscode.workspace.getConfiguration('boo').get('enableCompletion', true);
      const autoDiagnostics = vscode.workspace.getConfiguration('boo').get('enableDiagnostics', true);
      const engine = vscode.workspace.getConfiguration('boo').get<string>('engine', 'GOM');
      const reloadKey = `boo.reloadItems_${engine}`;
      const allReloadOpts = getReloadOptions(engine);
      // 清理旧版数字ID存储
      const oldItems = context.workspaceState.get<number[]>('boo.reloadItems');
      if (oldItems) context.workspaceState.update('boo.reloadItems', undefined);
      // 菜单 ID 会随 M2 版本变化；旧数字配置只能安全回落到按名称匹配。
      let raw = context.workspaceState.get<(string|number)[]>(reloadKey);
      if (allReloadOpts.length === 0) {
        raw = [];
      } else {
        const normalized = normalizeReloadSelection(raw);
        raw = normalized.items;
        if (normalized.changed) {
          context.workspaceState.update(reloadKey, raw);
        }
      }
      const reloadItemStr = JSON.stringify(raw.map(String));

      panel.webview.html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
*{margin:0;padding:0}body{background:#1e1e1e;color:#d4d4d4;font-family:'Microsoft YaHei';padding:20px}
h2{color:#ff8c00;margin-bottom:16px;font-size:18px}
.section{color:#00d4ff;font-size:13px;margin:16px 0 8px;padding-bottom:4px;border-bottom:1px solid #333}
.row{display:flex;align-items:center;justify-content:space-between;padding:12px;margin:6px 0;background:#2a2a2a;border-radius:8px}
.row .label{font-size:14px;color:#e0e0e0}
.row .desc{font-size:11px;color:#888;margin-top:2px}
.sw{width:44px;height:24px;border-radius:12px;background:#555;cursor:pointer;position:relative;flex-shrink:0;transition:background .2s}
.sw.on{background:#0e639c}
.sw .dot{width:20px;height:20px;border-radius:50%;background:#fff;position:absolute;top:2px;left:2px;transition:left .2s}
.sw.on .dot{left:22px}
.input{width:80px;padding:4px 8px;background:#333;color:#fff;border:1px solid #555;border-radius:4px;font-size:13px;text-align:center}
.hint{color:#666;font-size:11px;margin-left:8px}
</style></head><body>
<h2>自动加载设置</h2>
<div class="row" onclick="toggle('autoOpen')">
<div><div class="label">自动打开可视化编辑器</div><div class="desc">启动后自动打开UI编辑器标签页</div></div>
<div class="sw${autoOpen?' on':''}" id="swAutoOpen"><span class="dot"></span></div>
</div>
<div class="row" onclick="toggle('completion')">
<div><div class="label">启用代码补全</div><div class="desc">输入命令时自动提示并补全</div></div>
<div class="sw${autoCompletion?' on':''}" id="swCompletion"><span class="dot"></span></div>
</div>
<div class="row" onclick="toggle('diagnostics')">
<div><div class="label">启用代码审查</div><div class="desc">实时扫描脚本错误并标注</div></div>
<div class="sw${autoDiagnostics?' on':''}" id="swDiagnostics"><span class="dot"></span></div>
</div>
<div class="section">M2自动重载 (保存脚本时触发)</div>
<div class="row" onclick="toggle('autoReload')">
<div><div class="label">启用M2自动重载</div><div class="desc">保存Envir脚本文件时自动通知M2Server重载选中项</div></div>
<div class="sw${autoReload?' on':''}" id="swAutoReload"><span class="dot"></span></div>
</div>
<p style="color:#ff8c00;font-size:12px;margin:8px 0;padding:8px;background:#3a2a00;border-radius:4px">⚠ 需要以<b>管理员身份</b>运行 VS Code，否则无法向 M2Server 窗口发送重载指令。</p>
<p style="color:#888;font-size:12px;margin:8px 0 4px">保存时自动重载以下项目：</p>
<div id="reloadChecks"></div>
<div class="row" onclick="scanM2()">
<div><div class="label">扫描M2Server菜单</div><div class="desc">获取M2Server所有菜单项及命令ID</div></div>
<div style="background:#0e639c;color:#fff;padding:6px 16px;border-radius:4px;cursor:pointer;font-size:12px">扫描</div>
</div>
<div id="scanResult" style="padding:0;font-size:11px;color:#888;max-height:200px;overflow-y:auto;white-space:pre-wrap;display:none"></div>
<script>
var v=acquireVsCodeApi();
var s={autoOpen:${autoOpen},completion:${autoCompletion},diagnostics:${autoDiagnostics},autoReload:${autoReload}};
var opts=${JSON.stringify(allReloadOpts)};
var checked=${reloadItemStr};
function isChecked(name){return checked.indexOf(name)>=0}
function toggle(k){
s[k]=!s[k];
var el=document.getElementById('sw'+k.charAt(0).toUpperCase()+k.slice(1));
if(el)el.classList.toggle('on',s[k]);
v.postMessage({type:'set',key:k,value:s[k]});
}
function toggleItem(name){
if(isChecked(name)) checked=checked.filter(function(x){return x!==name});
else checked.push(name);
v.postMessage({type:'set',key:'reloadItems',value:checked.slice()});
renderChecks();
}
function scanM2(){
document.getElementById('scanResult').style.display='block';
document.getElementById('scanResult').textContent='正在扫描M2Server...';
v.postMessage({type:'scan'});
}
function renderChecks(){
var h='';
for(var i=0;i<opts.length;i++){
var o=opts[i],on=isChecked(o.label);
h+='<div class="row" data-rlv="'+o.label+'" style="padding:4px 10px;margin:2px 0;cursor:pointer"><div class="label" style="font-size:12px">'+o.label+'</div><div class="sw'+(on?' on':'')+'"><span class="dot"></span></div></div>';
}
document.getElementById('reloadChecks').innerHTML=h;
}
document.getElementById('reloadChecks').addEventListener('click',function(e){
var row=e.target.closest('[data-rlv]');
if(!row) return;
toggleItem(row.getAttribute('data-rlv'));
});
renderChecks();
window.addEventListener('message',function(e){
if(e.data.type==='scanResult'){
var el=document.getElementById('scanResult');
el.style.display='block';
if(e.data.items && e.data.items.length>0){
opts=e.data.items;
renderChecks();
el.textContent='已更新为扫描到的 '+e.data.items.length+' 个菜单项 (勾选后保存即可)';
}else{
el.textContent=e.data.text||'扫描完成';
}
}
});
</script></body></html>`;
      panel.webview.html = secureWebviewHtml(
        panel.webview,
        panel.webview.html,
        { allowInlineEventHandlers: true }
      );
      panel.webview.onDidReceiveMessage(async msg => {
        if (msg.type === 'set') {
          if (msg.key === 'autoOpen') context.workspaceState.update('boo.autoOpenEditor', msg.value);
          else if (msg.key === 'completion') vscode.workspace.getConfiguration('boo').update('enableCompletion', msg.value, vscode.ConfigurationTarget.Global);
          else if (msg.key === 'diagnostics') vscode.workspace.getConfiguration('boo').update('enableDiagnostics', msg.value, vscode.ConfigurationTarget.Global);
          else if (msg.key === 'autoReload') context.workspaceState.update('boo.autoReload', msg.value);
          else if (msg.key === 'reloadItems') context.workspaceState.update(reloadKey, msg.value);
        } else if (msg.type === 'scan') {
          const result = await scanM2Windows(context);
          // 解析 [重新加载] 子菜单项
          const items: {label:string}[] = [];
          if (result && !result.startsWith('ERR')) {
            const lines = result.split('\n');
            let inReload = false;
            for (const line of lines) {
              if (/^\s*\[重新加载/.test(line)) { inReload = true; continue; }
              if (inReload && /^\s*\[/.test(line)) break; // 下一个一级菜单
              if (inReload) {
                // 匹配 "    物品数据库(&I) ID=4" 或 "    物品数据库 ID=4"
                const m = line.match(/^\s+(.+?)\s*(?:\(&.\))?\s*ID=(\d+)/);
                if (m) items.push({ label: m[1].trim() });
              }
            }
          }
          panel.webview.postMessage({ type: 'scanResult', text: result || '扫描完成', items });
        }
      });
    }),

    // ---- 查找未使用标签 ----
    vscode.commands.registerCommand('boo.findUnusedLabels', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const lines: string[] = [];
      for (let i = 0; i < editor.document.lineCount; i++) lines.push(editor.document.lineAt(i).text);

      const defined = new Map<string, number>();
      const refs = new Set<string>();
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/\[@([^\]]+)\]/g);
        if (m) for (const lb of m) { const n = lb.substring(2, lb.length - 1).toUpperCase(); defined.set(n, i); }
        for (const reference of findScriptLabelReferences(lines[i])) {
          refs.add(normalizeScriptLabelKey(reference.name));
        }
      }

      const unused: { name: string; line: number }[] = [];
      for (const [name, line] of defined) {
        if (name === 'MAIN' || name === 'LOGIN') continue;
        if (isCurrentEngineDefaultScriptLabel(name)) continue;
        if (!refs.has(name)) unused.push({ name, line });
      }

      if (unused.length === 0) {
        vscode.window.showInformationMessage('所有标签都有引用！');
        return;
      }

      const items = unused.map(u => ({
        label: `[@${u.name}]`,
        description: `第${u.line + 1}行`,
        detail: '未被任何/@或GOTO引用'
      }));
      vscode.window.showQuickPick(items, {
        placeHolder: `发现 ${unused.length} 个未使用的标签`,
        title: '未使用标签列表'
      }).then(sel => {
        if (sel) {
          const idx = parseInt(sel.description!.replace(/\D/g, '')) - 1;
          const pos = new vscode.Position(idx, 0);
          editor.selection = new vscode.Selection(pos, pos);
          editor.revealRange(new vscode.Range(pos, pos));
        }
      });
    }),

    // ---- 脚本模板快速插入 ----
    vscode.commands.registerCommand('boo.insertTemplate', async () => {
      const templates = [
        { label: '$(symbol-class) NPC对话框模板', value: 'npc', detail: '#SAY对话框, 含文字和关闭' },
        { label: '$(check) 条件检测模板', value: 'check', detail: '#IF/#ACT检测模式' },
        { label: '$(package) 物品兑换模板', value: 'exchange', detail: '检查物品→扣除→给予' },
        { label: '$(server) 升级奖励模板', value: 'levelup', detail: '等级检测→给予奖励' },
        { label: '$(link) 跨文件调用模板', value: 'call', detail: '#CALL外部脚本' },
        { label: '$(symbol-variable) 变量操作模板', value: 'var', detail: 'MOV/INC/DEC变量' },
      ];
      const pick = await vscode.window.showQuickPick(templates, { placeHolder: '选择脚本模板' });
      if (!pick) return;

      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      let snippet = '';
      switch (pick.value) {
        case 'npc':
          snippet = "[@main]\n#SAY\n<{1:欢迎光临}/FColor=251>\\\n<{2:点击进入}/@enter>\\\n<{3:关闭}/@exit>\n\n#ACT\nGOTO @checkLevel\n\n[@enter]\n#IF\nCHECKLEVELEX > {4:50}\n#ACT\nMAPMOVE {5:D717} {6:100} {7:100}\nSENDMSG 5 你被传送到了新地图！\nBREAK\n#ELSEACT\nMESSAGEBOX 需要等级{4:50}以上才能进入！";
          break;
        case 'check':
          snippet = "#IF\nCHECKLEVELEX > {1:50}\nCHECKGAMEGOLD > {2:1000}\n#ACT\nGAMEGOLD - {2:1000}\nGIVE {3:物品名} {4:1}\nSENDMSG 6 兑换成功！\n#ELSEACT\nMESSAGEBOX 条件不足！";
          break;
        case 'exchange':
          snippet = "[@exchange]\n#IF\nCHECKITEM {1:物品名} {2:1}\n#ACT\nTAKE {1:物品名} {2:1}\nGIVE {3:奖励物品} {4:1}\nSENDMSG 6 兑换成功！\n#ELSEACT\nMESSAGEBOX 你没有{1:物品名}！";
          break;
        case 'levelup':
          snippet = "[@levelup]\n#IF\nCHECKLEVELEX = {1:100}\n#ACT\nGIVE {2:奖励物品} {3:1}\nSENDMSG 0 恭喜<$USERNAME>达到{1:100}级,获得奖励{2:奖励物品}！\nBREAK";
          break;
        case 'call':
          snippet = "#CALL [\\\\{1:文件夹}\\\\{2:文件名}.txt] @{3:标签}";
          break;
        case 'var':
          snippet = "#IF\n#ACT\nMOV {1:N\\$变量名} {2:0}\nINC {1:N\\$变量名} {3:1}\nSENDMSG 6 N\\$变量名 = <\\$STR({1:N\\$变量名})>";
          break;
      }

      if (snippet) {
        await editor.insertSnippet(new vscode.SnippetString(snippet));
        vscode.window.setStatusBarMessage('BOO: 模板已插入', 3000);
      }
    }),

    // ---- 添加变量备注 ----
    vscode.commands.registerCommand('boo.addVarDesc', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const line = editor.document.lineAt(editor.selection.active.line).text;
      const varMatch = line.match(/\b(N\$[A-Za-z0-9_\u4e00-\u9fff]+|S\$[A-Za-z0-9_\u4e00-\u9fff]+|[PDMNSIGAUTJZpdmnigautjz]\d+)\b/);
      const defaultVar = varMatch ? varMatch[1] : '';
      const varName = await vscode.window.showInputBox({ prompt: '输入变量名', value: defaultVar, placeHolder: 'N$变量名' });
      if (!varName) return;
      const varDesc = await vscode.window.showInputBox({ prompt: `为 ${varName} 添加备注`, placeHolder: '变量用途描述' });
      if (!varDesc) return;
      const allDescs: Record<string, string> = context.workspaceState.get('boo.varDescs', {});
      allDescs[varName] = varDesc;
      context.workspaceState.update('boo.varDescs', allDescs);
      vscode.window.showInformationMessage(`已为 ${varName} 添加备注`);
    }),

    // ---- 添加行备注 (codeLens) ----
    vscode.commands.registerCommand('boo.addLineNote', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const lineNum = editor.selection.active.line;
      const notes: Record<string, Record<number, string>> = context.workspaceState.get('boo.lineNotes', {});
      const docKey = editor.document.uri.toString();
      if (!notes[docKey]) notes[docKey] = {};
      const existing = notes[docKey][lineNum] || '';
      const note = await vscode.window.showInputBox({
        prompt: `第 ${lineNum + 1} 行备注 (留空删除)`,
        value: existing,
        placeHolder: '输入此行脚本的说明'
      });
      if (note === undefined) return;
      if (note === '') {
        delete notes[docKey][lineNum];
        if (Object.keys(notes[docKey]).length === 0) delete notes[docKey];
      } else {
        notes[docKey][lineNum] = note;
      }
      context.workspaceState.update('boo.lineNotes', notes);
    }),

    // ---- 清除行备注 ----
    vscode.commands.registerCommand('boo.clearLineNotes', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const yes = await vscode.window.showWarningMessage('确定清除当前文件所有行备注？', { modal: false }, '确定');
      if (yes !== '确定') return;
      const notes: Record<string, Record<number, string>> = context.workspaceState.get('boo.lineNotes', {});
      const docKey = editor.document.uri.toString();
      delete notes[docKey];
      context.workspaceState.update('boo.lineNotes', notes);
      vscode.window.showInformationMessage('已清除所有行备注');
    }),

    // ---- 全量代码审查 - GPTea ----
    vscode.commands.registerCommand('boo.diagnoseAll', () => diagnoseAllFiles()),

    // ---- 变量统计 - GPTea ----
    vscode.commands.registerCommand('boo.analyzeVariables', () => analyzeVariables()),

    // ---- ANIS特殊符号 ----
    vscode.commands.registerCommand('boo.showAnisSymbols', () => {
      const panel = vscode.window.createWebviewPanel(
        'booAnis', 'BOO ANIS特殊符号', vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true }
      );
      panel.webview.html = secureWebviewHtml(
        panel.webview,
        buildAnisSymbolsHTML()
      );
      panel.webview.onDidReceiveMessage(msg => {
        if (msg.type === 'insertSymbol') {
          const editor = vscode.window.activeTextEditor;
          if (editor) {
            editor.edit(eb => eb.insert(editor.selection.active, msg.symbol));
          }
        }
      });
    }),

    // ---- 编码检测 ----
    vscode.commands.registerCommand('boo.detectEncoding', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      try {
        const uri = editor.document.uri;
        const buf = await vscode.workspace.fs.readFile(uri);
        const enc = detectFileEncoding(buf);
        vscode.window.showInformationMessage(
          `检测到文件编码: ${enc.label} (BOM: ${enc.hasBOM ? '是' : '否'}, 含中文: ${enc.hasChinese ? '是' : '否'})`
        );
      } catch (e: unknown) {
        vscode.window.showErrorMessage(`编码检测失败: ${e instanceof Error ? e.message : String(e)}`);
      }
    }),

    // ---- 数据库查看器 ----
    vscode.commands.registerCommand('boo.openDatabase', async () => {
      const activeEngine = getEngineDefinition(
        vscode.workspace.getConfiguration('boo').get<string>('engine', 'GOM')
      );
      if (!activeEngine.databaseVerified) {
        vscode.window.showWarningMessage(
          `${activeEngine.label} 的数据库协议尚未通过安全读写验收，当前不会套用其他引擎的数据库规则。`
        );
        return;
      }
      if (databasePanel) { databasePanel.reveal(); return; }
      await vscode.commands.executeCommand('workbench.view.extension.boo-database');
      const panel = vscode.window.createWebviewPanel(
        'booDatabase', 'BOO 数据库查看器', vscode.ViewColumn.Active,
        databaseViewerWebviewOptions(context)
      );
      databasePanel = panel;
      let databaseSession: DatabaseBrowserSession | undefined;
      let databaseRequestVersion = 0;
      let databaseMutationPending = false;
      let databasePanelDisposed = false;
      panel.onDidDispose(() => {
        databasePanelDisposed = true;
        databaseRequestVersion++;
        databaseSession?.dispose();
        databaseSession = undefined;
        databasePanel = undefined;
      });
      panel.onDidChangeViewState(event => {
        if (!event.webviewPanel.visible) {
          databaseRequestVersion++;
          databaseSession?.releaseActive();
        }
      });
      panel.webview.html = databaseViewerWebviewHtml(context, panel.webview);

      panel.webview.onDidReceiveMessage(async msg => {
        if (msg.type === 'clearDatabaseDetail') {
          postToSidebar({
            type: 'clearDatabaseDetail',
            detailKind: classifyDatabaseDetail(msg.tableName, msg.tableLabel),
          });
          return;
        }
        if (msg.type === 'showDatabaseDetail') {
          const itemName = msg.name || '';
          const fields = msg.fields || {};
          const columnLabels = msg.columnLabels || {};
          const columnDescriptions = msg.columnDescriptions || {};
          const detailKind = classifyDatabaseDetail(msg.tableName, msg.tableLabel);
          const wsRoot2 = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (wsRoot2) {
            const engineRoot2 = resolveEngineRoot(wsRoot2);
            const envirDir2 = path.join(engineRoot2, 'Mir200', 'Envir');
            if (detailKind === 'monster') {
              const supplement = loadMonsterDatabaseDetail(envirDir2, itemName);
              const preview = buildMonsterIconPreviews(supplement.icons, resolvePakImageAsset);
              const activeEngine = normalizeEngineId(
                vscode.workspace.getConfiguration('boo').get<string>('engine', 'GOM')
              );
              const body = describeMonsterBodyAppearance(
                envirDir2,
                itemName,
                fields,
                activeEngine
              );
              const bodyAsset = body.source === 'archive' && body.pakName
                ? resolveCachedPatchPakImageAsset(body.pakName, body.imageIndex)
                : body.source === 'will' && body.willIndex !== undefined
                  ? resolvePakImageAsset(body.willIndex, body.imageIndex)
                  : { url: '' };
              postToSidebar({
                type: 'showDatabaseDetail',
                detailKind,
                name: itemName,
                fields,
                columnLabels,
                columnDescriptions,
                dropRateText: supplement.dropRateText,
                dropRateFileName: supplement.dropRateFileName,
                iconText: supplement.iconText,
                iconFileName: supplement.iconFileName,
                monsterIcons: preview.icons,
                iconConfigTruncated: preview.iconConfigTruncated,
                monsterBody: { ...body, ...bodyAsset },
              });
              return;
            }

            if (detailKind !== 'item') {
              postToSidebar({
                type: 'showDatabaseDetail',
                detailKind,
                name: itemName,
                fields,
                columnLabels,
                columnDescriptions,
              });
              return;
            }

            let topDesc = '', itemDesc = '';
            try {
              const tp = path.join(envirDir2, 'ItemDescTopList.txt');
              if (fs.existsSync(tp)) {
                const tc = readFileGBK(fs.readFileSync(tp));
                for (const l of tc.split(String.fromCharCode(10))) {
                  const eq = l.indexOf('=');
                  if (eq > 0 && l.substring(0, eq).trim() === itemName) { topDesc = l.substring(eq + 1).trim(); break; }
                }
              }
            } catch (e) {
              console.warn('[BOO] 读取物品描述(Top)失败:', e instanceof Error ? e.message : String(e));
            }
            try {
              const dp = path.join(envirDir2, 'ItemDescList.txt');
              if (fs.existsSync(dp)) {
                const dc = readFileGBK(fs.readFileSync(dp));
                for (const l of dc.split(String.fromCharCode(10))) {
                  const eq = l.indexOf('=');
                  if (eq > 0 && l.substring(0, eq).trim() === itemName) { itemDesc = l.substring(eq + 1).trim(); break; }
                }
              }
            } catch (e) {
              console.warn('[BOO] 读取物品描述(Desc)失败:', e instanceof Error ? e.message : String(e));
            }
            const allText = (topDesc + String.fromCharCode(10) + itemDesc);
            const descriptionMedia = resolveItemDescriptionMedia(allText, resolvePakImage);
            const itemImageReference = resolveItemImageReference(findItemLooksValue(fields));
            const itemImage = itemImageReference
              ? resolveCachedPatchPakImage(itemImageReference.pakName, itemImageReference.imageIndex)
              : '';
            postToSidebar({
              type: 'showDatabaseDetail',
              detailKind,
              name: itemName,
              topDesc,
              itemDesc,
              fields,
              columnLabels,
              columnDescriptions,
              images: descriptionMedia.images,
              animatedImages: descriptionMedia.animations,
              itemImage,
              itemImageLabel: itemImageReference
                ? `${itemImageReference.pakName}.${activeEngine.archiveExtensions[0]} / ${String(itemImageReference.imageIndex).padStart(6, '0')}`
                : '',
            });
          }
          return;
        }
        if (msg.type === 'ready') {
          try {
            const wsFolders = vscode.workspace.workspaceFolders;
            if (!wsFolders || wsFolders.length === 0) {
              panel.webview.postMessage({ type: 'databaseCatalog', tables: [], dbType: '未打开工作区', totalCount: 0 });
              return;
            }
            const wsRoot = wsFolders[0].uri.fsPath;
            const engineRoot = resolveEngineRoot(wsRoot);
            const databaseProfile = activeEngine.id === '996PC' ? '996pc' : 'legacy';
            const dbDir = databaseProfile === '996pc'
              ? path.join(engineRoot, 'Mir200', 'Envir', 'Data')
              : path.join(engineRoot, 'MUD2', 'db');
            databaseSession ||= new DatabaseBrowserSession(dbDir, databaseProfile);
            const catalog = await databaseSession.initialize();
            if (!databasePanelDisposed) panel.webview.postMessage({ type: 'databaseCatalog', ...catalog });
          } catch (e: unknown) {
            panel.webview.postMessage({ type: 'databaseError', error: e instanceof Error ? e.message : String(e) });
          }
          return;
        }
        if (
          msg.type === 'createDatabaseRow' ||
          msg.type === 'updateDatabaseRow' ||
          msg.type === 'updateDatabaseRows' ||
          msg.type === 'deleteDatabaseRow' ||
          msg.type === 'updateDatabaseSchema' ||
          msg.type === 'undoDatabaseMutation'
        ) {
          const mutationRequestId = Number(msg.requestId) || 0;
          if (databaseMutationPending) {
            panel.webview.postMessage({
              type: 'databaseMutationError',
              requestId: mutationRequestId,
              error: '另一项数据库修改正在执行，请稍候',
            });
            return;
          }
          databaseMutationPending = true;
          databaseRequestVersion++;
          try {
            if (!databaseSession) throw new Error('数据库尚未初始化');
            if (msg.type === 'undoDatabaseMutation') {
              const result = await databaseSession.undoLastMutation();
              const catalog = await databaseSession.initialize();
              if (!databasePanelDisposed) {
                panel.webview.postMessage({
                  type: 'databaseUndoResult',
                  requestId: mutationRequestId,
                  result,
                  catalog,
                });
              }
              return;
            }
            const tableId = String(msg.tableId || '');
            let result;
            if (msg.type === 'createDatabaseRow') {
              result = await databaseSession.createRow(
                tableId,
                msg.values && typeof msg.values === 'object' ? msg.values : {}
              );
            } else if (msg.type === 'updateDatabaseRow') {
              result = await databaseSession.updateRow(
                tableId,
                msg.rowId,
                msg.values && typeof msg.values === 'object' ? msg.values : {}
              );
            } else if (msg.type === 'updateDatabaseRows') {
              if (Array.isArray(msg.updates) && msg.updates.length > 200) {
                throw new Error('单次最多修改 200 行记录');
              }
              const updates: DatabaseRowUpdate[] = Array.isArray(msg.updates)
                ? msg.updates.map((update: unknown) => {
                  const value = update && typeof update === 'object'
                    ? update as Record<string, unknown>
                    : {};
                  return {
                    rowId: value.rowId,
                    values: value.values && typeof value.values === 'object' && !Array.isArray(value.values)
                      ? value.values as Record<string, unknown>
                      : {},
                  };
                })
                : [];
              result = await databaseSession.updateRows(tableId, updates);
            } else if (msg.type === 'deleteDatabaseRow') {
              result = await databaseSession.deleteRow(tableId, msg.rowId);
            } else {
              const columns: DatabaseSchemaColumnUpdate[] = Array.isArray(msg.columns)
                ? msg.columns.map((column: unknown) => {
                  const value = column && typeof column === 'object'
                    ? column as Record<string, unknown>
                    : {};
                  return {
                    sourceName: String(value.sourceName || ''),
                    name: String(value.name || ''),
                    type: String(value.type || 'TEXT'),
                  };
                })
                : [];
              result = await databaseSession.updateSchema(tableId, columns);
            }
            const catalog = await databaseSession.initialize();
            const table = catalog.tables.find(candidate => candidate.id === tableId);
            if (!databasePanelDisposed) {
              panel.webview.postMessage({
                type: 'databaseMutationResult',
                requestId: mutationRequestId,
                result,
                table,
                totalCount: catalog.totalCount,
              });
            }
          } catch (e: unknown) {
            if (!databasePanelDisposed) {
              panel.webview.postMessage({
                type: msg.type === 'undoDatabaseMutation'
                  ? 'databaseUndoError'
                  : 'databaseMutationError',
                requestId: mutationRequestId,
                error: e instanceof Error ? e.message : String(e),
              });
            }
          } finally {
            databaseMutationPending = false;
          }
          return;
        }
        if (msg.type === 'loadDatabasePage') {
          const requestId = Number(msg.requestId) || 0;
          const requestVersion = ++databaseRequestVersion;
          try {
            if (!databaseSession) throw new Error('数据库尚未初始化');
            const filters = Array.isArray(msg.filters)
              ? msg.filters.slice(0, 8).map((filter: unknown) => {
                const value = filter && typeof filter === 'object'
                  ? filter as Record<string, unknown>
                  : {};
                return {
                  column: String(value.column || ''),
                  values: Array.isArray(value.values)
                    ? value.values
                      .filter(item => typeof item === 'string' || typeof item === 'number')
                      .slice(0, 64) as (string | number)[]
                    : [],
                };
              }).filter((filter: { column: string; values: (string | number)[] }) =>
                filter.column && filter.values.length > 0
              )
              : [];
            const request: DatabasePageRequest = {
              tableId: String(msg.tableId || ''),
              offset: Number(msg.offset) || 0,
              limit: Number(msg.limit) || 100,
              query: String(msg.query || ''),
              searchColumn: String(msg.searchColumn || ''),
              matchMode: msg.matchMode === 'exact' ? 'exact' : 'contains',
              filters,
              sortColumn: String(msg.sortColumn || ''),
              sortDirection: msg.sortDirection === 'desc' ? 'desc' : 'asc',
            };
            const page = await databaseSession.loadPage(
              request,
              () => databasePanelDisposed || requestVersion !== databaseRequestVersion
            );
            if (!databasePanelDisposed && requestVersion === databaseRequestVersion) {
              panel.webview.postMessage({ type: 'databasePage', requestId, ...page });
            }
          } catch (e: unknown) {
            if (e instanceof DatabaseRequestCancelledError) return;
            if (!databasePanelDisposed && requestVersion === databaseRequestVersion) {
              panel.webview.postMessage({
                type: 'databaseError',
                requestId,
                error: e instanceof Error ? e.message : String(e),
              });
            }
          }
        }
      });
    }),

    // ---- 地图查看器 ----
    vscode.commands.registerCommand('boo.openMapViewer', async () => {
      const activeEngine = getEngineDefinition(
        vscode.workspace.getConfiguration('boo').get<string>('engine', 'GOM')
      );
      if (!activeEngine.mapPreviewVerified) {
        vscode.window.showWarningMessage(
          `${activeEngine.label} 的小地图定位规则尚未完成验收。`
        );
        return;
      }
      const panel = vscode.window.createWebviewPanel(
        'booMap', 'BOO 地图查看器', vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true }
      );
      mapViewerPanels.add(panel);
      panel.onDidDispose(() => mapViewerPanels.delete(panel));
      const htmlPath = path.join(context.extensionPath, 'media', 'map-viewer.html');
      panel.webview.html = secureWebviewHtml(
        panel.webview,
        fs.readFileSync(htmlPath, 'utf-8'),
        { allowInlineEventHandlers: true }
      );

      const wsFolders = vscode.workspace.workspaceFolders;
      const wsRoot = wsFolders?.[0]?.uri.fsPath || '';

      function readMapFile(mapPath: string) {
        try {
          const buf = fs.readFileSync(mapPath);
          const arr = new Uint8Array(buf);
          if (arr.length < 52) return null;
          const w = arr[0] | (arr[1] << 8);
          const h = arr[2] | (arr[3] << 8);
          if (w <= 0 || h <= 0 || w > 2000 || h > 2000) return null;
          // 根据文件大小自动判断格式: 52 + W*H*tileSize
          const tileSize = Math.round((arr.length - 52) / (w * h));
          const validSizes = [12, 14, 36];
          if (!validSizes.includes(tileSize)) return null; // 未知格式
          const formatName = tileSize === 12 ? '12Byte' : tileSize === 14 ? '14Byte' : '36Byte';
          // 列优先存储: offset = 52 + (x * H + y) * tileSize
          const blocking: number[] = new Array(w * h);
          const bngData: number[] = new Array(w * h);
          const objData: number[] = new Array(w * h);
          const midData: number[] = new Array(w * h);
          const wilTiles = new Set<number>();
          const wilObjects = new Set<number>();
          const wilSmTiles = new Set<number>();
          for (let x = 0; x < w; x++) {
            for (let y = 0; y < h; y++) {
              const off = 52 + (x * h + y) * tileSize;
              if (off + 11 >= arr.length) break;
              const bng = arr[off] | (arr[off + 1] << 8);
              const mid = arr[off + 2] | (arr[off + 3] << 8);
              const obj = arr[off + 4] | (arr[off + 5] << 8);
              const idx = y * w + x;
              blocking[idx] = ((bng & 0x8000) || (obj & 0x8000)) ? 1 : 0;
              bngData[idx] = bng & 0x7FFF;
              objData[idx] = obj & 0x7FFF;
              midData[idx] = mid & 0x7FFF;
              // 收集WIL文件引用号
              if (tileSize >= 14) { if (arr[off + 12]) wilTiles.add(arr[off + 12]); if (arr[off + 13]) wilSmTiles.add(arr[off + 13]); }
              if (arr[off + 10]) wilObjects.add(arr[off + 10]);
            }
          }
          const refs = { tiles: [...wilTiles].sort((a,b)=>a-b), objects: [...wilObjects].sort((a,b)=>a-b), smtiles: [...wilSmTiles].sort((a,b)=>a-b) };
          return { width: w, height: h, blocking, bng: bngData, obj: objData, mid: midData, format: formatName, fileName: path.basename(mapPath), wilRefs: refs };
        } catch (_) { return null; }
      }

      function scanMapDir(): { name: string; size: number }[] {
        const bases = [path.join(wsRoot, 'Mir200', 'Map'), path.join(wsRoot, 'Map')];
        for (const base of bases) {
          try {
            if (fs.existsSync(base)) {
              return fs.readdirSync(base)
                .filter(f => f.toLowerCase().endsWith('.map'))
                .map(f => ({ name: f, size: fs.statSync(path.join(base, f)).size }))
                .sort((a, b) => a.name.localeCompare(b.name));
            }
          } catch (e) {
            console.warn('[BOO] 地图目录读取失败:', e instanceof Error ? e.message : String(e));
          }
        }
        return [];
      }

      function withMiniMapImage(mapPath: string, data: ReturnType<typeof readMapFile>) {
        if (!data) return data;
        const reference = findMiniMapReference(wsRoot, path.basename(mapPath));
        if (!reference) return data;
        const patchState = context.workspaceState.get<SavedPatchManagerState>(
          patchManagerStateKey(activeEngine.id)
        ) || context.workspaceState.get<SavedPatchManagerState>(PATCH_MANAGER_STATE_KEY);
        const belongsToEngine = patchState && (
          !patchState.engine || patchState.engine === activeEngine.id
        );
        const resourceRoots = belongsToEngine
          ? clientResourceLayoutFromState(patchState)?.dataRoots || []
          : [];
        const patchCacheRoot = getPatchCacheRoot(context);
        const cachedImage = findCachedPatchImage(
          patchCacheRoot,
          reference.pakName,
          reference.imageIndex,
          resourceRoots,
          uiEditorArchiveExtensions(activeEngine.id)
        );
        if (!cachedImage) {
          return {
            ...data,
            miniMapCode: reference.code,
            miniMapPak: reference.pakName,
            miniMapIndex: reference.imageIndex,
          };
        }
        panel.webview.options = {
          enableScripts: true,
          localResourceRoots: webviewResourceRoots(
            cachedImage.imagePath ? [cachedImage.pak.cacheDir] : []
          ),
        };
        return {
          ...data,
          miniMapCode: reference.code,
          miniMapPak: reference.pakName,
          miniMapIndex: reference.imageIndex,
          miniMapUrl: panel.webview.asWebviewUri(cachedPatchImageUri(cachedImage)).toString(),
        };
      }

      function postMap(mapPath: string): void {
        const data = withMiniMapImage(mapPath, readMapFile(mapPath));
        if (data) panel.webview.postMessage({ type: 'updateMap', ...data });
      }

      panel.webview.onDidReceiveMessage(async msg => {
        if (msg.type === 'ready') {
          const files = scanMapDir();
          panel.webview.postMessage({ type: 'mapList', files });
          // 如果当前编辑器打开的是.map文件，自动加载
          const editor = vscode.window.activeTextEditor;
          if (editor && editor.document.fileName.endsWith('.map')) {
            postMap(editor.document.uri.fsPath);
          }
        } else if (msg.type === 'loadMap') {
          const bases = [path.join(wsRoot, 'Mir200', 'Map'), path.join(wsRoot, 'Map')];
          for (const base of bases) {
            const mapPath = path.join(base, msg.fileName);
            if (fs.existsSync(mapPath)) {
              postMap(mapPath);
              break;
            }
          }
        }
      });
    }),

    // ---- 代码补全编辑器 ----
    vscode.commands.registerCommand('boo.openCompletionEditor', async () => {
      const panel = vscode.window.createWebviewPanel(
        'booCompletionEditor', 'BOO 代码补全编辑器', vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true }
      );

      // 加载所有数据
      const extPath = context.extensionPath;
      const loadJson = (f: string) => { try { return JSON.parse(fs.readFileSync(path.join(extPath, 'data', f), 'utf-8')); } catch { return null; } };
      const commandsAll = loadJson('commands.json');
      const varsAll = loadJson('variables.json');
      const editorFunctionCatalog = new Map(
        ENGINE_DEFINITIONS.map(definition => [
          definition.id,
          loadJson(definition.functionFile) || {},
        ])
      );
      const editorConstantCatalog = new Map(
        ENGINE_DEFINITIONS.map(definition => [
          definition.id,
          loadJson(definition.constantsFile)?.constants || [],
        ])
      );
      type CompletionEditorStorage =
        | 'command-check'
        | 'command-exec'
        | 'variable'
        | 'function'
        | 'trigger'
        | 'constant'
        | 'static-say';
      type CompletionEditorRow = {
        name: string;
        engineId: EngineId;
        storage: CompletionEditorStorage;
        syntax: string;
        desc: string;
        params: string;
        sourceIndex?: number;
        customId?: string;
        isCustom?: boolean;
      };
      const commandRows = (
        entries: CommandEntry[],
        engine: EngineId,
        storage: 'command-check' | 'command-exec'
      ): CompletionEditorRow[] => (
        entries.flatMap<CompletionEditorRow>((entry, sourceIndex) => {
          const variant = entry.engineVariants?.[engine];
          if (!entry.engines?.includes(engine) || !variant?.name) return [];
          const verified = variant.completionVerified === true;
          return [{
            name: commandToken(variant.name),
            engineId: engine,
            storage,
            syntax: verified ? variant.syntax || variant.name : variant.name,
            desc: verified
              ? variant.description || ''
              : `${variant.description || ''}（完整参数格式未核验，仅保留名称）`,
            params: verified ? (variant.params || []).join(' ') : '',
            sourceIndex,
          }];
        })
      );
      const variableRows = (
        entries: VariablesData['variables'],
        engine: EngineId
      ): CompletionEditorRow[] => entries.flatMap((variable, sourceIndex) => {
        const variant = variable.engineVariants?.[engine];
        if (!variable.engines?.includes(engine) || !variant?.name) return [];
        return [{
          name: variant.full || variant.name,
          engineId: engine,
          storage: 'variable',
          syntax: variant.name,
          desc: variant.desc || variant.description || '',
          params: variant.scope || '',
          sourceIndex,
        }];
      });
      const functionRows = (
        functions: Record<string, any>,
        engine: EngineId,
        includeChecks: boolean
      ): CompletionEditorRow[] => (
        Object.entries(functions || {}).flatMap(([name, value]: [string, any], sourceIndex) => {
          const isCheck = value.kind === 'check'
            || (Array.isArray(value.contexts) && value.contexts.includes('IF'));
          if (isCheck !== includeChecks) return [];
          const verified = value.completionVerified === true;
          return [{
            name: commandToken(name),
            engineId: engine,
            storage: 'function',
            syntax: verified
              ? value.syntax || (value.params ? `${name} ${value.params}` : name)
              : name,
            desc: verified
              ? value.details || ''
              : `${value.details || ''}（完整参数格式未核验，仅保留名称）`,
            params: verified ? value.params || '' : '',
            sourceIndex,
          }];
        })
      );
      const triggerRows = (
        entries: NonNullable<CommandsData['triggers']>,
        engine: EngineId
      ): CompletionEditorRow[] => entries.flatMap((trigger, sourceIndex) => {
        const variant = trigger.engineVariants?.[engine];
        if (!trigger.engines?.includes(engine) || !variant?.name) return [];
        return [{
          name: variant.label,
          engineId: engine,
          storage: 'trigger',
          syntax: variant.name,
          desc: variant.description || '',
          params: '',
          sourceIndex,
        }];
      });
      const constantRows = (
        entries: ConstantEntry[],
        engine: EngineId
      ): CompletionEditorRow[] => entries.map((constant, sourceIndex) => ({
        name: constant.full,
        engineId: engine,
        storage: 'constant' as const,
        syntax: constant.name,
        desc: constant.description,
        params: constant.scope || '',
        sourceIndex,
      }));
      const sayRows = (
        entries: StaticLanguageData['saySnippets'],
        engine: EngineId
      ): CompletionEditorRow[] => entries.flatMap((entry, sourceIndex) => {
        const variant = entry.engineVariants?.[engine];
        if (!variant?.label) return [];
        const activeEntry = { ...variant, id: entry.id, engines: [engine] };
        const params = variant.parameters?.map(parameter => (
          parameter.key
            ? `${parameter.key}：${parameter.description}`
            : parameter.description
        )) || sayMarkupParameterMeanings(activeEntry);
        return [{
          name: variant.label,
          engineId: engine,
          storage: 'static-say',
          syntax: variant.snippet || variant.label,
          desc: variant.description || '',
          params: params.join('；'),
          sourceIndex,
        }];
      });
      const customRows = (
        category: CustomLanguageCategory,
        engine: EngineId,
        storage: CompletionEditorStorage
      ): CompletionEditorRow[] => customLanguageEntries(customLanguageData, engine, category).map(entry => ({
        name: entry.name,
        engineId: engine,
        storage,
        syntax: entry.syntax,
        desc: entry.description,
        params: entry.params.join(category === 'say' ? '；' : ' '),
        customId: entry.id,
        isCustom: true,
      }));

      const mergeRows = (...groups: CompletionEditorRow[][]): CompletionEditorRow[] => {
        const rows = new Map<string, CompletionEditorRow>();
        for (const group of groups) {
          for (const row of group) {
            const key = `${row.engineId}:${row.name.toUpperCase()}`;
            if (!rows.has(key)) rows.set(key, row);
          }
        }
        return [...rows.values()];
      };

      const tabs = [
        {
          id: 'check',
          label: '检测命令',
          data: ENGINE_DEFINITIONS.flatMap(definition => [
            ...mergeRows(
              commandRows(commandsAll?.commands || [], definition.id, 'command-check'),
              functionRows(editorFunctionCatalog.get(definition.id) || {}, definition.id, true)
            ),
            ...customRows('check', definition.id, 'command-check'),
          ]),
        },
        {
          id: 'exec',
          label: '执行命令',
          data: ENGINE_DEFINITIONS.flatMap(definition => [
            ...mergeRows(
              commandRows(commandsAll?.execCommands || [], definition.id, 'command-exec'),
              functionRows(editorFunctionCatalog.get(definition.id) || {}, definition.id, false)
            ),
            ...customRows('action', definition.id, 'command-exec'),
          ]),
        },
        {
          id: 'say',
          label: '界面语句',
          data: ENGINE_DEFINITIONS.flatMap(definition => [
            ...sayRows(staticLanguageData.saySnippets, definition.id),
            ...customRows('say', definition.id, 'static-say'),
          ]),
        },
        {
          id: 'func',
          label: '引擎函数',
          data: ENGINE_DEFINITIONS.flatMap(definition => [
            ...triggerRows(commandsAll?.triggers || [], definition.id),
            ...customRows('function', definition.id, 'trigger'),
          ]),
        },
        {
          id: 'constant',
          label: '系统常量',
          data: ENGINE_DEFINITIONS.flatMap(definition => [
            ...mergeRows(
              variableRows(varsAll?.variables || [], definition.id),
              constantRows(editorConstantCatalog.get(definition.id) || [], definition.id)
            ),
            ...customRows('constant', definition.id, 'constant'),
          ]),
        },
      ];
      const initialEngine = normalizeEngineId(
        vscode.workspace.getConfiguration('boo').get<string>('engine', 'GOM')
      );

      function esc(s: string): string {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      }
      const scriptJson = (value: unknown): string => JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');

      panel.webview.html = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#1e1e1e;color:#d4d4d4;font-family:'Microsoft YaHei',monospace;display:flex;flex-direction:column;height:100vh;overflow:hidden}
.toolbar{display:flex;align-items:center;gap:8px;padding:8px 12px;background:#252525;border-bottom:1px solid #333;flex-shrink:0}
.toolbar input{flex:1;max-width:300px;padding:6px 10px;background:#333;color:#fff;border:1px solid #555;border-radius:4px;font-size:13px;outline:none}
.toolbar input:focus{border-color:#0e639c}
.toolbar button{padding:6px 14px;background:#0e639c;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px}
.toolbar button:hover{background:#1177bb}
.toolbar button.secondary{background:#3a3d41}
.toolbar button.secondary:hover{background:#50545a}
.toolbar button.danger{background:#8b0000}
.toolbar button.danger:hover{background:#a00}
.toolbar .count{color:#888;font-size:12px;margin-left:auto}
.engine-tabs{display:flex;align-items:center;gap:4px;padding:8px 12px;background:#1f1f1f;border-bottom:1px solid #3a3a3a;flex-shrink:0}
.engine-title{color:#9a9a9a;font-size:12px;margin-right:8px}
.engine-tab{padding:7px 18px;border:1px solid transparent;background:transparent;color:#aaa;cursor:pointer;font-size:13px}
.engine-tab:hover{color:#fff;background:#2d2d2d}
.engine-tab.active{color:#fff;background:#0e639c;border-color:#2389c8}
.tabs{display:flex;gap:0;padding:0 12px;background:#252525;border-bottom:1px solid #333;flex-shrink:0}
.tab{padding:8px 16px;cursor:pointer;color:#888;font-size:13px;border-bottom:2px solid transparent;transition:all .15s}
.tab:hover{color:#ccc}
.tab.active{color:#00d4ff;border-bottom-color:#00d4ff}
.table-wrap{flex:1;overflow:auto;padding:0}
table{width:100%;border-collapse:collapse;font-size:12px;table-layout:fixed}
thead{position:sticky;top:0;z-index:2}
th{background:#2a2a2a;color:#ff8c00;padding:8px 10px;text-align:left;border-bottom:2px solid #444;font-weight:600;white-space:nowrap}
th.col-name{width:170px} th.col-syntax{width:280px} th.col-desc{width:auto} th.col-params{width:210px} th.col-actions{width:52px;text-align:center}
td{padding:6px 10px;border-bottom:1px solid #2a2a2a;vertical-align:top}
td.name{color:#9cdcfe;font-weight:600}
td.syntax{color:#ceb194} td.desc{color:#aaa} td.params{color:#8b9dbb}
tr:hover td{background:#2a2d35}
tr.editing td{background:#1a3a5c}
td[contenteditable]{outline:none;border-radius:2px}
td[contenteditable]:focus{background:#333;color:#fff;box-shadow:inset 0 0 0 1px #0e639c}
td[contenteditable].dirty{box-shadow:inset 0 0 0 2px #f59e0b}
.empty{text-align:center;color:#555;padding:40px;font-size:14px}
.row-num{color:#555;width:86px;text-align:right;padding-right:8px;font-size:11px}
.custom-row td{background:rgba(14,99,156,.08)}
.custom-badge{display:inline-block;margin-left:5px;padding:1px 4px;border:1px solid #0e639c;color:#7dcfff;font-size:10px;line-height:14px}
.row-action{text-align:center}
.icon-btn{width:26px;height:24px;padding:0;border:0;background:transparent;color:#aaa;cursor:pointer;font-size:18px;line-height:24px}
.icon-btn:hover{color:#fff;background:#8b0000}
</style></head>
<body>
<div class="engine-tabs">
  <span class="engine-title">补全引擎</span>
  ${ENGINE_DEFINITIONS.map(definition => (
    `<button class="engine-tab${definition.id === initialEngine ? ' active' : ''}" data-engine="${definition.id}">${esc(definition.label)}</button>`
  )).join('')}
</div>
<div class="tabs">${tabs.map((t, i) => `<div class="tab${i===0?' active':''}" data-tab="${t.id}">${esc(t.label)}</div>`).join('')}</div>
<div class="toolbar">
  <input type="text" id="search" placeholder="搜索关键词...">
  <button class="secondary" onclick="addCustom()">新增自定义</button>
  <button onclick="saveCurrent()">保存修改</button>
  <span class="count" id="rowCount"></span>
</div>
<div class="table-wrap">
<table id="tbl">
<thead><tr><th class="row-num">#</th><th class="col-name">名称</th><th class="col-syntax">实际语法</th><th class="col-desc">描述</th><th class="col-params">参数</th><th class="col-actions">操作</th></tr></thead>
<tbody id="tbody"></tbody>
</table>
</div>
<script>
const allData = ${scriptJson(tabs)};
const engineDefinitions = ${scriptJson(ENGINE_DEFINITIONS)};
let activeEngine = '${initialEngine}';
let activeTab = '${tabs[0].id}';
let dirty = {};
let customDirty = {};

function escHtml(s) { var d=document.createElement('div'); d.textContent=(s||''); return d.innerHTML; }
function customScopeKey() { return activeEngine+':'+activeTab; }
function markCustomDirty() { customDirty[customScopeKey()] = true; }
function customStorageForTab() {
  if (activeTab==='check') return 'command-check';
  if (activeTab==='exec') return 'command-exec';
  if (activeTab==='func') return 'trigger';
  if (activeTab==='say') return 'static-say';
  return 'constant';
}
function newCustomId() {
  return 'custom-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10);
}

function render(filter) {
  var tab = allData.find(function(t){return t.id===activeTab});
  var engineRows = tab ? tab.data.filter(function(row){return row.engineId===activeEngine}) : [];
  var data = engineRows.map(function(row){ return { row: row, sourceIndex: row.sourceIndex, storage: row.storage }; });
  var kw = (filter||'').toLowerCase();
  if (kw) data = data.filter(function(item){
    var r = item.row;
    return (r.name||'').toLowerCase().indexOf(kw)>=0 || (r.syntax||'').toLowerCase().indexOf(kw)>=0 || (r.desc||'').toLowerCase().indexOf(kw)>=0 || (r.params||'').toLowerCase().indexOf(kw)>=0;
  });
  var html='';
  for (var i=0;i<data.length;i++) {
    var r=data[i].row;
    var sourceIndex=data[i].sourceIndex;
    var storage=data[i].storage;
    var dkey = r.isCustom
      ? activeEngine+':custom:'+r.customId
      : activeEngine+':'+storage+':'+sourceIndex;
    var rowAttributes = r.isCustom
      ? 'data-tab="'+activeTab+'" data-engine="'+activeEngine+'" data-storage="'+storage+'" data-custom-id="'+r.customId+'"'
      : 'data-tab="'+activeTab+'" data-engine="'+activeEngine+'" data-storage="'+storage+'" data-idx="'+sourceIndex+'"';
    html+='<tr '+rowAttributes+(r.isCustom?' class="custom-row"':'')+'><td class="row-num">'+(i+1)+(r.isCustom?'<span class="custom-badge">自定义</span>':'')+'</td>';
    html+='<td class="name" contenteditable="true" data-field="name" data-key="'+dkey+'">'+escHtml(r.name)+'</td>';
    html+='<td class="syntax" contenteditable="true" data-field="syntax" data-key="'+dkey+'">'+escHtml(r.syntax)+'</td>';
    html+='<td class="desc" contenteditable="true" data-field="desc" data-key="'+dkey+'">'+escHtml(r.desc)+'</td>';
    html+='<td class="params" contenteditable="true" data-field="params" data-key="'+dkey+'">'+escHtml(r.params)+'</td>';
    html+='<td class="row-action">'+(r.isCustom?'<button class="icon-btn" data-action="delete-custom" title="删除自定义项目">×</button>':'')+'</td>';
    html+='</tr>';
  }
  document.getElementById('tbody').innerHTML = html || '<tr><td colspan="6" class="empty">无匹配数据</td></tr>';
  var customCount = engineRows.filter(function(row){return row.isCustom}).length;
  document.getElementById('rowCount').textContent = kw
    ? (data.length+' / '+engineRows.length)
    : (engineRows.length+' 条'+(customCount?'，自定义 '+customCount+' 条':''));
}

function addCustom() {
  var tab = allData.find(function(item){return item.id===activeTab});
  if (!tab) return;
  var row = {
    name: '',
    engineId: activeEngine,
    storage: customStorageForTab(),
    syntax: '',
    desc: '',
    params: '',
    customId: newCustomId(),
    isCustom: true
  };
  tab.data.push(row);
  markCustomDirty();
  document.getElementById('search').value = '';
  render('');
  var target = document.querySelector('tr[data-custom-id="'+row.customId+'"] td.name');
  if (target) target.focus();
}

document.getElementById('search').addEventListener('input', function(e){ render(e.target.value); });

document.querySelectorAll('.tab').forEach(function(t){
  t.addEventListener('click', function(){
    document.querySelectorAll('.tab').forEach(function(x){x.classList.remove('active')});
    t.classList.add('active');
    activeTab = t.dataset.tab;
    document.getElementById('search').value = '';
    render('');
  });
});

document.querySelectorAll('.engine-tab').forEach(function(t){
  t.addEventListener('click', function(){
    document.querySelectorAll('.engine-tab').forEach(function(x){x.classList.remove('active')});
    t.classList.add('active');
    activeEngine = t.dataset.engine;
    document.getElementById('search').value = '';
    render('');
  });
});

// 编辑追踪
document.getElementById('tbody').addEventListener('input', function(e){
  var td = e.target;
  if (!td.dataset.field) return;
  var tr = td.closest('tr');
  var tab = allData.find(function(item){return item.id===activeTab});
  var sourceIndex = parseInt(tr.dataset.idx);
  var customId = tr.dataset.customId;
  var storage = tr.dataset.storage;
  var row = tab && tab.data.find(function(item){
    if (item.engineId!==activeEngine || item.storage!==storage) return false;
    return customId ? item.customId===customId : item.sourceIndex===sourceIndex;
  });
  if (row) row[td.dataset.field] = td.textContent || '';
  if (row && row.isCustom) markCustomDirty();
  else dirty[td.dataset.key] = true;
  td.classList.add('dirty');
});

document.getElementById('tbody').addEventListener('click', function(e){
  var button = e.target.closest('[data-action="delete-custom"]');
  if (!button) return;
  var tr = button.closest('tr');
  var customId = tr && tr.dataset.customId;
  var tab = allData.find(function(item){return item.id===activeTab});
  if (!customId || !tab) return;
  tab.data = tab.data.filter(function(row){
    return !(row.engineId===activeEngine && row.customId===customId);
  });
  markCustomDirty();
  render(document.getElementById('search').value);
});

// 键盘快捷键
document.addEventListener('keydown', function(e){
  if (e.ctrlKey && e.key==='s') { e.preventDefault(); saveCurrent(); }
  // Tab键在td之间导航
  if (e.key==='Tab' && document.activeElement.tagName==='TD') {
    e.preventDefault();
    var td=document.activeElement, row=td.parentElement;
    var cells=row.querySelectorAll('td[contenteditable]');
    var idx=Array.from(cells).indexOf(td);
    if (!e.shiftKey && idx<cells.length-1) cells[idx+1].focus();
    else if (e.shiftKey && idx>0) cells[idx-1].focus();
    else { var nextRow=row.nextElementSibling; if(nextRow){var nc=nextRow.querySelectorAll('td[contenteditable]');if(nc.length)(e.shiftKey?nc[nc.length-1]:nc[0]).focus();} }
  }
});

function saveCurrent() {
  var tab = allData.find(function(t){return t.id===activeTab});
  if (!tab) return;
  var engineRows = tab.data.filter(function(row){return row.engineId===activeEngine});
  var changes = [];
  engineRows.forEach(function(row){
    if (row.isCustom) return;
    var key = activeEngine+':'+row.storage+':'+row.sourceIndex;
    if (dirty[key]) {
      changes.push({
        storage: row.storage,
        sourceIndex: row.sourceIndex,
        obj: { name: row.name, syntax: row.syntax, desc: row.desc, params: row.params }
      });
      dirty[key] = false;
    }
  });
  var customChanged = !!customDirty[customScopeKey()];
  var customEntries = engineRows.filter(function(row){return row.isCustom}).map(function(row){
    return {
      id: row.customId,
      name: row.name,
      syntax: row.syntax,
      description: row.desc,
      params: row.params
    };
  });
  if (changes.length===0 && !customChanged) { alert('没有修改'); return; }
  document.querySelectorAll('#tbody td.dirty').forEach(function(td){td.classList.remove('dirty')});
  vscode.postMessage({
    type: 'save',
    tabId: activeTab,
    engine: activeEngine,
    changes: changes,
    customChanged: customChanged,
    customEntries: customEntries,
    allData: engineRows
  });
}

var vscode = acquireVsCodeApi();
window.addEventListener('message', function(e){
  if (e.data.type==='saved') {
    if (e.data.ok) customDirty[e.data.engine+':'+e.data.tabId] = false;
    alert(e.data.ok?'保存成功！已写入 '+e.data.file:'保存失败: '+e.data.error);
  }
  if (e.data.type==='activeEngineChanged') {
    var nextEngine = e.data.engine;
    var nextTab = document.querySelector('.engine-tab[data-engine="'+nextEngine+'"]');
    if (!nextTab) return;
    activeEngine = nextEngine;
    document.querySelectorAll('.engine-tab').forEach(function(tab){
      tab.classList.toggle('active', tab===nextTab);
    });
    document.getElementById('search').value = '';
    render('');
  }
});

render('');
</script></body></html>`;
      panel.webview.html = secureWebviewHtml(
        panel.webview,
        panel.webview.html,
        { allowInlineEventHandlers: true }
      );
      const completionEngineSync = vscode.workspace.onDidChangeConfiguration(event => {
        if (!event.affectsConfiguration('boo.engine')) return;
        void panel.webview.postMessage({
          type: 'activeEngineChanged',
          engine: normalizeEngineId(
            vscode.workspace.getConfiguration('boo').get<string>('engine', 'GOM')
          ),
        });
      });
      panel.onDidDispose(() => completionEngineSync.dispose());

      panel.webview.onDidReceiveMessage(async msg => {
        if (msg.type === 'save') {
          const engine = normalizeEngineId(msg.engine as string);
          if (!beginCompletionEditorSave()) {
            panel.webview.postMessage({
              type: 'saved',
              ok: false,
              error: '另一项补全修改正在保存，请稍后重试',
              engine,
              tabId: msg.tabId,
            });
            return;
          }
          const changes = msg.changes as {
            storage: CompletionEditorStorage;
            sourceIndex: number;
            obj: Partial<Pick<CompletionEditorRow, 'name' | 'syntax' | 'desc' | 'params'>>;
          }[];

          try {
            const changedFiles = new Map<string, any>();
            const readForUpdate = (fileName: string): any => {
              const filePath = path.join(extPath, 'data', fileName);
              if (!changedFiles.has(filePath)) {
                changedFiles.set(filePath, JSON.parse(fs.readFileSync(filePath, 'utf-8')));
              }
              return changedFiles.get(filePath);
            };
            const changesFor = (storage: CompletionEditorStorage) => (
              changes.filter(change => change.storage === storage)
            );
            const updateCommandRows = (
              entries: CommandEntry[],
              rowChanges: typeof changes,
              category: string
            ): void => {
              for (const change of rowChanges) {
                const sourceIndex = Number(change.sourceIndex);
                const entry = entries[sourceIndex];
                if (!entry || !Number.isInteger(sourceIndex)) continue;
                const target = { ...(entry.engineVariants?.[engine] || {}) };
                if (change.obj.name) target.name = change.obj.name;
                if (change.obj.syntax !== undefined) target.syntax = change.obj.syntax;
                if (change.obj.desc !== undefined) target.description = change.obj.desc;
                if (change.obj.params !== undefined) {
                  target.params = change.obj.params
                    ? change.obj.params.split(/\s+/).filter(Boolean)
                    : [];
                }
                if (change.obj.syntax !== undefined || change.obj.params !== undefined) {
                  target.completionVerified = true;
                }
                entry.engineVariants = {
                  ...(entry.engineVariants || {}),
                  [engine]: target,
                };
                entry.category = category;
              }
            };

            const commandChanges = [
              ...changesFor('command-check'),
              ...changesFor('command-exec'),
              ...changesFor('trigger'),
            ];
            if (commandChanges.length > 0) {
              const commandData = readForUpdate('commands.json');
              updateCommandRows(
                commandData.commands,
                changesFor('command-check'),
                '检测命令'
              );
              updateCommandRows(
                commandData.execCommands,
                changesFor('command-exec'),
                '执行命令'
              );
              for (const change of changesFor('trigger')) {
                const entry = commandData.triggers[change.sourceIndex];
                if (!entry) continue;
                const target = { ...(entry.engineVariants?.[engine] || {}) };
                if (change.obj.syntax) target.name = change.obj.syntax;
                if (change.obj.name !== undefined) target.label = change.obj.name;
                if (change.obj.desc !== undefined) target.description = change.obj.desc;
                entry.engineVariants = {
                  ...(entry.engineVariants || {}),
                  [engine]: target,
                };
              }
              commandData.totalCheckCommands = commandData.commands.length;
              commandData.totalActionCommands = commandData.execCommands.length;
              commandData.totalTriggers = commandData.triggers.length;
            }

            const variableChanges = changesFor('variable');
            if (variableChanges.length > 0) {
              const variableData = readForUpdate('variables.json');
              for (const change of variableChanges) {
                const entry = variableData.variables[change.sourceIndex];
                if (!entry) continue;
                const target = { ...(entry.engineVariants?.[engine] || {}) };
                if (change.obj.syntax) target.name = change.obj.syntax;
                if (change.obj.name !== undefined) target.full = change.obj.name;
                if (change.obj.desc !== undefined) target.desc = change.obj.desc;
                if (change.obj.params !== undefined) target.scope = change.obj.params;
                entry.engineVariants = {
                  ...(entry.engineVariants || {}),
                  [engine]: target,
                };
              }
            }

            const functionChanges = changesFor('function');
            if (functionChanges.length > 0) {
                const definition = getEngineDefinition(engine);
                const previousEntries = Object.entries(readForUpdate(definition.functionFile));
                const changesByIndex = new Map(functionChanges.map(change => [change.sourceIndex, change.obj]));
                const nextData: Record<string, unknown> = {};
                for (let index = 0; index < previousEntries.length; index++) {
                  const [previousName, previousValue] = previousEntries[index];
                  const change = changesByIndex.get(index);
                  const name = change?.name || previousName;
                  nextData[name] = change
                    ? {
                        ...(previousValue as object),
                        details: change.desc ?? (previousValue as any).details,
                        params: change.params ?? (previousValue as any).params,
                        syntax: change.syntax ?? (previousValue as any).syntax,
                        completionVerified: true,
                        completionEnabled: true,
                      }
                    : previousValue;
                }
                changedFiles.set(
                  path.join(extPath, 'data', definition.functionFile),
                  nextData
                );
            }

            const constantChanges = changesFor('constant');
            if (constantChanges.length > 0) {
                const definition = getEngineDefinition(engine);
                const constantData = readForUpdate(definition.constantsFile);
                for (const change of constantChanges) {
                  const entry = constantData.constants[change.sourceIndex];
                  if (!entry) continue;
                  if (change.obj.syntax) entry.name = change.obj.syntax.toUpperCase();
                  if (change.obj.name !== undefined) entry.full = change.obj.name;
                  if (change.obj.desc !== undefined) entry.description = change.obj.desc;
                  if (change.obj.params !== undefined) entry.scope = change.obj.params;
                  entry.completionVerified = true;
                  entry.completionEnabled = true;
                }
                constantData.generated = new Date().toISOString();
            }

            const staticSayChanges = changesFor('static-say');
            if (staticSayChanges.length > 0) {
              const staticData = readForUpdate('static-language.json');
              for (const change of staticSayChanges) {
                const entry = staticData.saySnippets?.[change.sourceIndex];
                const previous = entry?.engineVariants?.[engine];
                if (!entry || !previous) continue;
                const target = { ...previous };
                if (change.obj.name !== undefined) target.label = change.obj.name;
                if (change.obj.syntax !== undefined) target.snippet = change.obj.syntax;
                if (change.obj.desc !== undefined) target.description = change.obj.desc;
                if (change.obj.params !== undefined) {
                  const values = change.obj.params
                    .split(/\s*(?:\||[;；]|\r?\n)\s*/)
                    .map(value => value.trim())
                    .filter(Boolean);
                  target.parameters = values.map((value, index) => {
                    const explicit = /^([A-Za-z_][A-Za-z0-9_]*)\s*(?:=|:|：)\s*(.+)$/.exec(value);
                    const oldParameter = previous.parameters?.[index];
                    return {
                      ...(oldParameter?.aliases?.length ? { aliases: oldParameter.aliases } : {}),
                      ...(explicit?.[1] || oldParameter?.key
                        ? { key: explicit?.[1] || oldParameter.key }
                        : {}),
                      description: (explicit?.[2] || value).trim(),
                    };
                  });
                }
                entry.engineVariants = {
                  ...(entry.engineVariants || {}),
                  [engine]: target,
                };
              }
            }

            const customCategoryByTab: Record<string, CustomLanguageCategory> = {
              check: 'check',
              exec: 'action',
              func: 'function',
              constant: 'constant',
              say: 'say',
            };
            const customChanged = msg.customChanged === true;
            const customCategory = customCategoryByTab[String(msg.tabId || '')];
            if (customChanged && !customCategory) {
              throw new Error('无法识别自定义补全类型');
            }
            const nextCustomLanguageData = customChanged
              ? replaceCustomLanguageEntries(
                  customLanguageData,
                  engine,
                  customCategory,
                  msg.customEntries
                )
              : customLanguageData;

            const writtenFiles: string[] = [];
            for (const [filePath, jsonData] of changedFiles) {
              fs.writeFileSync(filePath, `${JSON.stringify(jsonData, null, 2)}\n`, 'utf-8');
              writtenFiles.push(path.basename(filePath));
            }
            if (customChanged) {
              await context.globalState.update(
                CUSTOM_LANGUAGE_STATE_KEY,
                nextCustomLanguageData
              );
              replaceActiveCustomLanguageData(nextCustomLanguageData);
              writtenFiles.push('用户自定义目录');
            }
            if (changedFiles.size > 0 || customChanged) {
              commandsData = loadCommandsData(extPath, (line: string) => outputChannel.appendLine(line));
              variablesData = loadVariablesData(extPath, (line: string) => outputChannel.appendLine(line));
              engineFunctionCatalog = loadEngineFunctionCatalog(extPath, (line: string) => outputChannel.appendLine(line));
              engineConstantCatalog = loadEngineConstantCatalog(extPath, (line: string) => outputChannel.appendLine(line));
              staticLanguageData = loadStaticLanguageData(extPath, (line: string) => outputChannel.appendLine(line))
                || EMPTY_STATIC_LANGUAGE_DATA;
              rebuildLanguageIndex();
              rebuildSemanticCommandIndex();
              panel.webview.postMessage({
                type: 'saved',
                ok: true,
                file: writtenFiles.join('、'),
                engine,
                tabId: msg.tabId,
              });
            }
          } catch (e: unknown) {
            panel.webview.postMessage({
              type: 'saved',
              ok: false,
              error: e instanceof Error ? e.message : String(e),
              engine,
              tabId: msg.tabId,
            });
          } finally {
            endCompletionEditorSave();
          }
        }
      });
    }),    // ---- 切换引擎 - GPTea ----
    vscode.commands.registerCommand('boo.toggleEngine', async () => {
      const cfg = vscode.workspace.getConfiguration('boo');
      const current = normalizeEngineId(cfg.get<string>('engine', 'GOM'));
      const next = nextEngineId(current);
      const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (wsRoot) {
        await context.workspaceState.update(`boo.autoDetectedEngine:${wsRoot.toLowerCase()}`, undefined);
      }
      await cfg.update(
        'engine',
        next,
        wsRoot ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global
      );
      // 通知由 onDidChangeConfiguration 触发
    })
  );

  // ---- 状态栏：引擎指示器 ----
  const engineStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  engineStatusBar.command = 'boo.toggleEngine';
  engineStatusBar.tooltip = `点击切换引擎 (${ENGINE_DEFINITIONS.map(engine => engine.shortLabel).join(' / ')})`;
  context.subscriptions.push(engineStatusBar);

  function updateEngineStatusBar(engine: string) {
    const definition = getEngineDefinition(engine);
    engineStatusBar.text = `$(circle-filled) ${definition.label}`;
    engineStatusBar.color = definition.statusColor;
    engineStatusBar.show();
  }
  updateEngineStatusBar(vscode.workspace.getConfiguration('boo').get<string>('engine', 'GOM'));


  // ---- 引擎切换监听 ----
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async e => {
      if (e.affectsConfiguration('boo.engine')) {
        rebuildLanguageIndex();
        rebuildSemanticCommandIndex();
        const engine2 = normalizeEngineId(vscode.workspace.getConfiguration('boo').get<string>('engine', 'GOM'));
        const definition = getEngineDefinition(engine2);
        updateEngineStatusBar(engine2);
        if (databasePanel) {
          databasePanel.dispose();
          databasePanel = undefined;
        }
        postToSidebar({ type: 'clearDatabaseDetail', detailKind: 'other' });
        for (const panel of [...mapViewerPanels]) panel.dispose();
        diagnosticCollection.clear();
        for (const document of vscode.workspace.textDocuments) {
          updateDiagnostics(document);
        }
        await diagnoseWorkspaceScriptFiles(false);
        vscode.window.showInformationMessage(
          `已切换引擎: ${definition.label}`
        );
      }
      if (e.affectsConfiguration('boo.enableDiagnostics')) {
        workspaceAuditVersion++;
        if (vscode.workspace.getConfiguration('boo').get('enableDiagnostics', true)) {
          await diagnoseWorkspaceScriptFiles(false);
          for (const document of vscode.workspace.textDocuments) updateDiagnostics(document);
        } else {
          diagnosticCollection.clear();
        }
      }
      if (e.affectsConfiguration('boo.autoDetectEngine')) {
        void autoDetectEngine();
      }
    })
  );

  outputChannel.appendLine('BOO脚本助手语言功能已激活！');
}

export function deactivateAssistant() {
  if (outputChannel) outputChannel.dispose();
}

// ---- 辅助函数 ----

function formatEngineList(engines: EngineId[]): string {
  const labels = engines.map(engine => getEngineDefinition(engine).shortLabel);
  return [...new Set(labels)].join(' / ');
}

function formatEntryEngineCategory(engines: EngineId[] | undefined): string {
  if (!engines || engines.length === 0) return '旧版兼容（当前文档未验证）';
  return engines.map(engine => getEngineDefinition(engine).label).join(' / ');
}

function formatIndexedCommandEngineCategory(command: IndexedCommand): string {
  return formatEntryEngineCategory(command.engines);
}

function buildIndexedCommandHover(command: IndexedCommand): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.isTrusted = false;
  md.appendMarkdown(`### \`${escapeInlineCode(command.name)}\`\n\n`);
  if (command.description) md.appendMarkdown(`${command.description}\n\n`);
  if (command.completionVerified && command.params.length > 0) {
    command.params.forEach((parameter, index) => {
      md.appendMarkdown(`**参数${index + 1}：** \`${escapeInlineCode(formatCommandParameterMeaning(parameter))}\`\n\n`);
    });
  }
  return md;
}

function buildIndexedCommandParameterHover(
  parameter: string,
  parameterIndex: number
): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.isTrusted = false;
  md.appendMarkdown(`**参数${parameterIndex + 1}：** \`${escapeInlineCode(formatCommandParameterMeaning(parameter))}\``);
  return md;
}

function buildSayMarkupHover(markup: SayMarkupToken): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.isTrusted = false;
  md.appendMarkdown(`### \`${escapeInlineCode(markup.text.toUpperCase())}\`\n\n`);
  if (markup.entry.description) md.appendMarkdown(`${markup.entry.description}\n\n`);
  sayMarkupParameterMeanings(markup.entry).forEach((parameter, index) => {
    md.appendMarkdown(`**参数${index + 1}：** \`${escapeInlineCode(parameter)}\`\n\n`);
  });
  return md;
}

function buildSayMarkupParameterHover(parameter: SayMarkupParameterSpan): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.isTrusted = false;
  md.appendMarkdown(`**参数${parameter.index}：** \`${escapeInlineCode(parameter.meaning)}\``);
  return md;
}

function escapeInlineCode(value: string): string {
  return value.replace(/`/g, '\\`');
}

function activeMapInfoParams(engine: EngineId) {
  return activeStaticLanguageEntries(staticLanguageData.mapInfoParams, engine);
}

function activeSayMarkupEntries(engine: EngineId) {
  const rows = new Map<string, ReturnType<typeof activeStaticLanguageEntries>[number]>();
  for (const entry of customSayMarkupEntries(customLanguageData, engine)) {
    rows.set(entry.label.toUpperCase(), entry);
  }
  for (const entry of activeStaticLanguageEntries(staticLanguageData.saySnippets, engine)) {
    const key = entry.label.toUpperCase();
    if (!rows.has(key)) rows.set(key, entry);
  }
  return [...rows.values()];
}

function escapeStaticHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 自然排序: 按数字值而非字典序比较 (P1 < P2 < P10 < P100)
function naturalCompare(a: string, b: string): number {
  const re = /(\d+)|(\D+)/g;
  const aParts: (string | number)[] = [];
  const bParts: (string | number)[] = [];
  let m;
  while ((m = re.exec(a)) !== null) aParts.push(m[1] ? parseInt(m[1], 10) : m[2]);
  re.lastIndex = 0;
  while ((m = re.exec(b)) !== null) bParts.push(m[1] ? parseInt(m[1], 10) : m[2]);
  for (let i = 0; i < Math.min(aParts.length, bParts.length); i++) {
    const ap = aParts[i], bp = bParts[i];
    if (typeof ap === 'number' && typeof bp === 'number') {
      if (ap !== bp) return ap - bp;
    } else {
      const as = String(ap), bs = String(bp);
      const cmp = as.toLowerCase().localeCompare(bs.toLowerCase());
      if (cmp !== 0) return cmp;
    }
  }
  return aParts.length - bParts.length;
}

function newItem(label: string, detail: string, kind: vscode.CompletionItemKind): vscode.CompletionItem {
  const item = new vscode.CompletionItem(label, kind);
  item.detail = detail;
  item.documentation = new vscode.MarkdownString(detail);
  return item;
}

function newSnippetItem(label: string, snippet: string, detail: string, kind: vscode.CompletionItemKind): vscode.CompletionItem {
  const item = new vscode.CompletionItem(label, kind);
  item.detail = detail;
  item.documentation = new vscode.MarkdownString(detail);
  item.insertText = new vscode.SnippetString(snippet);
  return item;
}

function buildSnippet(cmd: { name: string; syntax?: string; params?: string[] }): vscode.SnippetString {
  if (!cmd.syntax) return new vscode.SnippetString(cmd.name);
  const parts = cmd.params?.length
    ? cmd.params
    : cmd.syntax.replace(new RegExp(`^${escapeRegex(cmd.name)}\\s*`, 'i'), '').trim().split(/\s+/);
  if (parts.length === 0 || (parts.length === 1 && parts[0] === '')) return new vscode.SnippetString(cmd.name);
  let idx = 1;
  const snippet = cmd.name + ' ' + parts.map((p: string) => `\${${idx++}:${p.replace(/[<>]/g, '')}}`).join(' ');
  return new vscode.SnippetString(snippet);
}

function extractDocLabels(text: string): string[] {
  const labels: string[] = [];
  const regex = /\[@([^\]]+)\]/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (!labels.includes(match[1])) labels.push(match[1]);
  }
  return labels;
}

/**
 * 选取最优基目录用于创建新文件
 * 在 getScriptBaseDirs 返回的目录列表中，返回第一个实际存在的目录
 */
function getBestCreateDir(wsRoot: string, ...extraDirs: string[]): string | null {
  const bases = getScriptBaseDirs(wsRoot, ...extraDirs);
  for (const base of bases) {
    try { if (fs.existsSync(base)) return base; } catch {}
  }
  return null;
}

/**
 * 在指定文件中查找 [@标签] 定义，返回目标位置
 * 用于 #CALL 跨文件跳转
 */
async function findLabelInFile(filePath: string, label: string): Promise<vscode.Location | null> {
  try {
    const uri = vscode.Uri.file(filePath);
    const doc = await vscode.workspace.openTextDocument(uri);
    const allText = doc.getText();
    const escaped = escapeRegex(label);
    const labelRegex = new RegExp(`\\[@${escaped}\\]`, 'g');
    const lm = labelRegex.exec(allText);
    if (lm) {
      const pos = doc.positionAt(lm.index);
      return new vscode.Location(uri, pos);
    }
  } catch (e) {
    console.warn('[BOO] 标签定义查找失败:', e instanceof Error ? e.message : String(e));
  }
  return null;
}


// ---- Webview HTML ----

function buildColorChart(): string {
  let h = '<html><body style="font-family:monospace;padding:15px"><h2>BOO引擎 256色值表</h2><div style="display:flex;flex-wrap:wrap;gap:2px">';
  for (let i = 0; i < 256; i++) {
    const hex = gomColorHex(i);
    const lum = parseInt(hex.substring(1,3),16) + parseInt(hex.substring(3,5),16) + parseInt(hex.substring(5,7),16);
    h += `<div style="width:36px;height:36px;background:${hex};font-size:9px;text-align:center;line-height:36px;color:${lum>300?'#000':'#fff'};text-shadow:0 0 2px #000;border:1px solid #555">${i}</div>`;
  }
  return h + '</div></body></html>';
}

function buildEquipTable(): string {
  const slots = [
    [0,'盔甲','<$DRESS>'],[1,'武器','<$WEAPON>'],[2,'勋章','<$RIGHTHAND>'],
    [3,'项链','<$NECKLACE>'],[4,'头盔','<$HELMET>'],[5,'右手镯','<$ARMRING_R>'],
    [6,'左手镯','<$ARMRING_L>'],[7,'右戒指','<$RING_R>'],[8,'左戒指','<$RING_L>'],
    [9,'护身符','<$BUJUK>'],[10,'腰带','<$BELT>'],[11,'靴子','<$BOOTS>'],
    [12,'宝石','<$CHARM>'],[13,'斗笠','<$HAT>'],[14,'军鼓','<$DRUM>'],
    [15,'马牌','<$HORSE>'],[16,'盾牌','<$SHIELD>'],
    [17,'时装衣','<$SDRESS>'],[18,'时装武','<$SWEAPON>'],[19,'时装链','<$SNECKLACE>'],
    [20,'时装头','<$SHELMET>'],[21,'时装镯L','<$SARMRING_L>'],[22,'时装镯R','<$SARMRING_R>'],
    [23,'时装戒L','<$SRING_L>'],[24,'时装戒R','<$SRING_R>'],[25,'时装勋章','<$SRIGHTHAND>'],
    [26,'时装腰带','<$SBELT>'],[27,'时装靴子','<$SBOOTS>'],[28,'时装宝石','<$SCHARM>'],
  ];
  let h = '<html><body style="font-family:monospace;padding:15px"><h2>BOO装备位置代码表</h2><table border=1 cellpadding=6 style="border-collapse:collapse"><tr><th>位置</th><th>名称</th><th>变量</th></tr>';
  for (const [pos, name, v] of slots) h += `<tr><td>${pos}</td><td>${name}</td><td><code>${v}</code></td></tr>`;
  return h + '</table></body></html>';
}

function buildStdModeTable(): string {
  const modes = [
    [0,'药品'],[1,'食物'],[2,'特殊药水(叠加)'],[3,'卷轴'],[4,'技能书'],
    [5,'武器(通用)'],[6,'武器(通用)'],[7,'魔血石'],[10,'衣服(男)'],[11,'衣服(女)'],
    [15,'头盔'],[16,'斗笠'],[19,'项链(敏)'],[20,'项链(准)'],[21,'项链(速)'],
    [22,'戒指(单)'],[23,'戒指(敏)'],[24,'手镯(准)'],[25,'护身符/毒/药'],[26,'手镯(敏)'],
    [28,'坐骑马牌'],[29,'天使'],[30,'勋章'],[31,'捆绑叠加物品'],[40,'宝箱钥匙'],[42,'制作原料'],
    [43,'矿石'],[48,'盾牌'],[51,'马(扩展)'],[52,'靴子'],[53,'宝石'],[54,'腰带'],
    [55,'指定类型宝石'],[56,'宝石类型'],[57,'兼容型宝石'],[58,'升级次数宝石'],[59,'成功率宝石'],
    [62,'靴子(扩展)'],[63,'宝石(扩展)'],[64,'腰带(扩展)'],[65,'军鼓'],
    [66,'时装衣(男)'],[67,'时装衣(女)'],[68,'时装武(男)'],[69,'时装武(女)'],
    [70,'称号'],[75,'时装项链'],[78,'时装头盔'],[100,'生肖(开始)'],
  ];
  let h = '<html><body style="font-family:monospace;padding:15px"><h2>BOO StdMode代码表</h2><table border=1 cellpadding=6 style="border-collapse:collapse"><tr><th>StdMode</th><th>类型</th></tr>';
  for (const [m, n] of modes) h += `<tr><td>${m}</td><td>${n}</td></tr>`;
  return h + '</table></body></html>';
}

// ---- 编码检测 ----
function detectFileEncoding(buffer: Uint8Array): { label: string; hasBOM: boolean; hasChinese: boolean } {
  const arr = new Uint8Array(buffer);
  // BOM检测
  if (arr[0] === 0xEF && arr[1] === 0xBB && arr[2] === 0xBF) return { label: 'UTF-8 (BOM)', hasBOM: true, hasChinese: true };
  if (arr[0] === 0xFF && arr[1] === 0xFE) return { label: 'UTF-16 LE', hasBOM: true, hasChinese: true };
  if (arr[0] === 0xFE && arr[1] === 0xFF) return { label: 'UTF-16 BE', hasBOM: true, hasChinese: true };

  // GBK/GB18030解码
  try {
    const iconv = require('iconv-lite');
    const gbkStr = iconv.decode(Buffer.from(arr), 'gb18030');
    const hasChinese = /[一-鿿]/.test(gbkStr);
    const hasReplacement = gbkStr.includes('�');
    return { label: hasReplacement ? 'UTF-8' : (hasChinese ? 'GB18030/GBK' : 'UTF-8'), hasBOM: false, hasChinese };
  } catch (e) {
    console.warn('[BOO] 编码检测回退:', e instanceof Error ? e.message : String(e));
    return { label: '未知(iconv-lite未安装)', hasBOM: false, hasChinese: false };
  }
}

// ---- ANIS符号面板 ----
function buildAnisSymbolsHTML(): string {
  const htmlPath = path.join(__dirname, '..', 'media', 'anis-symbols.html');
  try { return fs.readFileSync(htmlPath, 'utf-8'); }
  catch (e) { console.warn('[BOO] ANIS符号面板加载失败:', e instanceof Error ? e.message : String(e)); return '<html><body><h3>ANIS符号面板加载失败</h3></body></html>'; }
}

// 传奇引擎标准256色调色板（与decorator.ts GOM_PALETTE完全一致）
function gomColorHex(idx: number): string {
  const p = ['#000000','#800000','#008000','#808000','#000080','#800080','#008080','#c0c0c0','#558097','#9db9c8','#7b7373','#2d2929','#5a5252','#635a5a','#423939','#1d1818','#181010','#291818','#100808','#f27971','#e1675f','#ff5a5a','#ff3131','#d65a52','#941000','#942918','#390800','#731000','#b51800','#bd6352','#421810','#ffaa99','#000000','#733929','#a54a31','#947b73','#bd5231','#522110','#7b3118','#2d1810','#8c4a31','#942900','#bd3100','#c67352','#6b3118','#c66b42','#ce4a00','#a56339','#5a3118','#2a1000','#150800','#3a1800','#080000','#290000','#4a0000','#9d0000','#dc0000','#de0000','#fb0000','#9c7352','#946b4a','#734a29','#523118','#8c4a18','#884411','#4a2100','#211810','#d6945a','#c66b21','#ef6b00','#ff7700','#a59484','#423121','#181008','#291808','#211000','#392918','#8c6339','#422910','#6b4218','#7b4a18','#944a00','#8c847b','#6b635a','#4a4239','#292118','#463929','#b5a594','#7b6b5a','#ceb194','#a58c73','#8c735a','#b59473','#d6a573','#efa54a','#efc68c','#7b6342','#6b5639','#bd945a','#633900','#d6c6ad','#524229','#946318','#efd6ad','#a58c63','#635a4a','#bda57b','#5a4218','#bd8c31','#353129','#948463','#7b6b4a','#a58c5a','#5a4a29','#9c7b39','#423110','#efad21','#181000','#292100','#9c6b00','#94845a','#524218','#6b5a29','#7b6321','#9c7b21','#dea500','#5a5239','#312910','#cebd7b','#635a39','#94844a','#c6a529','#109c18','#428c4a','#318c42','#109429','#081810','#081818','#082910','#184229','#a5b5ad','#6b7373','#182929','#18424a','#31424a','#63c6de','#44ddff','#8cd6ef','#736b39','#f7de39','#f7ef8c','#f7e700','#6b6b5a','#5a8ca5','#39b5ef','#4a9cce','#3184b5','#31526b','#deded6','#bdbdb5','#8c8c84','#f7f7de','#000818','#081839','#081029','#081800','#082900','#0052a5','#007bde','#10294a','#10396b','#10528c','#215aa5','#10315a','#104284','#315284','#182131','#4a5a7b','#526ba5','#293963','#104ade','#292921','#4a4a39','#292918','#4a4a29','#7b7b42','#9c9c4a','#5a5a29','#424214','#393900','#595900','#ca352c','#6b7321','#293100','#313910','#313918','#424a00','#526318','#5a7329','#314a18','#182100','#183100','#183910','#63844a','#6bbd4a','#63b54a','#63bd4a','#5a9c4a','#4a8c39','#63c64a','#63d64a','#52844a','#317329','#63c65a','#52bd4a','#10ff00','#182918','#4a884a','#4ae74a','#005a00','#008800','#009400','#00de00','#00ee00','#00fb00','#4a5a94','#6373b5','#7b8cd6','#6b7bd6','#7788ff','#c6c6ce','#94949c','#9c94c6','#313139','#291884','#180084','#4a4252','#52427b','#635a73','#ceb5f7','#8c7b9c','#7722cc','#ddaaff','#f0b42a','#df009f','#e317b3','#fffbf0','#a0a0a4','#808080','#ff0000','#00ff00','#ffff00','#0000ff','#ff00ff','#00ffff','#ffffff'];
  return p[Math.max(0, Math.min(255, idx))] || '#ffffff';
}
function buildQuickColorHTML(): string {
  // GOM 256色调色板（正确色值）
  let cells = '';
  for (let i = 0; i < 256; i++) {
    const hex = gomColorHex(i);
    const r = parseInt(hex.substring(1,3),16);
    const g = parseInt(hex.substring(3,5),16);
    const b = parseInt(hex.substring(5,7),16);
    const fg = (r + g + b) > 400 ? '#000' : '#fff';
    cells += `<div class="cell" data-idx="${i}" style="background:${hex};color:${fg}" title="颜色${i}: ${hex}">${i}</div>`;
  }
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#1e1e1e;color:#ccc;font-family:monospace;padding:10px}
h3{color:#ff8c00;margin-bottom:10px}
.grid{display:flex;flex-wrap:wrap;gap:2px}
.cell{width:40px;height:24px;display:flex;align-items:center;justify-content:center;font-size:10px;cursor:pointer;border-radius:2px}
.cell:hover{outline:2px solid #fff;z-index:1}
</style>
</head>
<body>
<h3>BOO 256色快速调色板 - 点击插入颜色代码</h3>
<div class="grid">${cells}</div>
<script>
const vscode = acquireVsCodeApi();
document.querySelectorAll('.cell').forEach(c => {
  c.addEventListener('click', () => {
    const idx = c.dataset.idx;
    vscode.postMessage({ type: 'insertColor', value: idx });
  });
});
</script>
</body>
</html>`;
}

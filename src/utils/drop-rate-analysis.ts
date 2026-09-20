import { EngineId } from '../types';

// Evidence: LFM 新爆率格式-html; GOM 爆率控制; 996PC MonItems-怪物爆率文件目录.
// This is a source-only, unit-multiplier analysis, never a runtime drop executor.
type Fraction = [bigint, bigint];
export interface DropSourceLocation {
  filePath: string;
  line: number;
  section?: string;
  /** Ordered outermost-to-innermost static call sites; never runtime execution. */
  callChain?: { filePath: string; line: number; label: string }[];
}
interface Warning { line: number; message: string; source?: DropSourceLocation }
export interface DropGroup {
  source?: DropSourceLocation;
  line: number;
  raw: string;
  random: boolean;
  /** GOM/996PC CASE gate. The variable/value are source facts; the runtime
   * value is intentionally not guessed by this source-only analyzer. */
  caseVariable?: string;
  caseValue?: string;
  caseClearVariables?: boolean;
  condition?: string;
  conditionMode?: 'and' | 'or';
  inheritanceMask?: number;
  clearVariables?: boolean;
  trigger?: string;
  ignoresMultiplier: boolean;
}
export interface DropAnalysisRow {
  source?: DropSourceLocation;
  line: number;
  section: string;
  item: string;
  quantity?: string;
  trigger?: string;
  sourceRate: string;
  baselineFraction?: string;
  formula: string[];
  runtimeReasons: string[];
  unknownReasons: string[];
}
export interface DropAnalysis {
  engine: EngineId;
  rows: DropAnalysisRow[];
  groups: DropGroup[];
  warnings: Warning[];
  external?: { expandedCalls: number; unresolvedCalls: number; filesRead: number; bytesRead: number };
}
interface Node {
  group?: DropGroup;
  row?: DropAnalysisRow;
  children: Node[];
  rate?: Fraction;
  unknown: string[];
}
type CaseState = 'awaiting-branch' | 'awaiting-open' | 'open' | 'ready';
interface CaseContext {
  /** The node that owns all branches (the first branch is this node). */
  parent: Node;
  /** The branch currently being read, or the first branch template. */
  branch?: Node;
  state: CaseState;
}
const ONE: Fraction = [1n, 1n];
function rate(raw: string): Fraction | undefined {
  const match = /^(\d{1,15})\/(\d{1,15})$/.exec(raw);
  if (!match) return undefined;
  const n = BigInt(match[1]), d = BigInt(match[2]);
  return d > 0n && n <= d ? [n, d] : undefined;
}
function multiply(a: Fraction, b: Fraction): Fraction {
  let n = a[0] * b[0], d = a[1] * b[1], x = n, y = d;
  while (y) { const remainder = x % y; x = y; y = remainder; }
  n /= x; d /= x;
  return [n, d];
}
function fraction(value: Fraction): string { return `${value[0]}/${value[1]}`; }

/** Semicolons within LFM [conditions] are separators, not comments. */
export function dropSourceLine(raw: string): string {
  raw = raw.replace(/^\uFEFF/, '');
  let depth = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '[') depth++;
    if (raw[i] === ']') depth = Math.max(0, depth - 1);
    if (depth === 0 && (raw[i] === ';' || raw.slice(i, i + 2) === '//')) return raw.slice(0, i).trim();
  }
  return raw.trim();
}

function parseGroup(raw: string, line: number, engine: EngineId): Node {
  const group: DropGroup = { raw, line, random: false, ignoresMultiplier: false };
  const node: Node = { group, children: [], unknown: [] };
  const match = /^#(CHILD|IF)\s+(.+)$/i.exec(raw);
  if (!match) { node.unknown.push('未支持的分组语句'); return node; }
  let rest = match[2];
  const isIf = match[1].toUpperCase() === 'IF';
  if (isIf) {
    node.rate = ONE;
    if (engine === 'GEE') node.unknown.push('翎风未证实 #IF 爆率块，不能套用 GOM 语法');
  } else {
    const parts = /^(\S+)(.*)$/.exec(rest)!;
    node.rate = rate(parts[1]); rest = parts[2].trim();
    if (!node.rate) node.unknown.push('分组几率动态或超出已验证范围');
  }
  const condition = /\[([^\]]*)\]/.exec(rest);
  if (condition) {
    rest = rest.replace(condition[0], '').trim();
    group.condition = condition[1];
    if (engine === 'GEE' && !isIf) {
      const [expression, inherit = '0', trigger, ...extra] = condition[1].split(',').map(s => s.trim());
      const [checks, mode, ...modes] = expression.split('|');
      group.conditionMode = mode?.toUpperCase() === 'OR' ? 'or' : 'and';
      if (!/^[0-7]$/.test(inherit) || extra.length || modes.length || (mode && mode.toUpperCase() !== 'OR')
        || !checks.split(';').every(check => /^[DMNUJIG]\d+\s*(?:<=|>=|<>|=|<|>)\s*(?:-?\d+|[DMNUJIG]\d+)$/i.test(check.trim()))
        || (trigger && !/^@\S+$/.test(trigger))) node.unknown.push('翎风条件/继承/触发参数未能确认');
      else group.inheritanceMask = Number(inherit);
      if (trigger) group.trigger = trigger;
    } else if (engine !== 'GEE' && isIf) {
      const [checks, clear, ...extra] = condition[1].split('|');
      group.conditionMode = 'and';
      if (extra.length || (clear !== undefined && !/^[01]$/.test(clear.trim())) || checks.includes(';')
        || !checks.split(',').every(check => /^\s*[PDMNSIGAUTJZ]\d+\s*(?:<=|>=|<>|=|<|>)\s*[^<>=,;|]+\s*$/i.test(check))) {
        node.unknown.push('条件或清变量参数未能确认');
      } else group.clearVariables = clear?.trim() === '1';
    } else node.unknown.push('该引擎未证实此处的方括号条件');
  } else if (isIf) node.unknown.push('#IF 缺少爆率比较条件');
  for (const token of rest.split(/\s+/).filter(Boolean)) {
    if (token.toUpperCase() === 'RANDOM') group.random = true;
    else if (token.toUpperCase() === 'BURSTRATE' && engine !== '996PC') group.ignoresMultiplier = true;
    else node.unknown.push(`未证实分组参数：${token}`);
  }
  return node;
}

function parseCaseGroup(raw: string, line: number, engine: EngineId): Node {
  const group: DropGroup = { raw, line, random: false, ignoresMultiplier: false };
  const node: Node = { group, children: [], unknown: [] };
  if (engine === 'GEE') {
    node.unknown.push('翎风未证实 #CASE 爆率块，不能套用 GOM/996PC 语法');
    return node;
  }
  const match = /^#CASE\s+([PDMNSIGAUTJZ]\d+)(?:\|([01]))?(?:\s+(RANDOM))?$/i.exec(raw);
  if (!match) {
    node.unknown.push('#CASE 变量、清零参数或 RANDOM 形态未确认');
    return node;
  }
  group.caseVariable = match[1].toUpperCase();
  group.caseClearVariables = match[2] === '1';
  group.random = Boolean(match[3]);
  return node;
}

export function analyzeDropRates(text: string, engine: EngineId): DropAnalysis {
  if (!['GOM', 'GEE', '996PC'].includes(engine)) throw new Error('未知引擎，不能推测爆率规则');
  if (text.length > 1_000_000) throw new Error('爆率分析文本超过 100 万字符上限');
  const lines = text.split(/\r?\n/);
  if (lines.length > 20_000) throw new Error('爆率分析超过 2 万行上限');
  const result: DropAnalysis = { engine, rows: [], groups: [], warnings: [] };
  const root: Node = { children: [], rate: ONE, unknown: [] };
  const stack = [root];
  let pending: Node | undefined, pendingCase: Node | undefined, section = '', malformed = false;
  // A CASE header is followed by one or more `value` + `(...)` siblings.  Keep
  // this small state machine separate from the normal parenthesis stack so a
  // second value is not mistaken for an unsupported item (and so nested CASE
  // blocks can recover without stealing the outer block's next value).
  let caseContexts: CaseContext[] = [];
  const caseValuePattern = /^[+-]?\d{1,128}$/;
  const cloneCaseBranch = (template: Node, value: string): Node => {
    const original = template.group!;
    const group: DropGroup = { ...original, caseValue: value };
    return { group, children: [], unknown: [...template.unknown] };
  };
  const findLastCase = (predicate: (candidate: CaseContext) => boolean): CaseContext | undefined => {
    for (let index = caseContexts.length - 1; index >= 0; index--) {
      const candidate = caseContexts[index];
      if (predicate(candidate)) return candidate;
    }
    return undefined;
  };
  const caseForNode = (node: Node): CaseContext | undefined =>
    findLastCase(context => context.branch === node);
  const discardDetachedCases = () => {
    // A nested CASE's parent is the branch node that has just been popped. It
    // cannot receive another sibling value after that branch is closed.
    caseContexts = caseContexts.filter(context => stack.includes(context.parent));
  };
  const warn = (line: number, message: string) => result.warnings.push({ line, message });
  for (const [index, raw] of lines.entries()) {
    const line = index + 1, source = dropSourceLine(raw.replace(/^\uFEFF/, ''));
    if (!source) continue;
    // 996PC/GOM manuals also document the legacy two-line form:
    //   #CHILD 1/1\nRANDOM\n( ... )
    // It is equivalent to `#CHILD 1/1 RANDOM`; only accept the token while a
    // just-parsed CHILD is waiting for its opening parenthesis.
    if (engine !== 'GEE' && pending && /^#CHILD\b/i.test(pending.group?.raw || '') && /^RANDOM$/i.test(source)) {
      pending.group!.random = true;
      continue;
    }
    if (source === '(') {
      // CASE has an explicit branch value on the line between the header and
      // the opening parenthesis. A missing value remains unknown but must not
      // consume the following document as a malformed CHILD block.
      const openingNode = pending;
      const hadPendingCase = Boolean(pendingCase);
      const node = openingNode || pendingCase || { children: [], unknown: ['没有已确认分组的括号'] };
      if (pendingCase) {
        node.unknown.push('#CASE 缺少分支值');
        warn(node.group?.line || line, '#CASE 缺少分支值');
        malformed = true;
        const context = findLastCase(candidate => candidate.state === 'awaiting-branch' && candidate.branch === undefined);
        if (context) caseContexts = caseContexts.filter(candidate => candidate !== context);
        pendingCase = undefined;
      }
      if (!openingNode && !hadPendingCase) { stack.at(-1)!.children.push(node); malformed = true; }
      stack.push(node); pending = undefined;
      if (openingNode) {
        const context = caseForNode(openingNode);
        if (context) { context.state = 'open'; }
      }
      if (stack.length > 33) throw new Error('爆率嵌套超过 32 层上限');
      continue;
    }
    if (pendingCase) {
      // Documented CASE branches use a literal integer label (100, 101...).
      // Do not consume a command/label as the branch value when a malformed
      // CASE is encountered; leave the line to the normal parser for recovery.
      if (caseValuePattern.test(source)) {
        pendingCase.group!.caseValue = source;
        const context = findLastCase(candidate => candidate.branch === undefined && candidate.state === 'awaiting-branch');
        if (context) { context.branch = pendingCase; context.state = 'awaiting-open'; }
        pending = pendingCase;
        pendingCase = undefined;
        continue;
      }
      pendingCase.unknown.push('#CASE 分支值不是已确认的整数');
      warn(pendingCase.group!.line, '#CASE 分支值不是已确认的整数');
      const invalidContext = findLastCase(candidate => candidate.state === 'awaiting-branch' && candidate.branch === undefined);
      if (invalidContext) caseContexts = caseContexts.filter(candidate => candidate !== invalidContext);
      pendingCase = undefined;
      malformed = true;
    }
    if (pending) { malformed = true; warn(pending.group!.line, '分组后缺少独立行左括号'); pending = undefined; }

    // A closed CASE may be followed by another integer branch value.  Use the
    // nearest ready context at the current parent; any non-integer line ends
    // that context so a later numeric item cannot be misclassified.
    if (caseValuePattern.test(source)) {
      const parent = stack.at(-1)!;
      const context = [...caseContexts].reverse().find(candidate => candidate.state === 'ready' && candidate.parent === parent);
      if (context && context.branch) {
        const branch = cloneCaseBranch(context.branch, source);
        context.parent.children.push(branch);
        context.branch = branch;
        context.state = 'awaiting-open';
        result.groups.push(branch.group!);
        pending = branch;
        continue;
      }
    }
    // If this is not the next branch value, retire the ready context before
    // parsing an ordinary line (or a new CASE header).
    if (!/^\d+$/.test(source)) {
      const parent = stack.at(-1)!;
      caseContexts = caseContexts.filter(candidate => !(candidate.state === 'ready' && candidate.parent === parent));
    }
    if (source === ')') {
      if (stack.length > 1) {
        const closed = stack.pop()!;
        const context = caseForNode(closed);
        if (context && context.state === 'open') context.state = 'ready';
        discardDetachedCases();
      }
      else { malformed = true; warn(line, '多余的右括号'); }
      continue;
    }
    if (/^\[@[^\]]+\]$/.test(source)) {
      if (stack.length !== 1) { malformed = true; warn(line, '标签跨越未闭合爆率块'); }
      section = source.slice(1, -1); continue;
    }
    if (source === '{' || source === '}') continue; // Called-label wrappers, not probability gates.
    if (/^#(?:CHILD|IF)\b/i.test(source)) {
      pending = parseGroup(source, line, engine);
      stack.at(-1)!.children.push(pending); result.groups.push(pending.group!);
      for (const message of pending.unknown) warn(line, message);
      continue;
    }
    if (/^#CASE\b/i.test(source)) {
      // A previous CASE with no following value is complete once a new header
      // starts at the same parent.  The current header gets its own context.
      const parent = stack.at(-1)!;
      caseContexts = caseContexts.filter(candidate => candidate.parent !== parent || candidate.state === 'open');
      pendingCase = parseCaseGroup(source, line, engine);
      parent.children.push(pendingCase);
      caseContexts.push({ parent, state: 'awaiting-branch' });
      result.groups.push(pendingCase.group!);
      for (const message of pendingCase.unknown) warn(line, message);
      continue;
    }
    const item = /^(\S+\/\S+)\s+(\S+)(?:\s+(.*))?$/.exec(source);
    if (item) {
      const [itemName, trigger, ...extra] = item[2].split('|');
      const row: DropAnalysisRow = { line, section, item: itemName, trigger, sourceRate: item[1],
        quantity: item[3], formula: [], runtimeReasons: [], unknownReasons: [] };
      if (trigger?.startsWith('@')) row.runtimeReasons.push(`QF ${trigger}/ALLOWDROP 决定最终是否掉落`);
      if (!itemName || extra.length || (trigger !== undefined && !/^@[^|]+$/.test(trigger))) row.unknownReasons.push('物品触发字段未确认');
      if (/^(?:[AS]\d+$|<\$)/i.test(itemName)) row.runtimeReasons.push('动态物品名称及清空状态未执行');
      if (item[3] && !/^\d+$/.test(item[3])) row.unknownReasons.push('数量或附加字段未确认');
      const value = rate(item[1]);
      stack.at(-1)!.children.push({ row, children: [], rate: value,
        unknown: value ? [] : ['几率动态、分母无效或超出已验证范围'] });
      result.rows.push(row); continue;
    }
    const message = /^#CALL(?:EX)?\b/i.test(source) ? 'CALL 外部爆率未展开，不执行或猜测外部内容'
      : `未支持的爆率行：${source.slice(0, 100)}`;
    stack.at(-1)!.children.push({ children: [], unknown: [message] });
    warn(line, message);
    // CASE/NPC flow can change the meaning of all following rows; no guessed rates.
    if (!/^#CALL(?:EX)?\b/i.test(source)) malformed = true;
  }
  if (pending || pendingCase || stack.length > 1) { malformed = true; warn(lines.length, '爆率块未闭合'); }
  function walk(node: Node, incoming: Fraction, formula: string[], unknown: string[], runtime: string[], skipRate = false): void {
    const errors = [...unknown, ...node.unknown];
    const reasons = [...runtime];
    const group = node.group;
    if (group?.caseVariable) {
      const caseDescription = `CASE ${group.caseVariable}${group.caseValue !== undefined ? `=${group.caseValue}` : ''} 需运行时变量匹配`;
      reasons.push(caseDescription);
      errors.push(caseDescription);
      if (group.caseClearVariables) reasons.push('CASE 命中后清变量，后续状态未模拟');
    }
    if (group?.condition) reasons.push(`条件待判定：[${group.condition}]`);
    if (group?.trigger) reasons.push(`触发 ${group.trigger} 未执行`);
    if (group?.inheritanceMask !== undefined) reasons.push(`继承主人变量位掩码 ${group.inheritanceMask}，击杀者状态未知`);
    if (group?.clearVariables) reasons.push('命中后清变量，后续条件状态未模拟');
    if (group?.ignoresMultiplier) reasons.push('BURSTRATE：该分组子爆率不计人物倍率');
    let chance = incoming;
    const steps = [...formula];
    if (node.rate && !skipRate) { chance = multiply(chance, node.rate); steps.push(fraction(node.rate)); }
    if (node.row) {
      const row = node.row;
      row.formula = steps;
      row.unknownReasons.push(...errors, ...(malformed ? ['文档含未确认结构，停止计算数值'] : []));
      row.runtimeReasons.push(...reasons);
      if (!row.unknownReasons.length) row.baselineFraction = fraction(chance);
      return;
    }
    if (group?.random && node.children.some(child => !child.group && !child.row)) errors.push('RANDOM 候选含未展开/未知节点，候选总数不能确定');
    const selection: Fraction = group?.random && node.children.length ? [1n, BigInt(node.children.length)] : ONE;
    const childChance = multiply(chance, selection);
    const childSteps = group?.random ? [...steps, `随机选一 1/${node.children.length}`] : steps;
    for (const child of node.children) {
      // GXX skips a selected nested group's gate, but this is not proof for
      // every supported engine/version. Keep that combination unquantified.
      const childErrors = group?.random && child.group
        ? [...errors, 'RANDOM 内嵌分组的选择/几率规则待目标引擎实测'] : errors;
      walk(child, childChance, childSteps, childErrors, reasons,
        Boolean(group?.random && child.row && engine !== 'GEE'));
    }
  }
  walk(root, ONE, [], [], []);
  return result;
}

function cell(value: string): string {
  return value.replace(/[\\`*_{}[\]()#+.!|<>]/g, '\\$&').replace(/[\r\n]+/g, ' ');
}
export function dropAnalysisMarkdown(result: DropAnalysis, sourceName = ''): string {
  const lines = ['# 爆率基准分析', '', `引擎：${result.engine} 来源：${cell(sourceName)}`, '',
    '只读分析副本，不修改源文件。基准命中率按人物倍率=1、列出的条件已满足计算；不含限爆、击杀者、QF/ALLOWDROP 和实时变量影响，不能当作最终掉落率。', '',
    result.engine === 'GEE' ? '翎风 RANDOM：随机选一项后，仍判断该物品的子爆率。' : '当前引擎 RANDOM：随机选一项，忽略所选物品的子爆率。', '',
    '| 来源行 | 标签 | 物品 | 源几率 | 数量 | 基准命中率 | 条件与边界 |', '| --- | --- | --- | --- | --- | --- | --- |'];
  for (const row of result.rows) {
    const location = row.source ? `${row.source.filePath}:${row.source.line}` : String(row.line);
    const via = row.source?.callChain?.map(site => `${site.filePath}:${site.line} → ${site.label}`).join(' → ');
    lines.push(`| ${cell(location)} | ${cell(row.section)} | ${cell(row.item)} | ${cell(row.sourceRate)} | ${cell(row.quantity || '—')} | ${row.baselineFraction || '未计算'} | ${cell([...row.runtimeReasons, ...row.unknownReasons, ...(via ? [`调用链：${via}`] : [])].join('；') || '仅基准，无运行时状态')} |`);
  }
  lines.push('', '各行可能共享随机选择或条件，不能直接相加为总掉落概率；本报告不生成伪精确总概率。');
  if (result.external) lines.push('', `外部 CALL：展开 ${result.external.expandedCalls} 处，未展开 ${result.external.unresolvedCalls} 处；只读 ${result.external.filesRead} 个文件。CALLEX 不借用 NPC 预处理规则。`);
  if (result.warnings.length) lines.push('', '## 未展开或需核对', '', ...result.warnings.map(w => `- ${w.source ? cell(`${w.source.filePath}:${w.source.line}`) : `第 ${w.line} 行`}：${cell(w.message)}`));
  return lines.join('\n') + '\n';
}

import { EngineId } from '../types';
import { normalizeScriptVariableName } from '../utils/variable-statistics';
import { previewExcelRegisterName } from './preview-excel';

export type PreviewVariableKind = 'flag' | 'number' | 'text' | 'list' | 'dictionary';
export interface PreviewVariableContract {
  name: string;
  kind: PreviewVariableKind;
  description?: string;
  /** The input is usable, but the manual does not prove its value type/range. */
  typeUncertain?: boolean;
}
interface CatalogVariable {
  name: string; desc?: string; engines?: EngineId[];
  engineVariants?: Partial<Record<EngineId, { name?: string; desc?: string }>>;
}
// Resolve relative to this runtime module, not the workspace: extracted VSIX tests
// must use the exact bundled catalog and may not silently borrow developer files.
const catalog = (require('../../data/variables.json') as { variables: CatalogVariable[] }).variables;
const systemCatalogs = new Map<EngineId, Map<string, PreviewVariableContract>>();
const numbered = /^([PDMNSIGAUTJZ])(\d+)$/i;
const custom = /^(GL|[NSLD])\$([A-Za-z0-9_\u3400-\u9fff]+)$/i;
const textSystemNames = /(?:NAME(?:EX)?$|INFO$|ACCOUNT|PASSWORD|QUIZ|ANSWER|EMAIL|PHONE|IPADDR|IPLOCAL|SERVERIP|WEBSITE|BBSSITE|DIRECTORY|DOWNLOAD|MACHINEID|SHOPBUYER|SHOPSELLER|^QQ$|^MAP$|^HMAP$|^POS$|^DATE$|^DATETIME$|^TIME$|^LOGINTIME$|^HFTIME$|^STATSERVERTIME$|^BIRTHDAT$|^USERID$|^GAMEPROMOTIONFLAG$)/i;
const equipmentNames = /^(?:G_)?(?:DRESS|WEAPON|RIGHTHAND|HELMET|NECKLACE|RING_[LR]|ARMRING_[LR]|BUJUK|BELT|BOOTS|CHARM|HAT|DRUM|HORSE|SHIELD|SDRESS|SWEAPON)$/;
const numberSystemNames = /(?:COUNT|LEVEL|POINT|GOLD|DIAMOND|GAMEGIRD|GAMEGLORY|EXP|RATE|INDEX|MAKEINDEX|STDMODE|SHAPE|ANICOUNT|LOOKS|DURA|COLOR|WIDTH|HEIGHT|DAMAGE|REMAININGTIME|TIMEUNIX|UTCNOW|^VALUE\d+$|^PARAM\d+$|^YEAR$|^MONTH$|^DAY$|^HOUR(?:VAR)?$|^MINUTE(?:VAR)?$|^SECOND$|^LOGINLONG$|^RUNDATETIME$|^REVIVALTIME(?:EX)?$|^BATTLE|^HEROAUTOTIME$|^CURRMONPARAM$|^RANDOMNO$|^MONFLAG$|^NATIONID$|^MAGICID$|^OLDServerID$|^MAGICTARGETRACE$|^ALLOW|^HEAR|^BANSHOUT$|^H[XY]$|^(?:MAX)?(?:HP|MP|AC|MAC|DC|MC|SC|NH|BW|WW|HW)$|^(?:KILLMON|ATTACKMONSTER|SCATTERITEM|MOUSE)?[XY](?:EX)?$|^(?:HIT|HITSPD|SPD|LUCK|DIR|HUNGER|ATTACKMODE|PKPOWER)$)/i;

function systemContract(name: string, description: string): PreviewVariableContract {
  const base = name.replace(/^[CH]\./, '');
  const textName = textSystemNames.test(base) || equipmentNames.test(base);
  const numericName = numberSystemNames.test(base);
  const textDescription = /名称|名字|姓名|字符串|字符型|网址|帐号|账号|地址|目录|密码|问题|答案|邮箱|电话|手机|生日/.test(description);
  const numericDescription = /数量|点数|等级|经验|数值|数字型|攻击力|防御力|魔防|道术|重量|负重|腕力|生命|血量|魔法值|内力|准确|敏捷|攻速|坐标|时间戳|秒数|上限|唯一(?:ID|序号)|是否|百分比|属性值/.test(description);
  // Specific slot names win over prose mentioning another slot: GAMEGOLDNAME
  // is text, while CURRRTARGETNAMECOLOR is a numeric color, not a target name.
  const kind = textName ? 'text' : numericName ? 'number' : textDescription ? 'text' : numericDescription ? 'number' : 'text';
  return { name, kind, description, ...(!textName && !numericName && !textDescription && !numericDescription ? { typeUncertain: true } : {}) };
}

function systems(engine: EngineId): Map<string, PreviewVariableContract> {
  let result = systemCatalogs.get(engine);
  if (result) return result;
  result = new Map();
  for (const item of catalog) {
    if (!item.engines?.includes(engine)) continue;
    const variant = item.engineVariants?.[engine];
    const name = (variant?.name || item.name).toUpperCase();
    if (!/^[A-Z][A-Z0-9_.]*$/.test(name)) continue;
    result.set(name, systemContract(name, variant?.desc || item.desc || '系统预览值'));
  }
  systemCatalogs.set(engine, result);
  return result;
}

/** Engine-specific identity/type, independent of any current server or MOV value. */
export function previewVariableContract(raw: string, engine: EngineId = 'GOM', explicitUnknown = false): PreviewVariableContract | undefined {
  let token = raw.trim();
  if (token.startsWith('<$') && token.endsWith('>')) token = token.slice(2, -1).trim();
  const wrapped = /^STR\((.*)\)$/i.exec(token);
  if (wrapped) token = wrapped[1].trim();
  if (/^\[\d+\]$/.test(token)) {
    const id = Number(token.slice(1, -1));
    const min = engine === '996PC' ? 0 : 1, max = engine === '996PC' ? 999 : 1024;
    return id >= min && id <= max ? { name: `[${id}]`, kind: 'flag', description: '个人标识：0 关 / 1 开' } : undefined;
  }
  const fixed = numbered.exec(token);
  if (fixed) {
    const family = fixed[1].toUpperCase(), index = Number(fixed[2]);
    const max = engine === '996PC' && /[PDM]/.test(family) ? 99 : /[UTJZ]/.test(family) ? 499 : 999;
    if (index > max || (engine === 'GEE' && family === 'Z')) return undefined;
    const kind = /[ASTZ]/.test(family) ? 'text' : 'number';
    // 996PC's main table and older expansion chapter disagree about upper bounds.
    const uncertain = engine === '996PC' && ((/[NS]/.test(family) && index > 99)
      || (/[IGA]/.test(family) && index > 499) || (/[UT]/.test(family) && index > 254));
    return { name: `${family}${index}`, kind, description: `${engine} ${family} 编号${kind === 'text' ? '文字' : '数值'}变量${uncertain ? '；手册各章节编号上限不一致' : ''}`,
      ...(uncertain ? { typeUncertain: true } : {}) };
  }
  const extended = custom.exec(token);
  if (extended) {
    const prefix = extended[1].toUpperCase();
    if ((prefix === 'GL' && engine !== 'GOM') || (prefix === 'D' && engine === '996PC')) return undefined;
    const kind = prefix === 'N' ? 'number' : prefix === 'S' ? 'text' : prefix === 'D' ? 'dictionary' : 'list';
    return { name: normalizeScriptVariableName(token), kind, description: kind === 'list' ? '有序列表，JSON 数组' : kind === 'dictionary' ? '键值字典，JSON 对象' : '扩展变量；$ 后名称区分大小写' };
  }
  const current = /^CSTR\((.*)\)$/i.exec(token);
  if (current) {
    const target = previewVariableContract(current[1], engine);
    if (target && !target.name.startsWith('[')) return { ...target, name: `CSTR(${target.name})`, description: `当前对象的 ${target.name}` };
    return undefined;
  }
  const excel = previewExcelRegisterName(token, engine);
  if (excel) return { name: excel, kind: 'text', description: 'READEXCEL 行数据的列值；数值或文字均按原文输入', typeUncertain: true };
  const scoped = /^(HUMAN|GLOBAL|GUILD|CHUMAN|CGUILD)\(([A-Za-z0-9_\u3400-\u9fff]+)\)$/i.exec(token);
  if (scoped) return { name: `${scoped[1].toUpperCase()}(${scoped[2]})`, kind: 'text', description: '具名自定义变量；类型以 VAR 声明为准', typeUncertain: true };
  const npcControl = /^NPCPARAMS\(\s*([1234])\s*,\s*([^()]+?)\s*\)$/i.exec(token);
  if (npcControl) {
    if (engine !== '996PC') return undefined;
    const target = previewVariableContract(npcControl[2], engine);
    if (!target) return undefined;
    const type = Number(npcControl[1]);
    if (type === 1 ? !/^[NS](?:\d|\$)/.test(target.name)
      : type === 4 ? !/^S(?:\d|\$)/.test(target.name)
      : target.kind !== 'number' || (type === 3 && !/^N(?:\d|\$)/.test(target.name))) return undefined;
    return { name: `NPCPARAMS(${type},${target.name})`, kind: target.kind, description: '996PC 控件提交值；仅本地场景，不写入服务器变量' };
  }
  const npcInput = /^NPCINPUT\((\d+)\)$/i.exec(token);
  if (npcInput) {
    const index = Number(npcInput[1]);
    const max = engine === 'GOM' || engine === 'GEE' ? 40 : engine === '996PC' ? 9 : 0;
    return index >= 1 && index <= max ? { name: `NPCINPUT(${index})`, kind: 'text', description: '输入框提交原文；仅本地预览，不提交服务器' } : undefined;
  }
  const param = /^SCRIPTPARAM(?:\((\d+)\)|(\d+))$/i.exec(token);
  if (param) {
    const index = Number(param[1] || param[2]);
    return index >= 1 && index <= 99 ? { name: `SCRIPTPARAM(${index})`, kind: 'text', description: `NPC 标签第 ${index} 个传入参数；数字也可按原文输入` } : undefined;
  }
  const name = token.toUpperCase();
  if (/^PARAM\d+$/.test(name)) return { name, kind: 'text', description: '触发/命令参数；具体值类型取决于触发上下文', typeUncertain: true };
  const exact = systems(engine).get(name);
  if (exact) return { ...exact };
  // Own manuals permit the current-object / hero form for private constants.
  const qualified = /^([CH])\.(.+)$/.exec(name);
  if (qualified) {
    const base = systems(engine).get(qualified[2]);
    if (base) return { ...base, name, description: `${qualified[1] === 'C' ? '当前对象' : '英雄'}：${base.description}` };
  }
  const team = /^TEAM(\d+)$/.exec(name);
  if (team && Number(team[1]) <= 99) return { name, kind: 'text', description: '队伍成员名称' };
  // Only an explicit template can register an unknown, plain identifier. A
  // function/operation is not an input and must never be simulated by guessing.
  if (explicitUnknown && /^[A-Z][A-Z0-9_.]*$/.test(name)) {
    return { name, kind: 'text', description: '当前引擎目录未登记该变量；仅接受本地文字预览，不证明引擎支持', typeUncertain: true };
  }
  return undefined;
}

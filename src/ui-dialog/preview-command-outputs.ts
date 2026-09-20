import { EngineId } from '../types';

/**
 * Audited output identities shared by discovery and unknown-write invalidation.
 * These positions describe writes; they do not claim the command is simulated.
 * Run a deterministic implementation first, then use this registry as fallback.
 * Indexes are zero based, and never include ordinary input operands.
 */
const commonOutputs: Readonly<Record<string, readonly number[]>> = {
  MOVR: [0], SETSTRINGBLANK: [0],
  READCONFIGFILEITEM: [3], GETDBITEMFIELDVALUE: [2],
  GETDBMONSTERFIELDVALUE: [2], GETBINDMONEY: [1], GETRANDOMLINETEXT: [1],
  GETSTRINGPOSEX: [2, 3], CHECKITEMADDVALUE: [4],
  CHECKNAMEDATETIMELIST: [2, 3, 4, 5], CHECKNAMELISTPOSITION: [3],
};

const engineOutputs: Readonly<Record<EngineId, Readonly<Record<string, readonly number[]>>>> = {
  GOM: {
    CSVGETCELLTEXT: [3], CSVGETCELLINFO: [1, 2], CSVFINDTEXTROW: [5], GETLISTSTRINGEX: [2],
    GETITEMNAMEBYMAKEINDEX: [1], CALCPER: [2], PERCENT: [0], GETRANDOMLINETEXTEX: [1],
    CHECKBAGITEM: [1], CHECKSLAVENAME: [1], CHECKITEMADDVALUEEX: [4], CHECKREVIVAL: [0], CHECKSKILL: [4, 5],
    CHECKUSERDATE: [3, 4], FINDMONPOINT: [2, 3, 4], GETGUILDMEMBERCOUNT: [1], GETSHOPITEMCOUNT: [1, 3],
  },
  GEE: {
    CSVGETCELLTEXT: [3], CSVGETCELLINFO: [1, 2], CSVFINDTEXTROW: [5], CALCPERCENT: [2],
    CACHEGETSTRINGPOSEX: [2, 3], CHECKUSERDATE: [3, 4], FINDMONPOINT: [2, 3], GETGUILDMEMBERCOUNT: [1],
  },
  '996PC': {
    GETITEMNAMEBYMAKEINDEX: [1], GETDBIDXITEMFIELDVALUE: [2], HUMVARRANK: [1], CALCPER: [2], PERCENT: [0],
    CHECKBAGITEM: [1], CHECKREVIVAL: [0], CHECKCACHEGETSTRINGPOSEX: [2, 3],
  },
};

/**
 * Additions were cross-checked against the engine's own local manual:
 * - GOM commands-functional-b: GetDBMonsterFieldValue / GetItemNameByMakeIndex;
 *   game-features-a: GetBindMoney; commands-functional-a: PERCENT / CalcPer.
 * - GEE/LFM variables: GetBindMoney; server-map: GetDBMonsterFieldValue;
 *   commands-functional-a: CalcPercent; commands-functional-b: CacheGetStringPosEx.
 * - 996PC commands-functional-b: GetDBMonsterFieldValue / GetDBIdxItemFieldValue;
 *   PERCENT own-help 功能操作命令/百分比.htm explicitly assigns N1=(N2/N3)*100,
 *   so its first operand is an output, independently of GOM's same-name entry;
 *   variables: GetBindMoney / HumVarRank / SortHumVar;
 *   new-features: GetItemNameByMakeIndex; commands-check: CheckCacheGetStringPosEx.
 * The remaining entries preserve the previously audited preview output contract.
 */
export function runtimePreviewOutputIndexes(command: string, engine: EngineId): readonly number[] | undefined {
  const name = command.toUpperCase();
  return engineOutputs[engine][name] || commonOutputs[name];
}

/**
 * SortHumVar writes prefix1, prefix2, ... instead of the prefix variable itself.
 * Keep it out of direct targets. Resolve only already discovered/known positive
 * decimal suffixes (or a separately bounded static count), never an unbounded
 * invented family. The 996PC manual's example reads S$变量排序1 / N$变量排序1.
 */
export function runtimePreviewOutputFamilyIndexes(command: string, engine: EngineId): readonly number[] | undefined {
  return engine === '996PC' && command.toUpperCase() === 'SORTHUMVAR' ? [1, 2] : undefined;
}

/** Fixed implicit registers, not a guess based on variable-shaped arguments. */
export function runtimePreviewImplicitOutputs(command: string, engine: EngineId): readonly string[] | undefined {
  const name = command.toUpperCase();
  if (name === 'CHECKNAMELISTPOSITION' && engine !== '996PC') return ['P0'];
  // AddMirrorMap success/failure and MirrorMapTime results are independent
  // runtime writes. Neither may retain an earlier direct database IDX value.
  if ((name === 'ADDMIRRORMAP' || name === 'MIRRORMAPTIME') && engine !== 'GEE') return ['D99'];
  return undefined;
}

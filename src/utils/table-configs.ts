/**
 * 表格配置文件共享常量 — merchant.txt / mongen.txt 表头定义
 */
export const TABLE_CONFIGS: Record<string, string> = {
  'merchant.txt': [
    '脚本路径', '地图编号', 'X', 'Y', 'NPC显示名字', 'NPC朝向', 'NPC外观编号',
    '是否属于城堡', '是否自动移动', '移动间隔',
  ].join(' │ '),
  'mongen.txt': [
    '地图',
    '坐标X',
    '坐标Y',
    '怪物名字',
    '范围',
    '数量(支持G变量)',
    '时间间隔',
    '集中刷新坐标机率',
    '名字颜色(0~255)',
    '刷出来时触发的QF脚本字段(*表示不触发QF)',
    '内功怪物(0,1)',
    '国家名',
    '怪物能否攻击同国家的人(0,1)',
    '不同国家的怪物能否相互攻击(0,1)',
    '怪物能否被同国家的人来攻击(0,1)',
    '刷新模式(0~1)',
    'BOSS怪(0~1 不被NOMANNOMON模式地图清理)',
    '是否在小地图显示刷新倒计时/刷怪预告(0、1或1@标签:秒数列表)',
  ].join(' │ '),
};

/** 匹配文件是否为已知表格文件 */
export function matchTableFile(fileName: string): string | null {
  const name = fileName.toLowerCase();
  for (const key of Object.keys(TABLE_CONFIGS)) {
    if (name.endsWith(key)) return key;
  }
  return null;
}

/** 解析空格/Tab分隔的列 */
export function parseTableColumns(text: string): { value: string; start: number; end: number }[] {
  const cols: { value: string; start: number; end: number }[] = [];
  let i = 0;
  while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++;
  while (i < text.length) {
    const start = i;
    while (i < text.length && text[i] !== ' ' && text[i] !== '\t') i++;
    cols.push({ value: text.substring(start, i), start, end: i });
    while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++;
  }
  return cols;
}

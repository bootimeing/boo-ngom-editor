export interface ReloadOption {
  id: number;
  label: string;
}

export const RELOAD_OPTIONS_BY_ENGINE: Readonly<Record<string, readonly ReloadOption[]>> = {
  GOM: [
    { id: 5, label: '物品数据库' },
    { id: 6, label: '技能数据库' },
    { id: 7, label: '怪物数据库' },
    { id: 8, label: '怪物说话设置' },
    { id: 9, label: '地图安全区' },
    { id: 10, label: '数据列表' },
    { id: 11, label: '参数设置' },
    { id: 13, label: 'QManage 登录脚本' },
    { id: 14, label: 'QFunction 功能脚本' },
    { id: 15, label: 'QMission 任务脚本' },
    { id: 16, label: 'Robot 机器人脚本' },
    { id: 17, label: '所有NPC' },
    { id: 19, label: '地图事件触发' },
    { id: 21, label: '怪物爆率' },
    { id: 23, label: '假人列表' },
    { id: 25, label: '沙巴克参数设置' },
    { id: 27, label: '刷怪配置 MonGen.txt' },
  ],
  GEE: [
    { id: 4, label: '物品数据库' },
    { id: 5, label: '技能数据库' },
    { id: 6, label: '怪物数据库' },
    { id: 7, label: '怪物说话设置' },
    { id: 8, label: '怪物大血条' },
    { id: 9, label: '宝箱数据' },
    { id: 10, label: '数据列表' },
    { id: 11, label: '地图安全区' },
    { id: 12, label: '参数设置' },
    { id: 13, label: '物品掉落规则' },
    { id: 15, label: 'QManage 登录脚本' },
    { id: 16, label: 'QFunction 功能脚本' },
    { id: 17, label: 'QMission 任务脚本' },
    { id: 18, label: 'QChatbox 聊天框脚本' },
    { id: 19, label: 'Robot 机器人脚本' },
    { id: 20, label: '所有NPC' },
    { id: 22, label: '地图事件触发' },
    { id: 25, label: '怪物爆率' },
  ],
  '996PC': [
    { id: 6, label: '物品数据' },
    { id: 7, label: '技能数据' },
    { id: 8, label: '怪物数据' },
    { id: 9, label: '重载爆率' },
    { id: 10, label: '重载套装' },
    { id: 11, label: '怪物说话配置' },
    { id: 12, label: '数据列表' },
    { id: 13, label: '地图安全区' },
    { id: 14, label: '参数设置' },
    { id: 15, label: '公告信息' },
    { id: 16, label: '沙巴克配置' },
    { id: 18, label: 'QFunction' },
    { id: 19, label: 'QManage' },
    { id: 20, label: 'QMission' },
    { id: 21, label: '重载机器人' },
    { id: 23, label: '所有NPC' },
    { id: 24, label: '重载账号列表' },
  ],
};

export function getReloadOptions(engine: string): readonly ReloadOption[] {
  return RELOAD_OPTIONS_BY_ENGINE[engine] || [];
}

export interface NormalizedReloadSelection {
  items: string[];
  changed: boolean;
}

export function normalizeReloadSelection(
  raw: readonly (string | number)[] | undefined
): NormalizedReloadSelection {
  if (!raw || raw.length === 0) {
    return { items: ['所有NPC'], changed: !raw || raw.length === 0 };
  }

  const names = raw
    .filter(value => typeof value === 'string' && value.trim() !== '' && Number.isNaN(Number(value)))
    .map(value => String(value).trim());
  const uniqueNames = [...new Set(names)];

  if (uniqueNames.length === 0) {
    return { items: ['所有NPC'], changed: true };
  }

  const normalizedOriginal = raw.map(value => String(value).trim());
  const changed = uniqueNames.length !== normalizedOriginal.length
    || uniqueNames.some((value, index) => value !== normalizedOriginal[index]);
  return { items: uniqueNames, changed };
}

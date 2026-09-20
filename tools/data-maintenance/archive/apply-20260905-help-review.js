#!/usr/bin/env node
// Curated review of D:\0帮助, not automatic acceptance of extracted English tokens.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const entries = [
  ['CHECKMAINHITTARGET', 'check', [], '检测范围物理攻击当前受击对象是否为主目标，适用于 Attack/Struck', '脚本检测命令/范围物理攻击主目标检测.htm', 6],
  ['CHECKCHANGEMODEEX', 'check', ['模式编号'], '检测对象是否仍处于 ChangeModeEx 指定模式；11 为禁锢模式计时', '脚本检测命令/检测对象状态.html', 45],
  ['CHECKGAMEVALIDATE', 'check', [], '检测当前角色是否正在完成游戏验证码', '功能操作命令/显示验证码窗口.html', 33],
  ['GETGAMEVALIDATEINFO', 'action', ['状态变量', '剩余秒变量', '错误变量', '换题变量', '原因变量', '[来源变量]', '[优先级变量]'], '读取验证码会话信息；后两项可选，第七项不能跳过第六项使用', '功能操作命令/显示验证码窗口.html', 61, 5],
  ['SETIGNORETARGETDEFENSE', 'action', ['值类型(0百分比/1固定值)', '值', '时间(秒/0在线有效)'], '同时忽视目标防御和魔御；百分比0-100，固定值非负，值0清除效果', '功能操作命令/忽视目标防御.htm', 4],
  ['SETPICKITEMRULEBINDIGNORE', 'action', ['开关(0关闭/1开启)'], '设置后续拾取是否忽略物品规则23的新增绑定；不解除已有绑定，小退/大退恢复0', '功能操作命令/无视拾取绑定规则.htm', 4],
  ['PLAYEFFECTEX', 'action', ['WIL文件序号', '开始图片数', '播放图片张数', '播放次数(<=0永久)', '播放速度(毫秒)', '播放顺序(0前面/1后面/2所有图层上方)', '[X偏移]', '[Y偏移]', '[普通播放或特效播放]'], '扩展人物特效格式；末尾偏移和绘制模式可省略，默认特效播放；与 PLAYEFFECT 的参数顺序不同', '功能操作命令/播放人物效果PLAYEFFECT.htm', 9, 6],
  ['STOPPLAYEFFECT', 'action', ['WIL文件序号', '开始图片数', '播放图片张数', '播放次数', '播放速度(毫秒)', '[播放顺序(0前面/1后面/2所有图层上方)]'], '停止参数匹配的人物特效；兼容旧格式，除0和2外的非0顺序按对象后面处理', '功能操作命令/播放人物效果PLAYEFFECT.htm', 20, 5],
  ['CLEARGUILD', 'action', ['模式(0指定行会/1按人数)', '行会名称或人数'], '清理行会及成员关系：模式1删除少于指定人数的行会，-1删除全部；数据库模式异步提交', '功能操作命令/行会清理命令.html', 13],
  ['SETITEMHINTIMAGE', 'action', ['装备位置', '图片索引(0-65535)'], '设置物品窗口样式2的悬浮框背景，资源为 NewopUI；0恢复默认图片47，不修改物品ICO或属性', '功能操作命令/物品悬浮框背景图命令.html', 5],
  // Only examples exist for these two names: do not invent parameter signatures.
  ['CHECKGROUPITEM', 'check', null, '最新手册在套装条件示例中使用 CheckGroupItem 1；未给出完整参数定义', '功能操作命令/锁定属性刷新.htm', 163],
  ['GIVEONITEM', 'action', null, '最新手册示例使用 GiveOnItem 00 布衣(男)、GiveOnItem 01 木剑；未给出完整参数定义', '功能操作命令/锁定属性刷新.htm', 250],
];

function apply() {
  const file = path.join(root, 'data/functions.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const [name, kind, params, details, page, evidenceLine, minArgs] of entries) {
    const existingKey = Object.keys(data).find(key => key.toUpperCase() === name);
    const key = existingKey || name;
    data[key] = {
      name, syntax: [name, ...(params || [])].join(' '), details,
      params: (params || []).join(' '), paramList: params || [], kind,
      contexts: [kind === 'check' ? 'IF' : 'ACT'], aliases: [],
      source: { revision: '2026-09-05', page: `游戏引擎反外挂系统/${page}`, evidenceLine, title: path.basename(page).replace(/\.html?$/, '') },
      completionEnabled: params !== null, completionVerified: params !== null,
      diagnosticSupported: true, completionReview: params ? '20260905-own-help-manual-exact' : '20260905-own-help-name-only',
      ...(params ? { minArgs: minArgs ?? params.length, maxArgs: params.length } : {}),
    };
  }
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  console.log(`Reviewed ${entries.length} GOM commands (10 signatures, 2 names only).`);
}
if (require.main === module) {
  if (process.argv.includes('--apply')) apply();
  else console.log('Archived 2026-09-05 catalog migration. Review current data first; use --apply to write.');
}
module.exports = { entries };

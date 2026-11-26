import * as fs from 'fs';
import * as path from 'path';
import { EngineId, WebviewMessage } from '../types';
import {
  buildMonsterIconPreviews,
  describeMonsterBodyAppearance,
  loadMonsterDatabaseDetail,
  MonsterPreviewImageAsset,
  saveMonsterDatabaseDetailText,
} from './database-detail';
import { resolveItemDescriptionMedia } from './item-desc-preview';
import { decodeTextFile, encodeTextFile, PreservedTextEncoding } from './text';

export interface DatabaseDetailMutationOptions {
  envirDirectory?: string;
  engine: EngineId;
  postMessage: (message: WebviewMessage) => void;
  resolveImage: (wilIndex: number, imageIndex: number) => MonsterPreviewImageAsset;
  resolveArchiveImage: (pakName: string, imageIndex: number) => MonsterPreviewImageAsset;
}

function dictionary(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function descriptionValue(text: string, name: string): string {
  for (const line of text.split(/\r\n|\n|\r/)) {
    const equal = line.indexOf('=');
    if (equal > 0 && line.slice(0, equal).trim() === name) return line.slice(equal + 1).trim();
  }
  return '';
}

function readDescription(filePath: string): { text: string; encoding: PreservedTextEncoding } {
  return fs.existsSync(filePath)
    ? decodeTextFile(fs.readFileSync(filePath))
    : { text: '', encoding: 'gbk' };
}

function replaceDescription(text: string, name: string, value: string): string {
  const entry = `${name}=${value}`;
  const parts = text.split(/(\r\n|\n|\r)/);
  for (let index = 0; index < parts.length; index += 2) {
    const equal = parts[index].indexOf('=');
    if (equal > 0 && parts[index].slice(0, equal).trim() === name) {
      parts[index] = entry;
      return parts.join('');
    }
  }
  const eol = text.match(/\r\n|\n|\r/)?.[0] || '\r\n';
  return text ? text + (/\r$|\n$/.test(text) ? entry + eol : eol + entry) : entry + eol;
}

/** Handles the two ancillary-file mutations for both database detail surfaces. */
export function handleDatabaseDetailMutation(
  message: unknown,
  options: DatabaseDetailMutationOptions
): boolean {
  const msg = dictionary(message);
  if (msg.type !== 'saveMonsterDetail' && msg.type !== 'saveItemDesc') return false;
  const monster = msg.type === 'saveMonsterDetail';
  const resultType = monster ? 'monsterDetailSaveResult' : 'itemDescSaveResult';
  const name = typeof msg.name === 'string' ? msg.name.trim() : '';
  const key = typeof msg.key === 'string' ? msg.key : '';
  let savedFileName = '';
  const result = (ok: boolean, messageText: string) => options.postMessage({
    type: resultType, name, key, ok, message: messageText,
  });
  try {
    if (!options.envirDirectory) throw new Error('请先打开服务端工作区');
    if (!fs.existsSync(options.envirDirectory) || !fs.statSync(options.envirDirectory).isDirectory()) {
      throw new Error('服务端 Envir 目录无效');
    }
    if (!name || /[\0\r\n=]/.test(name)) throw new Error('记录名称无效，无法保存');
    if (monster && (name === '.' || name === '..' || /[<>:"/\\|?*]/.test(name))) {
      throw new Error('怪物名称无效，无法保存配置');
    }
    if (typeof msg.text !== 'string' || msg.text.includes('\0')) throw new Error('保存文本无效');
    if (monster) {
      if (key !== 'dropRateText' && key !== 'iconText') throw new Error('不支持的怪物配置类型');
      const saved = saveMonsterDatabaseDetailText(options.envirDirectory, name, key, msg.text);
      savedFileName = saved.fileName;
      const fields = dictionary(msg.fields);
      const detail = loadMonsterDatabaseDetail(options.envirDirectory, name);
      const preview = buildMonsterIconPreviews(detail.icons, options.resolveImage);
      const body = describeMonsterBodyAppearance(options.envirDirectory, name, fields, options.engine);
      const bodyAsset = body.source === 'archive' && body.pakName
        ? options.resolveArchiveImage(body.pakName, body.imageIndex)
        : body.source === 'will' && body.willIndex !== undefined
          ? options.resolveImage(body.willIndex, body.imageIndex)
          : { url: '' };
      options.postMessage({
        type: 'showDatabaseDetail', detailKind: 'monster', name, fields,
        columnLabels: dictionary(msg.columnLabels),
        columnDescriptions: dictionary(msg.columnDescriptions),
        dropRateText: detail.dropRateText, dropRateFileName: detail.dropRateFileName,
        iconText: detail.iconText, iconFileName: detail.iconFileName,
        monsterIcons: preview.icons, iconConfigTruncated: preview.iconConfigTruncated,
        monsterBody: { ...body, ...bodyAsset },
        saveResult: { key, ok: true, message: `已保存 ${saved.fileName}` },
      });
    } else {
      if (key !== 'topDesc' && key !== 'itemDesc') throw new Error('不支持的物品描述类型');
      if (/[\r\n]/.test(msg.text)) throw new Error('物品描述请用反斜杠分隔显示行，不能包含实际换行');
      const topPath = path.join(options.envirDirectory, 'ItemDescTopList.txt');
      const itemPath = path.join(options.envirDirectory, 'ItemDescList.txt');
      const top = readDescription(topPath);
      const item = readDescription(itemPath);
      const target = key === 'topDesc' ? top : item;
      target.text = replaceDescription(target.text, name, msg.text);
      const encoded = encodeTextFile(target.text, target.encoding);
      if (decodeTextFile(encoded).text !== target.text) throw new Error('文本包含原文件编码无法保存的字符');
      const fileName = key === 'topDesc' ? 'ItemDescTopList.txt' : 'ItemDescList.txt';
      fs.writeFileSync(key === 'topDesc' ? topPath : itemPath, encoded);
      savedFileName = fileName;
      const topDesc = descriptionValue(top.text, name);
      const itemDesc = descriptionValue(item.text, name);
      const media = resolveItemDescriptionMedia(`${topDesc}\n${itemDesc}`,
        (wilIndex, imageIndex) => options.resolveImage(wilIndex, imageIndex).url);
      options.postMessage({
        type: 'showDatabaseDetail', detailKind: 'item', name, topDesc, itemDesc, fields: {},
        images: media.images, animatedImages: media.animations, preserveSelectionVisuals: true,
      });
      result(true, `已保存 ${savedFileName}`);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    result(Boolean(savedFileName), savedFileName ? `已保存 ${savedFileName}；详情刷新失败：${detail}` : detail);
  }
  return true;
}

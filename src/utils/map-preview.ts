import * as fs from 'fs';

export interface MapInfoEntry {
  key: string;
  mapId: string;
  originalMapId: string;
  name: string;
  parameters: string;
  lineNumber: number;
}

export interface MapMarker {
  mapName: string;
  x: number;
  y: number;
  text: string;
  displayText: string;
  colorSource: string;
  color: string;
  mode: 0 | 1;
  lineNumber: number;
}

export interface MapMarkerUpdate {
  mapName: string;
  x: number;
  y: number;
  text: string;
  colorSource: string;
  mode: 0 | 1;
}

export interface MapDimensions {
  width: number;
  height: number;
}

export function parseMapInfoText(text: string): MapInfoEntry[] {
  const result: MapInfoEntry[] = [];
  const seen = new Set<string>();

  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';')) continue;
    const match = line.match(/^\[([^\]]+)\]\s*(.*)$/);
    if (!match) continue;

    const body = match[1].trim();
    const parameters = match[2].trim();
    let mapId = '';
    let originalMapId = '';
    let name = '';

    const pipeIndex = body.indexOf('|');
    if (pipeIndex >= 0) {
      mapId = body.slice(0, pipeIndex).trim();
      const aliasBody = body.slice(pipeIndex + 1).trim();
      const aliasMatch = aliasBody.match(/^(\S+)(?:\s+(.+))?$/);
      if (!aliasMatch) continue;
      originalMapId = aliasMatch[1].trim();
      name = (aliasMatch[2] || mapId).trim();
    } else {
      const standardMatch = body.match(/^(\S+)(?:\s+(.+))?$/);
      if (!standardMatch) continue;
      mapId = standardMatch[1].trim();
      originalMapId = mapId;
      name = (standardMatch[2] || mapId).trim();
    }

    if (!mapId || !originalMapId || !name) continue;
    const identity = `${mapId.toLowerCase()}\u0000${originalMapId.toLowerCase()}\u0000${name.toLowerCase()}`;
    if (seen.has(identity)) continue;
    seen.add(identity);

    const lineNumber = index + 1;
    result.push({
      key: `${lineNumber}:${mapId}`,
      mapId,
      originalMapId,
      name,
      parameters,
      lineNumber,
    });
  }

  return result;
}

export function parseMapMarkerText(text: string): MapMarker[] {
  const result: MapMarker[] = [];

  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';')) continue;
    const fields = parseCsvLine(line);
    if (fields.length < 6) continue;

    const mapName = fields[0].trim();
    const x = Number(fields[1].trim());
    const y = Number(fields[2].trim());
    const colorField = fields[fields.length - 2].trim();
    const modeNumber = Number(fields[fields.length - 1].trim());
    const markerText = fields.slice(3, -2).join(',').trim();

    if (!mapName || !Number.isFinite(x) || !Number.isFinite(y) || !markerText) continue;
    if (modeNumber !== 0 && modeNumber !== 1) continue;

    result.push({
      mapName,
      x,
      y,
      text: markerText,
      displayText: cleanMarkerDisplayText(markerText),
      colorSource: colorField,
      color: normalizeMarkerColor(colorField),
      mode: modeNumber,
      lineNumber: index + 1,
    });
  }

  return result;
}

export function updateMapMarkerLine(
  text: string,
  lineNumber: number,
  update: MapMarkerUpdate
): { text: string; marker: MapMarker } {
  if (!Number.isInteger(lineNumber) || lineNumber < 1) {
    throw new Error('标识行号无效');
  }
  validateMarkerUpdate(update);

  const range = findLineRange(text, lineNumber);
  if (!range) throw new Error(`标识第 ${lineNumber} 行不存在`);
  const currentLine = text.slice(range.start, range.end);
  if (parseMapMarkerText(currentLine).length !== 1) {
    throw new Error(`第 ${lineNumber} 行不是有效的地图标识`);
  }

  const replacement = serializeMarkerUpdate(update);
  const updatedText = text.slice(0, range.start) + replacement + text.slice(range.end);
  const parsed = parseMapMarkerText(replacement)[0];
  if (!parsed) throw new Error('修改后的地图标识无效');
  return {
    text: updatedText,
    marker: { ...parsed, lineNumber },
  };
}

export function deleteMapMarkerLine(
  text: string,
  lineNumber: number
): { text: string; marker: MapMarker } {
  if (!Number.isInteger(lineNumber) || lineNumber < 1) {
    throw new Error('标识行号无效');
  }
  const range = findLineRange(text, lineNumber);
  if (!range) throw new Error(`标识第 ${lineNumber} 行不存在`);
  const currentLine = text.slice(range.start, range.end);
  const marker = parseMapMarkerText(currentLine)[0];
  if (!marker) throw new Error(`第 ${lineNumber} 行不是有效的地图标识`);

  let removeStart = range.start;
  let removeEnd = range.end;
  if (text[removeEnd] === '\r' && text[removeEnd + 1] === '\n') {
    removeEnd += 2;
  } else if (text[removeEnd] === '\r' || text[removeEnd] === '\n') {
    removeEnd++;
  } else if (removeStart > 0) {
    if (text[removeStart - 1] === '\n' && text[removeStart - 2] === '\r') {
      removeStart -= 2;
    } else if (text[removeStart - 1] === '\r' || text[removeStart - 1] === '\n') {
      removeStart--;
    }
  }

  return {
    text: text.slice(0, removeStart) + text.slice(removeEnd),
    marker: { ...marker, lineNumber },
  };
}

export function appendMapMarkerLines(
  text: string,
  updates: MapMarkerUpdate[]
): { text: string; markers: MapMarker[] } {
  if (!updates.length) throw new Error('至少选择一种标识所在位置');
  for (const update of updates) validateMarkerUpdate(update);

  const eol = text.match(/\r\n|\n|\r/)?.[0] || '\r\n';
  const hasTrailingEol = /(?:\r\n|\n|\r)$/.test(text);
  const existingLineCount = text ? text.split(/\r\n|\n|\r/).length : 0;
  const firstLineNumber = text
    ? existingLineCount + (hasTrailingEol ? 0 : 1)
    : 1;
  const serialized = updates.map(serializeMarkerUpdate);
  const prefix = text && !hasTrailingEol ? `${text}${eol}` : text;
  const updatedText = `${prefix}${serialized.join(eol)}${hasTrailingEol ? eol : ''}`;
  const markers = serialized.map((line, index) => {
    const marker = parseMapMarkerText(line)[0];
    if (!marker) throw new Error('新增的地图标识无效');
    return { ...marker, lineNumber: firstLineNumber + index };
  });
  return { text: updatedText, markers };
}

export function markerMatchesMap(marker: MapMarker, map: MapInfoEntry): boolean {
  const key = normalizeMapKey(marker.mapName);
  return key === normalizeMapKey(map.mapId)
    || key === normalizeMapKey(map.originalMapId)
    || key === normalizeMapKey(map.name);
}

export function normalizeMarkerColor(value: string): string {
  const source = value.trim();
  const normalized = source.replace(/^(?:\$|#|0x)/i, '');
  if (/^[0-9a-f]{6}$/i.test(normalized)) {
    if (source.startsWith('$')) {
      const red = normalized.slice(4, 6);
      const green = normalized.slice(2, 4);
      const blue = normalized.slice(0, 2);
      return `#${red}${green}${blue}`.toUpperCase();
    }
    return `#${normalized.toUpperCase()}`;
  }
  if (/^[0-9a-f]{8}$/i.test(normalized)) return `#${normalized.slice(0, 6).toUpperCase()}`;

  const palette: Record<string, string> = {
    '249': '#FF9900',
    '250': '#66CCFF',
    '251': '#999999',
    '252': '#FF6666',
    '253': '#33FF66',
    '254': '#FFFF33',
    '255': '#FFFFFF',
  };
  return palette[normalized] || '#FFFFFF';
}

export function readClassicMapDimensions(filePath: string): MapDimensions | undefined {
  try {
    const handle = fs.openSync(filePath, 'r');
    const header = Buffer.alloc(64);
    let bytesRead = 0;
    try {
      bytesRead = fs.readSync(handle, header, 0, header.length, 0);
    } finally {
      fs.closeSync(handle);
    }
    if (bytesRead < 4) return undefined;
    const width = header.readUInt16LE(0);
    const height = header.readUInt16LE(2);
    if (width < 1 || height < 1 || width > 4000 || height > 4000) return undefined;
    return { width, height };
  } catch {
    return undefined;
  }
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

function validateMarkerUpdate(update: MapMarkerUpdate): void {
  if (!update.mapName.trim()) throw new Error('地图名字不能为空');
  if (!Number.isFinite(update.x) || !Number.isFinite(update.y)) throw new Error('坐标必须是数字');
  if (update.x < 0 || update.y < 0) throw new Error('坐标不能小于 0');
  if (!update.text.trim()) throw new Error('显示文字不能为空');
  if (!update.colorSource.trim()) throw new Error('文字颜色不能为空');
  if (update.mode !== 0 && update.mode !== 1) throw new Error('标识所在必须是大地图或小地图');
  for (const value of [update.mapName, update.text, update.colorSource]) {
    if (/[\r\n]/.test(value)) throw new Error('标识内容不能包含换行');
  }
}

function findLineRange(text: string, lineNumber: number): { start: number; end: number } | undefined {
  let start = 0;
  let currentLine = 1;
  for (let index = 0; index <= text.length; index++) {
    const char = text[index];
    const isLineEnd = char === '\r' || char === '\n' || index === text.length;
    if (!isLineEnd) continue;
    if (currentLine === lineNumber) return { start, end: index };
    if (char === '\r' && text[index + 1] === '\n') index++;
    start = index + 1;
    currentLine++;
  }
  return undefined;
}

function escapeCsvField(value: string): string {
  if (!/[",]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function serializeMarkerUpdate(update: MapMarkerUpdate): string {
  return [
    update.mapName,
    String(update.x),
    String(update.y),
    update.text,
    update.colorSource,
    String(update.mode),
  ].map(escapeCsvField).join(',');
}

function cleanMarkerDisplayText(value: string): string {
  const withoutHints = value.replace(/\{[^{}]*\|[^{}]*\}/g, '');
  const withoutImages = withoutHints.replace(/<(?:IMG|PLAYIMG):[^>]*>/gi, '');
  return withoutImages.replace(/\\([<>\[\]])/g, '$1').trim() || '图标';
}

function normalizeMapKey(value: string): string {
  return value.trim().toLowerCase();
}

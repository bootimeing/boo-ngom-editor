(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BooTableCore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function textValue(value) {
    return value === undefined || value === null ? '' : String(value);
  }

  function tableSize(rows) {
    var list = Array.isArray(rows) ? rows : [];
    var columns = 1;
    for (var row = 0; row < list.length; row++) {
      if (Array.isArray(list[row])) columns = Math.max(columns, list[row].length);
    }
    return { rows: Math.max(1, list.length), columns: columns };
  }

  function normalizeRows(rows, minimumRows, minimumColumns) {
    var source = Array.isArray(rows) ? rows : [];
    var size = tableSize(source);
    var rowCount = Math.max(1, Number(minimumRows) || 0, size.rows);
    var columnCount = Math.max(1, Number(minimumColumns) || 0, size.columns);
    var output = [];
    for (var row = 0; row < rowCount; row++) {
      var input = Array.isArray(source[row]) ? source[row] : [];
      var values = [];
      for (var column = 0; column < columnCount; column++) values.push(textValue(input[column]));
      output.push(values);
    }
    return output;
  }

  function compactRows(rows, minimumRows, minimumColumns) {
    var minRows = Math.max(1, Number(minimumRows) || 1);
    var minColumns = Math.max(1, Number(minimumColumns) || 1);
    var output = normalizeRows(rows, minRows, minColumns);
    while (output.length > minRows && output[output.length - 1].every(function (value) { return value === ''; })) {
      output.pop();
    }
    var lastUsedColumn = -1;
    for (var row = 0; row < output.length; row++) {
      for (var column = output[row].length - 1; column >= 0; column--) {
        if (output[row][column] !== '') {
          lastUsedColumn = Math.max(lastUsedColumn, column);
          break;
        }
      }
    }
    var columnCount = Math.max(minColumns, lastUsedColumn + 1, 1);
    return output.map(function (row) {
      var values = row.slice(0, columnCount);
      while (values.length < columnCount) values.push('');
      return values;
    });
  }

  function applyChanges(rows, changes, minimumRows, minimumColumns) {
    var output = normalizeRows(rows, minimumRows, minimumColumns);
    var list = Array.isArray(changes) ? changes : [];
    for (var index = 0; index < list.length; index++) {
      var change = list[index] || {};
      var row = Number(change.row);
      var column = Number(change.column);
      if (!Number.isInteger(row) || row < 0 || !Number.isInteger(column) || column < 0) continue;
      while (output.length <= row) output.push(new Array(output[0].length).fill(''));
      while (output[row].length <= column) output[row].push('');
      for (var other = 0; other < output.length; other++) {
        while (output[other].length <= column) output[other].push('');
      }
      output[row][column] = textValue(change.value);
    }
    return compactRows(output, minimumRows, minimumColumns);
  }

  function parseSeparated(text, delimiter) {
    var source = textValue(text);
    if (source === '') return [['']];
    var rows = [];
    var row = [];
    var cell = '';
    var quoted = false;
    for (var index = 0; index < source.length; index++) {
      var character = source[index];
      if (quoted) {
        if (character === '"') {
          if (source[index + 1] === '"') {
            cell += '"';
            index++;
          } else {
            quoted = false;
          }
        } else {
          cell += character;
        }
      } else if (character === '"' && cell.length === 0) {
        quoted = true;
      } else if (character === delimiter) {
        row.push(cell);
        cell = '';
      } else if (character === '\r' || character === '\n') {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
        if (character === '\r' && source[index + 1] === '\n') index++;
      } else {
        cell += character;
      }
    }
    if (cell !== '' || row.length || !rows.length) {
      row.push(cell);
      rows.push(row);
    }
    return rows;
  }

  function parseClipboardText(text) {
    return parseSeparated(text, '\t');
  }

  function quoteClipboardCell(value) {
    var text = textValue(value);
    return /[\t"\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  function formatClipboardText(rows) {
    return (Array.isArray(rows) ? rows : []).map(function (row) {
      return (Array.isArray(row) ? row : []).map(quoteClipboardCell).join('\t');
    }).join('\r\n');
  }

  function escapeHtml(value) {
    return textValue(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function columnName(index) {
    var value = Math.max(0, Number(index) || 0);
    var result = '';
    do {
      result = String.fromCharCode(65 + (value % 26)) + result;
      value = Math.floor(value / 26) - 1;
    } while (value >= 0);
    return result;
  }

  function columnIndex(name) {
    var source = textValue(name).trim().toUpperCase();
    if (!/^[A-Z]+$/.test(source)) return -1;
    var result = 0;
    for (var index = 0; index < source.length; index++) result = result * 26 + source.charCodeAt(index) - 64;
    return result - 1;
  }

  function numericStyle(value) {
    var text = textValue(value).trim();
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return null;
    var unsigned = text.replace(/^[+-]/, '');
    var parts = unsigned.split('.');
    return {
      number: Number(text),
      decimals: parts.length > 1 ? parts[1].length : 0,
      integerWidth: parts[0].length,
      padded: parts[0].length > 1 && parts[0][0] === '0',
    };
  }

  function formatNumber(value, style) {
    var negative = value < 0;
    var absolute = Math.abs(value);
    var rendered = style.decimals > 0 ? absolute.toFixed(style.decimals) : String(Math.round(absolute));
    if (style.padded) {
      var parts = rendered.split('.');
      parts[0] = parts[0].padStart(style.integerWidth, '0');
      rendered = parts.join('.');
    }
    return (negative ? '-' : '') + rendered;
  }

  function suffixStyle(value) {
    var match = textValue(value).match(/^(.*?)(\d+)(\D*)$/);
    if (!match) return null;
    return { prefix: match[1], number: Number(match[2]), suffix: match[3], width: match[2].length };
  }

  function seriesValue(values, distance, forward) {
    var source = values.map(textValue);
    if (!source.length) return '';
    var numeric = source.map(numericStyle);
    if (numeric.every(Boolean)) {
      var first = numeric[0];
      var last = numeric[numeric.length - 1];
      var step = numeric.length > 1 ? last.number - numeric[numeric.length - 2].number : 1;
      var result = forward ? last.number + step * distance : first.number - step * distance;
      return formatNumber(result, forward ? last : first);
    }
    var suffixes = source.map(suffixStyle);
    if (suffixes.every(Boolean)) {
      var firstSuffix = suffixes[0];
      var lastSuffix = suffixes[suffixes.length - 1];
      var compatible = suffixes.every(function (item) {
        return item.prefix === firstSuffix.prefix && item.suffix === firstSuffix.suffix;
      });
      if (compatible) {
        var suffixStep = suffixes.length > 1 ? lastSuffix.number - suffixes[suffixes.length - 2].number : 1;
        var suffixNumber = forward
          ? lastSuffix.number + suffixStep * distance
          : firstSuffix.number - suffixStep * distance;
        var template = forward ? lastSuffix : firstSuffix;
        return template.prefix + String(Math.max(0, suffixNumber)).padStart(template.width, '0') + template.suffix;
      }
    }
    var repeatIndex = forward
      ? (distance - 1) % source.length
      : (source.length - (distance % source.length)) % source.length;
    return source[repeatIndex];
  }

  function normalizeBounds(bounds) {
    return {
      top: Math.min(bounds.top, bounds.bottom),
      bottom: Math.max(bounds.top, bounds.bottom),
      left: Math.min(bounds.left, bounds.right),
      right: Math.max(bounds.left, bounds.right),
    };
  }

  function calculateFillChanges(rows, sourceBounds, pointerRow, pointerColumn) {
    var source = normalizeBounds(sourceBounds);
    var rowDistance = pointerRow < source.top
      ? source.top - pointerRow
      : Math.max(0, pointerRow - source.bottom);
    var columnDistance = pointerColumn < source.left
      ? source.left - pointerColumn
      : Math.max(0, pointerColumn - source.right);
    var vertical = rowDistance >= columnDistance;
    var bounds = vertical
      ? { top: Math.min(source.top, pointerRow), bottom: Math.max(source.bottom, pointerRow), left: source.left, right: source.right }
      : { top: source.top, bottom: source.bottom, left: Math.min(source.left, pointerColumn), right: Math.max(source.right, pointerColumn) };
    var changes = [];

    if (vertical) {
      for (var column = source.left; column <= source.right; column++) {
        var values = [];
        for (var sourceRow = source.top; sourceRow <= source.bottom; sourceRow++) {
          values.push(rows[sourceRow] ? rows[sourceRow][column] : '');
        }
        for (var row = bounds.top; row <= bounds.bottom; row++) {
          if (row >= source.top && row <= source.bottom) continue;
          var forward = row > source.bottom;
          var distance = forward ? row - source.bottom : source.top - row;
          changes.push({ row: row, column: column, value: seriesValue(values, distance, forward) });
        }
      }
    } else {
      for (var sourceLine = source.top; sourceLine <= source.bottom; sourceLine++) {
        var lineValues = [];
        for (var sourceColumn = source.left; sourceColumn <= source.right; sourceColumn++) {
          lineValues.push(rows[sourceLine] ? rows[sourceLine][sourceColumn] : '');
        }
        for (var targetColumn = bounds.left; targetColumn <= bounds.right; targetColumn++) {
          if (targetColumn >= source.left && targetColumn <= source.right) continue;
          var moveForward = targetColumn > source.right;
          var moveDistance = moveForward ? targetColumn - source.right : source.left - targetColumn;
          changes.push({
            row: sourceLine,
            column: targetColumn,
            value: seriesValue(lineValues, moveDistance, moveForward),
          });
        }
      }
    }
    return { direction: vertical ? 'vertical' : 'horizontal', bounds: bounds, changes: changes };
  }

  function calculateSelectionFillChanges(rows, selectionBounds) {
    var bounds = normalizeBounds(selectionBounds);
    bounds.top = Math.max(0, bounds.top);
    bounds.bottom = Math.max(bounds.top, bounds.bottom);
    bounds.left = Math.max(0, bounds.left);
    bounds.right = Math.max(bounds.left, bounds.right);
    if (bounds.top === bounds.bottom && bounds.left === bounds.right) return [];

    var changes = [];
    if (bounds.top === bounds.bottom) {
      var horizontalValue = textValue(rows[bounds.top] && rows[bounds.top][bounds.left]);
      for (var column = bounds.left + 1; column <= bounds.right; column++) {
        changes.push({ row: bounds.top, column: column, value: horizontalValue });
      }
      return changes;
    }

    for (var row = bounds.top + 1; row <= bounds.bottom; row++) {
      for (var sourceColumn = bounds.left; sourceColumn <= bounds.right; sourceColumn++) {
        var verticalValue = textValue(rows[bounds.top] && rows[bounds.top][sourceColumn]);
        changes.push({ row: row, column: sourceColumn, value: verticalValue });
      }
    }
    return changes;
  }

  function calculateIncrementChanges(rows, selectionBounds, step) {
    var bounds = normalizeBounds(selectionBounds);
    var amount = Number(step);
    if (!Number.isFinite(amount)) return { changes: [], skipped: 0 };
    var stepStyle = numericStyle(step) || { decimals: 0 };
    var changes = [];
    var skipped = 0;
    var ordinal = 0;

    for (var row = Math.max(0, bounds.top); row <= bounds.bottom; row++) {
      for (var column = Math.max(0, bounds.left); column <= bounds.right; column++) {
        var value = rows[row] && rows[row][column];
        var style = numericStyle(value);
        if (!style) {
          skipped++;
          continue;
        }
        ordinal++;
        changes.push({
          row: row,
          column: column,
          value: formatNumber(style.number + amount * ordinal, {
            decimals: Math.max(style.decimals, stepStyle.decimals || 0),
            integerWidth: style.integerWidth,
            padded: style.padded,
          }),
        });
      }
    }
    return { changes: changes, skipped: skipped };
  }

  return {
    applyChanges: applyChanges,
    calculateFillChanges: calculateFillChanges,
    calculateIncrementChanges: calculateIncrementChanges,
    calculateSelectionFillChanges: calculateSelectionFillChanges,
    columnIndex: columnIndex,
    columnName: columnName,
    compactRows: compactRows,
    escapeHtml: escapeHtml,
    formatClipboardText: formatClipboardText,
    normalizeRows: normalizeRows,
    parseClipboardText: parseClipboardText,
    seriesValue: seriesValue,
    tableSize: tableSize,
  };
}));

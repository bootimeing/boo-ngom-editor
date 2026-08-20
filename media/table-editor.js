(function () {
  'use strict';

  var vscode = acquireVsCodeApi();
  var core = window.BooTableCore;
  var TabulatorConstructor = window.Tabulator;
  var gridElement = document.getElementById('grid');
  var gridShell = document.getElementById('gridShell');
  var loadingElement = document.getElementById('loading');
  var fillHandle = document.getElementById('fillHandle');
  var cellAddress = document.getElementById('cellAddress');
  var cellValue = document.getElementById('cellValue');
  var dimensions = document.getElementById('dimensions');
  var selectionInfo = document.getElementById('selectionInfo');
  var statusElement = document.getElementById('status');
  var fileLabel = document.getElementById('fileLabel');
  var exitButton = document.getElementById('exitButton');

  var table = null;
  var rows = [['']];
  var minimumRows = 1;
  var minimumColumns = 1;
  var capacityRows = 100;
  var capacityColumns = 26;
  var editorMode = 'csv';
  var sheetName = '';
  var pendingChanges = new Map();
  var pendingLabel = '编辑表格';
  var saveTimer = null;
  var statusTimer = null;
  var revision = 0;
  var suppressCellEvents = false;
  var formulaDirty = false;
  var formulaTarget = null;
  var fillState = null;

  if (!core || !TabulatorConstructor) {
    loadingElement.textContent = '表格运行资源加载失败';
    loadingElement.classList.remove('hidden');
    vscode.postMessage({ type: 'error', message: 'Tabulator 表格运行资源加载失败' });
    return;
  }

  function showStatus(message, tone, keep) {
    clearTimeout(statusTimer);
    statusElement.textContent = message || '';
    statusElement.dataset.tone = tone || '';
    if (message && !keep) {
      statusTimer = setTimeout(function () {
        statusElement.textContent = '';
        statusElement.dataset.tone = '';
      }, 2600);
    }
  }

  function setLoading(visible, message) {
    loadingElement.textContent = message || '正在创建表格...';
    loadingElement.classList.toggle('hidden', !visible);
  }

  function rowColumnSize() {
    return core.tableSize(rows);
  }

  function updateDimensions() {
    var size = rowColumnSize();
    dimensions.textContent = size.rows + ' 行 × ' + size.columns + ' 列';
    gridElement.dataset.dataRows = String(size.rows);
    gridElement.dataset.dataColumns = String(size.columns);
  }

  function cellCoordinates(cell) {
    if (!cell) return null;
    var rowPosition = Number(cell.getRow().getPosition());
    var columnPosition = core.columnIndex(cell.getColumn().getField());
    if (!Number.isFinite(rowPosition) || rowPosition < 1 || columnPosition < 0) return null;
    return { row: rowPosition - 1, column: columnPosition };
  }

  function activeRange() {
    if (!table || typeof table.getRanges !== 'function') return null;
    var ranges = table.getRanges();
    return ranges.length ? ranges[ranges.length - 1] : null;
  }

  function rangeBounds(range) {
    if (!range) return null;
    var top = Number(range.getTopEdge());
    var bottom = Number(range.getBottomEdge());
    // Tabulator range edges include the frozen row-number column.
    var left = Number(range.getLeftEdge()) - 1;
    var right = Number(range.getRightEdge()) - 1;
    if (![top, bottom, left, right].every(Number.isFinite)) return null;
    return {
      top: Math.min(top, bottom),
      bottom: Math.max(top, bottom),
      left: Math.min(left, right),
      right: Math.max(left, right),
    };
  }

  function selectedBounds() {
    return rangeBounds(activeRange()) || { top: 0, bottom: 0, left: 0, right: 0 };
  }

  function dataBounds(bounds) {
    var size = rowColumnSize();
    var top = Math.max(0, bounds.top);
    var left = Math.max(0, bounds.left);
    return {
      top: top,
      bottom: Math.max(top, Math.min(bounds.bottom, Math.max(top, size.rows - 1))),
      left: left,
      right: Math.max(left, Math.min(bounds.right, Math.max(left, size.columns - 1))),
    };
  }

  function addressForBounds(bounds) {
    var start = core.columnName(bounds.left) + String(bounds.top + 1);
    var end = core.columnName(bounds.right) + String(bounds.bottom + 1);
    return start === end ? start : start + ':' + end;
  }

  function sourceValue(row, column) {
    return rows[row] && rows[row][column] !== undefined ? String(rows[row][column]) : '';
  }

  function updateSelectionUi() {
    var bounds = selectedBounds();
    var address = addressForBounds(bounds);
    cellAddress.value = address;
    selectionInfo.textContent = address;
    if (!formulaDirty) {
      cellValue.value = sourceValue(bounds.top, bounds.left);
      formulaTarget = { row: bounds.top, column: bounds.left };
    }
    updateFillHandle();
  }

  function getCell(row, column) {
    if (!table || row < 0 || column < 0) return null;
    var rowComponent = table.getRow(row + 1);
    if (!rowComponent) return null;
    return rowComponent.getCell(core.columnName(column)) || null;
  }

  function clearRanges() {
    if (!table) return;
    table.getRanges().forEach(function (range) { range.remove(); });
  }

  function selectBounds(bounds, scroll) {
    if (!table) return;
    var start = getCell(bounds.top, bounds.left);
    var end = getCell(bounds.bottom, bounds.right);
    if (!start || !end) return;
    clearRanges();
    table.addRange(start, end);
    if (scroll) {
      void start.getRow().scrollTo('center', true);
      void start.getColumn().scrollTo('left', true);
    }
    setTimeout(updateSelectionUi, 0);
  }

  function updateFillHandle() {
    if (!table || fillState || document.querySelector('.tabulator-editing')) {
      fillHandle.style.display = 'none';
      return;
    }
    var range = activeRange();
    var bounds = range ? range.getBounds() : null;
    var endCell = bounds && bounds.end;
    if (!endCell) {
      fillHandle.style.display = 'none';
      return;
    }
    var cellRect = endCell.getElement().getBoundingClientRect();
    var shellRect = gridShell.getBoundingClientRect();
    if (!cellRect.width || !cellRect.height || cellRect.bottom < shellRect.top || cellRect.top > shellRect.bottom) {
      fillHandle.style.display = 'none';
      return;
    }
    fillHandle.style.left = Math.min(shellRect.width - 9, cellRect.right - shellRect.left - 5) + 'px';
    fillHandle.style.top = Math.min(shellRect.height - 9, cellRect.bottom - shellRect.top - 5) + 'px';
    fillHandle.style.display = 'block';
  }

  function compactCurrentRows() {
    rows = core.compactRows(rows, minimumRows, minimumColumns);
    updateDimensions();
  }

  function scheduleSave(label) {
    pendingLabel = label || pendingLabel;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushChanges, 70);
    showStatus('正在同步修改...', '', true);
  }

  function flushChanges() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!pendingChanges.size) return;
    compactCurrentRows();
    var size = rowColumnSize();
    var changes = Array.from(pendingChanges.values());
    pendingChanges.clear();
    revision++;
    vscode.postMessage({
      type: 'applyEdit',
      operation: 'patch',
      changes: changes,
      rowCount: size.rows,
      columnCount: size.columns,
      label: pendingLabel,
      revision: revision,
    });
  }

  function sendReplacement(label) {
    clearTimeout(saveTimer);
    saveTimer = null;
    pendingChanges.clear();
    compactCurrentRows();
    revision++;
    vscode.postMessage({
      type: 'applyEdit',
      operation: 'replace',
      rows: rows,
      label: label || '调整表格结构',
      revision: revision,
    });
    showStatus('正在同步修改...', '', true);
  }

  function queuePatch(change, label) {
    pendingChanges.set(change.row + ':' + change.column, {
      row: change.row,
      column: change.column,
      value: String(change.value === undefined || change.value === null ? '' : change.value),
    });
    scheduleSave(label);
  }

  function rebuildSheet(focusBounds) {
    if (!table) return;
    buildTable(rows, focusBounds || { top: 0, bottom: 0, left: 0, right: 0 });
  }

  function applyBatchChanges(changes, label, finalBounds) {
    var effective = [];
    for (var index = 0; index < changes.length; index++) {
      var change = changes[index];
      var value = String(change.value === undefined || change.value === null ? '' : change.value);
      if (sourceValue(change.row, change.column) === value) continue;
      effective.push({ row: change.row, column: change.column, value: value });
    }
    if (!effective.length) return;

    var nextRows = core.applyChanges(rows, effective, minimumRows, minimumColumns);
    var nextSize = core.tableSize(nextRows);
    var requiresRebuild = nextSize.rows > capacityRows || nextSize.columns > capacityColumns;
    rows = nextRows;
    effective.forEach(function (change) {
      pendingChanges.set(change.row + ':' + change.column, change);
    });
    scheduleSave(label);

    if (requiresRebuild) {
      rebuildSheet(finalBounds || selectedBounds());
      return;
    }

    suppressCellEvents = true;
    if (typeof table.blockRedraw === 'function') table.blockRedraw();
    effective.forEach(function (change) {
      var cell = getCell(change.row, change.column);
      if (cell) cell.setValue(change.value);
    });
    if (typeof table.restoreRedraw === 'function') table.restoreRedraw();
    suppressCellEvents = false;
    updateDimensions();
    if (finalBounds) setTimeout(function () { selectBounds(finalBounds, false); }, 0);
  }

  function recordEditedCell(cell) {
    if (suppressCellEvents) return;
    var position = cellCoordinates(cell);
    if (!position) return;
    var value = String(cell.getValue() === undefined || cell.getValue() === null ? '' : cell.getValue());
    if (sourceValue(position.row, position.column) === value) return;
    rows = core.applyChanges(rows, [{ row: position.row, column: position.column, value: value }], minimumRows, minimumColumns);
    queuePatch({ row: position.row, column: position.column, value: value }, '编辑单元格');
    updateDimensions();
    formulaDirty = false;
    updateSelectionUi();
    if (position.row >= capacityRows - 2 || position.column >= capacityColumns - 2) {
      rebuildSheet({ top: position.row, bottom: position.row, left: position.column, right: position.column });
    }
  }

  function selectionMatrix(bounds) {
    var limited = dataBounds(bounds || selectedBounds());
    var output = [];
    for (var row = limited.top; row <= limited.bottom; row++) {
      var values = [];
      for (var column = limited.left; column <= limited.right; column++) {
        values.push(sourceValue(row, column));
      }
      output.push(values);
    }
    return output.length ? output : [['']];
  }

  function clipboardHtml(matrix) {
    return '<table>' + matrix.map(function (row) {
      return '<tr>' + row.map(function (value) {
        return '<td>' + core.escapeHtml(value) + '</td>';
      }).join('') + '</tr>';
    }).join('') + '</table>';
  }

  function isCellEditor(target) {
    if (!target || !target.closest) return false;
    return Boolean(target.closest('input,textarea,[contenteditable="true"]'));
  }

  function shouldHandleGridClipboard(target) {
    if (!table || isCellEditor(target)) return false;
    return gridElement.contains(target) || gridElement.contains(document.activeElement);
  }

  function writeSelectionToEvent(event) {
    if (!event.clipboardData) return false;
    var matrix = selectionMatrix();
    event.clipboardData.setData('text/plain', core.formatClipboardText(matrix));
    event.clipboardData.setData('text/html', clipboardHtml(matrix));
    event.preventDefault();
    event.stopImmediatePropagation();
    showStatus('已复制所选单元格', 'success');
    return true;
  }

  function copySelectionToClipboard() {
    var text = core.formatClipboardText(selectionMatrix());
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        showStatus('已复制所选单元格', 'success');
      }).catch(function () {
        showStatus('复制失败，请使用键盘复制', 'error');
      });
      return;
    }
    showStatus('请使用键盘复制', 'error');
  }

  function clearSelection() {
    var bounds = dataBounds(selectedBounds());
    var changes = [];
    for (var row = bounds.top; row <= bounds.bottom; row++) {
      for (var column = bounds.left; column <= bounds.right; column++) {
        if (sourceValue(row, column) !== '') changes.push({ row: row, column: column, value: '' });
      }
    }
    applyBatchChanges(changes, '清空单元格', bounds);
  }

  function fillSelectedRange() {
    var bounds = selectedBounds();
    var changes = core.calculateSelectionFillChanges(rows, bounds);
    if (!changes.length) {
      showStatus('请至少选择两个单元格', 'error');
      return;
    }
    applyBatchChanges(changes, 'Ctrl+D 填充选区', bounds);
  }

  function pasteMatrix(matrix) {
    if (!Array.isArray(matrix) || !matrix.length) return;
    var bounds = selectedBounds();
    var single = bounds.top === bounds.bottom && bounds.left === bounds.right;
    var sourceRows = matrix.length;
    var sourceColumns = matrix.reduce(function (maximum, row) {
      return Math.max(maximum, Array.isArray(row) ? row.length : 0);
    }, 1);
    var targetRows = single ? sourceRows : bounds.bottom - bounds.top + 1;
    var targetColumns = single ? sourceColumns : bounds.right - bounds.left + 1;
    var changes = [];
    for (var row = 0; row < targetRows; row++) {
      var sourceRow = Array.isArray(matrix[row % sourceRows]) ? matrix[row % sourceRows] : [];
      for (var column = 0; column < targetColumns; column++) {
        changes.push({
          row: bounds.top + row,
          column: bounds.left + column,
          value: sourceRow[column % Math.max(1, sourceRow.length)] || '',
        });
      }
    }
    var finalBounds = {
      top: bounds.top,
      bottom: bounds.top + targetRows - 1,
      left: bounds.left,
      right: bounds.left + targetColumns - 1,
    };
    applyBatchChanges(changes, '粘贴单元格', finalBounds);
  }

  function pasteFromClipboard() {
    if (!navigator.clipboard || !navigator.clipboard.readText) {
      showStatus('请使用键盘粘贴', 'error');
      return;
    }
    navigator.clipboard.readText().then(function (text) {
      pasteMatrix(core.parseClipboardText(text));
    }).catch(function () {
      showStatus('无法读取剪贴板，请使用键盘粘贴', 'error');
    });
  }

  function insertRows(at, count) {
    var size = rowColumnSize();
    var index = Math.max(0, Math.min(at, rows.length));
    var amount = Math.max(1, count || 1);
    var next = rows.map(function (row) { return row.slice(); });
    for (var offset = 0; offset < amount; offset++) next.splice(index, 0, new Array(size.columns).fill(''));
    rows = core.normalizeRows(next);
    minimumRows = rows.length;
    minimumColumns = core.tableSize(rows).columns;
    var focus = { top: index, bottom: index, left: 0, right: 0 };
    rebuildSheet(focus);
    sendReplacement('插入行');
  }

  function deleteSelectedRows() {
    var bounds = dataBounds(selectedBounds());
    var count = bounds.bottom - bounds.top + 1;
    var next = rows.map(function (row) { return row.slice(); });
    if (count >= next.length) next = [new Array(rowColumnSize().columns).fill('')];
    else next.splice(bounds.top, count);
    rows = core.normalizeRows(next);
    minimumRows = rows.length;
    minimumColumns = core.tableSize(rows).columns;
    var target = Math.min(bounds.top, rows.length - 1);
    rebuildSheet({ top: target, bottom: target, left: bounds.left, right: bounds.left });
    sendReplacement('删除行');
  }

  function insertColumns(at, count) {
    var size = rowColumnSize();
    var index = Math.max(0, Math.min(at, size.columns));
    var amount = Math.max(1, count || 1);
    var next = rows.map(function (row) {
      var values = row.slice();
      for (var offset = 0; offset < amount; offset++) values.splice(index, 0, '');
      return values;
    });
    rows = core.normalizeRows(next);
    minimumRows = rows.length;
    minimumColumns = core.tableSize(rows).columns;
    rebuildSheet({ top: 0, bottom: 0, left: index, right: index });
    sendReplacement('插入列');
  }

  function deleteSelectedColumns() {
    var bounds = dataBounds(selectedBounds());
    var size = rowColumnSize();
    var count = bounds.right - bounds.left + 1;
    var next;
    if (count >= size.columns) {
      next = rows.map(function () { return ['']; });
    } else {
      next = rows.map(function (row) {
        var values = row.slice();
        values.splice(bounds.left, count);
        return values;
      });
    }
    rows = core.normalizeRows(next);
    minimumRows = rows.length;
    minimumColumns = core.tableSize(rows).columns;
    var target = Math.min(bounds.left, minimumColumns - 1);
    rebuildSheet({ top: bounds.top, bottom: bounds.top, left: target, right: target });
    sendReplacement('删除列');
  }

  function ensureCellSelected(cell) {
    var position = cellCoordinates(cell);
    if (!position) return;
    var bounds = selectedBounds();
    if (position.row < bounds.top || position.row > bounds.bottom || position.column < bounds.left || position.column > bounds.right) {
      selectBounds({
        top: position.row,
        bottom: position.row,
        left: position.column,
        right: position.column,
      }, false);
    }
  }

  function cellContextMenu(_event, cell) {
    ensureCellSelected(cell);
    return [
      { label: '复制', action: copySelectionToClipboard },
      { label: '剪切', action: function () { copySelectionToClipboard(); clearSelection(); } },
      { label: '粘贴', action: pasteFromClipboard },
      { separator: true },
      { label: '在上方插入行', action: function () { insertRows(selectedBounds().top, 1); } },
      { label: '在下方插入行', action: function () { insertRows(selectedBounds().bottom + 1, 1); } },
      { label: '删除所选行', action: deleteSelectedRows },
      { separator: true },
      { label: '在左侧插入列', action: function () { insertColumns(selectedBounds().left, 1); } },
      { label: '在右侧插入列', action: function () { insertColumns(selectedBounds().right + 1, 1); } },
      { label: '删除所选列', action: deleteSelectedColumns },
    ];
  }

  function columnContextMenu(_event, column) {
    var index = core.columnIndex(column.getField());
    return [
      { label: '在左侧插入列', action: function () { insertColumns(index, 1); } },
      { label: '在右侧插入列', action: function () { insertColumns(index + 1, 1); } },
      { label: '删除此列', action: function () {
        selectBounds({ top: 0, bottom: Math.max(0, rows.length - 1), left: index, right: index }, false);
        deleteSelectedColumns();
      } },
    ];
  }

  function beginFill(event) {
    var source = selectedBounds();
    fillState = {
      source: source,
      pointerRow: source.bottom,
      pointerColumn: source.right,
    };
    fillHandle.style.display = 'none';
    event.preventDefault();
    event.stopPropagation();
  }

  function updateFillTarget(cell) {
    if (!fillState) return;
    var position = cellCoordinates(cell);
    if (!position) return;
    fillState.pointerRow = position.row;
    fillState.pointerColumn = position.column;
    var preview = core.calculateFillChanges(
      rows,
      fillState.source,
      fillState.pointerRow,
      fillState.pointerColumn
    );
    var range = activeRange();
    var start = getCell(preview.bounds.top, preview.bounds.left);
    var end = getCell(preview.bounds.bottom, preview.bounds.right);
    if (range && start && end) range.setBounds(start, end);
  }

  function finishFill() {
    if (!fillState) return;
    var completed = core.calculateFillChanges(
      rows,
      fillState.source,
      fillState.pointerRow,
      fillState.pointerColumn
    );
    fillState = null;
    applyBatchChanges(completed.changes, '填充单元格', completed.bounds);
    setTimeout(updateFillHandle, 0);
  }

  function startCellEdit(initialValue) {
    var range = activeRange();
    var bounds = range ? range.getBounds() : null;
    var cell = bounds && bounds.start;
    if (cell && typeof cell.getComponent === 'function') cell = cell.getComponent();
    if (!cell || typeof cell.edit !== 'function') return;
    cell.edit(true);
    if (initialValue !== undefined) {
      setTimeout(function () {
        var input = cell.getElement().querySelector('input,textarea');
        if (!input) return;
        input.value = initialValue;
        input.setSelectionRange(input.value.length, input.value.length);
      }, 0);
    }
  }

  function commitFormulaValue(restoreSelection) {
    if (!formulaDirty || !formulaTarget) return;
    formulaDirty = false;
    var targetBounds = {
      top: formulaTarget.row,
      bottom: formulaTarget.row,
      left: formulaTarget.column,
      right: formulaTarget.column,
    };
    applyBatchChanges([{
      row: formulaTarget.row,
      column: formulaTarget.column,
      value: cellValue.value,
    }], '编辑单元格', restoreSelection ? targetBounds : null);
  }

  function requestHistory(type) {
    commitFormulaValue(false);
    flushChanges();
    vscode.postMessage({ type: type });
  }

  function saveDocument() {
    commitFormulaValue(false);
    flushChanges();
    vscode.postMessage({ type: 'saveDocument' });
  }

  function buildTable(inputRows, initialBounds) {
    if (table) {
      table.destroy();
      table = null;
    }
    rows = core.normalizeRows(inputRows);
    var size = core.tableSize(rows);
    minimumRows = size.rows;
    minimumColumns = size.columns;
    capacityRows = Math.max(100, size.rows + 50);
    capacityColumns = Math.max(26, size.columns + 10);
    pendingChanges.clear();
    clearTimeout(saveTimer);
    saveTimer = null;
    formulaDirty = false;
    formulaTarget = { row: 0, column: 0 };
    gridElement.dataset.ready = 'false';
    setLoading(true, '正在创建表格...');
    updateDimensions();

    table = new TabulatorConstructor(gridElement, {
      height: '100%',
      layout: 'fitDataTable',
      renderVertical: 'virtual',
      renderHorizontal: 'virtual',
      rowHeight: 25,
      spreadsheet: true,
      spreadsheetRows: capacityRows,
      spreadsheetColumns: capacityColumns,
      spreadsheetData: rows,
      spreadsheetColumnDefinition: {
        width: 110,
        minWidth: 60,
        editor: 'input',
        formatter: 'plaintext',
        headerSort: false,
        contextMenu: cellContextMenu,
        headerContextMenu: columnContextMenu,
      },
      rowHeader: {
        formatter: 'rownum',
        headerSort: false,
        frozen: true,
        width: 48,
        minWidth: 48,
        maxWidth: 48,
        hozAlign: 'center',
        resizable: false,
      },
      selectableRows: false,
      selectableRange: 1,
      selectableRangeRows: true,
      selectableRangeColumns: true,
      selectableRangeClearCells: false,
      selectableRangeBlurEditOnNavigate: false,
      editTriggerEvent: 'dblclick',
      keybindings: {
        copyToClipboard: false,
        undo: false,
        redo: false,
      },
      clipboard: false,
      history: false,
    });

    table.on('tableBuilt', function () {
      gridElement.dataset.ready = 'true';
      gridElement.dataset.virtualized = 'true';
      setLoading(false);
      selectBounds(initialBounds || { top: 0, bottom: 0, left: 0, right: 0 }, Boolean(initialBounds));
      showStatus('表格已就绪', 'success');
    });
    table.on('cellEdited', recordEditedCell);
    table.on('cellClick', function () { setTimeout(updateSelectionUi, 0); });
    table.on('rangeAdded', updateSelectionUi);
    table.on('rangeChanged', updateSelectionUi);
    table.on('rangeRemoved', updateFillHandle);
    table.on('cellEditing', function () { fillHandle.style.display = 'none'; });
    table.on('cellEditCancelled', updateSelectionUi);
    table.on('cellMouseOver', function (_event, cell) { updateFillTarget(cell); });
    table.on('renderComplete', updateFillHandle);
    table.on('scrollVertical', updateFillHandle);
    table.on('scrollHorizontal', updateFillHandle);
  }

  document.addEventListener('copy', function (event) {
    if (shouldHandleGridClipboard(event.target)) writeSelectionToEvent(event);
  }, true);

  document.addEventListener('cut', function (event) {
    if (!shouldHandleGridClipboard(event.target)) return;
    if (writeSelectionToEvent(event)) clearSelection();
  }, true);

  document.addEventListener('paste', function (event) {
    if (!shouldHandleGridClipboard(event.target) || !event.clipboardData) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    pasteMatrix(core.parseClipboardText(event.clipboardData.getData('text/plain')));
  }, true);

  document.addEventListener('keydown', function (event) {
    if (!table || isCellEditor(event.target)) return;
    var gridFocused = gridElement.contains(event.target) || gridElement.contains(document.activeElement);
    if (!gridFocused) return;
    var command = event.ctrlKey || event.metaKey;
    var key = event.key.toLowerCase();
    if (command && key === 'd' && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      event.stopImmediatePropagation();
      fillSelectedRange();
    } else if (command && key === 'z') {
      event.preventDefault();
      event.stopImmediatePropagation();
      requestHistory(event.shiftKey ? 'redo' : 'undo');
    } else if (command && key === 'y') {
      event.preventDefault();
      event.stopImmediatePropagation();
      requestHistory('redo');
    } else if (command && key === 's') {
      event.preventDefault();
      event.stopImmediatePropagation();
      saveDocument();
    } else if (command && key === 'a') {
      event.preventDefault();
      event.stopImmediatePropagation();
      var size = rowColumnSize();
      selectBounds({ top: 0, bottom: size.rows - 1, left: 0, right: size.columns - 1 }, false);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      event.stopImmediatePropagation();
      clearSelection();
    } else if (event.key === 'F2') {
      event.preventDefault();
      event.stopImmediatePropagation();
      startCellEdit();
    } else if (event.key.length === 1 && !command && !event.altKey) {
      event.preventDefault();
      event.stopImmediatePropagation();
      startCellEdit(event.key);
    }
  }, true);

  fillHandle.addEventListener('mousedown', beginFill);
  document.addEventListener('mouseup', finishFill);

  cellValue.addEventListener('input', function () { formulaDirty = true; });
  cellValue.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitFormulaValue(true);
      gridElement.focus();
    } else if (event.key === 'Escape') {
      formulaDirty = false;
      updateSelectionUi();
      gridElement.focus();
    }
  });
  cellValue.addEventListener('blur', function () { commitFormulaValue(false); });

  document.getElementById('undoButton').addEventListener('click', function () { requestHistory('undo'); });
  document.getElementById('redoButton').addEventListener('click', function () { requestHistory('redo'); });
  document.getElementById('insertRowButton').addEventListener('click', function () {
    var bounds = dataBounds(selectedBounds());
    insertRows(bounds.bottom + 1, bounds.bottom - bounds.top + 1);
  });
  document.getElementById('insertColumnButton').addEventListener('click', function () {
    var bounds = dataBounds(selectedBounds());
    insertColumns(bounds.right + 1, bounds.right - bounds.left + 1);
  });
  document.getElementById('deleteRowButton').addEventListener('click', deleteSelectedRows);
  document.getElementById('deleteColumnButton').addEventListener('click', deleteSelectedColumns);
  exitButton.addEventListener('click', function () {
    commitFormulaValue(false);
    flushChanges();
    vscode.postMessage({ type: 'exit' });
  });

  window.addEventListener('message', function (event) {
    var message = event.data || {};
    if (message.type === 'load') {
      editorMode = message.mode === 'xls' ? 'xls' : 'csv';
      sheetName = typeof message.sheetName === 'string' ? message.sheetName : '';
      var name = typeof message.fileName === 'string' ? message.fileName : '';
      fileLabel.textContent = sheetName ? name + ' · ' + sheetName : name;
      exitButton.textContent = editorMode === 'xls' ? '关闭表格' : '退出表格';
      exitButton.title = editorMode === 'xls' ? '关闭 XLS 表格' : '退出表格并用文本方式打开';
      buildTable(Array.isArray(message.rows) ? message.rows : [['']]);
    } else if (message.type === 'saved') {
      showStatus('修改已同步', 'success');
    } else if (message.type === 'error') {
      showStatus(message.message || '表格修改失败', 'error', true);
    }
  });

  window.addEventListener('pagehide', flushChanges);
  window.addEventListener('beforeunload', function () {
    if (table) table.destroy();
  });

  vscode.postMessage({ type: 'ready' });
}());

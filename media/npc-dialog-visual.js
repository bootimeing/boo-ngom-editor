(function () {
  'use strict';

  const vscode = acquireVsCodeApi();
  const elements = Object.fromEntries([
    'functionTitle', 'fileTitle', 'engineBadge', 'zoomOut', 'zoomIn', 'zoomReset', 'zoomValue',
    'canvasDiagnosticsToggle',
    'undoButton', 'redoButton', 'reloadButton', 'applyButton', 'saveButton', 'statusBanner',
    'offsetBar', 'offsetSource', 'offsetX', 'offsetY', 'saveOffsets', 'offsetHelp', 'sceneCount',
    'resetPreview', 'sceneList', 'advancedConditions', 'advancedConditionCount', 'advancedConditionList',
    'conditionText', 'variableList', 'changeList', 'sceneTitle', 'canvasSize', 'coordinateReadout',
    'actUiPreviewPanel', 'actUiPreviewCount', 'actUiPreviewList',
    'canvasViewport', 'canvasStage', 'dialogCanvas', 'selectionState', 'emptyInspector',
    'elementInspector', 'elementToken', 'elementDescription', 'elementX', 'elementY', 'sourceX',
    'sourceY', 'coordinateMode', 'elementText', 'elementLocalPreview', 'elementLocalPreviewValue',
    'elementLocalPreviewState', 'assetState', 'elementParameters', 'elementWarning', 'locateButton',
    'patchButton', 'rawStatement', 'sceneWarnings', 'unsupportedList', 'toast',
  ].map(id => [id, document.getElementById(id)]));

  let model = null;
  let currentPageId = '';
  let selectedElementId = '';
  let zoom = 1;
  let showCanvasDiagnostics = false;
  let conflict = false;
  let drafts = new Map();
  let history = [];
  let historyIndex = 0;
  let drag = null;
  let suppressedRuntimeActionClick = null;
  let toastTimer = 0;
  let previewConditions = new Map();
  let lastPreviewRevision = -1;
  let lastDirtyState = false;
  let animationTimers = [];
  let dialogTooltip = null;
  let expandedMenuIds = new Set();
  let menuSelections = new Map();
  let listScrollOffsets = new Map();
  let listScrollDrag = null;
  let toggleStates = new Map();
  let sliderStates = new Map();
  let inputStates = new Map();
  let localTextPreviewValues = new Map();
  let runtimeActionStates = new Map();
  let countdownStates = new Map();
  let animationStates = new Map();
  let renderGeneration = 0;
  const showPositionedSubtreeCache = new WeakMap();

  bindEvents();
  vscode.postMessage({ type: 'ready' });

  window.addEventListener('message', event => {
    const message = event.data || {};
    if (message.type === 'model') {
      loadModel(
        message.model,
        message.geeOffsetHelp || '',
        message.preserveDrafts === true,
        Number(message.previewRevision) || 0
      );
    }
    else if (message.type === 'conflict') showConflict(message.message || '源码已发生变化');
    else if (message.type === 'operationError') showToast(message.message || '操作失败', true);
    else if (message.type === 'operationComplete') showToast(message.message || '操作完成', false);
    else if (message.type === 'floatingFallback') showBanner(message.message || '', 'info');
  });

  function bindEvents() {
    elements.zoomOut.addEventListener('click', () => setZoom(zoom - .1));
    elements.zoomIn.addEventListener('click', () => setZoom(zoom + .1));
    elements.zoomReset.addEventListener('click', () => setZoom(1));
    elements.canvasDiagnosticsToggle.addEventListener('click', () => {
      showCanvasDiagnostics = !showCanvasDiagnostics;
      syncCanvasDiagnostics();
    });
    elements.undoButton.addEventListener('click', undo);
    elements.redoButton.addEventListener('click', redo);
    elements.reloadButton.addEventListener('click', () => vscode.postMessage({ type: 'reload' }));
    elements.resetPreview.addEventListener('click', resetPreviewState);
    elements.applyButton.addEventListener('click', () => submit('apply'));
    elements.saveButton.addEventListener('click', () => submit('save'));
    elements.saveOffsets.addEventListener('click', () => vscode.postMessage({
      type: 'saveGeeOffsets',
      x: Number(elements.offsetX.value),
      y: Number(elements.offsetY.value),
    }));
    elements.elementX.addEventListener('change', updateFromInspector);
    elements.elementY.addEventListener('change', updateFromInspector);
    elements.elementLocalPreviewValue.addEventListener('input', updateLocalTextPreviewFromInspector);
    elements.locateButton.addEventListener('click', () => {
      if (selectedElementId) vscode.postMessage({ type: 'locate', elementId: selectedElementId });
    });
    elements.patchButton.addEventListener('click', () => vscode.postMessage({ type: 'openPatchManager' }));
    elements.canvasViewport.addEventListener('mousemove', updateCoordinateReadout);
    elements.canvasViewport.addEventListener('mouseleave', () => {
      elements.coordinateReadout.textContent = '坐标 --, --';
      hideDialogTooltip();
    });
    elements.canvasViewport.addEventListener('keydown', onCanvasKeyDown);
    window.addEventListener('mousemove', onDragMove);
    window.addEventListener('mouseup', finishDrag);
  }

  function loadModel(nextModel, geeOffsetHelp, preserveDrafts, previewRevision) {
    if (previewRevision < lastPreviewRevision) return;
    lastPreviewRevision = previewRevision;
    const modelIdentityChanged = Boolean(model && (
      model.uri !== nextModel?.uri
      || model.engine !== nextModel?.engine
      || model.functionLabel !== nextModel?.functionLabel
    ));
    model = nextModel;
    if (modelIdentityChanged) currentPageId = '';
    conflict = false;
    const validElements = new Set((model.scenes || []).flatMap(scene => [
      ...(scene.elements || []).map(element => element.id),
      ...coordinateBindingElements(scene).map(element => element.id),
    ]));
    if (!preserveDrafts) {
      drafts = new Map();
      history = [];
      historyIndex = 0;
      selectedElementId = '';
      lastDirtyState = false;
      expandedMenuIds = new Set();
      menuSelections = new Map();
      listScrollOffsets = new Map();
      toggleStates = new Map();
      sliderStates = new Map();
      inputStates = new Map();
      localTextPreviewValues = new Map();
      runtimeActionStates = new Map();
      countdownStates = new Map();
      animationStates = new Map();
    } else {
      drafts = new Map([...drafts].filter(([id]) => validElements.has(id)));
      history = history.filter(entry => validElements.has(entry.id));
      historyIndex = Math.min(historyIndex, history.length);
      expandedMenuIds = new Set([...expandedMenuIds].filter(id => validElements.has(id)));
      menuSelections = filterRuntimeMap(menuSelections, validElements);
      listScrollOffsets = new Map(
        [...listScrollOffsets].filter(([id]) => validElements.has(id))
      );
      toggleStates = filterRuntimeMap(toggleStates, validElements);
      sliderStates = filterRuntimeMap(sliderStates, validElements);
      inputStates = filterRuntimeMap(inputStates, validElements);
      localTextPreviewValues = modelIdentityChanged
        ? new Map()
        : new Map([...localTextPreviewValues].filter(([id]) => {
          const element = findElementInModel(model, id);
          return elementSupportsLocalTextPreview(element);
        }));
      runtimeActionStates = filterRuntimeMap(runtimeActionStates, validElements);
      countdownStates = filterRuntimeMap(countdownStates, validElements);
      animationStates = filterRuntimeMap(animationStates, validElements);
      if (!validElements.has(selectedElementId)) selectedElementId = '';
    }
    previewConditions = new Map();
    for (const group of model.conditionGroups || []) {
      previewConditions.set(group.id, group.satisfied === true);
    }
    for (const scene of model.scenes || []) {
      for (const element of scene.elements || []) {
        if (element.containerPreview?.variant !== 'list' || listScrollOffsets.has(element.id)) continue;
        listScrollOffsets.set(element.id, Number(element.containerPreview.scrollOffset) || 0);
      }
    }
    for (const scene of model.scenes || []) {
      for (const element of scene.elements || []) initializeControlRuntime(element);
    }
    const availablePages = new Set((model.pages || []).map(page => page.id));
    if (!availablePages.has(currentPageId)) currentPageId = preferredPage()?.id || '';
    elements.functionTitle.textContent = model.functionLabel || 'NPC 界面';
    elements.fileTitle.textContent = model.fileName || '';
    elements.fileTitle.title = model.filePath || '';
    elements.engineBadge.textContent = model.engineLabel || model.engine || '--';
    lastDirtyState = collectChanges().length > 0;
    renderOffsets(geeOffsetHelp);
    renderAll();
    const warnings = model.warnings || [];
    if (warnings.length) showBanner(warnings.join('；'), 'info');
    else hideBanner();
  }

  function filterRuntimeMap(runtime, validElements) {
    return new Map([...runtime].filter(([id]) => validElements.has(id)));
  }

  function findElementInModel(sourceModel, id) {
    for (const scene of sourceModel?.scenes || []) {
      const element = (scene.elements || []).find(candidate => candidate.id === id);
      if (element) return element;
    }
    return null;
  }

  function elementSupportsLocalTextPreview(element) {
    const preview = element?.textPreview;
    if (element?.kind !== 'text' || preview?.textValueStatus !== 'runtime-placeholder') {
      return false;
    }
    const visibleText = (preview.lines || [])
      .flatMap(line => (line || []).map(run => String(run?.text || '')))
      .join('');
    return visibleText === '预览文字';
  }

  function localTextPreviewValue(element) {
    if (!elementSupportsLocalTextPreview(element)
      || !localTextPreviewValues.has(element.id)) return null;
    return localTextPreviewValues.get(element.id);
  }

  function initializeControlRuntime(element) {
    if (element.menuPreview && !menuSelections.has(element.id)) {
      menuSelections.set(
        element.id,
        element.menuPreview.selected || element.menuPreview.items?.[0] || '请选择'
      );
    }
    if (element.togglePreview && !toggleStates.has(element.id)) {
      const initial = element.togglePreview.initialChecked ?? element.togglePreview.checked;
      if (typeof initial === 'boolean') toggleStates.set(element.id, initial);
    }
    if (element.sliderPreview && !sliderStates.has(element.id)) {
      const dynamic = element.sliderPreview.dynamicFields?.length > 0;
      const invalid = element.sliderPreview.invalidFields?.length > 0;
      if (!dynamic && !invalid && Number.isFinite(Number(element.sliderPreview.initialValue))) {
        sliderStates.set(element.id, Number(element.sliderPreview.initialValue));
      }
    }
    if (element.inputPreview && !inputStates.has(element.id)) {
      inputStates.set(element.id, { value: '', touched: false, error: '' });
    }
    if (element.countdownPreview && !countdownStates.has(element.id)) {
      const preview = element.countdownPreview;
      const blockedDynamic = preview.dynamicFields?.some(field => (
        field === 'seconds' || field === 'repeat' || field === 'format'
      ));
      const blockedInvalid = Boolean(preview.invalidFields?.length);
      if (!blockedDynamic && !blockedInvalid && Number.isFinite(Number(preview.seconds))) {
        countdownStates.set(element.id, {
          startedAt: Date.now(),
          initialSeconds: Math.max(0, Math.floor(Number(preview.seconds))),
          repeatCount: preview.repeatCount,
        });
      }
    }
    if (element.animationPreview) {
      const preview = element.animationPreview;
      const signature = [
        preview.variant,
        preview.frameCount,
        preview.previewIntervalMs,
        preview.repeatCount,
        preview.finishHide,
        preview.finishPolicyConflict,
      ].join('|');
      const current = animationStates.get(element.id);
      if (!current || current.signature !== signature) {
        animationStates.set(element.id, {
          signature,
          startedAt: Date.now(),
          frameIndex: 0,
          completedLoops: 0,
          status: preview.staticFirstFrameOnly ? 'static-first-frame' : 'ready',
        });
      }
    }
  }

  function renderOffsets(geeOffsetHelp) {
    const offsets = model?.offsets;
    if (!offsets) {
      elements.offsetBar.classList.add('hidden');
      document.body.classList.remove('has-offsets');
      return;
    }
    elements.offsetBar.classList.remove('hidden');
    document.body.classList.add('has-offsets');
    elements.offsetX.value = String(offsets.memoX || 0);
    elements.offsetY.value = String(offsets.memoY || 0);
    const labels = { setup: '读取自 Mir200\\!Setup.txt', workspace: '当前工作区缓存', default: '尚未配置，按 0,0' };
    elements.offsetSource.textContent = labels[offsets.source] || '';
    const editable = model.engine === 'GEE';
    elements.offsetX.disabled = !editable;
    elements.offsetY.disabled = !editable;
    elements.saveOffsets.classList.toggle('hidden', !editable);
    elements.offsetHelp.textContent = editable ? geeOffsetHelp : (offsets.setupPath || '');
    elements.offsetHelp.title = elements.offsetHelp.textContent;
  }

  function renderAll() {
    renderSceneList();
    renderActUiPreviews();
    renderScene();
    renderInspector();
    renderChangeList();
    updateButtons();
    syncCanvasDiagnostics();
  }

  function syncCanvasDiagnostics() {
    elements.dialogCanvas.classList.toggle('show-canvas-diagnostics', showCanvasDiagnostics);
    elements.actUiPreviewPanel.classList.toggle('show-act-ui-diagnostics', showCanvasDiagnostics);
    elements.canvasDiagnosticsToggle.setAttribute('aria-pressed', String(showCanvasDiagnostics));
    elements.canvasDiagnosticsToggle.textContent = showCanvasDiagnostics ? '隐藏诊断' : '显示诊断';
  }

  function renderActUiPreviews() {
    const currentLabel = String(currentScene()?.sourceLabel || model?.functionLabel || '').toUpperCase();
    const previews = (Array.isArray(model?.actUiPreviews) ? model.actUiPreviews : [])
      .filter(preview => !preview?.sourceLabel
        || String(preview.sourceLabel).toUpperCase() === currentLabel);
    elements.actUiPreviewList.textContent = '';
    elements.actUiPreviewCount.textContent = String(previews.length);
    elements.actUiPreviewPanel.classList.toggle('hidden', previews.length === 0);
    for (const [index, preview] of previews.entries()) {
      elements.actUiPreviewList.appendChild(createActUiPreviewCard(preview, index));
    }
  }

  function createActUiPreviewCard(preview, index) {
    const fields = Array.isArray(preview?.fields) ? preview.fields : [];
    const card = document.createElement('article');
    card.className = 'act-ui-preview-card';
    card.dataset.actUiCardId = String(preview?.id || `ACT_UI_${index + 1}`);
    card.dataset.actUiCommand = String(preview?.command || 'unknown');
    card.dataset.actUiSimulation = 'partial';
    card.dataset.actUiLocalOnly = 'true';

    const dynamicFields = actUiDiagnosticFields(preview?.dynamicFields, fields, 'dynamic');
    const invalidFields = actUiDiagnosticFields(preview?.invalidFields, fields, 'invalid');
    if (dynamicFields.length > 0) card.dataset.actUiDynamicFields = dynamicFields.join(',');
    if (invalidFields.length > 0) card.dataset.actUiInvalidFields = invalidFields.join(',');
    if (preview?.evidenceStatus === 'evidence-blocked') {
      card.dataset.actUiEvidenceStatus = 'evidence-blocked';
      card.classList.add('act-ui-preview-evidence-blocked');
    }
    if (preview?.sourceLabel) card.dataset.actUiSourceLabel = String(preview.sourceLabel);
    if (Number.isInteger(preview?.lineNumber)) card.dataset.actUiLineNumber = String(preview.lineNumber);

    const heading = document.createElement('div');
    heading.className = 'act-ui-preview-card-heading';
    const title = document.createElement('strong');
    title.textContent = actUiCommandLabel(preview?.command);
    const command = document.createElement('code');
    command.textContent = String(preview?.command || 'unknown');
    heading.append(title, command);

    const fieldList = document.createElement('div');
    fieldList.className = 'act-ui-field-list';
    if (fields.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'act-ui-field act-ui-field-invalid';
      empty.dataset.actUiField = '<missing-fields>';
      empty.dataset.actUiFieldStatus = 'invalid';
      empty.textContent = '字段模型缺失，未进行静态推断';
      fieldList.appendChild(empty);
    } else {
      for (const field of fields) fieldList.appendChild(createActUiField(field));
    }

    if (preview?.warning) {
      const warning = document.createElement('div');
      warning.className = 'act-ui-preview-warning';
      warning.textContent = String(preview.warning);
      card.append(heading, fieldList, warning);
    } else {
      card.append(heading, fieldList);
    }

    const boundary = document.createElement('div');
    boundary.className = 'act-ui-preview-boundary';
    boundary.dataset.actUiBoundary = 'display-only';
    boundary.textContent = 'Partial simulation：仅本地展示；不执行服务器标签、客户端窗口、宿主动作或导航。';
    card.appendChild(boundary);
    return card;
  }

  function createActUiField(field) {
    const status = actUiFieldStatus(field?.status);
    const row = document.createElement('div');
    row.className = `act-ui-field act-ui-field-${status}`;
    row.dataset.actUiField = String(field?.name || '<unnamed>');
    row.dataset.actUiFieldStatus = status;

    const name = document.createElement('span');
    name.className = 'act-ui-field-name';
    name.textContent = String(field?.name || '<unnamed>');
    const value = document.createElement('span');
    value.className = 'act-ui-field-value';
    const displayValue = actUiFieldValue(field, status);
    value.textContent = displayValue;
    if (field?.displayValueSource) {
      row.dataset.actUiDisplayKind = String(field.displayValueSource.kind || 'text');
      row.dataset.actUiDisplayStatus = String(field.displayValueSource.status || 'runtime-placeholder');
    }
    if (/-label$/u.test(String(field?.name || '')) && /^@/u.test(displayValue)) {
      value.classList.add('act-ui-action-label');
      value.dataset.actUiActionBoundary = 'display-only';
    }
    const badge = document.createElement('small');
    badge.className = 'act-ui-field-status';
    badge.textContent = actUiFieldStatusLabel(status);
    row.append(name, value, badge);
    return row;
  }

  function actUiDiagnosticFields(explicitFields, fields, status) {
    const values = Array.isArray(explicitFields)
      ? explicitFields.map(value => String(value)).filter(Boolean)
      : [];
    for (const field of fields) {
      if (field?.status !== status || !field?.name) continue;
      const name = String(field.name);
      if (!values.includes(name)) values.push(name);
    }
    return values;
  }

  function actUiFieldStatus(value) {
    return ['static', 'dynamic', 'invalid', 'evidence-blocked'].includes(value)
      ? value
      : 'invalid';
  }

  function actUiFieldValue(field, status) {
    if (field?.displayValueSource?.value !== undefined) {
      return formatActUiValue(field.displayValueSource.value);
    }
    if (field && field.value !== undefined) return formatActUiValue(field.value);
    if (status === 'dynamic') return '未确定';
    if (status === 'evidence-blocked') return '证据不足，未应用';
    if (status === 'invalid') return '非法或缺失';
    return '（空）';
  }

  function formatActUiValue(value) {
    if (Array.isArray(value)) return `[${value.map(item => String(item)).join(', ')}]`;
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (value === null) return 'null';
    return String(value);
  }

  function actUiFieldStatusLabel(status) {
    return {
      static: '静态',
      dynamic: '动态未知',
      invalid: '非法/缺失',
      'evidence-blocked': '证据阻断',
    }[status];
  }

  function actUiCommandLabel(command) {
    return {
      messagebox: '消息框',
      'show-progress-bar': '进度窗口',
      'play-window-effect': '窗口特效',
      'send-move-hint': '移动提示',
      'open-upgrade-dialog': '装备升级窗口',
      'open-client-dialog': '客户端窗口',
    }[command] || '未知 #ACT 界面动作';
  }

  function renderSceneList() {
    elements.sceneList.textContent = '';
    const scenes = model?.scenes || [];
    const pages = model?.pages || [];
    elements.sceneCount.textContent = `${pages.length} 页`;
    const scenesByGroup = new Map();
    for (const scene of scenes) {
      if (!scene.conditionGroupId) continue;
      const grouped = scenesByGroup.get(scene.conditionGroupId) || [];
      grouped.push(scene);
      scenesByGroup.set(scene.conditionGroupId, grouped);
    }

    const groups = model?.conditionGroups || [];
    for (const page of pages) {
      elements.sceneList.appendChild(createPageButton(page));
      for (const group of groups.filter(candidate => candidate.sourceLabel === page.sourceLabel)) {
        const groupedScenes = scenesByGroup.get(group.id) || [];
        if (groupedScenes.length > 0) {
          elements.sceneList.appendChild(createSceneGroup(group, groupedScenes));
        }
      }
    }
    const advancedGroups = [];
    for (const group of groups) {
      if (!(scenesByGroup.get(group.id) || []).length) advancedGroups.push(group);
    }
    renderAdvancedConditions(advancedGroups);
  }

  function createPageButton(page) {
    const button = document.createElement('button');
    button.type = 'button';
    const active = page.id === currentPageId;
    button.className = `scene-button${active ? ' active' : ''}`;
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
    const title = document.createElement('strong');
    title.textContent = page.sourceLabel;
    const summary = document.createElement('span');
    summary.textContent = page.conditionSummary || '默认界面';
    button.append(title, summary);
    button.addEventListener('click', () => {
      currentPageId = page.id;
      selectedElementId = '';
      renderAll();
    });
    return button;
  }

  function createSceneGroup(group, scenes) {
    const container = document.createElement('section');
    const current = pageForLabel(group.sourceLabel)?.id === currentPageId;
    container.className = `scene-group${current ? ' current' : ''}`;

    const heading = document.createElement('div');
    heading.className = 'scene-group-heading';
    const title = document.createElement('strong');
    title.textContent = group.title;
    const detail = document.createElement('span');
    const conditionText = formatConditions(group);
    detail.textContent = conditionText.replace(/\n/g, ' / ');
    detail.title = conditionText;
    heading.append(title, detail);

    const segment = document.createElement('div');
    segment.className = 'branch-segment';
    segment.setAttribute('role', 'group');
    segment.setAttribute('aria-label', `${group.title}预览分支`);
    const falseScene = scenes.find(scene => scene.marker === '#ELSESAY');
    const trueScene = scenes.find(scene => scene.marker !== '#ELSESAY');
    segment.append(
      createBranchButton(group, false, falseScene),
      createBranchButton(group, true, trueScene)
    );
    container.append(heading, segment);
    return container;
  }

  function createBranchButton(group, satisfied, scene) {
    const button = document.createElement('button');
    button.type = 'button';
    const active = (previewConditions.get(group.id) || false) === satisfied;
    const current = pageForLabel(group.sourceLabel)?.id === currentPageId && active;
    button.className = `branch-button${active ? ' active' : ''}${current ? ' current' : ''}`;
    button.textContent = satisfied ? '满足' : '不满足';
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
    button.title = scene ? scene.conditionSummary : `${group.title}没有独立界面输出`;
    button.addEventListener('click', () => selectPreviewCondition(group, satisfied));
    return button;
  }

  function renderAdvancedConditions(groups) {
    elements.advancedConditionList.textContent = '';
    elements.advancedConditionCount.textContent = String(groups.length);
    elements.advancedConditions.classList.toggle('hidden', groups.length === 0);
    for (const group of groups) {
      const row = document.createElement('div');
      row.className = 'advanced-condition';
      const title = document.createElement('strong');
      title.textContent = group.title;
      const detail = document.createElement('small');
      detail.textContent = formatConditions(group);
      const segment = document.createElement('div');
      segment.className = 'branch-segment';
      segment.setAttribute('role', 'group');
      segment.setAttribute('aria-label', `${group.title}模拟状态`);
      segment.append(
        createBranchButton(group, false),
        createBranchButton(group, true)
      );
      row.append(title, detail, segment);
      elements.advancedConditionList.appendChild(row);
    }
  }

  function selectPreviewCondition(group, satisfied) {
    previewConditions.set(group.id, satisfied);
    currentPageId = pageForLabel(group.sourceLabel)?.id || currentPageId;
    selectedElementId = '';
    renderAll();
    vscode.postMessage({
      type: 'previewCondition',
      groupId: group.id,
      satisfied,
    });
  }

  function resetPreviewState() {
    previewConditions = new Map((model?.conditionGroups || []).map(group => [group.id, false]));
    selectedElementId = '';
    expandedMenuIds = new Set();
    menuSelections = new Map();
    listScrollOffsets = new Map();
    toggleStates = new Map();
    sliderStates = new Map();
    inputStates = new Map();
    localTextPreviewValues = new Map();
    runtimeActionStates = new Map();
    countdownStates = new Map();
    animationStates = new Map();
    for (const scene of model?.scenes || []) {
      for (const element of scene.elements || []) {
        if (element.containerPreview?.variant === 'list') {
          listScrollOffsets.set(element.id, Number(element.containerPreview.scrollOffset) || 0);
        }
        initializeControlRuntime(element);
      }
    }
    renderAll();
    vscode.postMessage({ type: 'resetPreview' });
  }

  function pageForLabel(sourceLabel) {
    return (model?.pages || []).find(page => page.sourceLabel === sourceLabel) || null;
  }

  function renderScene() {
    const scene = currentScene();
    clearAnimationTimers();
    hideDialogTooltip();
    elements.dialogCanvas.textContent = '';
    const origin = document.createElement('div');
    origin.className = 'canvas-origin';
    const contentOrigin = mainDialogContentOrigin(scene);
    const knownOriginAxes = Number(contentOrigin.knownX) + Number(contentOrigin.knownY);
    origin.dataset.originSpace = knownOriginAxes === 2
      ? 'dialog'
      : knownOriginAxes === 1 ? 'dialog-partial' : 'canvas';
    origin.style.left = `${(contentOrigin.knownX ? contentOrigin.x : 0) - 4}px`;
    origin.style.top = `${(contentOrigin.knownY ? contentOrigin.y : 0) - 4}px`;
    origin.title = knownOriginAxes === 2
      ? '对话框原点 0,0'
      : knownOriginAxes === 1 ? '对话框原点仅一轴可静态确定' : '画布原点 0,0';
    elements.dialogCanvas.appendChild(origin);
    const width = model?.canvasWidth || 800;
    const height = model?.canvasHeight || 600;
    elements.dialogCanvas.style.width = `${width}px`;
    elements.dialogCanvas.style.height = `${height}px`;
    elements.canvasStage.style.width = `${Math.round(width * zoom)}px`;
    elements.canvasStage.style.height = `${Math.round(height * zoom)}px`;
    elements.dialogCanvas.style.transform = `scale(${zoom})`;
    elements.canvasSize.textContent = `${width} × ${height}`;
    elements.zoomValue.textContent = `${Math.round(zoom * 100)}%`;

    if (!scene) {
      elements.sceneTitle.textContent = '当前页面没有可显示的界面';
      elements.conditionText.textContent = '请选择左侧界面页面';
      renderVariableList(null);
      renderDiagnostics(null);
      return;
    }
    elements.sceneTitle.textContent = `${scene.title} · ${scene.conditionSummary}`;
    elements.conditionText.textContent = formatPageConditions(scene);
    renderBackground(scene.background);
    renderAddDlgWindow(scene.addDlgWindow);
    for (const element of scene.elements || []) renderCanvasElement(element, scene);
    renderVariableList(scene);
    renderDiagnostics(scene);
  }

  function renderVariableList(scene) {
    elements.variableList.textContent = '';
    const variables = scene?.resolvedVariables || [];
    if (variables.length === 0) {
      elements.variableList.textContent = '当前场景未使用脚本变量';
      return;
    }
    for (const variable of variables) {
      const row = document.createElement('div');
      row.className = `variable-row ${variable.status}`;
      const name = document.createElement('strong');
      name.textContent = variable.name;
      const value = document.createElement('span');
      value.textContent = variable.value === '' ? '(空)' : variable.value;
      value.title = variable.value || '(空)';
      const source = document.createElement('small');
      source.textContent = variable.status === 'resolved'
        ? `${variable.sourceLabel || '脚本'}${variable.sourceLine ? ` 第 ${variable.sourceLine} 行` : ''}`
        : '无法静态确定，已使用默认值';
      row.append(name, value, source);
      elements.variableList.appendChild(row);
    }
  }

  function renderBackground(background) {
    if (!background) return;
    const assetReady = background.asset?.status === 'ready' && background.asset.url;
    const hasNineGridSource = Boolean(background.nineGrid);
    const nineGrid = background.nineGrid?.enabled === true;
    const geometry = dialogBackgroundGeometry(background);
    const { width, height } = geometry;
    const wrapper = document.createElement('section');
    wrapper.className = `dialog-background-preview background-${background.status || 'static'}`;
    wrapper.style.left = `${geometry.left}px`;
    wrapper.style.top = `${geometry.top}px`;
    wrapper.style.width = `${width}px`;
    wrapper.style.height = `${height}px`;
    wrapper.dataset.backgroundCommand = background.command || 'OPENMERCHANTBIGDLG';
    wrapper.dataset.backgroundStatus = background.status || 'static';
    wrapper.dataset.backgroundRuntimeScope = 'local';
    setBackgroundDataset(wrapper, 'backgroundWillIndex', background.willIndex);
    setBackgroundDataset(wrapper, 'backgroundImageIndex', background.imageIndex);
    setBackgroundDataset(wrapper, 'backgroundMovable', background.movable);
    setBackgroundDataset(wrapper, 'backgroundPosition', background.position);
    setBackgroundDataset(wrapper, 'backgroundOffsetX', geometry.offset.x);
    setBackgroundDataset(wrapper, 'backgroundOffsetY', geometry.offset.y);
    setBackgroundDataset(wrapper, 'backgroundShowClose', background.showCloseButton);
    setBackgroundDataset(wrapper, 'backgroundCloseX', background.closeButtonX);
    setBackgroundDataset(wrapper, 'backgroundCloseY', background.closeButtonY);
    setBackgroundDataset(wrapper, 'backgroundIndependentWindow', background.independentWindow);
    setBackgroundDataset(wrapper, 'backgroundContinueUse', background.continueUse);
    if (Array.isArray(background.dynamicFields) && background.dynamicFields.length) {
      wrapper.dataset.backgroundDynamicFields = background.dynamicFields.join(',');
    }
    if (Array.isArray(background.invalidFields) && background.invalidFields.length) {
      wrapper.dataset.backgroundInvalidFields = background.invalidFields.join(',');
    }
    if (hasNineGridSource) {
      wrapper.dataset.backgroundNineGrid = 'true';
      wrapper.dataset.backgroundNineGridEnabled = nineGrid ? 'true' : 'unknown';
      wrapper.dataset.backgroundNineGridWidth = String(background.nineGrid.targetWidth || '');
      wrapper.dataset.backgroundNineGridHeight = String(background.nineGrid.targetHeight || '');
      wrapper.dataset.backgroundNineGridRendering = background.nineGrid.rendering || 'partial-simulation';
    }

    if (assetReady) {
      const image = document.createElement('img');
      image.className = `dialog-background${nineGrid ? ' dialog-background-nine-grid' : ''}`;
      image.src = background.asset.url;
      image.alt = background.asset.archiveLabel || '对话框背景';
      image.title = background.asset.archiveLabel || '';
      image.draggable = false;
      image.style.left = `${background.asset.offsetX || 0}px`;
      image.style.top = `${background.asset.offsetY || 0}px`;
      if (nineGrid) {
        image.style.width = `${width}px`;
        image.style.height = `${height}px`;
      }
      wrapper.appendChild(image);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'background-placeholder';
      placeholder.textContent = background.asset?.message
        || `${background.status === 'dynamic' ? '动态' : background.status === 'invalid' ? '无效' : '缺失'}背景 WIL ${background.willIndex ?? '?'} / ${background.imageIndex ?? '?'}`;
      wrapper.appendChild(placeholder);
    }

    if (
      background.showCloseButton === true
      && Number.isFinite(Number(background.closeButtonX))
      && Number.isFinite(Number(background.closeButtonY))
    ) {
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'dialog-background-close-marker';
      close.style.left = `${Number(background.closeButtonX)}px`;
      close.style.top = `${Number(background.closeButtonY)}px`;
      close.textContent = '×';
      close.title = '关闭按钮位置标记；仅本地展示，不执行或控制客户端';
      close.setAttribute('aria-label', close.title);
      close.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
      });
      wrapper.appendChild(close);
    }

    const boundary = document.createElement('div');
    boundary.className = 'dialog-background-runtime-boundary';
    boundary.textContent = [
      ...(Array.isArray(background.warnings) ? background.warnings : []),
      background.warning,
      hasNineGridSource
        ? 'Partial simulation：九宫格仅按已证明的目标几何缩放展示，源图切片算法未公开'
        : undefined,
      '仅本地展示，不执行关闭、移动或客户端窗口命令',
    ].filter(Boolean).filter((value, index, values) => values.indexOf(value) === index).join('；');
    const backgroundHint = '对话框背景静态预览；详细诊断请点击“显示诊断”';
    wrapper.title = backgroundHint;
    wrapper.setAttribute('aria-label', backgroundHint);
    wrapper.appendChild(boundary);
    if (background.offsetBinding?.id) {
      wrapper.dataset.coordinateBindingId = background.offsetBinding.id;
    }
    elements.dialogCanvas.appendChild(wrapper);
    renderCoordinateBindingHandle(background.offsetBinding, background, {
      x: geometry.left,
      y: geometry.top,
    });
  }

  function dialogBackgroundGeometry(background) {
    const assetReady = background?.asset?.status === 'ready' && background.asset.url;
    const nineGrid = background?.nineGrid?.enabled === true;
    const width = nineGrid && Number(background.nineGrid.targetWidth) > 0
      ? Number(background.nineGrid.targetWidth)
      : assetReady && Number(background.asset.width) > 0
        ? Number(background.asset.width)
        : 420;
    const height = nineGrid && Number(background.nineGrid.targetHeight) > 0
      ? Number(background.nineGrid.targetHeight)
      : assetReady && Number(background.asset.height) > 0
        ? Number(background.asset.height)
        : 300;
    const clientWidth = Number(model?.clientWidth) > 0 ? Number(model.clientWidth) : 800;
    const clientHeight = Number(model?.clientHeight) > 0 ? Number(model.clientHeight) : 600;
    const origin = dialogBackgroundOrigin(
      background?.position,
      clientWidth,
      clientHeight,
      width,
      height
    );
    const offset = coordinateBindingPosition(
      background?.offsetBinding,
      background?.offsetX,
      background?.offsetY
    );
    return {
      width,
      height,
      origin,
      offset,
      left: origin.x + offset.x,
      top: origin.y + offset.y,
    };
  }

  function mainDialogContentOrigin(scene) {
    const background = scene?.background;
    // AddDlg has its own independently modeled window/content origins. Its
    // companion background must never be applied a second time to child nodes.
    if (!background || scene?.addDlgWindow) return unknownDialogContentOrigin();
    const blockedFields = new Set([
      ...(background.dynamicFields || []),
      ...(background.invalidFields || []),
    ]);
    const position = background.position;
    if (blockedFields.has('position')) return unknownDialogContentOrigin();
    if (!Number.isInteger(position) || position < 0 || position > 4) {
      if (position !== undefined && position !== null) return unknownDialogContentOrigin();
    }
    const effectivePosition = Number.isInteger(position) ? position : 0;
    const nineGridStateUnknown = Boolean(background.nineGrid)
      && blockedFields.has('nine-grid-enabled');
    const nineGrid = background.nineGrid?.enabled === true && !nineGridStateUnknown;
    const width = nineGridStateUnknown
      ? NaN
      : nineGrid
        ? Number(background.nineGrid.targetWidth)
        : background.asset?.status === 'ready' ? Number(background.asset.width) : NaN;
    const height = nineGridStateUnknown
      ? NaN
      : nineGrid
        ? Number(background.nineGrid.targetHeight)
        : background.asset?.status === 'ready' ? Number(background.asset.height) : NaN;
    const widthKnown = Number.isFinite(width) && width > 0;
    const heightKnown = Number.isFinite(height) && height > 0;
    const anchorXKnown = effectivePosition === 0 || effectivePosition === 2
      || ((effectivePosition === 1 || effectivePosition === 3 || effectivePosition === 4) && widthKnown);
    const anchorYKnown = effectivePosition === 0 || effectivePosition === 1
      || ((effectivePosition === 2 || effectivePosition === 3 || effectivePosition === 4) && heightKnown);
    const offsetXKnown = coordinateAxisKnown(
      background.offsetBinding,
      'x',
      background.offsetX === undefined ? 0 : background.offsetX
    )
      && !blockedFields.has('offset-x');
    const offsetYKnown = coordinateAxisKnown(
      background.offsetBinding,
      'y',
      background.offsetY === undefined ? 0 : background.offsetY
    )
      && !blockedFields.has('offset-y');
    const knownX = anchorXKnown && offsetXKnown;
    const knownY = anchorYKnown && offsetYKnown;
    const canvasWidth = Number(model?.clientWidth) > 0 ? Number(model.clientWidth) : 800;
    const canvasHeight = Number(model?.clientHeight) > 0 ? Number(model.clientHeight) : 600;
    const anchorX = effectivePosition === 1 || effectivePosition === 3
      ? canvasWidth - width
      : effectivePosition === 4 ? (canvasWidth - width) / 2 : 0;
    const anchorY = effectivePosition === 2 || effectivePosition === 3
      ? canvasHeight - height
      : effectivePosition === 4 ? (canvasHeight - height) / 2 : 0;
    const offset = coordinateBindingPosition(
      background.offsetBinding,
      background.offsetX,
      background.offsetY
    );
    return {
      x: knownX ? anchorX + offset.x : 0,
      y: knownY ? anchorY + offset.y : 0,
      knownX,
      knownY,
      known: knownX && knownY,
    };
  }

  function unknownDialogContentOrigin() {
    return { x: 0, y: 0, knownX: false, knownY: false, known: false };
  }

  function coordinateAxisKnown(binding, axis, fallback) {
    const coordinate = binding?.[axis];
    return coordinate
      ? coordinate.displayValue !== undefined && coordinate.displayValue !== null
        && Number.isFinite(Number(coordinate.displayValue))
      : fallback !== undefined && fallback !== null && Number.isFinite(Number(fallback));
  }

  function setBackgroundDataset(wrapper, name, value) {
    if (value === undefined || value === null) return;
    wrapper.dataset[name] = String(value);
  }

  function dialogBackgroundOrigin(position, canvasWidth, canvasHeight, width, height) {
    const right = canvasWidth - width;
    const bottom = canvasHeight - height;
    if (position === 1) return { x: right, y: 0 };
    if (position === 2) return { x: 0, y: bottom };
    if (position === 3) return { x: right, y: bottom };
    if (position === 4) return { x: right / 2, y: bottom / 2 };
    return { x: 0, y: 0 };
  }

  function coordinatePairKnown(binding, fallbackX, fallbackY) {
    if (binding?.x && binding?.y) {
      return Number.isFinite(binding.x.displayValue) && Number.isFinite(binding.y.displayValue);
    }
    return Number.isFinite(fallbackX) && Number.isFinite(fallbackY);
  }

  function coordinateBindingPosition(binding, fallbackX, fallbackY) {
    const draft = binding?.id ? drafts.get(binding.id) : undefined;
    if (draft) return { x: draft.x, y: draft.y };
    return {
      x: Number.isFinite(binding?.x?.displayValue)
        ? Number(binding.x.displayValue)
        : Number.isFinite(fallbackX) ? Number(fallbackX) : 0,
      y: Number.isFinite(binding?.y?.displayValue)
        ? Number(binding.y.displayValue)
        : Number.isFinite(fallbackY) ? Number(fallbackY) : 0,
    };
  }

  function coordinateBindingSourceKind(binding) {
    const normalize = value => String(value || '')
      .replaceAll('\\', '/')
      .replace(/^\/\/\?\//, '')
      .toLowerCase();
    const pathMatches = binding?.sourceFilePath && model?.filePath
      && normalize(binding.sourceFilePath) === normalize(model.filePath);
    const uriMatches = binding?.sourceUri && model?.uri
      && normalize(binding.sourceUri) === normalize(model.uri);
    if (pathMatches || uriMatches) return 'primary';
    if ((binding?.sourceFilePath && model?.filePath) || (binding?.sourceUri && model?.uri)) {
      return 'external-companion';
    }
    return binding?.sourceKind || 'external-companion';
  }

  function coordinateBindingEditable(binding) {
    return binding?.editable === true && coordinateBindingSourceKind(binding) === 'primary';
  }

  function coordinateBindingElement(binding, owner) {
    if (!binding?.id || !binding.x || !binding.y) return null;
    const labels = {
      'adddlg-window-origin': ['AddDlg 窗口原点', 'W'],
      'adddlg-content-origin': ['AddDlg 内容原点', 'C'],
      'dialog-background-offset': ['对话背景偏移', 'B'],
    };
    const [description, glyph] = labels[binding.targetKind] || ['坐标绑定', '+'];
    const sourceKind = coordinateBindingSourceKind(binding);
    const base = {
      x: Number(binding.x.displayValue),
      y: Number(binding.y.displayValue),
    };
    return {
      id: binding.id,
      statementId: 'coordinate-binding',
      token: owner?.command || description,
      description,
      kind: 'generic',
      raw: owner?.raw || binding.sourceRange?.original || '',
      lineNumber: owner?.lineNumber || 0,
      sourceRange: binding.sourceRange || owner?.sourceRange,
      sourceUri: binding.sourceUri,
      sourceFilePath: binding.sourceFilePath,
      sourceDocumentVersion: binding.sourceDocumentVersion,
      coordinateMode: 'absolute',
      sourceCoordinateBiasX: 0,
      sourceCoordinateBiasY: 0,
      editable: coordinateBindingEditable(binding),
      x: binding.x,
      y: binding.y,
      localLayoutX: base.x,
      localLayoutY: base.y,
      layoutX: base.x,
      layoutY: base.y,
      width: 14,
      height: 14,
      text: glyph,
      warning: sourceKind === 'primary'
        ? `${description}来自主文档直接数值；可拖动、方向键微调并安全回写对应坐标对`
        : `${description}来自外部 companion；仅允许选择和定位，禁止拖动或写入主文档`,
      coordinateTargetKind: binding.targetKind,
      coordinateSourceKind: sourceKind,
      coordinateBinding: binding,
      coordinateBindingOwner: owner,
    };
  }

  function coordinateBindingElements(scene) {
    if (!scene) return [];
    const windowPreview = scene.addDlgWindow;
    return [
      coordinateBindingElement(windowPreview?.windowOriginBinding, windowPreview),
      coordinateBindingElement(windowPreview?.contentOriginBinding, windowPreview),
      coordinateBindingElement(scene.background?.offsetBinding, scene.background),
    ].filter(Boolean);
  }

  function renderCoordinateBindingHandle(binding, owner, visualPosition) {
    const target = coordinateBindingElement(binding, owner);
    if (!target || !coordinatePairKnown(binding)) return;
    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = `coordinate-binding-handle coordinate-target-${target.coordinateTargetKind}`
      + `${target.editable ? '' : ' locked'}`
      + `${selectedElementId === target.id ? ' selected' : ''}`;
    handle.dataset.elementId = target.id;
    handle.dataset.coordinateTargetKind = target.coordinateTargetKind;
    handle.dataset.coordinateEditable = String(target.editable);
    handle.dataset.coordinateSourceKind = target.coordinateSourceKind;
    handle.style.left = `${visualPosition.x}px`;
    handle.style.top = `${visualPosition.y}px`;
    handle.textContent = target.text;
    handle.title = target.editable
      ? `${target.description} ${target.x.displayValue},${target.y.displayValue}；拖动或方向键微调`
      : `${target.description} ${target.x.displayValue},${target.y.displayValue}；只读预览`;
    handle.setAttribute('aria-label', handle.title);
    handle.addEventListener('focus', () => selectElement(target.id, false));
    handle.addEventListener('mousedown', event => {
      event.stopPropagation();
      startDrag(event, target);
    });
    handle.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      selectElement(target.id);
    });
    elements.dialogCanvas.appendChild(handle);
  }

  function renderAddDlgWindow(preview) {
    if (!preview) return;
    const positionKnown = coordinatePairKnown(
      preview.windowOriginBinding,
      preview.windowX,
      preview.windowY
    );
    const textOffsetKnown = coordinatePairKnown(
      preview.contentOriginBinding,
      preview.textOffsetX,
      preview.textOffsetY
    );
    const windowOrigin = coordinateBindingPosition(
      preview.windowOriginBinding,
      preview.windowX,
      preview.windowY
    );
    const contentOffset = coordinateBindingPosition(
      preview.contentOriginBinding,
      preview.textOffsetX,
      preview.textOffsetY
    );
    const asset = preview.asset;
    const assetReady = asset?.status === 'ready' && asset.url;
    const width = assetReady && Number(asset.width) > 0 ? Number(asset.width) : 420;
    const height = assetReady && Number(asset.height) > 0 ? Number(asset.height) : 300;
    const panel = document.createElement('section');
    panel.className = `adddlg-window${positionKnown ? '' : ' uncertain-position'}`;
    panel.style.left = `${positionKnown ? windowOrigin.x : 0}px`;
    panel.style.top = `${positionKnown ? windowOrigin.y : 0}px`;
    panel.style.width = `${width}px`;
    panel.style.height = `${height}px`;
    panel.dataset.adddlgWindowId = preview.id || '';
    panel.dataset.dialogId = preview.dialogId === undefined ? '' : String(preview.dialogId);
    panel.dataset.partialSimulation = 'true';
    panel.dataset.positionKnown = String(positionKnown);
    panel.dataset.textOffsetKnown = String(textOffsetKnown);
    panel.dataset.createPosition = preview.createPosition === undefined
      ? '' : String(preview.createPosition);
    panel.dataset.createPositionLabel = preview.createPositionLabel || '';
    panel.dataset.movable = preview.movable === undefined ? 'unknown' : String(preview.movable);
    panel.dataset.displayMode = String(preview.displayMode ?? 0);
    panel.dataset.popupDirection = String(preview.popupDirection ?? 0);
    panel.dataset.closeOnLeave = String(preview.closeOnLeave === true);
    panel.dataset.closeDelayMs = String(preview.closeDelayMs ?? 300);
    panel.dataset.qfTarget = preview.qfTarget || '';
    panel.dataset.adddlgCommand = preview.command || 'ADDDLG';
    panel.dataset.adddlgContentMode = preview.contentPreview?.mode || '';
    panel.dataset.adddlgContentStatus = preview.contentPreview?.status || '';
    panel.dataset.adddlgDynamicFields = (preview.dynamicFields || []).join(',');
    panel.dataset.adddlgInvalidFields = (preview.invalidFields || []).join(',');
    panel.dataset.deldlgScopes = (preview.closeActions || [])
      .map(action => action.scope || (action.scopeDynamic ? 'dynamic' : action.invalid ? 'invalid' : ''))
      .filter(Boolean)
      .join(',');
    if (preview.contentPreview?.mode === 'external-file') {
      panel.dataset.adddlgExternalPath = preview.contentPreview.raw || '';
      panel.dataset.adddlgExternalAbsolute = preview.contentPreview.absolute === undefined
        ? 'unknown'
        : String(preview.contentPreview.absolute);
    }

    if (assetReady) {
      const image = document.createElement('img');
      image.className = 'adddlg-background-image';
      image.src = asset.url;
      image.alt = asset.archiveLabel || `AddDlg ${preview.dialogId ?? ''} 背景`;
      image.title = asset.archiveLabel || '';
      image.draggable = false;
      image.style.left = `${Number(asset.offsetX) || 0}px`;
      image.style.top = `${Number(asset.offsetY) || 0}px`;
      panel.appendChild(image);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'adddlg-background-placeholder';
      placeholder.textContent = asset?.message
        || asset?.archiveLabel
        || `AddDlg 背景 ${preview.assetRef ? '等待素材解析' : '参数未知'}`;
      panel.appendChild(placeholder);
    }

    const contentOrigin = document.createElement('div');
    contentOrigin.className = 'adddlg-content-origin';
    contentOrigin.style.left = `${textOffsetKnown ? contentOffset.x : 0}px`;
    contentOrigin.style.top = `${textOffsetKnown ? contentOffset.y : 0}px`;
    contentOrigin.title = textOffsetKnown
      ? `${preview.contentPreview ? 'LFM 内容' : 'QF 内容'}原点 ${contentOffset.x},${contentOffset.y}`
      : `${preview.contentPreview ? 'LFM 内容' : 'QF 内容'}偏移包含动态值或无效值`;
    panel.appendChild(contentOrigin);

    const closeLinked = (preview.closeActions || []).some(action => (
      !action.dynamic
      && Number.isInteger(action.dialogId)
      && action.dialogId === preview.dialogId
    ));
    const closeAllUsers = (preview.closeActions || []).some(action => (
      action.scope === 'all-users'
      && !action.dynamic
      && action.dialogId === preview.dialogId
    ));
    const status = document.createElement('div');
    status.className = 'adddlg-static-status';
    status.textContent = [
      `${preview.command || 'AddDlg'} #${preview.dialogId ?? '?'}`,
      preview.createPositionLabel || '宿主未知',
      'Partial simulation',
      preview.movable === true ? '客户端可移动' : preview.movable === false ? '固定' : '移动状态未知',
      `显示模式 ${preview.displayMode ?? 0}`,
      `方向 ${preview.popupDirection ?? 0}`,
      closeLinked
        ? `DelDlg 已关联${closeAllUsers ? '（全服范围，仅展示）' : ''}`
        : 'DelDlg 未静态确认',
    ].join(' · ');
    panel.appendChild(status);

    const boundary = document.createElement('div');
    boundary.className = 'adddlg-runtime-boundary';
    boundary.textContent = [...new Set([
      '仅静态几何；未模拟真实宿主、悬停命中与渐缓曲线',
      ...(preview.warnings || []),
    ].filter(Boolean))].join('；');
    panel.appendChild(boundary);
    const addDlgHint = 'AddDlg 静态窗口预览；详细诊断请点击“显示诊断”';
    panel.title = addDlgHint;
    panel.setAttribute('aria-label', addDlgHint);
    elements.dialogCanvas.appendChild(panel);
    renderCoordinateBindingHandle(preview.windowOriginBinding, preview, windowOrigin);
    renderCoordinateBindingHandle(preview.contentOriginBinding, preview, {
      x: windowOrigin.x + contentOffset.x,
      y: windowOrigin.y + contentOffset.y,
    });
  }

  function addDlgElementPosition(element, position, preview) {
    if (!preview
      || !coordinatePairKnown(preview.windowOriginBinding, preview.windowX, preview.windowY)
      || !coordinatePairKnown(
        preview.contentOriginBinding,
        preview.textOffsetX,
        preview.textOffsetY
      )) {
      return position;
    }
    let root = element;
    const visited = new Set();
    while (root.parentElementId && !visited.has(root.parentElementId)) {
      visited.add(root.parentElementId);
      const parent = findElement(root.parentElementId);
      if (!parent) break;
      root = parent;
    }
    const windowOrigin = coordinateBindingPosition(
      preview.windowOriginBinding,
      preview.windowX,
      preview.windowY
    );
    const contentOrigin = coordinateBindingPosition(
      preview.contentOriginBinding,
      preview.textOffsetX,
      preview.textOffsetY
    );
    const windowX = windowOrigin.x;
    const windowY = windowOrigin.y;
    const textOffsetX = contentOrigin.x;
    const textOffsetY = contentOrigin.y;
    if (root.coordinateMode === 'flow') {
      return {
        x: position.x + windowX + textOffsetX - ((Number(model?.offsets?.menuX) || 0) + 18),
        y: position.y + windowY + textOffsetY - ((Number(model?.offsets?.menuY) || 0) + 24),
      };
    }
    if (root.coordinateMode === 'relative') {
      return {
        x: position.x + windowX + textOffsetX - (Number(model?.offsets?.memoX) || 0),
        y: position.y + windowY + textOffsetY - (Number(model?.offsets?.memoY) || 0),
      };
    }
    return position;
  }

  function sceneElementVisualPosition(element, scene) {
    const position = visualPositionFor(element, positionFor(element.id, element));
    if (scene?.addDlgWindow) {
      return addDlgElementPosition(element, position, scene.addDlgWindow);
    }
    // 996PC Img bg=1 show=N and every child attached through children={}
    // were already reflowed into absolute 800x600 canvas coordinates by the
    // parser. Applying the main-dialog origin here would translate that whole
    // subtree a second time when both background systems occur in one scene.
    if (belongsToShowPositionedBackgroundSubtree(element, scene)) return position;
    const origin = mainDialogContentOrigin(scene);
    return {
      x: position.x + (origin.knownX ? origin.x : 0),
      y: position.y + (origin.knownY ? origin.y : 0),
    };
  }

  function belongsToShowPositionedBackgroundSubtree(element, scene) {
    if (!scene || !element) return false;
    let subtreeIds = showPositionedSubtreeCache.get(scene);
    if (!subtreeIds) {
      subtreeIds = new Set();
      const children = new Map();
      const roots = [];
      for (const candidate of scene.elements || []) {
        if (candidate.parentElementId) {
          const values = children.get(candidate.parentElementId) || [];
          values.push(candidate);
          children.set(candidate.parentElementId, values);
        }
        const show = candidate.imagePreview?.showPosition;
        if (candidate.imagePreview?.background === true
          && Number.isInteger(show) && show >= 0 && show <= 4) {
          roots.push(candidate);
        }
      }
      const pending = [...roots];
      while (pending.length) {
        const candidate = pending.pop();
        if (!candidate || subtreeIds.has(candidate.id)) continue;
        subtreeIds.add(candidate.id);
        pending.push(...(children.get(candidate.id) || []));
      }
      showPositionedSubtreeCache.set(scene, subtreeIds);
    }
    return subtreeIds.has(element.id);
  }

  function renderCanvasElement(element, scene) {
    const position = sceneElementVisualPosition(element, scene);
    const visualSize = elementVisualSize(element);
    const canvasBox = elementCanvasBox(element, position, visualSize);
    const wrapper = document.createElement('div');
    wrapper.className = `canvas-element kind-${element.kind}${element.editable ? '' : ' locked'}${selectedElementId === element.id ? ' selected' : ''}`;
    wrapper.dataset.elementId = element.id;
    if (element.sizePreview?.width?.mode) {
      wrapper.dataset.sizeWidthMode = element.sizePreview.width.mode;
    }
    if (element.sizePreview?.height?.mode) {
      wrapper.dataset.sizeHeightMode = element.sizePreview.height.mode;
    }
    const legacyCenter = element.layoutPreview;
    if (legacyCenter?.legacyCenterX || legacyCenter?.legacyCenterY) {
      wrapper.dataset.legacyCenterX = String(legacyCenter.legacyCenterX === true);
      wrapper.dataset.legacyCenterY = String(legacyCenter.legacyCenterY === true);
      if (Number.isFinite(Number(legacyCenter.legacyCenterOffsetX))) {
        wrapper.dataset.legacyCenterOffsetX = String(Number(legacyCenter.legacyCenterOffsetX));
      }
      if (Number.isFinite(Number(legacyCenter.legacyCenterOffsetY))) {
        wrapper.dataset.legacyCenterOffsetY = String(Number(legacyCenter.legacyCenterOffsetY));
      }
    }
    wrapper.style.left = `${canvasBox.x}px`;
    wrapper.style.top = `${canvasBox.y}px`;
    wrapper.style.width = `${canvasBox.width}px`;
    wrapper.style.height = `${canvasBox.height}px`;
    applyPanelBackgroundPlacement(element, wrapper);
    const interactionHint = element.editable
      ? '可选择并拖动；方向键微调坐标；详细诊断见右侧元素属性'
      : '只读预览；详细诊断见右侧元素属性';
    wrapper.setAttribute('aria-label', `${element.description}；${interactionHint}`);
    if (!element.tooltipPreview) wrapper.title = `${element.description}\n${interactionHint}`;

    if (element.inputPreview) {
      renderInputElement(element, wrapper);
    } else if (element.imageTextPreview) {
      renderImageTextElement(element, wrapper);
    } else if (element.modelPreview) {
      renderDialogModelElement(element, wrapper);
    } else if (element.monsterPreview) {
      renderMonsterElement(element, wrapper);
    } else if (element.imagePreview) {
      renderDialogImageElement(element, wrapper);
    } else if (element.kind === 'text') {
      if (element.textPreview) renderStyledTextElement(element, wrapper);
      else {
        const label = document.createElement('span');
        label.className = 'element-text';
        label.textContent = element.text ?? '';
        if (element.color) label.style.color = element.color;
        wrapper.appendChild(label);
      }
    } else if (element.togglePreview) {
      renderToggleElement(element, wrapper);
    } else if (element.menuPreview) {
      renderMenuElement(element, wrapper);
    } else if (element.costItemPreview) {
      renderCostItemElement(element, wrapper);
    } else if (element.itemPreview) {
      renderItemElement(element, wrapper, visualSize);
    } else if (element.progressPreview) {
      renderProgressElement(element, wrapper, visualSize);
    } else if (element.containerPreview) {
      renderContainerElement(element, wrapper, visualSize);
    } else if (element.animationPreview) {
      renderAnimationElement(element, wrapper);
    } else if (element.kind === 'button' && element.textPreview) {
      renderTextButton(element, wrapper);
    } else if (element.kind === 'button' && hasReadyInteractiveAsset(element)) {
      renderInteractiveAsset(element, wrapper);
    } else if (element.asset?.status === 'ready' && element.asset.url) {
      wrapper.appendChild(createAssetImage(element.asset, element.token));
    } else {
      wrapper.appendChild(createElementPlaceholder(genericElementPlaceholderText(element)));
    }

    if (element.assetStateDiagnostics) renderAssetStateDiagnostics(element, wrapper);
    if (element.addButtonPreview) renderAddButtonPreview(element, wrapper);
    if (element.runtimeActionPreview) renderRuntimeAction(element, wrapper);

    applyListViewportClip(element, wrapper, canvasBox);
    attachDialogTooltip(wrapper, element.tooltipPreview);

    wrapper.addEventListener('mousedown', event => startDrag(event, element));
    wrapper.addEventListener('click', event => {
      event.stopPropagation();
      selectElement(element.id);
    });
    elements.dialogCanvas.appendChild(wrapper);
    expandLocalTextPreviewHitArea(wrapper);
  }

  function expandLocalTextPreviewHitArea(wrapper) {
    if (wrapper.dataset.localTextPreview !== 'true'
      || wrapper.classList.contains('text-scroll-preview')) return;
    const label = wrapper.querySelector('.styled-text-preview');
    if (!label) return;
    const labelRect = label.getBoundingClientRect();
    const currentWidth = Number.parseFloat(wrapper.style.width) || 0;
    const currentHeight = Number.parseFloat(wrapper.style.height) || 0;
    const renderScale = Number(zoom) > 0 ? Number(zoom) : 1;
    const width = Math.ceil(Math.max(
      currentWidth,
      label.scrollWidth,
      labelRect.width / renderScale
    ));
    const height = Math.ceil(Math.max(
      currentHeight,
      label.scrollHeight,
      labelRect.height / renderScale
    ));
    if (width > currentWidth) wrapper.style.width = `${width}px`;
    if (height > currentHeight) wrapper.style.height = `${height}px`;

    const currentCanvasWidth = Number.parseFloat(elements.dialogCanvas.style.width) || 0;
    const currentCanvasHeight = Number.parseFloat(elements.dialogCanvas.style.height) || 0;
    const wrapperLeft = Number.parseFloat(wrapper.style.left) || 0;
    const wrapperTop = Number.parseFloat(wrapper.style.top) || 0;
    const canvasFrameWidth = Math.max(
      0,
      elements.dialogCanvas.offsetWidth - elements.dialogCanvas.clientWidth
    );
    const canvasFrameHeight = Math.max(
      0,
      elements.dialogCanvas.offsetHeight - elements.dialogCanvas.clientHeight
    );
    const canvasWidth = Math.ceil(Math.max(
      currentCanvasWidth,
      wrapperLeft + width + canvasFrameWidth
    ));
    const canvasHeight = Math.ceil(Math.max(
      currentCanvasHeight,
      wrapperTop + height + canvasFrameHeight
    ));
    if (canvasWidth > currentCanvasWidth) {
      elements.dialogCanvas.style.width = `${canvasWidth}px`;
      elements.canvasStage.style.width = `${Math.round(canvasWidth * renderScale)}px`;
    }
    if (canvasHeight > currentCanvasHeight) {
      elements.dialogCanvas.style.height = `${canvasHeight}px`;
      elements.canvasStage.style.height = `${Math.round(canvasHeight * renderScale)}px`;
    }
    wrapper.dataset.localTextPreviewBox = `${width}x${height}`;
  }

  function visualPositionFor(element, position) {
    let x = position.x;
    let y = position.y;
    const visited = new Set();
    let parentId = element.parentElementId;
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      const parent = findElement(parentId);
      if (!parent) break;
      if (parent.containerPreview?.variant === 'list') {
        const initial = Number(parent.containerPreview.scrollOffset) || 0;
        const current = listScrollOffset(parent);
        const delta = current - initial;
        if (parent.containerPreview.direction === 'horizontal') x -= delta;
        else y -= delta;
      }
      parentId = parent.parentElementId;
    }
    return { x, y };
  }

  function applyPanelBackgroundPlacement(element, wrapper) {
    const preview = element.imagePreview;
    if (!preview?.background) return;
    wrapper.classList.add('dialog-panel-background');
    wrapper.dataset.imageBackground = 'true';
    wrapper.style.zIndex = '1';
    const show = Number(preview.showPosition);
    if (!Number.isInteger(show) || show < 0 || show > 4) return;
    wrapper.dataset.imageShowPosition = String(show);
  }

  function renderInputElement(element, wrapper) {
    const preview = element.inputPreview;
    const multiline = preview.mode === 'memo';
    const dynamic = Boolean(preview.dynamicFields?.length);
    const invalid = Boolean(preview.invalidFields?.length);
    const blocked = dynamic || invalid;
    const state = inputStates.get(element.id) || { value: '', touched: false, error: '' };
    inputStates.set(element.id, state);
    const control = document.createElement(multiline ? 'textarea' : 'input');
    wrapper.classList.add('dialog-input-preview', `dialog-input-${preview.mode}`);
    wrapper.dataset.inputCoverage = dynamic
      ? 'runtime-placeholder'
      : invalid
        ? 'invalid-placeholder'
        : 'local-preview';
    if (preview.dynamicFields?.length) {
      wrapper.dataset.inputDynamicFields = preview.dynamicFields.join(',');
    }
    if (preview.invalidFields?.length) {
      wrapper.dataset.inputInvalidFields = preview.invalidFields.join(',');
    }
    control.className = 'dialog-input-control';
    if (!multiline) control.type = preview.mode === 'password' ? 'password' : 'text';
    control.readOnly = blocked;
    control.tabIndex = blocked ? -1 : 0;
    control.spellcheck = false;
    control.autocomplete = 'off';
    control.dataset.inputMode = preview.mode;
    control.value = blocked ? '' : state.value;
    control.setAttribute('aria-invalid', state.error ? 'true' : 'false');
    if (preview.mode === 'number' || preview.mode === 'absolute-number') {
      control.inputMode = 'decimal';
    }
    if (multiline) {
      control.wrap = preview.autoWrap === false ? 'off' : 'soft';
      control.dataset.autoWrap = String(preview.autoWrap !== false);
    }
    if (preview.inputId !== undefined) control.dataset.inputId = String(preview.inputId);
    if (preview.onlyChinese !== undefined) {
      control.dataset.onlyChinese = String(preview.onlyChinese);
    }
    if (preview.placeholder) control.placeholder = preview.placeholder;
    if (Number(preview.minLength) >= 0) control.minLength = Math.trunc(Number(preview.minLength));
    if (Number(preview.maxLength) >= 0) control.maxLength = Math.trunc(Number(preview.maxLength));
    if (preview.minValue !== undefined) control.dataset.minValue = String(preview.minValue);
    if (preview.maxValue !== undefined) control.dataset.maxValue = String(preview.maxValue);
    if (preview.textColor) control.style.color = preview.textColor;
    if (Number(preview.fontSize) > 0) control.style.fontSize = `${Number(preview.fontSize)}px`;
    if (Number(preview.lineHeight) > 0) {
      control.style.lineHeight = `${Number(preview.lineHeight)}px`;
    }
    if (preview.placeholderColor) {
      control.style.setProperty('--dialog-input-placeholder-color', preview.placeholderColor);
    }
    if (preview.transparentBackground) control.style.backgroundColor = 'transparent';
    else if (preview.backgroundColor) control.style.backgroundColor = preview.backgroundColor;
    if (preview.borderless) control.style.border = 'none';
    else if (preview.borderColor) control.style.borderColor = preview.borderColor;
    if (preview.showBackground === true) {
      wrapper.classList.add('dialog-input-default-frame');
    } else if (preview.showBackground === false) {
      wrapper.classList.add('dialog-input-no-frame');
      control.style.backgroundColor = 'transparent';
      control.style.border = 'none';
    }
    const error = document.createElement('div');
    error.className = 'dialog-input-error';
    error.setAttribute('role', 'alert');
    error.setAttribute('aria-live', 'polite');
    error.hidden = !state.error;
    error.textContent = state.error || '';
    wrapper.classList.toggle('dialog-input-has-error', Boolean(state.error));

    const boundary = document.createElement('div');
    boundary.className = 'dialog-input-local-boundary';
    if (dynamic) {
      boundary.textContent = '运行时参数未知，已禁用本地输入；仅作占位，不提交服务器';
    } else if (invalid) {
      boundary.textContent = '输入参数无效，已禁用本地输入；不截断或猜测，不提交服务器';
    } else {
      boundary.textContent = '仅本地预览，不提交服务器';
    }
    const dragHandle = element.editable ? document.createElement('span') : undefined;
    if (dragHandle) {
      dragHandle.className = 'dialog-input-drag-handle';
      dragHandle.tabIndex = 0;
      dragHandle.setAttribute('role', 'button');
      dragHandle.setAttribute('aria-label', '选择并拖动输入框；方向键微调坐标');
      dragHandle.title = '拖动输入框；选中后可用方向键微调坐标';
      dragHandle.addEventListener('focus', () => selectElement(element.id, false));
    }
    wrapper.append(control, error, boundary, ...(dragHandle ? [dragHandle] : []));

    const stopCanvasInteraction = event => {
      if (event.type === 'mousedown' || event.type === 'pointerdown' || event.type === 'click') {
        selectElement(element.id, false);
      }
      event.stopPropagation();
    };
    control.addEventListener('focus', () => selectElement(element.id, false));
    for (const eventName of [
      'mousedown', 'mouseup', 'click', 'dblclick', 'pointerdown', 'pointerup', 'keydown', 'keyup',
    ]) {
      control.addEventListener(eventName, stopCanvasInteraction);
    }
    if (!blocked) {
      control.addEventListener('input', event => {
        event.stopPropagation();
        let value = control.value;
        if (preview.mode === 'absolute-number' && /^\d+$/.test(value)) {
          value = value.replace(/^0+(?=\d)/, '');
          control.value = value;
        }
        state.value = value;
        state.touched = true;
        state.error = inputValidationError(preview, value);
        updateInputValidation(wrapper, control, state.error);
      });
    }
  }

  function inputValidationError(preview, value) {
    if (!preview.errorTips) return '';
    const error = String(preview.errorTips);
    const length = Array.from(value).length;
    if (preview.onlyChinese === true
      && value.length > 0
      && !/^[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+$/u.test(value)) {
      return error;
    }
    if (preview.mode === 'number') {
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) return error;
      const number = Number(value);
      if (!Number.isFinite(number)) return error;
      if (preview.minValue !== undefined && number < Number(preview.minValue)) return error;
      if (preview.maxValue !== undefined && number > Number(preview.maxValue)) return error;
    }
    if (preview.mode === 'absolute-number' && !/^\d+$/.test(value)) return error;
    if (preview.minLength !== undefined && length < Number(preview.minLength)) return error;
    if (preview.maxLength !== undefined && length > Number(preview.maxLength)) return error;
    return '';
  }

  function updateInputValidation(wrapper, control, message) {
    const error = wrapper.querySelector('.dialog-input-error');
    control.setAttribute('aria-invalid', message ? 'true' : 'false');
    wrapper.classList.toggle('dialog-input-has-error', Boolean(message));
    if (!error) return;
    error.textContent = message || '';
    error.hidden = !message;
  }

  function renderRuntimeAction(element, wrapper) {
    const preview = element.runtimeActionPreview;
    const dynamicFields = Array.isArray(preview.dynamicFields) ? preview.dynamicFields : [];
    const invalidFields = Array.isArray(preview.invalidFields) ? preview.invalidFields : [];
    const blocked = dynamicFields.length > 0 || invalidFields.length > 0;
    const submitIds = Array.isArray(preview.submitInputIds) ? preview.submitInputIds : [];
    const linkParameters = Array.isArray(preview.parameters) ? preview.parameters : [];
    const actionTrigger = preview.trigger || 'click';
    const hasAction = submitIds.length > 0
      || Boolean(preview.link || preview.doubleClickLink || preview.reload);
    const interactiveTrigger = actionTrigger === 'click' || actionTrigger === 'double-click';
    const hasTextLinkVisual = Boolean(preview.link || preview.doubleClickLink)
      || dynamicFields.includes('link')
      || invalidFields.includes('link');
    if (
      (element.kind === 'text' || element.kind === 'flow-text')
      && hasTextLinkVisual
    ) {
      wrapper.classList.add('text-action-link');
    }
    const state = runtimeActionStates.get(element.id) || { status: 'idle', summary: '' };

    wrapper.dataset.runtimeActionScope = 'local';
    wrapper.dataset.runtimeTrigger = actionTrigger;
    wrapper.dataset.runtimeSubmitInputs = submitIds.join(',');
    wrapper.dataset.runtimeLink = preview.link || '';
    wrapper.dataset.runtimeLinkParameters = JSON.stringify(linkParameters);
    wrapper.dataset.runtimeDoubleClickLink = preview.doubleClickLink || '';
    wrapper.dataset.runtimeReload = preview.reload === undefined ? '' : String(preview.reload);
    wrapper.dataset.runtimeDelay = preview.delay === undefined ? '' : String(preview.delay);
    wrapper.dataset.runtimeCount = preview.count === undefined ? '' : String(preview.count);
    wrapper.dataset.runtimeDelayUnit = preview.delayUnit || '';
    wrapper.dataset.runtimeActionInteractive = String(!blocked && hasAction && interactiveTrigger);
    wrapper.dataset.runtimeActionStatus = state.status || 'idle';
    if (dynamicFields.length) wrapper.dataset.runtimeActionDynamicFields = dynamicFields.join(',');
    if (invalidFields.length) wrapper.dataset.runtimeActionInvalidFields = invalidFields.join(',');

    const boundary = document.createElement('div');
    boundary.className = 'runtime-action-boundary';
    const details = [];
    if (submitIds.length) details.push(`submitInput=${submitIds.join(',')}`);
    if (preview.link) details.push(`link=${preview.link}`);
    if (linkParameters.length) details.push(`parameters=${linkParameters.join(',')}`);
    if (preview.doubleClickLink) details.push(`dblink=${preview.doubleClickLink}`);
    if (preview.reload !== undefined) details.push(`reload=${preview.reload ? 1 : 0}`);
    if (preview.delay !== undefined) details.push(`delay=${preview.delay}`);
    if (preview.count !== undefined) details.push(`count=${preview.count}`);
    if (preview.delayUnit === 'manual-unspecified') details.push('delay 单位未公开');
    if (dynamicFields.length) {
      details.push(`动态字段 ${dynamicFields.join('、')} 不借用当前值，动作已禁用`);
    }
    if (invalidFields.length) details.push(`无效字段 ${invalidFields.join('、')}，动作已禁用`);
    details.push('仅本地预览，不提交服务器，不执行 @ 标签或刷新真实客户端');
    boundary.textContent = details.join('；');

    const summary = document.createElement('div');
    summary.className = 'runtime-action-summary';
    summary.textContent = state.summary || '';
    summary.title = state.summary || '';
    summary.hidden = !state.summary;
    wrapper.append(boundary, summary);

    const ownsHitArea = !element.togglePreview
      && !element.menuPreview
      && !element.sliderPreview
      && !element.inputPreview;
    if (!ownsHitArea || !hasAction || !interactiveTrigger) return;

    // A disabled full-size button still wins elementFromPoint() and prevents
    // the canvas wrapper from receiving selection/drag events. A blocked
    // runtime action therefore has no hit area at all; action safety and
    // coordinate editability are independent contracts.
    if (blocked) return;

    bindRuntimeActionToWrapper(element, wrapper, actionTrigger);

    const hit = document.createElement('button');
    hit.type = 'button';
    hit.className = 'runtime-action-hitarea';
    hit.dataset.runtimeTrigger = actionTrigger;
    hit.setAttribute('aria-label', '模拟本地点击动作');
    const stop = event => {
      event.preventDefault();
      event.stopPropagation();
    };
    hit.addEventListener('mousedown', stop);
    hit.addEventListener('click', event => {
      stop(event);
      simulateRuntimeAction(element, wrapper, 'click');
    });
    hit.addEventListener('dblclick', event => {
      stop(event);
      simulateRuntimeAction(element, wrapper, 'double-click');
    });
    wrapper.appendChild(hit);
  }

  function bindRuntimeActionToWrapper(element, wrapper, actionTrigger) {
    const invoke = (event, trigger) => {
      if (consumeSuppressedRuntimeActionClick(element.id)) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      simulateRuntimeAction(element, wrapper, trigger);
    };
    if (actionTrigger === 'double-click') {
      wrapper.addEventListener('dblclick', event => invoke(event, 'double-click'));
    } else {
      wrapper.addEventListener('click', event => invoke(event, 'click'));
    }
    wrapper.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      invoke(event, actionTrigger === 'double-click' ? 'double-click' : 'click');
    });
  }

  function consumeSuppressedRuntimeActionClick(elementId) {
    const suppressed = suppressedRuntimeActionClick;
    if (!suppressed) return false;
    suppressedRuntimeActionClick = null;
    return suppressed.id === elementId && performance.now() <= suppressed.until;
  }

  function simulateRuntimeAction(element, wrapper, trigger) {
    captureVisibleInputValues();
    const preview = element.runtimeActionPreview || {};
    const values = [];
    for (const id of preview.submitInputIds || []) {
      values.push(`${id}=${visibleInputValue(id)}`);
    }
    const link = trigger === 'double-click'
      ? preview.doubleClickLink || preview.link
      : preview.link;
    if (link) values.push(`${link}（仅本地预览，不执行服务器脚本）`);
    if (Array.isArray(preview.parameters) && preview.parameters.length) {
      values.push(`parameters=${preview.parameters.join(',')}（仅展示，不提交 SCRIPTPARAM）`);
    }
    if (preview.reload) values.push('reload=1（仅本地预览，不刷新客户端）');
    if (preview.delay !== undefined) {
      values.push(`delay=${preview.delay}（单位未公开，不启动自动服务器动作）`);
    }
    if (preview.count !== undefined) values.push(`count=${preview.count}（仅展示）`);
    if (values.length === 0) values.push('仅本地预览，不执行服务器动作');
    const state = { status: 'simulated', summary: values.join('；') };
    runtimeActionStates.set(element.id, state);
    wrapper.dataset.runtimeActionStatus = state.status;
    const summary = wrapper.querySelector('.runtime-action-summary');
    if (summary) {
      summary.textContent = state.summary;
      summary.hidden = false;
    }
  }

  function simulateTypedRuntimeAction(element, wrapper, trigger) {
    const preview = element.runtimeActionPreview;
    if (!preview || preview.trigger !== trigger) return;
    if (preview.dynamicFields?.length || preview.invalidFields?.length) return;
    if (trigger === 'completion' && runtimeActionStates.get(element.id)?.status === 'simulated') {
      return;
    }
    simulateRuntimeAction(element, wrapper, trigger);
  }

  function captureVisibleInputValues() {
    for (const control of elements.dialogCanvas.querySelectorAll('.dialog-input-control')) {
      const wrapper = control.closest('[data-element-id]');
      if (!wrapper) continue;
      const current = inputStates.get(wrapper.dataset.elementId)
        || { value: '', touched: false, error: '' };
      current.value = control.value;
      inputStates.set(wrapper.dataset.elementId, current);
    }
  }

  function visibleInputValue(inputId) {
    const control = elements.dialogCanvas.querySelector(
      `.dialog-input-control[data-input-id="${String(inputId)}"]`
    );
    if (control) return control.value;
    for (const scene of model?.scenes || []) {
      const input = (scene.elements || []).find(candidate => (
        candidate.inputPreview?.inputId === inputId
      ));
      if (input && inputStates.has(input.id)) return inputStates.get(input.id).value || '';
    }
    return '';
  }

  function renderDialogModelElement(element, wrapper) {
    const preview = element.modelPreview;
    const bounds = preview.bounds;
    const scale = Number(preview.scale) > 0 ? Number(preview.scale) : 1;
    wrapper.classList.add('dialog-model-preview', `dialog-model-${preview.variant}`);
    wrapper.dataset.modelCoverage = 'partial-simulation';
    wrapper.dataset.modelScale = String(scale);
    if (preview.sex !== undefined) wrapper.dataset.modelSex = String(preview.sex);
    if (preview.hairId !== undefined) wrapper.dataset.modelHairId = String(preview.hairId);
    if (preview.notShowMold !== undefined) {
      wrapper.dataset.modelNotShowMold = String(preview.notShowMold);
    }
    if (preview.notShowHair !== undefined) {
      wrapper.dataset.modelNotShowHair = String(preview.notShowHair);
    }
    if (preview.effectConfigs && Object.keys(preview.effectConfigs).length > 0) {
      wrapper.dataset.modelEffectConfigs = JSON.stringify(preview.effectConfigs);
    }
    if (preview.dynamicFields?.length) {
      wrapper.dataset.modelDynamicFields = preview.dynamicFields.join(',');
    }
    if (preview.invalidFields?.length) {
      wrapper.dataset.modelInvalidFields = preview.invalidFields.join(',');
    }
    let rendered = 0;
    for (const [index, layer] of (preview.layers || []).entries()) {
      const asset = layer.asset;
      if (asset?.status !== 'ready' || !asset.url || !bounds) continue;
      const image = createAssetImage(
        asset,
        `${layer.label} Looks ${layer.looks}`,
        'asset-image dialog-model-layer-image'
      );
      image.dataset.modelRole = layer.role;
      image.dataset.looks = String(layer.looks);
      image.style.left = `${((Number(asset.offsetX) || 0) - bounds.minX) * scale}px`;
      image.style.top = `${((Number(asset.offsetY) || 0) - bounds.minY) * scale}px`;
      image.style.width = `${Math.max(1, (Number(asset.width) || 0) * scale)}px`;
      image.style.height = `${Math.max(1, (Number(asset.height) || 0) * scale)}px`;
      image.style.zIndex = String(index + 1);
      wrapper.appendChild(image);
      rendered++;
    }
    if (rendered === 0) {
      wrapper.appendChild(createElementPlaceholder(
        preview.layers?.length
          ? 'UIModel 部件素材未缓存'
          : 'UIModel 没有可静态确定的部件'
      ));
    }

    const roleLabels = {
      cloth: '衣服', weapon: '武器', head: '头盔',
      cap: '斗笠', shield: '盾牌', veil: '面巾',
    };
    const boundaryParts = [];
    if (preview.hairId !== undefined) {
      boundaryParts.push(`发型ID ${preview.hairId}（素材映射未公开）`);
    }
    if (preview.notShowMold !== undefined) {
      boundaryParts.push(`裸模隐藏=${preview.notShowMold}`);
    }
    if (preview.notShowHair !== undefined) {
      boundaryParts.push(`头发隐藏=${preview.notShowHair}`);
    }
    for (const [role, value] of Object.entries(preview.effectConfigs || {})) {
      boundaryParts.push(`${roleLabels[role] || role}特效 ${value}（素材表与层级未公开）`);
    }
    if (preview.dynamicFields?.length) {
      boundaryParts.push(`动态 ${preview.dynamicFields.join('、')}`);
    }
    if (preview.invalidFields?.length) {
      boundaryParts.push(`无效 ${preview.invalidFields.join('、')}`);
    }
    if (boundaryParts.length === 0) {
      boundaryParts.push('裸模、头发与完整内观动画映射未公开');
    }
    const boundary = document.createElement('div');
    boundary.className = 'dialog-model-boundary';
    boundary.textContent = boundaryParts.join(' · ');
    boundary.title = `Partial simulation：${boundaryParts.join('；')}`;
    wrapper.appendChild(boundary);
  }

  function renderMonsterElement(element, wrapper) {
    const preview = element.monsterPreview;
    wrapper.classList.add(
      'dialog-monster-preview',
      `dialog-monster-${preview.variant}`,
      `dialog-monster-${preview.status}`
    );
    wrapper.dataset.monsterStatus = preview.status;
    if (preview.appr !== undefined) wrapper.dataset.monsterAppr = String(preview.appr);
    if (preview.race !== undefined) wrapper.dataset.monsterRace = String(preview.race);
    if (preview.raceImg !== undefined) wrapper.dataset.monsterRaceImg = String(preview.raceImg);
    if (preview.action !== undefined) wrapper.dataset.monsterAction = String(preview.action);
    if (preview.displayMode !== undefined) {
      wrapper.dataset.monsterDisplayMode = String(preview.displayMode);
    }
    if (preview.direction !== undefined) {
      wrapper.dataset.monsterDirection = String(preview.direction);
    }

    if (element.asset?.status === 'ready' && element.asset.url) {
      wrapper.appendChild(createAssetImage(
        element.asset,
        preview.message,
        'asset-image monster-preview-image'
      ));
      return;
    }

    const missingText = [element.asset?.archiveLabel, element.asset?.message]
      .filter(Boolean)
      .join(' · ') || preview.message;
    wrapper.appendChild(createElementPlaceholder(missingText));
  }

  function renderDialogImageElement(element, wrapper) {
    const preview = element.imagePreview;
    wrapper.classList.add('dialog-image-preview', `dialog-image-${preview.variant}`);
    if (preview.opacity !== undefined) wrapper.dataset.imageOpacity = String(preview.opacity);
    if (preview.gray !== undefined) wrapper.dataset.imageGray = String(preview.gray === true);
    if (preview.background === true) wrapper.dataset.imageBackground = 'true';
    if (preview.showPosition !== undefined) {
      wrapper.dataset.imageShowPosition = String(preview.showPosition);
    }
    if (preview.escapeClose !== undefined) {
      wrapper.dataset.imageEscapeClose = String(preview.escapeClose);
    }
    if (preview.movable !== undefined) wrapper.dataset.imageMove = String(preview.movable);
    if (preview.resetPosition !== undefined) wrapper.dataset.imageReset = String(preview.resetPosition);
    if (preview.loadDelay !== undefined) wrapper.dataset.imageLoadDelay = String(preview.loadDelay);
    if (preview.hideMain !== undefined) wrapper.dataset.imageHideMain = String(preview.hideMain);
    if (preview.forbidBagEquip !== undefined) {
      wrapper.dataset.imageForbidBagEquip = String(preview.forbidBagEquip);
    }
    if (preview.bagPosition !== undefined) {
      wrapper.dataset.imageBagPosition = String(preview.bagPosition);
    }
    if (preview.reload !== undefined) wrapper.dataset.imageReload = String(preview.reload);
    if (preview.layerId !== undefined) wrapper.dataset.imageLayerId = String(preview.layerId);
    if (preview.localOnly || preview.runtimeScope === 'local-only') {
      wrapper.dataset.imageRuntimeScope = 'local';
    }
    if (preview.submitIds) wrapper.dataset.imageSubmitIds = preview.submitIds;
    if (preview.link) wrapper.dataset.imageLink = preview.link;
    if (preview.defaultFields?.length) {
      wrapper.dataset.imageDefaultFields = preview.defaultFields.join(',');
    }
    if (preview.dynamicFields?.length) {
      wrapper.dataset.imageDynamicFields = preview.dynamicFields.join(',');
    }
    if (preview.invalidFields?.length) {
      wrapper.dataset.imageInvalidFields = preview.invalidFields.join(',');
    }
    if (preview.scale9) {
      wrapper.dataset.imageScale9 = [
        preview.scale9.left,
        preview.scale9.right,
        preview.scale9.top,
        preview.scale9.bottom,
      ].join(',');
    }
    if (preview.directPathPreview) {
      wrapper.dataset.imageDirectPath = preview.directPathPreview.normalized
        || preview.directPathPreview.raw;
      wrapper.dataset.imageDirectPathStatus = preview.directPathPreview.status;
    }
    const normal = readyDialogAsset(element.asset) ? element.asset : undefined;
    const hover = readyDialogAsset(layerFor(element, 'hover')?.asset)
      ? layerFor(element, 'hover').asset : undefined;
    const pressed = readyDialogAsset(layerFor(element, 'pressed')?.asset)
      ? layerFor(element, 'pressed').asset : undefined;
    const interactive = element.kind === 'button' && hasReadyInteractiveAsset(element);
    if (interactive) {
      renderInteractiveAsset(element, wrapper);
    } else if (normal) {
      if (preview.scale9) {
        wrapper.appendChild(createDialogImageNineSlice(element, preview));
      } else {
        const image = createAssetImage(
          element.asset,
          element.token,
          'asset-image dialog-image-preview-image'
        );
        if (dialogImageUsesTargetSize(element, 'width')) {
          image.style.width = `${Math.max(1, Number(element.width) || 1)}px`;
        }
        if (dialogImageUsesTargetSize(element, 'height')) {
          image.style.height = `${Math.max(1, Number(element.height) || 1)}px`;
        }
        applyDialogImageEffects(image, preview);
        wrapper.appendChild(image);
      }
    } else if (preview.directPathPreview) {
      wrapper.appendChild(createElementPlaceholder(
        preview.directPathPreview.status === 'evidence-blocked'
          ? `Evidence-blocked：直接路径 ${preview.directPathPreview.normalized || preview.directPathPreview.raw} 的素材根目录未确认`
          : `Direct-path blocked：拒绝加载 ${preview.directPathPreview.raw}`
      ));
    } else {
      const sourceBlocked = preview.dynamicFields?.length || preview.invalidFields?.length;
      wrapper.appendChild(createElementPlaceholder(
        sourceBlocked
          ? '动态图片素材未确定'
          : element.asset?.archiveLabel || element.asset?.message || '图片素材未解析',
        '动态图片素材未确定'
      ));
    }

    if (preview.variant === 'newui-img-996pc') renderImageRuntimeBoundary(preview, wrapper);
    if (!preview.title?.text) return;
    const title = document.createElement('span');
    title.className = 'animation-title image-title';
    title.textContent = preview.title.text;
    title.style.color = preview.title.color;
    title.dataset.imageTitleColorValue = preview.title.colorValue;
    wrapper.dataset.imageTitleOffsetX = String(preview.title.offsetX);
    wrapper.dataset.imageTitleOffsetY = String(preview.title.offsetY);
    wrapper.dataset.imageTitleColorValue = preview.title.colorValue;
    wrapper.dataset.imageTitleColor = preview.title.color;
    const placeTitle = asset => {
      const imageX = Number(asset?.offsetX) || 0;
      const imageY = Number(asset?.offsetY) || 0;
      title.style.left = `${imageX + Number(preview.title.offsetX || 0)}px`;
      title.style.top = `${imageY + Number(preview.title.offsetY || 0)}px`;
    };
    placeTitle(normal || hover || pressed);
    wrapper.appendChild(title);

    if (interactive) {
      // Keep the documented title offset relative to the currently drawn
      // IMGEX state. These listeners are registered after renderInteractiveAsset,
      // so both image pixels and title position move to the same state.
      wrapper.addEventListener('mouseenter', () => placeTitle(hover || normal));
      wrapper.addEventListener('mouseleave', () => placeTitle(normal));
      wrapper.addEventListener('mousedown', () => placeTitle(pressed || hover || normal));
      wrapper.addEventListener('mouseup', () => placeTitle(hover || normal));
    }
  }

  function renderImageRuntimeBoundary(preview, wrapper) {
    const defaultFields = Array.isArray(preview.defaultFields) ? preview.defaultFields : [];
    const dynamicFields = Array.isArray(preview.dynamicFields) ? preview.dynamicFields : [];
    const invalidFields = Array.isArray(preview.invalidFields) ? preview.invalidFields : [];
    const boundary = document.createElement('div');
    boundary.className = 'image-runtime-boundary';
    const details = [
      '仅本地预览和展示，不执行或控制真实客户端的 ESC、移动、重置、隐藏、背包限制、reload、延迟加载及窗口层动作',
    ];
    if (defaultFields.length) details.push(`默认/未填写字段：${defaultFields.join('、')}`);
    if (dynamicFields.length) {
      details.push(`动态/运行时字段：${dynamicFields.join('、')}，不借用当前值`);
    }
    if (invalidFields.length) details.push(`无效字段：${invalidFields.join('、')}，不钳制或强制转换`);
    if (preview.directPathPreview?.status === 'evidence-blocked') {
      details.push(`Evidence-blocked：直接路径 ${preview.directPathPreview.normalized} 的 public 根目录和加载规则未公开`);
    } else if (preview.directPathPreview) {
      details.push(`Direct-path blocked：拒绝路径穿越或不可信路径 ${preview.directPathPreview.raw}`);
    }
    boundary.textContent = details.join('；');
    wrapper.appendChild(boundary);
  }

  function createDialogImageNineSlice(element, preview) {
    const asset = element.asset;
    const targetWidth = Math.max(1, Number(element.width) || Number(asset.width) || 1);
    const targetHeight = Math.max(1, Number(element.height) || Number(asset.height) || 1);
    const [sourceLeft, sourceRight] = fitSlicePair(
      preview.scale9.left,
      preview.scale9.right,
      Number(asset.width)
    );
    const [sourceTop, sourceBottom] = fitSlicePair(
      preview.scale9.top,
      preview.scale9.bottom,
      Number(asset.height)
    );
    const [targetLeft, targetRight] = fitSlicePair(sourceLeft, sourceRight, targetWidth);
    const [targetTop, targetBottom] = fitSlicePair(sourceTop, sourceBottom, targetHeight);
    const layer = document.createElement('span');
    layer.className = 'dialog-image-nine-slice';
    layer.setAttribute('role', 'img');
    layer.setAttribute('aria-label', asset.archiveLabel || element.token);
    layer.style.left = `${Number(asset.offsetX) || 0}px`;
    layer.style.top = `${Number(asset.offsetY) || 0}px`;
    layer.style.width = `${targetWidth}px`;
    layer.style.height = `${targetHeight}px`;
    layer.style.borderStyle = 'solid';
    layer.style.borderColor = 'transparent';
    layer.style.borderWidth = `${targetTop}px ${targetRight}px ${targetBottom}px ${targetLeft}px`;
    layer.style.borderImageSource = `url(${JSON.stringify(String(asset.url))})`;
    layer.style.borderImageSlice = `${sourceTop} ${sourceRight} ${sourceBottom} ${sourceLeft} fill`;
    layer.style.borderImageWidth = `${targetTop}px ${targetRight}px ${targetBottom}px ${targetLeft}px`;
    layer.style.borderImageRepeat = 'stretch';
    applyDialogImageEffects(layer, preview);
    return layer;
  }

  function fitSlicePair(first, second, maximum) {
    let start = Math.max(0, Number(first) || 0);
    let end = Math.max(0, Number(second) || 0);
    const limit = Number(maximum);
    if (Number.isFinite(limit) && limit >= 0 && start + end > limit && start + end > 0) {
      const ratio = limit / (start + end);
      start *= ratio;
      end *= ratio;
    }
    return [start, end];
  }

  function applyDialogImageEffects(node, preview) {
    if (Number.isFinite(Number(preview.opacity))) {
      node.style.opacity = String(Number(preview.opacity) / 255);
    }
    if (preview.gray === true) node.style.filter = 'grayscale(1)';
  }

  function dialogImageUsesTargetSize(element, axis) {
    const mode = element.sizePreview?.[axis]?.mode;
    return mode === 'explicit' || mode === 'percent';
  }

  function renderImageTextElement(element, wrapper) {
    const preview = element.imageTextPreview;
    wrapper.classList.add('image-text-preview', `image-text-${preview.mode}`);
    renderImageTextGlyphs(preview, wrapper);
    if (preview.textAtlasVariant) renderTextAtlasBoundary(preview, wrapper);
    wrapper.setAttribute('aria-label', `${element.description}；${preview.value}`);
    if (element.countdownPreview) {
      bindCountdownRuntime(element, wrapper, value => {
        const runtimePreview = imageTextPreviewForValue(preview, value);
        for (const node of wrapper.querySelectorAll(
          '.image-text-atlas-cell, .image-text-glyph-image, .image-text-glyph-placeholder, .image-text-value-fallback'
        )) {
          node.remove();
        }
        delete wrapper.dataset.imageTextFallback;
        renderImageTextGlyphs(runtimePreview, wrapper);
        const size = imageTextVisualSize(runtimePreview);
        if (size) {
          wrapper.style.width = `${Math.max(1, size.width)}px`;
          wrapper.style.height = `${Math.max(1, size.height)}px`;
        }
        wrapper.setAttribute('aria-label', `${element.description}；${value}`);
      });
    }
  }

  function renderTextAtlasBoundary(preview, wrapper) {
    const dynamicFields = Array.isArray(preview.dynamicFields) ? preview.dynamicFields : [];
    const invalidFields = Array.isArray(preview.invalidFields) ? preview.invalidFields : [];
    const contract = preview.assetContract || 'unverified';
    const state = dynamicFields.length ? 'dynamic'
      : invalidFields.length ? 'invalid'
        : contract === 'mismatch' ? 'mismatch'
          : contract === 'unavailable' ? 'unavailable'
            : contract === 'blocked' ? 'blocked'
              : contract === 'matched' ? 'matched' : 'static';
    wrapper.dataset.imageTextVariant = preview.textAtlasVariant;
    wrapper.dataset.imageTextState = state;
    wrapper.dataset.imageTextAssetContract = contract;
    if (dynamicFields.length) wrapper.dataset.imageTextDynamicFields = dynamicFields.join(',');
    if (invalidFields.length) wrapper.dataset.imageTextInvalidFields = invalidFields.join(',');

    const boundary = document.createElement('div');
    boundary.className = 'image-text-field-boundary image-text-runtime-boundary';
    if (state === 'dynamic') {
      boundary.textContent = `TextAtlas 动态字段 ${dynamicFields.join('、')}：不借用 MOV 当前值，不按表达式长度伪造几何`;
    } else if (state === 'invalid') {
      boundary.textContent = `TextAtlas 无效字段 ${invalidFields.join('、')}：不猜素材，不使用 12/16 像素默认值`;
    } else if (state === 'mismatch') {
      boundary.textContent = `TextAtlas 素材合同不匹配：${preview.assetContractMessage || '整图尺寸与 10 个数字格不一致'}`;
    } else if (state === 'unavailable') {
      boundary.textContent = `TextAtlas 素材不可用：${preview.assetContractMessage || '本地缓存未解析'}`;
    } else if (state === 'blocked') {
      boundary.textContent = `TextAtlas 绘制已阻止：${preview.assetContractMessage || '字段合同不完整'}`;
    } else if (contract === 'matched') {
      boundary.textContent = `TextAtlas 静态素材合同已验证：${preview.assetContractMessage || '按真实素材绘制'}`;
    } else {
      boundary.textContent = 'TextAtlas 静态字段已解析；素材尺寸尚待 Provider 验证';
    }
    wrapper.appendChild(boundary);
  }

  function imageTextPreviewForValue(preview, value) {
    const bank = new Map((preview.glyphBank || []).map(glyph => [glyph.character, glyph]));
    return {
      ...preview,
      value,
      glyphs: [...String(value)].map(character => {
        const glyph = bank.get(character);
        return glyph ? { ...glyph, character } : { character };
      }),
    };
  }

  function renderImageTextGlyphs(preview, wrapper) {
    let cursor = 0;
    const firstReadyWidth = (preview.glyphs || []).find(glyph => (
      glyph.asset?.status === 'ready' && Number(glyph.asset.width) > 0
    ))?.asset?.width;
    if (preview.mode === 'atlas') {
      const glyphWidth = Number(preview.glyphWidth);
      const glyphHeight = Number(preview.glyphHeight);
      if (!Number.isSafeInteger(glyphWidth) || glyphWidth <= 0
        || !Number.isSafeInteger(glyphHeight) || glyphHeight <= 0) {
        const value = (preview.glyphs || []).map(glyph => glyph.character).join('')
          || String(preview.value ?? '0');
        const fallback = document.createElement('span');
        fallback.className = 'image-text-value-fallback';
        fallback.dataset.previewValue = value;
        fallback.textContent = value;
        wrapper.dataset.imageTextFallback = 'plain-text';
        wrapper.appendChild(fallback);
        return;
      }
    }
    for (const glyph of preview.glyphs || []) {
      const asset = glyph.asset;
      if (preview.mode === 'atlas') {
        const glyphWidth = Number(preview.glyphWidth);
        const glyphHeight = Number(preview.glyphHeight);
        const sourceX = Number(glyph.sourceX);
        const canCrop = asset?.status === 'ready' && asset.url
          && Number.isSafeInteger(sourceX) && sourceX >= 0
          && Number(asset.width) === glyphWidth * 10
          && Number(asset.height) === glyphHeight
          && sourceX + glyphWidth <= Number(asset.width)
          && preview.assetContract !== 'mismatch'
          && preview.assetContract !== 'blocked';
        if (canCrop) {
          const cell = document.createElement('span');
          cell.className = 'image-text-atlas-cell';
          cell.dataset.character = glyph.character;
          cell.style.left = `${cursor}px`;
          cell.style.top = '0px';
          cell.style.width = `${glyphWidth}px`;
          cell.style.height = `${glyphHeight}px`;
          cell.style.overflow = 'hidden';
          const image = createAssetImage(
            asset,
            glyph.character,
            'asset-image image-text-glyph-image image-text-atlas-sheet'
          );
          image.dataset.character = glyph.character;
          image.style.left = `${(Number(asset.offsetX) || 0) - sourceX}px`;
          image.style.top = `${Number(asset.offsetY) || 0}px`;
          cell.appendChild(image);
          wrapper.appendChild(cell);
        } else {
          const fallback = document.createElement('span');
          fallback.className = 'image-text-glyph-placeholder';
          fallback.dataset.character = glyph.character;
          fallback.textContent = glyph.character;
          fallback.style.left = `${cursor}px`;
          fallback.style.width = `${glyphWidth}px`;
          fallback.style.height = `${glyphHeight}px`;
          wrapper.appendChild(fallback);
        }
        cursor += glyphWidth + Number(preview.gap || 0);
        continue;
      }
      if (preview.textAtlasVariant === 'legacy-individual'
        && !(asset?.status === 'ready' && asset.url && Number(asset.width) > 0 && Number(asset.height) > 0)) {
        break;
      }
      const glyphWidth = Number(asset?.width) || Number(preview.glyphWidth)
        || Number(firstReadyWidth) || 12;
      if (asset?.status === 'ready' && asset.url) {
        const image = createAssetImage(
          asset,
          glyph.character,
          'asset-image image-text-glyph-image'
        );
        image.dataset.character = glyph.character;
        image.style.left = `${cursor + (Number(asset.offsetX) || 0)}px`;
        image.style.top = `${Number(asset.offsetY) || 0}px`;
        wrapper.appendChild(image);
      } else {
        const fallback = document.createElement('span');
        fallback.className = 'image-text-glyph-placeholder';
        fallback.dataset.character = glyph.character;
        fallback.textContent = glyph.character;
        fallback.style.left = `${cursor}px`;
        fallback.style.width = `${glyphWidth}px`;
        wrapper.appendChild(fallback);
      }
      cursor += glyphWidth + Number(preview.gap || 0);
    }
  }

  function renderStyledTextElement(element, wrapper) {
    const preview = element.textPreview;
    const localPreviewValue = localTextPreviewValue(element);
    const label = document.createElement('span');
    label.className = 'element-text styled-text-preview';
    if (preview.gray) wrapper.classList.add('gray');
    if (preview.color) label.style.color = preview.color;
    if (Number.isFinite(Number(preview.fontSize))) {
      label.style.fontSize = `${Number(preview.fontSize)}px`;
    }
    if (preview.fontFamily) {
      label.style.fontFamily = preview.fontFamily;
      label.dataset.fontFamilySource = preview.fontFamily;
    }
    if (preview.bold === true) label.style.fontWeight = '700';
    else if (preview.bold === false) label.style.fontWeight = '400';
    if (Number.isFinite(Number(preview.outlineWidth))) {
      label.style.webkitTextStrokeWidth = `${Math.max(0, Number(preview.outlineWidth))}px`;
    }
    if (preview.outlineColor) label.style.webkitTextStrokeColor = preview.outlineColor;
    label.style.textAlign = preview.align === 'center' ? 'center' : 'left';
    if (preview.align === 'center') label.style.width = '100%';
    const sourceLines = Array.isArray(preview.lines) ? preview.lines : [];
    const templateRun = sourceLines.flat().find(run => run && typeof run === 'object') || {};
    const displayLines = localPreviewValue === null
      ? sourceLines
      : String(localPreviewValue).split(/\r?\n/).map(text => [{ ...templateRun, text }]);
    if (localPreviewValue !== null) {
      wrapper.dataset.localTextPreview = 'true';
    }
    for (const line of displayLines) {
      const lineNode = document.createElement('span');
      lineNode.className = 'styled-text-line';
      for (const run of line || []) {
        const runNode = document.createElement('span');
        runNode.textContent = run.text || '';
        if (run.color) runNode.style.color = run.color;
        const runColorFrames = Array.isArray(run.colorFrames)
          ? run.colorFrames.filter(color => typeof color === 'string' && color) : [];
        const runColorIntervalMs = positiveNumber(run.colorIntervalMs);
        if (runColorFrames.length > 0) {
          let runColorIndex = 0;
          runNode.style.color = runColorFrames[runColorIndex];
          runNode.dataset.textColors = runColorFrames.join(',');
          if (Array.isArray(run.colorValues)) {
            runNode.dataset.textColorValues = run.colorValues.join(',');
          }
          runNode.dataset.textColorIntervalMs = String(runColorIntervalMs || 1000);
          runNode.dataset.textColorIndex = String(runColorIndex);
          if (runColorFrames.length > 1 && runColorIntervalMs) {
            const timer = window.setInterval(() => {
              runColorIndex = (runColorIndex + 1) % runColorFrames.length;
              runNode.style.color = runColorFrames[runColorIndex];
              runNode.dataset.textColorIndex = String(runColorIndex);
            }, runColorIntervalMs);
            animationTimers.push(timer);
          }
        }
        lineNode.appendChild(runNode);
      }
      label.appendChild(lineNode);
    }

    const scrollWidth = positiveNumber(preview.scrollWidth);
    const scrollHeight = positiveNumber(preview.scrollHeight);
    const scrollDirection = Number(preview.scrollDirection);
    const scrollDurationMs = positiveNumber(preview.scrollDurationMs);
    let parent = wrapper;
    if (scrollWidth || scrollHeight) {
      wrapper.classList.add('text-scroll-preview');
      wrapper.style.overflow = 'hidden';
      if (scrollWidth) wrapper.dataset.textScrollWidth = String(scrollWidth);
      if (scrollHeight) wrapper.dataset.textScrollHeight = String(scrollHeight);
      const viewport = document.createElement('span');
      viewport.className = 'text-scroll-viewport';
      viewport.style.width = scrollWidth ? `${scrollWidth}px` : '100%';
      viewport.style.height = scrollHeight ? `${scrollHeight}px` : '100%';
      wrapper.appendChild(viewport);
      parent = viewport;
    }
    if (scrollDirection === 0 || scrollDirection === 1) {
      wrapper.dataset.textScrollDirection = String(scrollDirection);
    }
    if (scrollDurationMs) wrapper.dataset.textScrollDurationMs = String(scrollDurationMs);
    const canScroll = scrollWidth && scrollHeight && scrollDurationMs
      && (scrollDirection === 0 || scrollDirection === 1);
    if (canScroll) {
      label.classList.add('text-scroll-content');
    }

    const colorFrames = Array.isArray(preview.colorFrames)
      ? preview.colorFrames.filter(color => typeof color === 'string' && color) : [];
    const colorIntervalMs = positiveNumber(preview.colorIntervalMs);
    if (colorFrames.length > 1 && colorIntervalMs) {
      let colorIndex = 0;
      label.style.color = colorFrames[colorIndex];
      wrapper.dataset.textColors = colorFrames.join(',');
      if (Array.isArray(preview.colorValues)) {
        wrapper.dataset.textColorValues = preview.colorValues.join(',');
      }
      wrapper.dataset.textColorIntervalMs = String(colorIntervalMs);
      wrapper.dataset.textColorIndex = String(colorIndex);
      // The documented interval is 1s. Starting at the first entry and wrapping
      // in source order makes the otherwise undocumented phase deterministic.
      const timer = window.setInterval(() => {
        colorIndex = (colorIndex + 1) % colorFrames.length;
        label.style.color = colorFrames[colorIndex];
        wrapper.dataset.textColorIndex = String(colorIndex);
      }, colorIntervalMs);
      animationTimers.push(timer);
    }
    parent.appendChild(label);
    if (element.countdownPreview) {
      bindCountdownRuntime(element, wrapper, value => {
        label.textContent = value;
      });
    }
    if (canScroll) {
      startTextScrollPreview(
        label,
        wrapper,
        scrollDirection,
        scrollWidth,
        scrollHeight,
        scrollDurationMs
      );
    }
    renderTextFieldBoundary(preview, wrapper);
  }

  function renderTextFieldBoundary(preview, wrapper) {
    const dynamicFields = Array.isArray(preview.dynamicFields) ? preview.dynamicFields : [];
    const invalidFields = Array.isArray(preview.invalidFields) ? preview.invalidFields : [];
    if (!dynamicFields.length && !invalidFields.length) return;
    wrapper.dataset.textFieldState = dynamicFields.length && invalidFields.length
      ? 'mixed' : dynamicFields.length ? 'dynamic' : 'invalid';
    if (dynamicFields.length) wrapper.dataset.textDynamicFields = dynamicFields.join(',');
    if (invalidFields.length) wrapper.dataset.textInvalidFields = invalidFields.join(',');
    const boundary = document.createElement('div');
    boundary.className = 'text-field-boundary';
    const details = [];
    if (dynamicFields.length) {
      details.push(`动态字段 ${dynamicFields.join('、')} 不借用 MOV 当前值`);
    }
    if (invalidFields.length) {
      details.push(`无效字段 ${invalidFields.join('、')} 不钳制、不转换，也不生成伪造样式`);
    }
    boundary.textContent = details.join('；');
    wrapper.appendChild(boundary);
  }

  function positiveNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }

  function startTextScrollPreview(label, wrapper, direction, width, height, durationMs) {
    const tickMs = 40;
    const contentExtent = direction === 0
      ? Math.max(1, label.offsetWidth) : Math.max(1, label.offsetHeight);
    const viewportExtent = direction === 0 ? width : height;
    const distance = viewportExtent + contentExtent;
    const startTime = performance.now();
    wrapper.dataset.textScrollTickMs = String(tickMs);
    const update = () => {
      const elapsed = Math.max(0, performance.now() - startTime);
      const progress = (elapsed % durationMs) / durationMs;
      const offset = viewportExtent - distance * progress;
      label.style.transform = direction === 0
        ? `translateX(${offset}px)` : `translateY(${offset}px)`;
      wrapper.dataset.textScrollOffset = String(offset);
    };
    // The manual documents direction and total seconds, but not exact endpoints,
    // easing, or repetition. A full linear loop is an explicit preview convention.
    update();
    const timer = window.setInterval(update, tickMs);
    animationTimers.push(timer);
  }

  function bindCountdownRuntime(element, wrapper, renderValue) {
    const preview = element.countdownPreview;
    const blockedDynamic = preview.dynamicFields?.some(field => (
      field === 'seconds' || field === 'repeat' || field === 'format'
    ));
    const blockedInvalid = Boolean(preview.invalidFields?.length);
    const blocked = blockedDynamic ? 'dynamic' : blockedInvalid ? 'invalid' : '';
    wrapper.setAttribute('aria-live', 'polite');
    const boundary = document.createElement('span');
    boundary.className = 'countdown-runtime-boundary';
    boundary.textContent = preview.link
      ? `结束标签 ${preview.link} 仅由游戏客户端/服务器触发，Ctrl+F12 不执行`
      : '倒计时仅作本地时间预览，不执行客户端或服务器动作';
    wrapper.appendChild(boundary);
    if (blocked) {
      wrapper.dataset.countdownRunning = 'false';
      wrapper.dataset.countdownBlocked = blocked;
      wrapper.dataset.countdownCurrent = '?';
      wrapper.dataset.countdownCompletedLoops = '0';
      wrapper.dataset.countdownLinkPending = 'false';
      // A dynamic source blocks the timer, not the separately typed display
      // snapshot.  Keep the proven/neutral text visible while leaving all
      // runtime state stopped and unknown.
      renderValue(safeCanvasDisplayText(preview.initialText, '?'));
      return;
    }
    let state = countdownStates.get(element.id);
    if (!state && Number.isFinite(Number(preview.seconds))) {
      state = {
        startedAt: Date.now(),
        initialSeconds: Math.max(0, Math.floor(Number(preview.seconds))),
        repeatCount: preview.repeatCount,
      };
      countdownStates.set(element.id, state);
    }
    if (!state) {
      wrapper.dataset.countdownRunning = 'false';
      wrapper.dataset.countdownBlocked = 'invalid';
      wrapper.dataset.countdownCurrent = '?';
      renderValue('?');
      return;
    }
    wrapper.dataset.countdownBlocked = 'none';
    let timer = 0;
    const update = () => {
      const snapshot = countdownRuntimeSnapshot(state, Date.now());
      const text = formatCountdownRuntimeText(snapshot.current, preview.format);
      wrapper.dataset.countdownCurrent = String(snapshot.current);
      wrapper.dataset.countdownRunning = String(snapshot.running);
      wrapper.dataset.countdownCompletedLoops = String(snapshot.completedLoops);
      wrapper.dataset.countdownLinkPending = String(snapshot.ended && Boolean(preview.link));
      wrapper.dataset.countdownCycle = String(snapshot.cycle);
      renderValue(text);
      if (snapshot.ended) simulateTypedRuntimeAction(element, wrapper, 'completion');
      if (snapshot.ended && timer) {
        window.clearInterval(timer);
        animationTimers = animationTimers.filter(value => value !== timer);
        timer = 0;
      }
    };
    update();
    if (wrapper.dataset.countdownRunning === 'true') {
      timer = window.setInterval(update, 100);
      animationTimers.push(timer);
    }
  }

  function countdownRuntimeSnapshot(state, now) {
    const seconds = Math.max(0, Math.floor(Number(state.initialSeconds) || 0));
    const repeatValue = state.repeatCount;
    const infinite = Number(repeatValue) === 0;
    const repeatLimit = infinite ? Number.POSITIVE_INFINITY
      : Math.max(1, Math.floor(Number(repeatValue) || 1));
    if (seconds === 0) {
      return {
        current: 0,
        running: false,
        ended: !infinite,
        completedLoops: infinite ? 0 : repeatLimit,
        cycle: 0,
      };
    }
    const durationMs = seconds * 1000;
    const elapsed = Math.max(0, Number(now) - Number(state.startedAt));
    const completedLoops = Math.floor(elapsed / durationMs);
    if (!infinite && completedLoops >= repeatLimit) {
      return {
        current: 0,
        running: false,
        ended: true,
        completedLoops: repeatLimit,
        cycle: Math.max(0, repeatLimit - 1),
      };
    }
    const elapsedInCycle = elapsed - completedLoops * durationMs;
    return {
      current: Math.max(0, seconds - Math.floor(elapsedInCycle / 1000)),
      running: true,
      ended: false,
      completedLoops,
      cycle: completedLoops,
    };
  }

  function formatCountdownRuntimeText(value, format) {
    const seconds = Math.max(0, Math.floor(Number(value) || 0));
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor(seconds % 86400 / 3600);
    const totalHours = Math.floor(seconds / 3600);
    const minutes = Math.floor(seconds % 3600 / 60);
    const remainingSeconds = seconds % 60;
    const pad = part => String(part).padStart(2, '0');
    if (format === 'legacy-fixed') {
      return `${pad(totalHours)}:${pad(minutes)}:${pad(remainingSeconds)}`;
    }
    if (format === 'legacy-compact') {
      if (totalHours > 0) return `${pad(totalHours)}:${pad(minutes)}:${pad(remainingSeconds)}`;
      if (minutes > 0) return `${pad(minutes)}:${pad(remainingSeconds)}`;
      return String(remainingSeconds);
    }
    if (format === 'seconds') return String(seconds);
    if (format === 'pc-smart') {
      return days > 0
        ? `${days}天${pad(hours)}时${pad(minutes)}分`
        : `${pad(totalHours)}:${pad(minutes)}:${pad(remainingSeconds)}`;
    }
    if (format === 'pc-dhms') {
      return `${days}天${hours}时${minutes}分${remainingSeconds}秒`;
    }
    return `${seconds}秒`;
  }

  function renderToggleElement(element, wrapper) {
    const preview = element.togglePreview;
    const stateDynamic = preview.dynamicFields?.includes('checked');
    const stateInvalid = preview.invalidFields?.includes('checked');
    const stateKnown = !stateDynamic && !stateInvalid && toggleStates.has(element.id);
    const selected = layerFor(element, 'selected')?.asset;
    wrapper.classList.add('toggle-preview');
    const runtimeValue = document.createElement('span');
    runtimeValue.className = 'toggle-runtime-value';
    wrapper.appendChild(runtimeValue);
    const hit = document.createElement('button');
    hit.type = 'button';
    hit.className = 'toggle-hitarea';
    hit.setAttribute('role', 'checkbox');
    hit.dataset.toggleVariable = preview.variableName || '';
    hit.dataset.toggleInteractive = String(stateKnown);
    hit.setAttribute('aria-disabled', String(!stateKnown));
    const paint = () => {
      for (const old of wrapper.querySelectorAll('.toggle-asset-image, .toggle-state-placeholder')) {
        old.remove();
      }
      const checked = stateKnown ? toggleStates.get(element.id) === true : undefined;
      const state = checked === undefined ? 'unknown' : checked ? 'checked' : 'unchecked';
      const value = checked === undefined ? 'unknown' : checked ? '1' : '0';
      hit.dataset.toggleState = state;
      hit.dataset.toggleValue = value;
      hit.setAttribute('aria-checked', checked === undefined ? 'mixed' : String(checked));
      wrapper.classList.toggle('checked', checked === true);
      wrapper.classList.toggle('unchecked', checked === false);
      wrapper.classList.toggle('unknown', checked === undefined);
      const asset = checked === true ? selected : checked === false ? element.asset : undefined;
      let visual;
      if (asset?.status === 'ready' && asset.url) {
        visual = createAssetImage(
          asset,
          checked ? '复选框已选中' : '复选框未选中',
          'asset-image toggle-asset-image'
        );
      } else {
        visual = createElementPlaceholder(
          checked === undefined
            ? '复选框默认状态未知'
            : asset?.message || (checked ? '复选框已选中' : '复选框未选中')
        );
        visual.classList.add('toggle-state-placeholder');
      }
      wrapper.insertBefore(visual, runtimeValue);
      runtimeValue.textContent = preview.variableName
        ? `${preview.variableName}=${value}（仅本地预览，不提交服务器）`
        : `${value}（仅本地预览，不提交服务器变量）`;
    };
    hit.addEventListener('mousedown', event => {
      event.preventDefault();
      event.stopPropagation();
    });
    hit.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      selectElement(element.id);
      if (!stateKnown) return;
      toggleStates.set(element.id, !(toggleStates.get(element.id) === true));
      paint();
    });
    const dragHandle = element.editable ? document.createElement('span') : undefined;
    if (dragHandle) {
      dragHandle.className = 'toggle-drag-handle';
      dragHandle.tabIndex = 0;
      dragHandle.setAttribute('role', 'button');
      dragHandle.setAttribute('aria-label', '选择并拖动复选框；方向键微调坐标');
      dragHandle.title = '拖动复选框；选中后可用方向键微调坐标';
      dragHandle.addEventListener('focus', () => selectElement(element.id, false));
    }
    wrapper.append(hit, ...(dragHandle ? [dragHandle] : []));
    paint();
  }

  function renderMenuElement(element, wrapper) {
    const preview = element.menuPreview;
    const background = element.asset;
    const selected = layerFor(element, 'selected')?.asset;
    const arrow = layerFor(element, 'arrow')?.asset;
    const listBackground = layerFor(element, 'list-background')?.asset;
    const menuAssets = new Map([
      ['img', background],
      ['arrowimg', arrow],
      ['selectimg', selected],
      ['listimg', listBackground],
    ]);
    const menuAssetLabels = new Map([
      ['img', '菜单底图 img'],
      ['arrowimg', '箭头 arrowimg'],
      ['selectimg', '选中图 selectimg'],
      ['listimg', '列表底图 listimg'],
    ]);
    const menuAssetDiagnostics = new Map(
      (preview.assetDiagnostics || []).map(diagnostic => [diagnostic.field, diagnostic])
    );
    const expanded = expandedMenuIds.has(element.id) && (preview.items || []).length > 0;
    const runtimeSelected = menuSelections.get(element.id)
      ?? preview.selected ?? preview.items?.[0] ?? '请选择';
    wrapper.classList.add('menu-preview', preview.direction === 1 ? 'menu-up' : 'menu-down');
    wrapper.classList.toggle('menu-expanded', expanded);
    wrapper.dataset.menuItems = (preview.items || []).join('#');
    wrapper.dataset.menuItemHeight = String(preview.itemHeight);
    if (preview.maxHeight !== undefined) wrapper.dataset.menuMaxHeight = String(preview.maxHeight);
    wrapper.dataset.menuExpanded = String(expanded);
    wrapper.dataset.menuId = preview.menuId || '';
    wrapper.dataset.menuLink = preview.link || '';
    wrapper.dataset.menuSelected = runtimeSelected;
    wrapper.dataset.menuSelectionScope = 'local';

    for (const [index, field] of ['img', 'arrowimg', 'selectimg', 'listimg'].entries()) {
      const diagnostic = menuAssetDiagnostics.get(field);
      const sourceStatus = diagnostic?.sourceStatus || diagnostic?.status || 'invalid';
      const status = diagnostic?.status || sourceStatus || 'invalid';
      const suffix = `${field.charAt(0).toUpperCase()}${field.slice(1)}`;
      wrapper.dataset[`menu${suffix}Status`] = status;
      wrapper.dataset[`menu${suffix}SourceStatus`] = sourceStatus;
      wrapper.classList.add(`menu-${field}-${status}`);

      const boundary = document.createElement('span');
      boundary.className = `menu-resource-boundary menu-resource-${status}`;
      boundary.dataset.field = field;
      boundary.dataset.status = status;
      boundary.dataset.sourceStatus = sourceStatus;
      boundary.style.top = `calc(100% + ${34 + index * 16}px)`;
      const label = menuAssetLabels.get(field) || field;
      const assetReady = menuAssets.get(field)?.status === 'ready' && menuAssets.get(field)?.url;
      const explanation = status === 'default'
        ? `空值默认素材${assetReady ? '已解析并绘制' : '等待本地素材解析'}`
        : status === 'static'
          ? `显式静态素材${assetReady ? '已解析并绘制' : '等待本地素材解析'}`
          : status === 'dynamic'
            ? '运行时动态，未借用 MOV 当前值，也未冒充空值默认'
            : status === 'invalid'
              ? '显式无效，已阻止素材请求，未用空值默认替代'
              : status === 'missing'
                ? '引用合法，但本地缓存或素材环境缺失'
                : '未知素材状态，已安全阻止绘制';
      boundary.textContent = `${label}：${diagnostic?.message || explanation}`;
      wrapper.appendChild(boundary);
    }

    if (background?.status === 'ready' && background.url) {
      wrapper.appendChild(createAssetImage(
        background,
        '菜单底图',
        'asset-image menu-background-image'
      ));
    } else {
      wrapper.classList.add('menu-css-fallback');
    }
    if (selected?.status === 'ready' && selected.url) {
      wrapper.appendChild(createAssetImage(
        selected,
        '菜单选中项',
        'asset-image menu-selected-image'
      ));
    }
    if (arrow?.status === 'ready' && arrow.url) {
      const arrowImage = createAssetImage(arrow, '菜单箭头', 'asset-image menu-arrow-image');
      arrowImage.style.left = 'auto';
      arrowImage.style.right = '4px';
      arrowImage.style.top = '50%';
      arrowImage.style.transform = 'translateY(-50%)';
      wrapper.appendChild(arrowImage);
    }

    const shell = document.createElement('span');
    shell.className = 'menu-shell';
    shell.title = `菜单共 ${(preview.items || []).length} 项`;
    const value = document.createElement('span');
    value.className = 'menu-selected-value';
    value.textContent = runtimeSelected;
    if (preview.selectedColor || preview.fontColor) {
      value.style.color = preview.selectedColor || preview.fontColor;
    }
    shell.appendChild(value);
    if (!(arrow?.status === 'ready' && arrow.url)) {
      const fallbackArrow = document.createElement('span');
      fallbackArrow.className = 'menu-fallback-arrow';
      fallbackArrow.textContent = preview.direction === 1 ? '▲' : '▼';
      if (preview.fontColor) fallbackArrow.style.color = preview.fontColor;
      shell.appendChild(fallbackArrow);
    }
    wrapper.appendChild(shell);

    const runtimeValue = document.createElement('span');
    runtimeValue.className = 'menu-runtime-value';
    runtimeValue.textContent = preview.menuId
      ? `${preview.menuId}=${runtimeSelected}（仅本地预览，不提交服务器）`
      : `${runtimeSelected}（仅本地预览，不提交服务器变量）`;
    wrapper.appendChild(runtimeValue);
    if (preview.link) {
      const boundary = document.createElement('span');
      boundary.className = 'menu-action-boundary';
      boundary.textContent = `${preview.link} 仅展示，Ctrl+F12 不执行服务器脚本`;
      wrapper.appendChild(boundary);
    }

    if (expanded) {
      const itemHeight = Math.max(1, Number(preview.itemHeight) || 30);
      const contentHeight = itemHeight * preview.items.length;
      const rawMaxHeight = Number(preview.maxHeight);
      const viewportHeight = Number.isFinite(rawMaxHeight) && rawMaxHeight > 0
        ? Math.min(contentHeight, rawMaxHeight)
        : contentHeight;
      const optionList = document.createElement('span');
      optionList.className = 'menu-option-list';
      optionList.setAttribute('role', 'listbox');
      optionList.setAttribute('aria-label', '菜单选项');
      optionList.style.height = `${viewportHeight}px`;
      optionList.dataset.itemHeight = String(itemHeight);
      optionList.dataset.contentHeight = String(contentHeight);
      optionList.dataset.viewportHeight = String(viewportHeight);
      optionList.addEventListener('mousedown', event => event.stopPropagation());
      optionList.addEventListener('click', event => event.stopPropagation());

      if (listBackground?.status === 'ready' && listBackground.url) {
        const listImage = createAssetImage(
          listBackground,
          '菜单列表底图',
          'asset-image menu-list-background-image'
        );
        listImage.style.width = '100%';
        listImage.style.height = `${Math.max(viewportHeight, 1)}px`;
        listImage.style.objectFit = 'fill';
        optionList.appendChild(listImage);
      } else {
        optionList.classList.add('menu-list-css-fallback');
      }

      const optionScroll = document.createElement('span');
      optionScroll.className = 'menu-option-scroll';
      optionScroll.style.overflowY = contentHeight > viewportHeight ? 'auto' : 'hidden';
      const optionContent = document.createElement('span');
      optionContent.className = 'menu-option-content';
      optionContent.style.height = `${contentHeight}px`;
      for (const item of preview.items) {
        const option = document.createElement('span');
        const isSelected = item === runtimeSelected;
        option.className = `menu-option${isSelected ? ' selected' : ''}`;
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', String(isSelected));
        option.tabIndex = 0;
        option.style.height = `${itemHeight}px`;
        option.style.minHeight = `${itemHeight}px`;
        if (isSelected ? preview.selectedColor : preview.fontColor) {
          option.style.color = isSelected ? preview.selectedColor : preview.fontColor;
        }
        if (isSelected && selected?.status === 'ready' && selected.url) {
          const selectedImage = createAssetImage(
            selected,
            '菜单选中项',
            'asset-image menu-list-selected-image'
          );
          selectedImage.style.width = '100%';
          selectedImage.style.height = `${itemHeight}px`;
          selectedImage.style.objectFit = 'fill';
          option.appendChild(selectedImage);
        }
        const label = document.createElement('span');
        label.className = 'menu-option-label';
        label.textContent = item;
        option.appendChild(label);
        option.addEventListener('mousedown', event => {
          event.preventDefault();
          event.stopPropagation();
        });
        option.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          menuSelections.set(element.id, item);
          expandedMenuIds.delete(element.id);
          selectedElementId = element.id;
          renderScene();
          renderInspector();
        });
        option.addEventListener('keydown', event => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          option.click();
        });
        optionContent.appendChild(option);
      }
      optionScroll.appendChild(optionContent);
      optionList.appendChild(optionScroll);
      wrapper.appendChild(optionList);
    }

    const toggle = document.createElement('button');
    toggle.className = 'menu-toggle-hitarea';
    toggle.type = 'button';
    toggle.setAttribute('aria-label', expanded ? '收起菜单选项' : '展开菜单选项');
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.disabled = (preview.items || []).length === 0;
    toggle.addEventListener('mousedown', event => {
      event.preventDefault();
      event.stopPropagation();
    });
    toggle.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      if (expandedMenuIds.has(element.id)) expandedMenuIds.delete(element.id);
      else expandedMenuIds.add(element.id);
      selectedElementId = element.id;
      renderScene();
      renderInspector();
    });
    wrapper.appendChild(toggle);
  }

  function renderAnimationElement(element, wrapper) {
    const preview = element.animationPreview || {};
    const frames = Array.isArray(element.animationFrames) && element.animationFrames.length > 0
      ? element.animationFrames
      : element.asset ? [element.asset] : [];
    const readyCount = frames.filter(frame => frame?.status === 'ready' && frame.url).length;
    const missingCount = Math.max(0, frames.length - readyCount);
    const scale = Number(preview.scale) > 0 ? Number(preview.scale) : 1;
    const useOffsets = preview.offsetPolicy === 'asset'
      || (preview.offsetPolicy === 'switch' && Number(preview.repairMode) === 1);
    const minX = Number(preview.bounds?.minX) || 0;
    const minY = Number(preview.bounds?.minY) || 0;
    const finiteRepeats = Number(preview.repeatCount) > 0
      ? Math.floor(Number(preview.repeatCount)) : 0;
    const interval = Math.max(16, Number(preview.previewIntervalMs) || 100);
    const state = animationStates.get(element.id) || {
      startedAt: Date.now(), frameIndex: 0, completedLoops: 0, status: 'ready',
    };
    animationStates.set(element.id, state);

    wrapper.dataset.animationVariant = preview.variant || 'unknown';
    wrapper.dataset.animationFrameCount = String(Number(preview.frameCount) || frames.length);
    wrapper.dataset.animationSlotCount = String(frames.length);
    wrapper.dataset.animationReadyCount = String(readyCount);
    wrapper.dataset.animationMissingCount = String(missingCount);
    wrapper.dataset.animationRepeat = String(finiteRepeats);
    wrapper.dataset.animationCompletedLoops = String(Number(state.completedLoops) || 0);
    wrapper.dataset.animationIntervalMs = String(Number(preview.intervalMs) || 0);
    wrapper.dataset.animationPreviewIntervalMs = String(interval);
    wrapper.dataset.animationOffsetPolicy = preview.offsetPolicy || 'unknown';
    wrapper.dataset.animationScale = String(scale);
    wrapper.dataset.animationCompletion = preview.finiteCompletion || 'unknown';
    if (preview.drawMode !== undefined) {
      wrapper.dataset.animationDrawMode = String(preview.drawMode);
      wrapper.classList.add(`animation-draw-mode-${preview.drawMode}`);
    }
    if (preview.repairMode !== undefined) {
      wrapper.dataset.animationRepairMode = String(preview.repairMode);
    }
    if (preview.repairModeEvidence) {
      wrapper.dataset.animationRepairEvidence = preview.repairModeEvidence;
    }
    if (preview.finishHide !== undefined) {
      wrapper.dataset.animationFinishHide = String(preview.finishHide);
    }
    if (preview.finishFrame !== undefined) {
      wrapper.dataset.animationFinishFrame = String(preview.finishFrame);
      wrapper.dataset.animationFinishFrameIndexBasis = preview.finishFrameIndexBasis || 'unknown';
    }
    if (preview.finishPolicyConflict) wrapper.dataset.animationFinishPolicyConflict = 'true';
    if (preview.slowCount !== undefined) {
      wrapper.dataset.animationSlowCount = String(preview.slowCount);
    }
    if (preview.link) wrapper.dataset.animationLink = preview.link;
    if (preview.caption) wrapper.dataset.animationCaption = preview.caption;
    if (preview.submitIds) wrapper.dataset.animationSubmitIds = preview.submitIds;
    if (preview.unverifiedFields?.length) {
      wrapper.dataset.animationUnverifiedFields = preview.unverifiedFields.join(',');
    }

    const firstReady = frames.find(frame => frame?.status === 'ready' && frame.url);
    const image = firstReady
      ? createAssetImage(firstReady, element.token, 'asset-image animation-frame-image')
      : document.createElement('img');
    image.className = 'asset-image animation-frame-image';
    image.draggable = false;
    const missing = createElementPlaceholder('动画帧素材缺失');
    missing.classList.add('animation-frame-missing');
    missing.hidden = true;
    wrapper.append(image, missing);
    let titleNode = null;
    if (preview.title?.text) {
      titleNode = document.createElement('span');
      titleNode.className = 'animation-title';
      titleNode.textContent = preview.title.text;
      titleNode.style.color = preview.title.color;
      titleNode.dataset.animationTitleColorValue = preview.title.colorValue;
      wrapper.dataset.animationTitleOffsetX = String(preview.title.offsetX);
      wrapper.dataset.animationTitleOffsetY = String(preview.title.offsetY);
      wrapper.dataset.animationTitleColor = preview.title.color;
      wrapper.appendChild(titleNode);
    }

    const applyFrame = frameIndex => {
      const index = Math.max(0, Math.min(frames.length - 1, Number(frameIndex) || 0));
      const frame = frames[index];
      state.frameIndex = index;
      wrapper.dataset.animationCurrentFrame = String(index);
      wrapper.dataset.animationCompletedLoops = String(Number(state.completedLoops) || 0);
      if (frame?.status === 'ready' && frame.url) {
        const offsetX = useOffsets ? Number(frame.offsetX) || 0 : 0;
        const offsetY = useOffsets ? Number(frame.offsetY) || 0 : 0;
        image.src = frame.url;
        image.alt = frame.archiveLabel || element.token;
        image.hidden = false;
        missing.hidden = true;
        image.style.left = `${(offsetX - minX) * scale}px`;
        image.style.top = `${(offsetY - minY) * scale}px`;
        if (Number(frame.width) > 0) image.style.width = `${Number(frame.width) * scale}px`;
        if (Number(frame.height) > 0) image.style.height = `${Number(frame.height) * scale}px`;
        if (titleNode) {
          titleNode.style.left = `${(offsetX - minX + Number(preview.title.offsetX || 0)) * scale}px`;
          titleNode.style.top = `${(offsetY - minY + Number(preview.title.offsetY || 0)) * scale}px`;
        }
        wrapper.dataset.animationFrameStatus = 'ready';
        wrapper.dataset.animationFrameOffsetX = String(offsetX);
        wrapper.dataset.animationFrameOffsetY = String(offsetY);
      } else {
        image.hidden = true;
        missing.hidden = false;
        missing.textContent = frame?.message || `动画第 ${index + 1} 帧素材缺失`;
        wrapper.dataset.animationFrameStatus = frame?.status || 'missing';
        delete wrapper.dataset.animationFrameOffsetX;
        delete wrapper.dataset.animationFrameOffsetY;
      }
    };
    const complete = () => {
      const hide = preview.finiteCompletion === 'hide'
        || (preview.finiteCompletion === 'frames-policy'
          && preview.finishHide === true
          && preview.finishPolicyConflict !== true);
      state.status = hide ? 'complete-hidden' : 'complete-hold';
      wrapper.dataset.animationStatus = state.status;
      if (hide) {
        image.hidden = true;
        missing.hidden = true;
        if (titleNode) titleNode.hidden = true;
        wrapper.classList.add('animation-complete-hidden');
      }
    };
    const updateFromElapsedTime = () => {
      if (frames.length === 0) return;
      const elapsed = Math.max(0, Date.now() - Number(state.startedAt || Date.now()));
      const elapsedTicks = Math.max(0, Math.floor(elapsed / interval));
      const completionTicks = finiteRepeats > 0 ? frames.length * finiteRepeats : 0;
      if (completionTicks > 0 && elapsedTicks >= completionTicks) {
        state.completedLoops = finiteRepeats;
        state.frameIndex = Math.max(0, frames.length - 1);
        applyFrame(state.frameIndex);
        complete();
        return;
      }
      state.completedLoops = frames.length > 0 ? Math.floor(elapsedTicks / frames.length) : 0;
      state.status = 'playing';
      wrapper.dataset.animationStatus = state.status;
      applyFrame(frames.length > 0 ? elapsedTicks % frames.length : 0);
    };

    if (frames.length === 0) {
      image.hidden = true;
      missing.hidden = false;
      wrapper.dataset.animationStatus = 'missing';
      wrapper.dataset.animationCurrentFrame = '0';
      return;
    }
    if (preview.staticFirstFrameOnly) {
      state.status = 'static-first-frame';
      wrapper.dataset.animationStatus = state.status;
      applyFrame(0);
      return;
    }
    updateFromElapsedTime();
    if (String(state.status).startsWith('complete')) return;
    if (frames.length === 1 && finiteRepeats === 0) {
      state.status = 'static-single-frame';
      wrapper.dataset.animationStatus = state.status;
      return;
    }
    const timer = window.setInterval(updateFromElapsedTime, interval);
    animationTimers.push(timer);
  }

  function clearAnimationTimers() {
    for (const timer of animationTimers) window.clearInterval(timer);
    animationTimers = [];
  }

  function renderInteractiveAsset(element, wrapper) {
    const rawNormal = element.asset;
    const rawHover = layerFor(element, 'hover')?.asset;
    const rawPressed = layerFor(element, 'pressed')?.asset;
    const normal = readyDialogAsset(rawNormal) ? rawNormal : undefined;
    const hover = readyDialogAsset(rawHover) ? rawHover : undefined;
    const pressed = readyDialogAsset(rawPressed) ? rawPressed : undefined;
    const fallback = normal || hover || pressed;
    const fallbackState = normal ? 'normal' : hover ? 'hover' : 'pressed';
    const image = createAssetImage(fallback, element.token, 'asset-image interactive-asset-image');
    wrapper.dataset.interactiveFallbackState = fallbackState;
    wrapper.dataset.interactiveNormalReady = String(Boolean(normal));
    const normalPlaceholder = normal ? undefined : createElementPlaceholder(
      rawNormal?.message || '正常态素材缺失'
    );
    if (normalPlaceholder) normalPlaceholder.classList.add('interactive-normal-placeholder');
    const show = (asset, state) => {
      const current = readyDialogAsset(asset) ? asset : undefined;
      if (!current) {
        image.hidden = true;
        if (normalPlaceholder) normalPlaceholder.hidden = false;
        wrapper.dataset.interactiveState = 'normal-missing';
        return;
      }
      image.hidden = false;
      if (normalPlaceholder) normalPlaceholder.hidden = true;
      image.src = current.url;
      image.alt = current.archiveLabel || element.token;
      image.style.left = `${current.offsetX || 0}px`;
      image.style.top = `${current.offsetY || 0}px`;
      wrapper.dataset.interactiveState = state;
    };
    wrapper.appendChild(image);
    if (normalPlaceholder) wrapper.appendChild(normalPlaceholder);
    show(normal, 'normal');
    wrapper.addEventListener('mouseenter', () => show(hover || normal, hover ? 'hover' : 'normal'));
    wrapper.addEventListener('mouseleave', () => show(normal, 'normal'));
    wrapper.addEventListener('mousedown', () => show(pressed || hover || normal, pressed ? 'pressed' : hover ? 'hover' : 'normal'));
    wrapper.addEventListener('mouseup', () => show(hover || normal, hover ? 'hover' : 'normal'));
  }

  function readyDialogAsset(asset) {
    return Boolean(asset?.status === 'ready' && asset.url);
  }

  function renderAssetStateDiagnostics(element, wrapper) {
    const diagnostics = Array.isArray(element.assetStateDiagnostics)
      ? element.assetStateDiagnostics : [];
    if (!diagnostics.length) return;
    wrapper.classList.add('asset-state-aware');
    const boundary = document.createElement('div');
    boundary.className = 'asset-state-boundary';
    boundary.setAttribute('aria-label', '状态素材诊断');
    for (const diagnostic of diagnostics) {
      const role = String(diagnostic.role || 'unknown');
      const status = String(diagnostic.status || 'missing');
      wrapper.setAttribute(`data-asset-state-${role}`, status);
      const line = document.createElement('div');
      line.className = `asset-state-diagnostic asset-state-${status}`;
      line.dataset.assetStateRole = role;
      line.dataset.assetStateStatus = status;
      const reference = diagnostic.assetRef;
      const source = reference
        ? `${reference.willIndex !== undefined ? `WIL ${reference.willIndex}` : reference.archiveName || reference.archiveRole || '?'} / ${reference.imageIndex}`
        : '';
      const detail = status === 'static'
        ? `静态 ${source}`
        : status === 'dynamic'
          ? '动态，不借用 MOV 当前值'
          : status === 'invalid'
            ? '无效，不推测素材'
            : '缺失，不使用 imageIndex=0 默认补图';
      line.textContent = `${role}=${status}（${detail}）`;
      boundary.appendChild(line);
    }
    wrapper.appendChild(boundary);
  }

  function hasReadyInteractiveAsset(element) {
    return readyDialogAsset(element.asset)
      || readyDialogAsset(layerFor(element, 'hover')?.asset)
      || readyDialogAsset(layerFor(element, 'pressed')?.asset);
  }

  function renderAddButtonPreview(element, wrapper) {
    const preview = element.addButtonPreview || {};
    wrapper.classList.add('addbutton-action-preview');
    wrapper.dataset.addbuttonCommand = preview.command || '';
    wrapper.dataset.addbuttonEngine = preview.engine || '';
    wrapper.dataset.addbuttonStatus = preview.status || 'partial-simulation';
    wrapper.dataset.addbuttonLocalOnly = String(preview.localOnly !== false);
    if (preview.triggerId !== undefined) {
      wrapper.dataset.addbuttonTriggerId = String(preview.triggerId);
    }
    if (preview.movable !== undefined) {
      wrapper.dataset.addbuttonMovable = String(Boolean(preview.movable));
    }
    if (preview.groupId !== undefined) {
      wrapper.dataset.addbuttonGroupId = String(preview.groupId);
    }
    if (preview.createPosition !== undefined) {
      wrapper.dataset.addbuttonCreatePosition = String(preview.createPosition);
    }
    if (preview.createPositionLabel) {
      wrapper.dataset.addbuttonCreatePositionLabel = preview.createPositionLabel;
    }
    if (Array.isArray(preview.dynamicFields) && preview.dynamicFields.length) {
      wrapper.dataset.addbuttonDynamicFields = preview.dynamicFields.join(',');
    }
    if (Array.isArray(preview.invalidFields) && preview.invalidFields.length) {
      wrapper.dataset.addbuttonInvalidFields = preview.invalidFields.join(',');
    }

    if (preview.status === 'evidence-blocked') {
      const evidence = document.createElement('div');
      evidence.className = 'addbutton-evidence-boundary';
      evidence.textContent = element.warning
        || '[Evidence-blocked] ADDBUTTONEX 方言/版本未消歧，不能套用其他引擎语法或素材';
      wrapper.appendChild(evidence);
    } else {
      renderAddButtonEffects(element, wrapper, preview.effects || []);
    }

    const deleteActions = Array.isArray(preview.deleteActions) ? preview.deleteActions : [];
    if (deleteActions.length) {
      const lifecycle = document.createElement('div');
      lifecycle.className = 'addbutton-lifecycle-boundary';
      lifecycle.dataset.addbuttonDeleteCount = String(deleteActions.length);
      lifecycle.textContent = deleteActions.map(action => {
        const id = action.buttonId === undefined ? '<dynamic>' : action.buttonId;
        const scope = action.scope === 'all-users'
          ? '全服 / all-users'
          : action.scope === 'self'
            ? '自己 / self'
            : action.scopeDynamic
              ? '动态范围'
              : '无效范围';
        return `DELBUTTON ${id} · ${scope}`;
      }).join('；') + '；仅本地展示生命周期，不执行真实客户端删除';
      wrapper.appendChild(lifecycle);
    }
  }

  function renderAddButtonEffects(element, wrapper, effects) {
    if (!Array.isArray(effects) || effects.length === 0) return;
    const layers = new Map();
    for (const effect of effects) {
      const state = effect.state || effect.role;
      if (!['normal', 'hover', 'pressed'].includes(state)) continue;
      const layer = document.createElement('div');
      layer.className = 'addbutton-effect-layer';
      layer.dataset.addbuttonEffectState = state;
      if (effect.frameCount !== undefined) {
        layer.dataset.addbuttonEffectFrameCount = String(effect.frameCount);
      }
      if (effect.frameIntervalMs !== undefined) {
        layer.dataset.addbuttonEffectInterval = String(effect.frameIntervalMs);
      }
      if (effect.drawMode !== undefined) {
        layer.dataset.addbuttonEffectDrawMode = String(effect.drawMode);
      }
      if (effect.offsetX !== undefined) {
        layer.dataset.addbuttonEffectOffsetX = String(effect.offsetX);
        layer.style.left = `${Number(effect.offsetX) || 0}px`;
      }
      if (effect.offsetY !== undefined) {
        layer.dataset.addbuttonEffectOffsetY = String(effect.offsetY);
        layer.style.top = `${Number(effect.offsetY) || 0}px`;
      }
      const frames = Array.isArray(effect.frames)
        ? effect.frames
        : Array.isArray(effect.animationFrames) ? effect.animationFrames : [];
      const firstReady = frames.find(readyDialogAsset);
      if (firstReady) {
        const image = createAssetImage(
          firstReady,
          `${element.token} ${state} 特效`,
          'asset-image addbutton-effect-image'
        );
        layer.appendChild(image);
        let frameIndex = 0;
        const showFrame = () => {
          const frame = frames[frameIndex % Math.max(1, frames.length)];
          frameIndex++;
          if (!readyDialogAsset(frame)) {
            image.hidden = true;
            layer.dataset.addbuttonEffectFrameStatus = 'missing';
            return;
          }
          image.hidden = false;
          image.src = frame.url;
          image.alt = frame.archiveLabel || `${element.token} ${state} 特效`;
          image.style.left = `${frame.offsetX || 0}px`;
          image.style.top = `${frame.offsetY || 0}px`;
          layer.dataset.addbuttonEffectFrameStatus = 'ready';
          layer.dataset.addbuttonEffectFrameIndex = String((frameIndex - 1) % frames.length);
        };
        showFrame();
        const interval = Math.max(16, Number(effect.frameIntervalMs) || 100);
        if (frames.length > 1) {
          const timer = window.setInterval(showFrame, interval);
          animationTimers.push(timer);
        }
      } else {
        const placeholder = createElementPlaceholder(`${state} 特效素材未解析`);
        placeholder.classList.add('addbutton-effect-placeholder');
        layer.appendChild(placeholder);
      }
      wrapper.appendChild(layer);
      layers.set(state, layer);
    }

    const showState = state => {
      const resolved = layers.has(state) ? state : layers.has('normal') ? 'normal' : layers.keys().next().value;
      wrapper.dataset.addbuttonEffectState = resolved || '';
      for (const [candidate, layer] of layers) layer.hidden = candidate !== resolved;
    };
    showState('normal');
    wrapper.addEventListener('mouseenter', () => showState('hover'));
    wrapper.addEventListener('mouseleave', () => showState('normal'));
    wrapper.addEventListener('mousedown', () => showState('pressed'));
    wrapper.addEventListener('mouseup', () => showState('hover'));
  }

  function renderTextButton(element, wrapper) {
    const preview = element.textPreview;
    wrapper.classList.add('button-preview');
    wrapper.dataset.buttonWidthMode = element.sizePreview?.width?.mode || 'unknown';
    wrapper.dataset.buttonHeightMode = element.sizePreview?.height?.mode || 'unknown';
    if (dialogControlUsesDeclaredSize(element, 'width')
      || dialogControlUsesDeclaredSize(element, 'height')) {
      // The manual defines width/height but does not publish an image-stretch algorithm.
      // Ctrl+F12 therefore keeps the declared hit box and clips source pixels at its edge.
      wrapper.dataset.buttonSizePolicy = 'declared-viewport-source-pixels';
    }
    if (preview.gray) wrapper.classList.add('gray');
    if (hasReadyInteractiveAsset(element)) {
      renderInteractiveAsset(element, wrapper);
    } else {
      wrapper.appendChild(createElementPlaceholder(element.asset?.message || '按钮底图'));
    }

    const caption = document.createElement('span');
    caption.className = 'button-caption';
    if (preview.color) caption.style.color = preview.color;
    if (Number.isFinite(Number(preview.fontSize))) {
      caption.style.fontSize = `${Number(preview.fontSize)}px`;
    }
    if (Number.isFinite(Number(preview.outlineWidth))) {
      caption.style.webkitTextStrokeWidth = `${Math.max(0, Number(preview.outlineWidth))}px`;
    }
    if (preview.outlineColor) caption.style.webkitTextStrokeColor = preview.outlineColor;
    caption.style.textAlign = preview.align === 'left' ? 'left' : 'center';
    for (const line of preview.lines || []) {
      const lineNode = document.createElement('span');
      lineNode.className = 'button-caption-line';
      for (const run of line || []) {
        const runNode = document.createElement('span');
        runNode.textContent = run.text || '';
        if (run.color) runNode.style.color = run.color;
        lineNode.appendChild(runNode);
      }
      caption.appendChild(lineNode);
    }
    wrapper.appendChild(caption);
    renderTextFieldBoundary(preview, wrapper);
  }

  function attachDialogTooltip(wrapper, preview) {
    if (!preview) return;
    wrapper.addEventListener('mouseenter', event => showDialogTooltip(event, preview));
    wrapper.addEventListener('mousemove', event => positionDialogTooltip(event, preview));
    wrapper.addEventListener('mouseleave', hideDialogTooltip);
    wrapper.addEventListener('mousedown', hideDialogTooltip);
  }

  function ensureDialogTooltip() {
    if (dialogTooltip) return dialogTooltip;
    dialogTooltip = document.createElement('div');
    dialogTooltip.className = 'dialog-tooltip hidden';
    dialogTooltip.setAttribute('role', 'tooltip');
    document.body.appendChild(dialogTooltip);
    return dialogTooltip;
  }

  function showDialogTooltip(event, preview) {
    const tooltip = ensureDialogTooltip();
    tooltip.textContent = '';
    tooltip.dataset.tooltipKind = preview.kind || 'text';
    tooltip.classList.toggle('item-tooltip', preview.kind === 'item');
    if (preview.kind === 'item') {
      const heading = document.createElement('strong');
      heading.textContent = '物品属性提示';
      tooltip.appendChild(heading);
      if ((preview.lines || []).length > 0) {
        appendDialogTooltipLines(tooltip, preview.lines);
      } else {
        const detail = document.createElement('span');
        detail.textContent = `IDX ${preview.itemIndex ?? '?'} · 模式 ${preview.itemMode ?? '?'}`;
        tooltip.appendChild(detail);
      }
    } else {
      appendDialogTooltipLines(tooltip, preview.lines || []);
    }
    tooltip.classList.remove('hidden');
    positionDialogTooltip(event, preview);
  }

  function appendDialogTooltipLines(tooltip, lines) {
    for (const line of lines || []) {
      const row = document.createElement('div');
      row.className = 'dialog-tooltip-line';
      if (!line.length) row.appendChild(document.createTextNode('\u00a0'));
      for (const run of line) {
        const span = document.createElement('span');
        span.textContent = run.text || '';
        if (run.color) span.style.color = run.color;
        row.appendChild(span);
      }
      tooltip.appendChild(row);
    }
  }

  function positionDialogTooltip(event, preview) {
    if (!dialogTooltip || dialogTooltip.classList.contains('hidden')) return;
    const margin = 8;
    const offsetX = 12 + (Number(preview.offsetX) || 0);
    const offsetY = 12 + (Number(preview.offsetY) || 0);
    let left = Number(event.clientX) + offsetX;
    let top = Number(event.clientY) + offsetY;
    const rect = dialogTooltip.getBoundingClientRect();
    if (left + rect.width > window.innerWidth - margin) {
      left = Math.max(margin, Number(event.clientX) - rect.width - offsetX);
    }
    if (top + rect.height > window.innerHeight - margin) {
      top = Math.max(margin, Number(event.clientY) - rect.height - offsetY);
    }
    dialogTooltip.style.left = `${Math.round(left)}px`;
    dialogTooltip.style.top = `${Math.round(top)}px`;
  }

  function hideDialogTooltip() {
    if (!dialogTooltip) return;
    dialogTooltip.classList.add('hidden');
  }

  function elementVisualSize(element) {
    if (element.itemPreview && !element.costItemPreview) {
      const scale = Number(element.itemPreview.scale) > 0
        ? Number(element.itemPreview.scale) : 1;
      const frameAsset = layerFor(element, 'background')?.asset;
      const itemAsset = layerFor(element, 'item')?.asset;
      const intrinsicWidth = Math.max(
        Number(frameAsset?.width) || 0,
        Number(itemAsset?.width) || 0
      ) * scale;
      const intrinsicHeight = Math.max(
        Number(frameAsset?.height) || 0,
        Number(itemAsset?.height) || 0
      ) * scale;
      const widthMode = element.sizePreview?.width?.mode;
      const heightMode = element.sizePreview?.height?.mode;
      const useDeclaredWidth = element.itemPreview.align === 'custom-width'
        || ['explicit', 'percent', 'derived'].includes(widthMode);
      const useDeclaredHeight = ['explicit', 'percent', 'derived'].includes(heightMode);
      return {
        width: Math.max(1, useDeclaredWidth
          ? Number(element.width) || intrinsicWidth || 40
          : intrinsicWidth || Number(element.width) || 40),
        height: Math.max(1, useDeclaredHeight
          ? Number(element.height) || intrinsicHeight || 40
          : intrinsicHeight || Number(element.height) || 40),
      };
    }
    const animationBounds = element.animationPreview?.bounds;
    const previews = (element.imageTextPreview
      ? []
      : element.costItemPreview
      ? []
      : element.itemPreview
      ? [element.asset, layerFor(element, 'background')?.asset]
      : element.menuPreview
      ? [element.asset]
      : [element.asset, ...(element.assetLayers || []).map(layer => layer.asset)])
      .filter(Boolean);
    let width = Math.max(8, Number(element.width) || 0);
    let height = Math.max(8, Number(element.height) || 0);
    if (animationBounds) {
      width = Math.max(width, Number(animationBounds.width) || 0);
      height = Math.max(height, Number(animationBounds.height) || 0);
    }
    const lockImageWidth = ((element.imagePreview || element.menuPreview)
      && dialogImageUsesTargetSize(element, 'width'))
      || (element.kind === 'button' && dialogControlUsesDeclaredSize(element, 'width'));
    const lockImageHeight = ((element.imagePreview || element.menuPreview)
      && dialogImageUsesTargetSize(element, 'height'))
      || (element.kind === 'button' && dialogControlUsesDeclaredSize(element, 'height'));
    const itemScale = element.itemPreview && Number(element.itemPreview.scale) > 0
      ? Number(element.itemPreview.scale) : 1;
    for (const preview of previews) {
      if (!lockImageWidth) width = Math.max(width, (Number(preview.width) || 0) * itemScale);
      if (!lockImageHeight) height = Math.max(height, (Number(preview.height) || 0) * itemScale);
    }
    if (element.itemPreview && !element.costItemPreview) {
      const itemAsset = layerFor(element, 'item')?.asset;
      width = Math.max(width, (Number(itemAsset?.width) || 0) * itemScale);
      height = Math.max(height, (Number(itemAsset?.height) || 0) * itemScale);
    }
    const imageTextSize = imageTextVisualSize(element.imageTextPreview);
    if (imageTextSize) {
      width = Math.max(width, imageTextSize.width);
      height = Math.max(height, imageTextSize.height);
    }
    if (element.modelPreview?.bounds) {
      width = Math.max(width, Number(element.modelPreview.bounds.width) || 0);
      height = Math.max(height, Number(element.modelPreview.bounds.height) || 0);
    }
    const costItemSize = costItemVisualSize(element);
    if (costItemSize) {
      width = Math.max(width, costItemSize.width);
      height = Math.max(height, costItemSize.height);
    }
    return { width: width || 72, height: height || 32 };
  }

  function dialogControlUsesDeclaredSize(element, axis) {
    const mode = element.sizePreview?.[axis]?.mode;
    return mode === 'explicit' || mode === 'percent';
  }

  function costItemVisualSize(element) {
    const preview = element.costItemPreview;
    if (!preview) return null;
    const fontSize = Number(preview.fontSize) > 0 ? Number(preview.fontSize) : 12;
    const scale = Number(preview.itemScale) > 0 ? Number(preview.itemScale) : 1;
    const icon = costItemIconMetrics(element, scale);
    return {
      width: Math.ceil(dialogTextPixelWidth(preview.title, fontSize)
        + icon.width
        + dialogTextPixelWidth(`/${preview.quantityText}`, fontSize)
        + 8),
      height: Math.max(Math.ceil(fontSize * 1.2), icon.height),
    };
  }

  function costItemIconMetrics(element, scale) {
    const itemAsset = layerFor(element, 'item')?.asset;
    const ready = itemAsset?.status === 'ready';
    const imageWidth = (ready && Number(itemAsset.width) > 0 ? Number(itemAsset.width) : 32) * scale;
    const imageHeight = (ready && Number(itemAsset.height) > 0 ? Number(itemAsset.height) : 32) * scale;
    const offsetX = ready ? (Number(itemAsset.offsetX) || 0) * scale : 0;
    const offsetY = ready ? (Number(itemAsset.offsetY) || 0) * scale : 0;
    const minX = Math.min(0, offsetX);
    const minY = Math.min(0, offsetY);
    const maxX = Math.max(0, offsetX + imageWidth);
    const maxY = Math.max(0, offsetY + imageHeight);
    return {
      imageWidth,
      imageHeight,
      offsetX,
      offsetY,
      imageLeft: offsetX - minX,
      imageTop: offsetY - minY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
    };
  }

  function dialogTextPixelWidth(value, fontSize) {
    let baseWidth = 0;
    for (const character of String(value || '')) {
      if (character === '\t') baseWidth += 24;
      else if (character.charCodeAt(0) <= 0xff) baseWidth += 6;
      else baseWidth += 12;
    }
    return baseWidth * fontSize / 12;
  }

  function elementCanvasBox(element, position, visualSize) {
    const size = visualSize || elementVisualSize(element);
    const preview = element.modelPreview;
    const animationPreview = element.animationPreview;
    const bounds = preview?.bounds || animationPreview?.bounds;
    if (!bounds) {
      return {
        x: position.x,
        y: position.y,
        width: Math.max(8, size.width),
        height: Math.max(8, size.height),
      };
    }
    const scale = Number((preview || animationPreview).scale) > 0
      ? Number((preview || animationPreview).scale) : 1;
    return {
      x: position.x + (Number(bounds.minX) || 0) * scale,
      y: position.y + (Number(bounds.minY) || 0) * scale,
      width: Math.max(8, size.width),
      height: Math.max(8, size.height),
    };
  }

  function applyListViewportClip(element, wrapper, canvasBox) {
    const list = nearestListViewAncestor(element);
    if (!list) return;
    const viewportPosition = positionFor(list.id, list);
    const viewport = {
      x: viewportPosition.x,
      y: viewportPosition.y,
      width: Math.max(1, Number(list.width) || 1),
      height: Math.max(1, Number(list.height) || 1),
    };
    const top = Math.max(0, viewport.y - canvasBox.y);
    const left = Math.max(0, viewport.x - canvasBox.x);
    const right = Math.max(0, canvasBox.x + canvasBox.width - (viewport.x + viewport.width));
    const bottom = Math.max(0, canvasBox.y + canvasBox.height - (viewport.y + viewport.height));
    const visibleWidth = canvasBox.width - left - right;
    const visibleHeight = canvasBox.height - top - bottom;
    const outside = visibleWidth <= 0 || visibleHeight <= 0;
    const partial = !outside && (top > 0 || right > 0 || bottom > 0 || left > 0);
    wrapper.dataset.listViewportId = list.id;
    wrapper.dataset.listClip = outside ? 'outside' : partial ? 'partial' : 'inside';
    wrapper.dataset.listClipTop = String(roundListClip(top));
    wrapper.dataset.listClipRight = String(roundListClip(right));
    wrapper.dataset.listClipBottom = String(roundListClip(bottom));
    wrapper.dataset.listClipLeft = String(roundListClip(left));
    if (outside) {
      wrapper.style.clipPath = 'inset(100%)';
    } else if (partial) {
      wrapper.style.clipPath = `inset(${roundListClip(top)}px ${roundListClip(right)}px ${roundListClip(bottom)}px ${roundListClip(left)}px)`;
    }
  }

  function nearestListViewAncestor(element) {
    const visited = new Set();
    let parentId = element.parentElementId;
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      const parent = findElement(parentId);
      if (!parent) return null;
      if (parent.containerPreview?.variant === 'list') return parent;
      parentId = parent.parentElementId;
    }
    return null;
  }

  function roundListClip(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  function imageTextVisualSize(preview) {
    if (!preview || !Array.isArray(preview.glyphs) || preview.glyphs.length === 0) return null;
    if (preview.mode === 'atlas') {
      const glyphWidth = Number(preview.glyphWidth);
      const glyphHeight = Number(preview.glyphHeight);
      if (!Number.isSafeInteger(glyphWidth) || glyphWidth <= 0
        || !Number.isSafeInteger(glyphHeight) || glyphHeight <= 0) return null;
      return {
        width: Math.max(1, glyphWidth * preview.glyphs.length
          + Number(preview.gap || 0) * Math.max(0, preview.glyphs.length - 1)),
        height: glyphHeight,
      };
    }
    if (preview.textAtlasVariant === 'legacy-individual') {
      const widths = preview.glyphs.map(glyph => Number(glyph.asset?.width));
      const heights = preview.glyphs.map(glyph => Number(glyph.asset?.height));
      if (widths.some(value => !Number.isFinite(value) || value <= 0)
        || heights.some(value => !Number.isFinite(value) || value <= 0)) return null;
      return {
        width: Math.max(1, widths.reduce((total, value) => total + value, 0)
          + Number(preview.gap || 0) * Math.max(0, preview.glyphs.length - 1)),
        height: Math.max(...heights),
      };
    }
    const readyWidths = preview.glyphs.map(glyph => Number(glyph.asset?.width) || 0);
    const fallbackWidth = Number(preview.glyphWidth)
      || readyWidths.find(value => value > 0) || 12;
    const width = readyWidths.reduce((total, value) => total + (value || fallbackWidth), 0)
      + Number(preview.gap || 0) * Math.max(0, preview.glyphs.length - 1);
    const height = Math.max(
      Number(preview.glyphHeight) || 0,
      ...preview.glyphs.map(glyph => Number(glyph.asset?.height) || 0),
      16
    );
    return { width: Math.max(1, width), height };
  }

  function createAssetImage(asset, fallbackLabel, className = 'asset-image') {
    const image = document.createElement('img');
    image.className = className;
    image.src = asset.url;
    image.alt = asset.archiveLabel || fallbackLabel;
    image.draggable = false;
    image.style.left = `${asset.offsetX || 0}px`;
    image.style.top = `${asset.offsetY || 0}px`;
    return image;
  }

  function genericElementPlaceholderText(element) {
    if (element?.imagePreview) return '图片素材未确定';
    if (element?.kind === 'image'
      || /(?:^|[-_])(?:img|image|picture)(?:$|[-_])/i.test(String(element?.statementId || ''))
      || /IMG|IMAGE|PICTURE/i.test(String(element?.token || ''))) {
      return /<\$|\$STR\s*\(/i.test(String(element?.raw || ''))
        ? '动态图片素材未确定'
        : '图片素材未确定';
    }
    if (element?.modelPreview) return '模型素材未静态确定';
    if (element?.monsterPreview) return '怪物素材未静态确定';
    if (element?.itemPreview) return '物品素材未静态确定';
    if (element?.animationPreview) return '动画素材未静态确定';
    if (element?.progressPreview) return '进度控件预览';
    if (element?.kind === 'button') return '按钮素材未静态确定';
    const description = String(element?.description || '').trim();
    return description && !/<\$|\$STR\s*\(/i.test(description)
      ? description
      : '控件预览';
  }

  function createElementPlaceholder(text, fallback = '控件预览') {
    const placeholder = document.createElement('div');
    placeholder.className = 'element-placeholder';
    placeholder.textContent = safeCanvasDisplayText(text, fallback);
    return placeholder;
  }

  function safeCanvasDisplayText(value, fallback) {
    const candidate = String(value ?? '').trim();
    return candidate && !/<\$|\$STR\s*\(/i.test(candidate)
      ? candidate
      : fallback;
  }

  function layerFor(element, role) {
    return (element.assetLayers || []).find(layer => layer.role === role) || null;
  }

  function renderCostItemElement(element, wrapper) {
    const preview = element.costItemPreview;
    const item = layerFor(element, 'item');
    const scale = Number(preview.itemScale) > 0 ? Number(preview.itemScale) : 1;
    const fontSize = Number(preview.fontSize) > 0 ? Number(preview.fontSize) : 12;
    const iconMetrics = costItemIconMetrics(element, scale);
    wrapper.classList.add('cost-item-preview');
    wrapper.dataset.costItemScale = String(scale);
    wrapper.dataset.costItemTitleSource = preview.titleUsesClientDefault ? 'client-default' : 'explicit';

    const shell = document.createElement('span');
    shell.className = 'cost-item-shell';
    const title = document.createElement('span');
    title.className = `cost-item-title${preview.titleUsesClientDefault ? ' client-default' : ''}`;
    title.textContent = preview.title;
    title.style.fontSize = `${fontSize}px`;
    if (preview.titleColor) title.style.color = preview.titleColor;
    shell.appendChild(title);

    const icon = document.createElement('span');
    icon.className = 'cost-item-icon';
    icon.dataset.assetOffsetX = String(iconMetrics.offsetX);
    icon.dataset.assetOffsetY = String(iconMetrics.offsetY);
    icon.style.width = `${iconMetrics.width}px`;
    icon.style.height = `${iconMetrics.height}px`;
    if (item?.asset?.status === 'ready' && item.asset.url) {
      const image = createAssetImage(
        item.asset,
        element.itemPreview?.label || '货币物品',
        'asset-image cost-item-image'
      );
      image.style.width = `${iconMetrics.imageWidth}px`;
      image.style.height = `${iconMetrics.imageHeight}px`;
      image.style.left = `${iconMetrics.imageLeft}px`;
      image.style.top = `${iconMetrics.imageTop}px`;
      icon.appendChild(image);
    } else {
      const placeholder = document.createElement('span');
      placeholder.className = 'cost-item-icon-placeholder';
      placeholder.textContent = '物品';
      placeholder.title = element.itemPreview?.message || '等待物品素材解析';
      icon.appendChild(placeholder);
    }
    shell.appendChild(icon);

    const quantity = document.createElement('span');
    quantity.className = 'cost-item-quantity';
    quantity.textContent = `/${preview.quantityText}`;
    quantity.style.fontSize = `${fontSize}px`;
    if (preview.quantityColor) quantity.style.color = preview.quantityColor;
    shell.appendChild(quantity);
    wrapper.appendChild(shell);
  }

  function renderItemElement(element, wrapper, size) {
    wrapper.classList.add('layered-item');
    const frame = layerFor(element, 'background');
    const item = layerFor(element, 'item');
    const preview = element.itemPreview;
    const scale = Number(preview.scale) > 0 ? Number(preview.scale) : 1;
    const frameWidth = (Number(frame?.asset?.width)
      || Number(item?.asset?.width)
      || size.width / scale) * scale;
    const frameHeight = (Number(frame?.asset?.height)
      || Number(item?.asset?.height)
      || size.height / scale) * scale;
    const contentLeft = preview.align === 'custom-width'
      ? Math.max(0, (Number(size.width) - frameWidth) / 2) : 0;
    wrapper.dataset.itemScale = String(scale);
    if (preview.align) wrapper.dataset.itemAlign = preview.align;
    if (preview.customWidth !== undefined) wrapper.dataset.itemCustomWidth = String(preview.customWidth);
    if (preview.imageSource) wrapper.dataset.itemImageSource = preview.imageSource;
    if (preview.displayTarget) wrapper.dataset.itemDisplayTarget = preview.displayTarget;
    if (preview.titleMode !== undefined) wrapper.dataset.itemTitleMode = String(preview.titleMode);
    if (preview.drawEffect !== undefined) wrapper.dataset.itemDrawEffect = String(preview.drawEffect);
    if (preview.lightCode !== undefined) wrapper.dataset.itemLightCode = String(preview.lightCode);
    if (preview.showTips !== undefined) wrapper.dataset.itemShowTips = String(preview.showTips);
    if (preview.effectShow !== undefined) wrapper.dataset.itemEffectShow = String(preview.effectShow);
    if (preview.showStar !== undefined) wrapper.dataset.itemShowStar = String(preview.showStar);
    if (preview.gray) wrapper.classList.add('item-preview-gray');
    let rendered = false;
    if (frame?.asset?.status === 'ready' && frame.asset.url) {
      const frameImage = createAssetImage(frame.asset, '物品框', 'asset-image item-frame-image');
      frameImage.style.width = `${frameWidth}px`;
      frameImage.style.height = `${frameHeight}px`;
      frameImage.style.left = `${contentLeft + (Number(frame.asset.offsetX) || 0) * scale}px`;
      frameImage.style.top = `${(Number(frame.asset.offsetY) || 0) * scale}px`;
      wrapper.appendChild(frameImage);
      rendered = true;
    }
    if (item?.asset?.status === 'ready' && item.asset.url) {
      const grayClass = preview.gray ? ' item-content-gray' : '';
      const image = createAssetImage(
        item.asset,
        preview.label,
        `asset-image item-content-image${grayClass}`
      );
      const itemWidth = (Number(item.asset.width) || 0) * scale;
      const itemHeight = (Number(item.asset.height) || 0) * scale;
      image.style.width = `${itemWidth}px`;
      image.style.height = `${itemHeight}px`;
      image.style.left = `${contentLeft + Math.round((frameWidth - itemWidth) / 2)
        + (Number(item.asset.offsetX) || 0) * scale}px`;
      image.style.top = `${Math.round((frameHeight - itemHeight) / 2)
        + (Number(item.asset.offsetY) || 0) * scale}px`;
      wrapper.appendChild(image);
      rendered = true;
    }
    if (!rendered) wrapper.appendChild(createElementPlaceholder(element.itemPreview.label));
    if (!item?.asset?.url && element.itemPreview.message) {
      const runtime = document.createElement('span');
      runtime.className = 'item-runtime-label';
      runtime.textContent = element.itemPreview.label;
      wrapper.appendChild(runtime);
    }
    if (preview.quantity !== undefined && Number.isFinite(Number(preview.quantity))) {
      const quantity = document.createElement('span');
      quantity.className = 'item-quantity';
      quantity.textContent = itemQuantityText(preview.quantity, preview.compactQuantity);
      if (preview.quantityColor) quantity.style.color = preview.quantityColor;
      wrapper.appendChild(quantity);
    }
    if (preview.showStar) {
      const star = document.createElement('span');
      star.className = 'item-runtime-star';
      star.textContent = '☆?';
      star.title = '星级取决于运行时唯一物品数据';
      wrapper.appendChild(star);
    }
    if (preview.locked) {
      const lock = document.createElement('span');
      lock.className = 'item-lock-indicator';
      lock.setAttribute('aria-label', '已锁定');
      lock.title = '已锁定（Ctrl+F12 静态近似）';
      wrapper.appendChild(lock);
    }
    const hasInteriorContract = preview.showInterior !== undefined
      || preview.dynamicFields?.includes('interior')
      || preview.invalidFields?.includes('interior');
    if (hasInteriorContract) renderCustomItemRuntimeBoundary(preview, wrapper);
    if (preview.mode === 'empty-box') renderItemBoxConstraints(element, wrapper, size);
  }

  function renderCustomItemRuntimeBoundary(preview, wrapper) {
    const dynamic = preview.dynamicFields?.includes('interior');
    const invalid = preview.invalidFields?.includes('interior');
    const state = dynamic ? 'dynamic'
      : invalid ? 'invalid'
        : preview.showInterior === true ? 'enabled' : 'disabled';
    wrapper.dataset.itemShowInterior = state;
    const boundary = document.createElement('div');
    boundary.className = 'custom-item-runtime-boundary';
    if (state === 'enabled') {
      boundary.textContent = '内观=1 已保留；真实人物/英雄装备内容依赖在线数据（Runtime-data blocked）';
    } else if (state === 'disabled') {
      boundary.textContent = '内观=0；只绘制脚本指定的装备框底图（Runtime-data blocked）';
    } else if (state === 'dynamic') {
      boundary.textContent = '内观是动态值；不借用 MOV 当前值，真实装备内容不可离线确定';
    } else {
      boundary.textContent = '内观参数无效；仅接受 0/1，不强制转换，真实装备内容不可离线确定';
    }
    wrapper.appendChild(boundary);
  }

  function renderItemBoxConstraints(element, wrapper, size) {
    const preview = element.itemPreview;
    const dynamicFields = Array.isArray(preview.dynamicFields) ? preview.dynamicFields : [];
    const invalidFields = Array.isArray(preview.invalidFields) ? preview.invalidFields : [];
    wrapper.classList.add('itembox-preview');
    if (preview.boxIndex !== undefined) wrapper.dataset.itemBoxIndex = String(preview.boxIndex);
    if (Array.isArray(preview.allowedStdModes)) {
      wrapper.dataset.itemBoxAllowedStdModes = preview.allowedStdModes.join(',');
    }
    if (preview.acceptsAnyStdMode !== undefined) {
      wrapper.dataset.itemBoxAcceptsAnyStdMode = String(preview.acceptsAnyStdMode);
    }
    wrapper.dataset.itemBoxBackground = preview.backgroundDisabled === true
      ? 'disabled' : preview.backgroundDisabled === false ? 'enabled' : 'unknown';
    wrapper.dataset.itemBoxConstraintState = dynamicFields.length
      ? 'dynamic' : invalidFields.length ? 'invalid' : 'static';
    if (dynamicFields.length) wrapper.dataset.itemBoxDynamicFields = dynamicFields.join(',');
    if (invalidFields.length) wrapper.dataset.itemBoxInvalidFields = invalidFields.join(',');

    const summary = document.createElement('div');
    summary.className = 'itembox-constraint-summary';
    const parts = [
      `OK框 ${preview.boxIndex ?? '?'}`,
      preview.acceptsAnyStdMode === true
        ? '允许全部 StdMode'
        : Array.isArray(preview.allowedStdModes)
          ? `允许 StdMode：${preview.allowedStdModes.join('、')}`
          : dynamicFields.includes('stdmode')
            ? 'StdMode 动态未知'
            : invalidFields.includes('stdmode')
              ? 'StdMode 无效'
              : 'StdMode 未指定',
      `${Math.round(Number(size.width) || 0)}×${Math.round(Number(size.height) || 0)}`,
      preview.backgroundDisabled === true
        ? '无背景'
        : preview.backgroundDisabled === false
          ? '有背景'
          : dynamicFields.includes('background')
            ? '背景动态未知，不借用当前值'
            : invalidFields.includes('background')
              ? '背景参数无效'
              : '背景状态未知',
    ];
    if (dynamicFields.length) parts.push(`动态字段：${dynamicFields.join('、')}，不借用当前值`);
    if (invalidFields.length) parts.push(`无效字段：${invalidFields.join('、')}`);
    summary.textContent = parts.join(' · ');

    const boundary = document.createElement('div');
    boundary.className = 'itembox-runtime-boundary';
    boundary.textContent = 'Runtime-data blocked：实际拖入物品、人物背包数据及服务器接受/拒绝结果无法离线模拟';
    wrapper.append(summary, boundary);
  }

  function itemQuantityText(quantity, compact) {
    const value = Number(quantity);
    if (!compact || !Number.isFinite(value) || Math.abs(value) < 10000) return String(quantity);
    const units = value / 10000;
    return `${Number.isInteger(units) ? units : units.toFixed(2).replace(/\.?0+$/, '')}W`;
  }

  function renderProgressElement(element, wrapper, size) {
    wrapper.classList.add('layered-progress');
    const sourceProgress = element.progressPreview;
    const slider = element.sliderPreview;
    const dynamicFields = Array.isArray(sourceProgress.dynamicFields)
      ? sourceProgress.dynamicFields : [];
    const invalidFields = Array.isArray(sourceProgress.invalidFields)
      ? sourceProgress.invalidFields : [];
    const sliderDynamicFields = Array.isArray(slider?.dynamicFields)
      ? slider.dynamicFields : [];
    const sliderInvalidFields = Array.isArray(slider?.invalidFields)
      ? slider.invalidFields : [];
    const progressBlocked = dynamicFields.length > 0 || sliderDynamicFields.length > 0
      ? 'dynamic'
      : invalidFields.length > 0 || sliderInvalidFields.length > 0
        ? 'invalid'
        : 'none';
    const sliderBlocked = slider && progressBlocked !== 'none' ? progressBlocked : '';
    const sliderMaximum = Number(slider?.maximum);
    const sliderMinimum = Number(slider?.minimum) || 0;
    const runtimeSliderValue = slider && sliderStates.has(element.id)
      ? Number(sliderStates.get(element.id)) : Number(slider?.initialValue);
    const sliderRatio = slider && !sliderBlocked
      && Number.isFinite(runtimeSliderValue)
      && Number.isFinite(sliderMaximum)
      && sliderMaximum > sliderMinimum
      ? Math.max(0, Math.min(1,
        (runtimeSliderValue - sliderMinimum) / (sliderMaximum - sliderMinimum)))
      : Number.isFinite(Number(sourceProgress.ratio))
        ? Number(sourceProgress.ratio)
        : undefined;
    const progress = slider && !sliderBlocked
      ? {
        ...sourceProgress,
        minimum: sliderMinimum,
        maximum: sliderMaximum,
        value: runtimeSliderValue,
        ratio: sliderRatio,
      }
      : sourceProgress;
    const background = layerFor(element, 'background');
    const fill = layerFor(element, 'progress');
    const thumb = layerFor(element, 'thumb');
    const progressFrames = (element.animationFrames || [])
      .filter(frame => frame?.status === 'ready' && frame.url);
    const requestedFrameCount = Number(progress.frameCount);
    if (Number.isFinite(requestedFrameCount) && requestedFrameCount > 0) {
      wrapper.dataset.progressFrameCount = String(Math.trunc(requestedFrameCount));
      wrapper.dataset.progressFrameReadyCount = String(progressFrames.length);
    }
    if (progress.frameInterval !== undefined) {
      wrapper.dataset.progressFrameInterval = String(progress.frameInterval);
    }
    if (dynamicFields.length > 0) {
      wrapper.dataset.progressDynamicFields = dynamicFields.join(',');
    }
    if (invalidFields.length > 0) {
      wrapper.dataset.progressInvalidFields = invalidFields.join(',');
    }
    wrapper.dataset.progressBlocked = progressBlocked;
    if (progressBlocked === 'none' && Number.isFinite(Number(progress.direction))) {
      wrapper.dataset.progressDirection = String(Number(progress.direction));
    }
    if (progressBlocked === 'none' && Number.isFinite(Number(progress.ratio))) {
      wrapper.dataset.progressRatio = String(Number(progress.ratio));
    }
    let rendered = false;
    let fillImage = null;
    let thumbImage = null;
    if (background?.asset?.status === 'ready' && background.asset.url) {
      wrapper.appendChild(createAssetImage(background.asset, '进度条底图', 'asset-image progress-background-image'));
      rendered = true;
    }
    const initialFill = progressFrames[0]
      || (fill?.asset?.status === 'ready' && fill.asset.url ? fill.asset : undefined);
    if (initialFill) {
      fillImage = createAssetImage(initialFill, '进度条图片', 'asset-image progress-fill-image');
      const showFrame = (frame, index) => {
        fillImage.src = frame.url;
        fillImage.alt = frame.archiveLabel || '进度条图片';
        fillImage.style.left = `${(frame.offsetX || 0) + (progress.offsetX || 0)}px`;
        fillImage.style.top = `${(frame.offsetY || 0) + (progress.offsetY || 0)}px`;
        fillImage.dataset.progressFrameIndex = String(index);
      };
      showFrame(initialFill, 0);
      fillImage.style.clipPath = progressClipPath(
        progress.ratio,
        progress.direction
      );
      wrapper.appendChild(fillImage);
      rendered = true;
      const frameInterval = Number(progress.frameInterval);
      const intervalDynamic = dynamicFields.includes('frame-interval');
      if (progressBlocked === 'none'
        && progressFrames.length > 1 && frameInterval > 0 && !intervalDynamic) {
        let frameIndex = 0;
        const timer = window.setInterval(() => {
          frameIndex = (frameIndex + 1) % progressFrames.length;
          showFrame(progressFrames[frameIndex], frameIndex);
        }, Math.max(16, frameInterval));
        animationTimers.push(timer);
      }
    }
    if (thumb?.asset?.status === 'ready' && thumb.asset.url) {
      thumbImage = createAssetImage(thumb.asset, '滑块球', 'asset-image slider-thumb-image');
      const trackWidth = Math.max(1, Number(element.width) || size.width);
      const trackHeight = Math.max(1, Number(element.height) || size.height);
      const thumbWidth = Number(thumb.asset.width) || 0;
      const thumbHeight = Number(thumb.asset.height) || 0;
      thumbImage.style.left = `${Math.round(
        Math.max(0, trackWidth - thumbWidth) * (Number(progress.ratio) || 0)
      ) + (thumb.asset.offsetX || 0)}px`;
      thumbImage.style.top = `${Math.round((trackHeight - thumbHeight) / 2)
        + (thumb.asset.offsetY || 0)}px`;
      wrapper.appendChild(thumbImage);
      rendered = true;
    }
    if (!rendered) wrapper.appendChild(createElementPlaceholder('进度条'));
    let caption = null;
    const displayValueSource = (element.displayValueSources || []).find(source => (
      source?.field === 'progress-value'
    ));
    const displayTextSource = (element.displayValueSources || []).find(source => (
      source?.field === 'progress-text'
    ));
    const canShowBlockedSnapshot = progressBlocked === 'dynamic'
      && progress.showCaption === true
      && Boolean(displayValueSource)
      && Number.isFinite(Number(progress.value))
      && Number.isFinite(Number(progress.maximum))
      && !dynamicFields.includes('maximum')
      && !dynamicFields.includes('minimum')
      && !invalidFields.includes('maximum')
      && !invalidFields.includes('minimum');
    const canShowBlockedTextSnapshot = progressBlocked === 'dynamic'
      && Boolean(displayTextSource)
      && typeof progress.text === 'string'
      && progress.text.length > 0;
    if ((progressBlocked === 'none' || canShowBlockedSnapshot || canShowBlockedTextSnapshot)
      && progress.showCaption !== false) {
      caption = document.createElement('span');
      caption.className = 'progress-caption';
      caption.textContent = progressCaption(progress, canShowBlockedSnapshot);
      if (canShowBlockedSnapshot || canShowBlockedTextSnapshot) {
        const typedSource = canShowBlockedTextSnapshot ? displayTextSource : displayValueSource;
        caption.dataset.progressDisplayStatus = typedSource.status || 'typed-display';
        caption.dataset.progressDisplayField = typedSource.field || '';
      }
      if (progress.captionColor) {
        caption.style.color = progress.captionColor;
      }
      if (Number.isFinite(Number(progress.fontSize)) && Number(progress.fontSize) > 0) {
        caption.style.fontSize = `${Number(progress.fontSize)}px`;
      }
      if (Number.isFinite(Number(progress.outlineWidth))) {
        caption.style.webkitTextStrokeWidth = `${Math.max(0, Number(progress.outlineWidth))}px`;
      }
      if (progress.outlineColor) caption.style.webkitTextStrokeColor = progress.outlineColor;
      const captionOffsetX = Number(progress.captionOffsetX) || 0;
      const captionOffsetY = Number(progress.captionOffsetY) || 0;
      caption.style.transform = `translate(${captionOffsetX}px, ${captionOffsetY}px)`;
      wrapper.appendChild(caption);
    }
    if (slider) {
      const control = document.createElement('button');
      control.type = 'button';
      control.className = 'slider-hitarea';
      control.setAttribute('role', 'slider');
      control.setAttribute('aria-label', '滑动拉杆本地预览');
      control.setAttribute('aria-valuemin', String(sliderMinimum));
      if (!sliderBlocked && Number.isFinite(sliderMaximum)) {
        control.setAttribute('aria-valuemax', String(sliderMaximum));
      }
      control.setAttribute('aria-disabled', String(Boolean(sliderBlocked)));
      control.dataset.sliderInteractive = String(!sliderBlocked);
      control.dataset.sliderBlocked = sliderBlocked || 'none';
      control.dataset.sliderVariable = slider.variableName || '';
      control.dataset.sliderQuantization = 'nearest-integer-preview-convention';
      const runtimeLabel = document.createElement('span');
      runtimeLabel.className = 'slider-runtime-value';
      const updateSlider = clientX => {
        if (sliderBlocked) return;
        const rect = wrapper.getBoundingClientRect();
        const ratio = rect.width > 0
          ? Math.max(0, Math.min(1, (Number(clientX) - rect.left) / rect.width)) : 0;
        const value = Math.round(sliderMinimum + ratio * (sliderMaximum - sliderMinimum));
        const normalizedRatio = (value - sliderMinimum) / (sliderMaximum - sliderMinimum);
        sliderStates.set(element.id, value);
        control.dataset.sliderValue = String(value);
        control.setAttribute('aria-valuenow', String(value));
        wrapper.dataset.sliderValue = String(value);
        if (fillImage) fillImage.style.clipPath = progressClipPath(normalizedRatio, progress.direction);
        if (thumbImage) {
          const trackWidth = Math.max(1, Number(element.width) || size.width);
          const thumbWidth = Number(thumb?.asset?.width) || 0;
          thumbImage.style.left = `${Math.round(
            Math.max(0, trackWidth - thumbWidth) * normalizedRatio
          ) + (Number(thumb?.asset?.offsetX) || 0)}px`;
        }
        if (caption) {
          caption.textContent = progressCaption({
            ...progress,
            value,
            ratio: normalizedRatio,
          });
        }
        runtimeLabel.textContent = slider.variableName
          ? `${slider.variableName}=${value}（仅本地预览，不提交服务器）`
          : `${value}（仅本地预览，不提交服务器变量）`;
        simulateTypedRuntimeAction(element, wrapper, 'change');
      };
      if (!sliderBlocked && Number.isFinite(runtimeSliderValue)) {
        control.dataset.sliderValue = String(runtimeSliderValue);
        wrapper.dataset.sliderValue = String(runtimeSliderValue);
        control.setAttribute('aria-valuenow', String(runtimeSliderValue));
        runtimeLabel.textContent = slider.variableName
          ? `${slider.variableName}=${runtimeSliderValue}（仅本地预览，不提交服务器）`
          : `${runtimeSliderValue}（仅本地预览，不提交服务器变量）`;
      } else {
        runtimeLabel.textContent = sliderBlocked === 'dynamic'
          ? '最大值或默认值为动态表达式，确定性交互已禁用'
          : '最大值或默认值无效，确定性交互已禁用';
      }
      control.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        updateSlider(event.clientX);
        selectElement(element.id);
      });
      control.addEventListener('mousedown', event => {
        event.preventDefault();
        event.stopPropagation();
        if (sliderBlocked) return;
        updateSlider(event.clientX);
        const move = moveEvent => {
          moveEvent.preventDefault();
          moveEvent.stopPropagation();
          updateSlider(moveEvent.clientX);
        };
        const up = upEvent => {
          upEvent.preventDefault();
          upEvent.stopPropagation();
          updateSlider(upEvent.clientX);
          window.removeEventListener('mousemove', move);
          window.removeEventListener('mouseup', up);
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
      });
      const dragHandle = element.editable ? document.createElement('span') : undefined;
      if (dragHandle) {
        dragHandle.className = 'slider-drag-handle';
        dragHandle.tabIndex = 0;
        dragHandle.setAttribute('role', 'button');
        dragHandle.setAttribute('aria-label', '选择并拖动滑动条；方向键微调坐标');
        dragHandle.title = '拖动滑动条；选中后可用方向键微调坐标';
        dragHandle.addEventListener('focus', () => selectElement(element.id, false));
      }
      wrapper.append(runtimeLabel, control, ...(dragHandle ? [dragHandle] : []));
    }
    if (progress.endValue !== undefined) {
      const startValue = Number(progress.value);
      const endValue = Number(progress.endValue);
      const maximum = Number(progress.maximum);
      const intervalMs = Number(progress.valueIntervalMs);
      const valueStep = Number(progress.valueStep);
      wrapper.dataset.progressStart = String(progress.value);
      wrapper.dataset.progressEnd = String(progress.endValue);
      wrapper.dataset.progressMaximum = String(progress.maximum);
      wrapper.dataset.progressValueIntervalMs = String(progress.valueIntervalMs);
      wrapper.dataset.progressValueStep = String(progress.valueStep);
      const runtimeDynamic = dynamicFields.some(field => [
        'minimum', 'maximum', 'value', 'end-value', 'value-interval', 'value-step',
      ].includes(field));
      const updateValue = (currentValue, running) => {
        const denominator = maximum - Number(progress.minimum);
        const ratio = denominator > 0
          ? Math.max(0, Math.min(1, (currentValue - Number(progress.minimum)) / denominator))
          : 0;
        wrapper.dataset.progressCurrent = String(currentValue);
        wrapper.dataset.progressRunning = String(running);
        if (fillImage) fillImage.style.clipPath = progressClipPath(ratio, progress.direction);
        if (caption) caption.textContent = progressCaption({ ...progress, value: currentValue, ratio });
      };
      const canAnimate = progressBlocked === 'none'
        && !runtimeDynamic
        && Number.isFinite(startValue)
        && Number.isFinite(endValue)
        && Number.isFinite(maximum)
        && Number.isFinite(intervalMs)
        && Number.isFinite(valueStep)
        && endValue > startValue
        && intervalMs > 0
        && valueStep > 0;
      // A typed blocked value is a caption-only snapshot.  It must not drive
      // fill clipping, thumb position, completion state, or animation.
      if (progressBlocked === 'none') updateValue(startValue, canAnimate);
      if (canAnimate) {
        let currentValue = startValue;
        const timer = window.setInterval(() => {
          currentValue = Math.min(endValue, currentValue + valueStep);
          const running = currentValue < endValue;
          updateValue(currentValue, running);
          if (!running) {
            window.clearInterval(timer);
            animationTimers = animationTimers.filter(value => value !== timer);
            simulateTypedRuntimeAction(element, wrapper, 'completion');
          }
        }, Math.max(16, intervalMs));
        animationTimers.push(timer);
      } else if (
        progressBlocked === 'none'
        && Number.isFinite(startValue)
        && Number.isFinite(endValue)
        && startValue >= endValue
      ) {
        simulateTypedRuntimeAction(element, wrapper, 'completion');
      }
    }
    if (progressBlocked !== 'none') {
      wrapper.dataset.progressRunning = 'false';
      const boundary = document.createElement('div');
      boundary.className = 'progress-runtime-boundary';
      const details = [];
      if (dynamicFields.length || sliderDynamicFields.length) {
        details.push(`动态字段 ${[...new Set([...dynamicFields, ...sliderDynamicFields])].join('、')} 不借用 MOV 当前值`);
      }
      if (invalidFields.length || sliderInvalidFields.length) {
        details.push(`无效字段 ${[...new Set([...invalidFields, ...sliderInvalidFields])].join('、')}，不能确定性绘制`);
      }
      boundary.textContent = details.join('；');
      wrapper.appendChild(boundary);
    }
  }

  function progressClipPath(ratio, direction) {
    const hidden = Math.round((1 - Math.max(0, Math.min(1, Number(ratio) || 0))) * 10000) / 100;
    if (Number(direction) === 1) return `inset(0 0 0 ${hidden}%)`;
    if (Number(direction) === 2) return `inset(0 0 ${hidden}% 0)`;
    if (Number(direction) === 3) return `inset(${hidden}% 0 0 0)`;
    return `inset(0 ${hidden}% 0 0)`;
  }

  function progressCaption(progress, useTypedSnapshot = false) {
    const minimum = Number(progress.minimum);
    const maximumNumber = Number(progress.maximum);
    const valueNumber = Number(progress.value);
    const ratioNumber = Number(progress.ratio);
    const displayRatio = Number.isFinite(ratioNumber)
      ? ratioNumber
      : useTypedSnapshot
        && Number.isFinite(valueNumber)
        && Number.isFinite(maximumNumber)
        && maximumNumber > (Number.isFinite(minimum) ? minimum : 0)
        ? (valueNumber - (Number.isFinite(minimum) ? minimum : 0))
          / (maximumNumber - (Number.isFinite(minimum) ? minimum : 0))
        : 0;
    const percent = Math.round(Math.max(0, Math.min(1, displayRatio)) * 100);
    const dynamicFields = progress.dynamicFields || [];
    const value = !useTypedSnapshot && dynamicFields.includes('value')
      ? '?' : String(progress.value);
    const maximum = !useTypedSnapshot && dynamicFields.includes('maximum')
      ? '?' : String(progress.maximum);
    const ratio = !useTypedSnapshot
      && dynamicFields.some(field => ['minimum', 'maximum', 'value'].includes(field))
      ? '?' : String(percent);
    if (progress.captionMode === 'percent') return `${ratio}%`;
    return String(progress.text || `${percent}%`)
      .replace(/%p/gi, value)
      .replace(/%m/gi, maximum)
      .replace(/%r/gi, ratio);
  }

  function renderContainerElement(element, wrapper) {
    wrapper.classList.add('container-preview', `container-${element.containerPreview.variant}`);
    if (element.containerPreview.variant === 'line-break') {
      wrapper.hidden = true;
      wrapper.setAttribute('aria-hidden', 'true');
      return;
    }
    if (element.containerPreview.variant === 'list') {
      const preview = element.containerPreview;
      const runtimeStatus = preview.interactionStatus
        || (preview.invalidFields?.length
          ? 'blocked-invalid'
          : preview.dynamicFields?.length
            ? 'blocked-dynamic'
            : preview.touchEnabled === false ? 'disabled' : 'local-only');
      const currentOffset = listScrollOffset(element);
      wrapper.dataset.listDirection = preview.direction || 'unknown';
      wrapper.dataset.listGap = String(Number(preview.gap) || 0);
      wrapper.dataset.listDefaultIndex = String(Number(preview.defaultIndex) || 0);
      wrapper.dataset.listRequestedDefaultIndex = preview.requestedDefaultIndex === undefined
        ? '' : String(preview.requestedDefaultIndex);
      wrapper.dataset.listEffectiveDefaultIndex = String(Number(
        preview.effectiveDefaultIndex ?? preview.defaultIndex
      ) || 0);
      wrapper.dataset.listRuntimeStatus = runtimeStatus;
      wrapper.dataset.listLocalOnly = preview.localOnly === false ? 'false' : 'true';
      wrapper.dataset.listScrollOffset = String(currentOffset);
      wrapper.dataset.listContentWidth = String(Number(preview.contentWidth) || 0);
      wrapper.dataset.listContentHeight = String(Number(preview.contentHeight) || 0);
      wrapper.dataset.listViewportClipped = preview.viewportClipped ? 'true' : 'false';
      wrapper.dataset.listScrollbarMode = preview.scrollbarMode || 'none';
      wrapper.dataset.listTouchEnabled = preview.touchEnabled === undefined
        ? 'unknown' : String(preview.touchEnabled);
      wrapper.dataset.listDynamicFields = (preview.dynamicFields || []).join(',');
      wrapper.dataset.listInvalidFields = (preview.invalidFields || []).join(',');
      wrapper.dataset.listDefaultFields = (preview.defaultFields || []).join(',');
      wrapper.dataset.listReservedFields = (preview.reservedFields || []).join(',');
      if (preview.rememberScrollPosition !== undefined) {
        wrapper.dataset.listRememberScrollPosition = String(preview.rememberScrollPosition);
      }
      if (preview.bounce !== undefined) {
        wrapper.dataset.listBounce = String(preview.bounce);
      }
      bindListViewportInteraction(element, wrapper);
    }
    if (element.containerPreview.borderColor) {
      wrapper.style.borderColor = element.containerPreview.borderColor;
    }
    if (element.statementId === 'newui-layout-996pc') {
      wrapper.classList.add('container-newui-layout');
      wrapper.style.backgroundColor = element.containerPreview.fillColor || 'transparent';
    } else if (element.containerPreview.fillColor) {
      wrapper.style.backgroundColor = element.containerPreview.fillColor;
    }
    const label = document.createElement('span');
    label.className = 'container-label';
    label.textContent = element.containerPreview.label;
    wrapper.appendChild(label);
    if (element.containerPreview.variant === 'list') {
      renderListRuntimeBoundary(element, wrapper);
    }
    if (element.containerPreview.variant === 'item-grid') {
      const preview = element.containerPreview;
      wrapper.dataset.gridSource = preview.gridSource || 'unknown';
      wrapper.dataset.gridSelectionMode = preview.selectionMode || 'unknown';
      wrapper.dataset.gridShowTips = preview.showTips === undefined
        ? 'unknown' : String(preview.showTips);
      wrapper.dataset.gridShowStar = preview.showStar === undefined
        ? 'unknown' : String(preview.showStar);
      const columns = Math.max(1, Number(element.containerPreview.columns) || 1);
      const rows = Math.max(1, Number(element.containerPreview.rows) || 1);
      const cellWidth = Math.max(1, Number(element.containerPreview.cellWidth) || 40);
      const cellHeight = Math.max(1, Number(element.containerPreview.cellHeight) || 40);
      const cellGap = element.containerPreview.cellGap === undefined
        ? 2 : Math.max(0, Number(element.containerPreview.cellGap) || 0);
      const grid = document.createElement('div');
      grid.className = 'item-grid-preview';
      grid.dataset.cellWidth = String(cellWidth);
      grid.dataset.cellHeight = String(cellHeight);
      grid.dataset.cellGap = String(cellGap);
      grid.style.gridTemplateColumns = `repeat(${columns}, ${cellWidth}px)`;
      grid.style.gridTemplateRows = `repeat(${rows}, ${cellHeight}px)`;
      grid.style.gap = `${cellGap}px`;
      for (let index = 0; index < (element.containerPreview.cellCount || 1); index++) {
        const cell = document.createElement('span');
        cell.className = 'item-grid-cell item-grid-runtime-cell';
        cell.style.width = `${cellWidth}px`;
        cell.style.height = `${cellHeight}px`;
        cell.dataset.gridCellIndex = String(index);
        cell.dataset.runtimeSource = preview.gridSource || 'unknown';
        cell.setAttribute('aria-label', `第 ${index + 1} 格：运行时物品内容无法离线还原`);
        const empty = document.createElement('span');
        empty.className = 'item-grid-runtime-empty';
        empty.textContent = '运行时';
        cell.appendChild(empty);
        if (preview.showStar) {
          const star = document.createElement('span');
          star.className = 'item-grid-runtime-star';
          star.textContent = '☆?';
          star.title = '星级取决于运行时唯一物品数据';
          cell.appendChild(star);
        }
        if (preview.showTips) {
          cell.dataset.runtimeTooltip = 'true';
          attachDialogTooltip(cell, {
            kind: 'item',
            lines: [[{
              text: '运行时背包/装备内容无法离线还原',
              color: '#ffd479',
            }], [{
              text: 'Ctrl+F12 仅展示槽位、筛选和选择配置，不伪造人物或英雄物品。',
            }]],
          });
        }
        grid.appendChild(cell);
      }
      wrapper.appendChild(grid);
      const status = document.createElement('span');
      status.className = 'item-grid-runtime-status';
      status.textContent = itemGridRuntimeSummary(preview);
      wrapper.appendChild(status);
    }
    if (element.containerPreview.variant === 'list') renderListScrollbar(element, wrapper);
  }

  function itemGridRuntimeSummary(preview) {
    const parts = ['运行时内容边界：背包/装备物品无法离线还原'];
    if (preview.filterCondition !== undefined) parts.push(`condition=${preview.filterCondition}`);
    if (preview.equipmentPositions !== undefined) parts.push(`positions=${preview.equipmentPositions}`);
    if (preview.selectedUniqueIds?.length) {
      parts.push(`selected IDs=${preview.selectedUniqueIds.join(',')}`);
    }
    if (preview.selectionMode) parts.push(`selecttype=${preview.selectionMode}`);
    if (preview.excludedUniqueIds?.length) parts.push(`exclude=${preview.excludedUniqueIds.join(',')}`);
    if (preview.excludedItemIds?.length) parts.push(`filter1=${preview.excludedItemIds.join(',')}`);
    if (preview.excludedItemNames?.length) parts.push(`filter2=${preview.excludedItemNames.join(',')}`);
    if (preview.includedItemRefs?.length) parts.push(`filter3=${preview.includedItemRefs.join(',')}`);
    if (preview.excludeBound !== undefined) parts.push(`exbind=${preview.excludeBound ? 1 : 0}`);
    if (preview.filterStar !== undefined) parts.push(`conditionEx=${preview.filterStar ? 1 : 0}`);
    if (preview.starLevel !== undefined) parts.push(`conditionParam=${preview.starLevel}`);
    if (preview.starCondition !== undefined) parts.push(`conditionOnOff=${preview.starCondition}`);
    if (preview.dynamicFields?.length) parts.push(`动态=${preview.dynamicFields.join(',')}`);
    if (preview.invalidFields?.length) parts.push(`无效=${preview.invalidFields.join(',')}`);
    return parts.join('；');
  }

  function renderListScrollbar(element, wrapper) {
    const preview = element.containerPreview;
    if (preview.scrollbarMode === 'client-default') {
      const boundary = document.createElement('span');
      boundary.className = 'container-client-default-scrollbar';
      boundary.textContent = '客户端默认滑块（素材未公开）';
      wrapper.appendChild(boundary);
      return;
    }
    const horizontal = preview.direction === 'horizontal';
    const parts = [
      ['scrollbar', '滚动条底图'],
      ['scroll-start', horizontal ? '向左箭头' : '向上箭头'],
      ['scroll-thumb', '滚动滑块'],
      ['scroll-end', horizontal ? '向右箭头' : '向下箭头'],
    ].map(([role, label]) => ({
      role,
      label,
      layer: layerFor(element, role),
      hover: layerFor(element, `${role}-hover`),
      pressed: layerFor(element, `${role}-pressed`),
    }));
    const ready = new Map(parts.filter(part => (
      part.layer?.asset?.status === 'ready' && part.layer.asset.url
    )).map(part => [part.role, part]));
    const viewportMain = Math.max(0, Number(horizontal ? element.width : element.height) || 0);
    const contentMain = Math.max(0, Number(
      horizontal ? preview.contentWidth : preview.contentHeight
    ) || 0);
    const scrollRange = Math.max(0, contentMain - viewportMain);
    const ratio = scrollRange > 0
      ? Math.max(0, Math.min(1, listScrollOffset(element) / scrollRange))
      : 0;
    const startExtent = listScrollbarAssetExtent(ready.get('scroll-start')?.layer?.asset, horizontal);
    const endExtent = listScrollbarAssetExtent(ready.get('scroll-end')?.layer?.asset, horizontal);
    const thumbExtent = listScrollbarAssetExtent(ready.get('scroll-thumb')?.layer?.asset, horizontal);
    const thumbTravel = Math.max(0, viewportMain - startExtent - endExtent - thumbExtent);

    for (const part of parts) {
      const asset = part.layer?.asset;
      if (!asset || asset.status !== 'ready' || !asset.url) continue;
      const image = createAssetImage(
        asset,
        part.label,
        `asset-image container-scrollbar-part container-${part.role}-image`
      );
      positionListScrollbarPart(
        image,
        part.role,
        asset,
        horizontal,
        startExtent + Math.round(thumbTravel * ratio)
      );
      if (part.role !== 'scrollbar') {
        bindListScrollbarStates(
          image,
          part,
          horizontal,
          startExtent + Math.round(thumbTravel * ratio)
        );
        bindListScrollControl(
          image,
          element,
          part.role,
          horizontal,
          scrollRange,
          thumbTravel
        );
      }
      wrapper.appendChild(image);
    }
  }

  function renderListRuntimeBoundary(element, wrapper) {
    const preview = element.containerPreview || {};
    const status = preview.interactionStatus
      || (preview.invalidFields?.length
        ? 'blocked-invalid'
        : preview.dynamicFields?.length
          ? 'blocked-dynamic'
          : preview.touchEnabled === false ? 'disabled' : 'local-only');
    const details = [];
    if (status === 'blocked-dynamic') {
      details.push(`动态字段 ${(preview.dynamicFields || []).join('、') || '未知'} 不借用 MOV 当前值；滚动交互和推测素材已禁用`);
    } else if (status === 'blocked-invalid') {
      details.push(`无效字段 ${(preview.invalidFields || []).join('、') || '未知'}；滚动交互和推测素材已禁用`);
    } else if (status === 'disabled') {
      details.push('cantouch=0：本地滚动交互已禁用；Slider=0 时不绘制滚动条素材');
    } else {
      details.push('Partial simulation：仅本地滚动预览，不提交服务器，不执行客户端或宿主动作');
    }
    if (preview.rememberScrollPosition === true) {
      details.push('GOM 记录滚动位置仅保留配置；跨真实 NPC 刷新的客户端运行时生命周期无法离线复现');
    }
    if (preview.reservedFields?.length) {
      details.push(`GEE/LFM 预留字段 reserved：${preview.reservedFields.join('、')}；仅保留源码，不解释为客户端行为`);
    }
    if (preview.bounce !== undefined && Number(preview.bounce) !== 0) {
      details.push('bounce 阻尼和回弹曲线未公开，离线预览严格限制在内容边界');
    }
    if (preview.scrollbarMode === 'client-default') {
      details.push('客户端默认 Slider 素材映射未公开，不猜测像素外观');
    }
    const boundary = document.createElement('span');
    boundary.className = `listview-runtime-boundary listview-runtime-${status}`;
    boundary.dataset.listRuntimeStatus = status;
    boundary.textContent = details.join('；');
    wrapper.appendChild(boundary);
  }

  function listScrollOffset(element) {
    const initial = Number(element.containerPreview?.scrollOffset) || 0;
    const stored = Number(listScrollOffsets.get(element.id));
    return clampListScrollOffset(element, Number.isFinite(stored) ? stored : initial);
  }

  function listInteractionDisabled(element) {
    const preview = element.containerPreview || {};
    return preview.touchEnabled === false
      || preview.interactionStatus === 'blocked-dynamic'
      || preview.interactionStatus === 'blocked-invalid'
      || preview.interactionStatus === 'disabled'
      || (preview.interactionStatus === undefined
        && Boolean(preview.dynamicFields?.length || preview.invalidFields?.length));
  }

  function listScrollRange(element) {
    const preview = element.containerPreview || {};
    const horizontal = preview.direction === 'horizontal';
    const viewportMain = Math.max(0, Number(horizontal ? element.width : element.height) || 0);
    const contentMain = Math.max(0, Number(
      horizontal ? preview.contentWidth : preview.contentHeight
    ) || 0);
    return Math.max(0, contentMain - viewportMain);
  }

  function clampListScrollOffset(element, value) {
    return Math.max(0, Math.min(listScrollRange(element), Number(value) || 0));
  }

  function setListScrollOffset(element, value) {
    const next = clampListScrollOffset(element, value);
    const current = listScrollOffset(element);
    if (Math.abs(next - current) < .01) return false;
    listScrollOffsets.set(element.id, next);
    renderScene();
    renderInspector();
    return true;
  }

  function listScrollStep(element) {
    const preview = element.containerPreview || {};
    const horizontal = preview.direction === 'horizontal';
    const children = (currentScene()?.elements || []).filter(candidate => (
      candidate.parentElementId === element.id
    ));
    const first = children[0];
    const extent = Number(horizontal ? first?.width : first?.height) || 32;
    return Math.max(1, extent + (Number(preview.gap) || 0));
  }

  function bindListViewportInteraction(element, wrapper) {
    if (listInteractionDisabled(element)) return;
    wrapper.addEventListener('wheel', event => {
      const horizontal = element.containerPreview.direction === 'horizontal';
      const primary = horizontal
        ? (Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY)
        : event.deltaY;
      if (!primary) return;
      event.preventDefault();
      event.stopPropagation();
      setListScrollOffset(element, listScrollOffset(element) + primary / Math.max(.1, zoom));
    }, { passive: false });

    let touchStart = null;
    wrapper.addEventListener('touchstart', event => {
      const touch = event.touches?.[0];
      if (!touch) return;
      touchStart = {
        x: touch.clientX,
        y: touch.clientY,
        offset: listScrollOffset(element),
      };
    }, { passive: true });
    wrapper.addEventListener('touchmove', event => {
      if (!touchStart) return;
      const touch = event.touches?.[0];
      if (!touch) return;
      const horizontal = element.containerPreview.direction === 'horizontal';
      const delta = horizontal ? touchStart.x - touch.clientX : touchStart.y - touch.clientY;
      event.preventDefault();
      event.stopPropagation();
      setListScrollOffset(element, touchStart.offset + delta / Math.max(.1, zoom));
    }, { passive: false });
    wrapper.addEventListener('touchend', () => { touchStart = null; }, { passive: true });
    wrapper.addEventListener('touchcancel', () => { touchStart = null; }, { passive: true });
  }

  function bindListScrollControl(image, element, role, horizontal, scrollRange, thumbTravel) {
    if (listInteractionDisabled(element)) {
      image.classList.add('list-scroll-disabled');
      return;
    }
    if (role === 'scroll-start' || role === 'scroll-end') {
      image.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        const direction = role === 'scroll-start' ? -1 : 1;
        setListScrollOffset(element, listScrollOffset(element) + direction * listScrollStep(element));
      });
      return;
    }
    if (role !== 'scroll-thumb' || scrollRange <= 0 || thumbTravel <= 0) return;
    image.addEventListener('mousedown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      listScrollDrag = {
        elementId: element.id,
        horizontal,
        client: horizontal ? event.clientX : event.clientY,
        offset: listScrollOffset(element),
        scrollRange,
        thumbTravel,
      };
    });
  }

  function bindListScrollbarStates(image, part, horizontal, thumbPosition) {
    const normal = part.layer?.asset;
    const hover = part.hover?.asset;
    const pressed = part.pressed?.asset;
    image.classList.add('container-scrollbar-control');
    image.dataset.listScrollPart = part.role;
    const show = (asset, state) => {
      const current = asset?.status === 'ready' && asset.url ? asset : normal;
      if (!current?.url) return;
      image.src = current.url;
      image.alt = current.archiveLabel || part.label;
      image.dataset.listScrollState = current === normal ? 'normal' : state;
      positionListScrollbarPart(image, part.role, current, horizontal, thumbPosition);
    };
    show(normal, 'normal');
    image.addEventListener('mouseenter', () => show(hover, 'hover'));
    image.addEventListener('mouseleave', () => show(normal, 'normal'));
    image.addEventListener('mousedown', event => {
      event.preventDefault();
      event.stopPropagation();
      show(pressed || hover, pressed?.url ? 'pressed' : 'hover');
    });
    image.addEventListener('mouseup', event => {
      show(hover, 'hover');
    });
  }

  function listScrollbarAssetExtent(asset, horizontal) {
    return Math.max(0, Number(horizontal ? asset?.width : asset?.height) || 0);
  }

  function positionListScrollbarPart(image, role, asset, horizontal, thumbPosition) {
    const offsetX = Number(asset.offsetX) || 0;
    const offsetY = Number(asset.offsetY) || 0;
    image.style.left = 'auto';
    image.style.right = 'auto';
    image.style.top = 'auto';
    image.style.bottom = 'auto';
    if (horizontal) {
      image.style.bottom = `${-offsetY}px`;
      if (role === 'scroll-end') image.style.right = `${-offsetX}px`;
      else image.style.left = `${(role === 'scroll-thumb' ? thumbPosition : 0) + offsetX}px`;
    } else {
      image.style.right = `${-offsetX}px`;
      if (role === 'scroll-end') image.style.bottom = `${-offsetY}px`;
      else image.style.top = `${(role === 'scroll-thumb' ? thumbPosition : 0) + offsetY}px`;
    }
  }

  function selectElement(id, focusCanvas = true) {
    const previousId = selectedElementId;
    selectedElementId = id;
    if (previousId && previousId !== id) canvasNode(previousId)?.classList.remove('selected');
    canvasNode(id)?.classList.add('selected');
    renderInspector();
    if (focusCanvas) elements.canvasViewport.focus({ preventScroll: true });
  }

  function startDrag(event, element) {
    if (event.button !== 0) return;
    selectElement(element.id);
    if (!element.editable || conflict) return;
    event.preventDefault();
    const before = positionFor(element.id, element);
    const beforeLocal = localPositionFor(element.id, element);
    drag = {
      id: element.id,
      clientX: event.clientX,
      clientY: event.clientY,
      before: { x: before.x, y: before.y },
      last: { x: before.x, y: before.y },
      beforeLocal: { ...beforeLocal },
      lastLocal: { ...beforeLocal },
      moved: false,
    };
    const node = canvasNode(element.id);
    if (node) node.classList.add('dragging');
  }

  function onDragMove(event) {
    if (listScrollDrag) {
      const element = findElement(listScrollDrag.elementId);
      if (!element) {
        listScrollDrag = null;
        return;
      }
      event.preventDefault();
      const client = listScrollDrag.horizontal ? event.clientX : event.clientY;
      const delta = (client - listScrollDrag.client) / Math.max(.1, zoom);
      const offsetDelta = delta * listScrollDrag.scrollRange / listScrollDrag.thumbTravel;
      setListScrollOffset(element, listScrollDrag.offset + offsetDelta);
      return;
    }
    if (!drag) return;
    const x = Math.round(drag.before.x + (event.clientX - drag.clientX) / zoom);
    const y = Math.round(drag.before.y + (event.clientY - drag.clientY) / zoom);
    const element = findElement(drag.id);
    if (!element) return;
    const local = localPositionFromGlobal(element, x, y);
    if (Math.abs(event.clientX - drag.clientX) >= 4
      || Math.abs(event.clientY - drag.clientY) >= 4) {
      drag.moved = true;
    }
    drag.last = { x, y };
    drag.lastLocal = local;
    drafts.set(drag.id, local);
    moveElementTree(drag.id);
    renderInspector();
    renderChangeList();
    notifyDirty();
  }

  function finishDrag() {
    if (listScrollDrag) {
      listScrollDrag = null;
      return;
    }
    if (!drag) return;
    const node = canvasNode(drag.id);
    if (node) node.classList.remove('dragging');
    if (drag.beforeLocal.x !== drag.lastLocal.x || drag.beforeLocal.y !== drag.lastLocal.y) {
      pushHistory(drag.id, drag.beforeLocal, drag.lastLocal);
    }
    if (drag.moved) {
      suppressedRuntimeActionClick = {
        id: drag.id,
        until: performance.now() + 500,
      };
    }
    drag = null;
    updateButtons();
  }

  function onCanvasKeyDown(event) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const element = selectedElement();
    if (!element?.editable || conflict) return;
    event.preventDefault();
    const before = positionFor(element.id, element);
    const after = { ...before };
    if (event.key === 'ArrowLeft') after.x -= 1;
    else if (event.key === 'ArrowRight') after.x += 1;
    else if (event.key === 'ArrowUp') after.y -= 1;
    else if (event.key === 'ArrowDown') after.y += 1;
    const beforeLocal = localPositionFor(element.id, element);
    const afterLocal = localPositionFromGlobal(element, after.x, after.y);
    drafts.set(element.id, afterLocal);
    pushHistory(element.id, beforeLocal, afterLocal);
    moveElementTree(element.id);
    renderInspector();
    renderChangeList();
    notifyDirty();
  }

  function updateFromInspector() {
    const element = selectedElement();
    if (!element?.editable || conflict) return;
    const x = Number(elements.elementX.value);
    const y = Number(elements.elementY.value);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const beforeLocal = localPositionFor(element.id, element);
    const after = { x: Math.round(x), y: Math.round(y) };
    const afterLocal = localPositionFromGlobal(element, after.x, after.y);
    drafts.set(element.id, afterLocal);
    pushHistory(element.id, beforeLocal, afterLocal);
    moveElementTree(element.id);
    renderInspector();
    renderChangeList();
    notifyDirty();
  }

  function updateLocalTextPreviewFromInspector() {
    const element = selectedElement();
    if (!elementSupportsLocalTextPreview(element)) return;
    const value = String(elements.elementLocalPreviewValue.value || '');
    if (value) localTextPreviewValues.set(element.id, value);
    else localTextPreviewValues.delete(element.id);
    renderScene();
    renderInspector();
  }

  function renderInspector() {
    const element = selectedElement();
    elements.emptyInspector.classList.toggle('hidden', Boolean(element));
    elements.elementInspector.classList.toggle('hidden', !element);
    elements.selectionState.textContent = element ? `第 ${element.lineNumber} 行` : '未选择';
    if (!element) return;
    const position = positionFor(element.id, element);
    elements.elementToken.textContent = element.token;
    elements.elementDescription.textContent = element.description;
    elements.elementX.value = String(position.x);
    elements.elementY.value = String(position.y);
    elements.elementX.disabled = !element.editable || conflict;
    elements.elementY.disabled = !element.editable || conflict;
    elements.sourceX.textContent = element.x ? String(sourceCoordinate(element, position.x, 'x')) : '--';
    elements.sourceY.textContent = element.y ? String(sourceCoordinate(element, position.y, 'y')) : '--';
    const modes = { absolute: '绝对坐标，不叠加 M2 修正', relative: `相对坐标，已叠加修正 ${model.offsets.memoX}, ${model.offsets.memoY}`, anchored: '996PC 锚点/百分比静态近似布局', flow: '流式布局，无独立坐标', none: '无坐标' };
    elements.coordinateMode.textContent = modes[element.coordinateMode] || element.coordinateMode;
    const localPreviewValue = localTextPreviewValue(element);
    elements.elementText.textContent = localPreviewValue ?? element.text ?? '--';
    const supportsLocalTextPreview = elementSupportsLocalTextPreview(element);
    elements.elementLocalPreview.classList.toggle('hidden', !supportsLocalTextPreview);
    if (supportsLocalTextPreview) {
      const value = localPreviewValue ?? '';
      if (elements.elementLocalPreviewValue.value !== value) {
        elements.elementLocalPreviewValue.value = value;
      }
      elements.elementLocalPreviewState.textContent = localPreviewValue === null
        ? '源码文字无法静态确定；留空显示“预览文字”。输入只改变当前画布，不写源码、不执行 @ 标签。'
        : '本地预览值；仅改变当前画布，不写源码、不执行 @ 标签。留空恢复“预览文字”。';
    } else {
      elements.elementLocalPreviewValue.value = '';
      elements.elementLocalPreviewState.textContent = '';
    }
    elements.assetState.textContent = assetDescription(element);
    renderElementParameters(element);
    elements.elementWarning.textContent = element.warning || '';
    elements.elementWarning.classList.toggle('hidden', !element.warning);
    elements.patchButton.classList.toggle('hidden', !elementHasMissingAsset(element));
    elements.rawStatement.textContent = element.raw;
  }

  function renderElementParameters(element) {
    elements.elementParameters.textContent = '';
    const parameters = element.parameters || [];
    if (parameters.length === 0) {
      elements.elementParameters.textContent = '无';
      return;
    }
    for (const parameter of parameters) {
      const row = document.createElement('div');
      row.className = 'parameter-row';
      const name = document.createElement('strong');
      name.textContent = parameter.key
        ? `${parameter.key} · ${parameter.name}`
        : `参数${parameter.index || ''} · ${parameter.name}`;
      const value = document.createElement('span');
      value.textContent = parameter.value === '' ? '(空)' : parameter.value;
      value.title = value.textContent;
      row.append(name, value);
      elements.elementParameters.appendChild(row);
    }
  }

  function elementHasMissingAsset(element) {
    if (element.asset?.status === 'missing') return true;
    if ((element.animationFrames || []).some(frame => frame?.status === 'missing')) return true;
    if ((element.modelPreview?.layers || []).some(layer => layer.asset?.status === 'missing')) {
      return true;
    }
    return (element.assetLayers || []).some(layer => layer.asset?.status === 'missing');
  }

  function renderDiagnostics(scene) {
    renderDiagnosticList(elements.sceneWarnings, [
      ...(model?.warnings || []),
      ...(scene?.warnings || []),
    ], true);
    renderDiagnosticList(elements.unsupportedList, scene?.unsupportedStatements || [], false);
  }

  function renderDiagnosticList(container, values, warning) {
    container.textContent = '';
    if (!values.length) {
      container.textContent = '无';
      return;
    }
    for (const value of values) {
      const row = document.createElement('div');
      row.className = `diagnostic-item${warning ? ' warning' : ''}`;
      if (warning) row.textContent = value;
      else {
        const code = document.createElement('code');
        code.textContent = value;
        row.appendChild(code);
      }
      container.appendChild(row);
    }
  }

  function renderChangeList() {
    const changes = collectChanges();
    elements.changeList.textContent = '';
    if (!changes.length) {
      elements.changeList.textContent = '暂无改动';
      return;
    }
    for (const change of changes) {
      const element = findElement(change.elementId);
      const row = document.createElement('div');
      row.className = 'change-row';
      const label = document.createElement('div');
      label.textContent = `${element?.token || change.elementId} · 第 ${element?.lineNumber || '?'} 行`;
      const value = document.createElement('b');
      value.textContent = `${element?.layoutX ?? '?'} , ${element?.layoutY ?? '?'} → ${change.x} , ${change.y}`;
      row.append(label, value);
      elements.changeList.appendChild(row);
    }
  }

  function submit(type) {
    if (!model || conflict) return;
    vscode.postMessage({ type, changes: collectChanges() });
  }

  function collectChanges() {
    const result = [];
    for (const [elementId] of drafts.entries()) {
      const element = findElement(elementId);
      if (!element?.editable || !element.x || !element.y) continue;
      const position = positionFor(elementId, element);
      if (position.x === element.layoutX && position.y === element.layoutY) continue;
      result.push({ elementId, x: Math.round(position.x), y: Math.round(position.y) });
    }
    return result;
  }

  function pushHistory(id, before, after) {
    if (before.x === after.x && before.y === after.y) return;
    history = history.slice(0, historyIndex);
    history.push({ id, before: { ...before }, after: { ...after } });
    historyIndex = history.length;
    updateButtons();
  }

  function undo() {
    if (historyIndex <= 0) return;
    const entry = history[--historyIndex];
    setDraftFromHistory(entry.id, entry.before);
  }

  function redo() {
    if (historyIndex >= history.length) return;
    const entry = history[historyIndex++];
    setDraftFromHistory(entry.id, entry.after);
  }

  function setDraftFromHistory(id, position) {
    const element = findElement(id);
    if (!element) return;
    if (position.x === element.localLayoutX && position.y === element.localLayoutY) drafts.delete(id);
    else drafts.set(id, { ...position });
    renderScene();
    renderInspector();
    renderChangeList();
    notifyDirty();
  }

  function notifyDirty() {
    const dirty = collectChanges().length > 0;
    if (dirty !== lastDirtyState) {
      lastDirtyState = dirty;
      vscode.postMessage({ type: 'dirtyChanged', dirty });
    }
    updateButtons();
  }

  function updateButtons() {
    const changeCount = collectChanges().length;
    elements.undoButton.disabled = conflict || historyIndex <= 0;
    elements.redoButton.disabled = conflict || historyIndex >= history.length;
    elements.applyButton.disabled = conflict || !model;
    elements.saveButton.disabled = conflict || !model;
    elements.applyButton.textContent = changeCount ? `应用到代码 (${changeCount})` : '应用到代码';
    elements.saveButton.textContent = changeCount ? `保存文件 (${changeCount})` : '保存文件';
  }

  function setZoom(value) {
    zoom = Math.min(2, Math.max(.25, Math.round(value * 10) / 10));
    renderScene();
  }

  function updateCoordinateReadout(event) {
    const rect = elements.dialogCanvas.getBoundingClientRect();
    const canvasX = (event.clientX - rect.left) / zoom - elements.dialogCanvas.clientLeft;
    const canvasY = (event.clientY - rect.top) / zoom - elements.dialogCanvas.clientTop;
    const origin = mainDialogContentOrigin(currentScene());
    // Odd-sized centered dialogs have a half-pixel logical origin (for
    // example 579px in an 800px canvas => 110.5). Pointer coordinates are
    // integer-quantized by Chromium, so round the local result instead of
    // reporting the preceding source pixel at every such origin.
    const x = Math.round(canvasX - (origin.knownX ? origin.x : 0));
    const y = Math.round(canvasY - (origin.knownY ? origin.y : 0));
    const knownOriginAxes = Number(origin.knownX) + Number(origin.knownY);
    const label = knownOriginAxes === 2
      ? '对话框坐标'
      : knownOriginAxes === 1 ? '部分对话框坐标' : '坐标';
    elements.coordinateReadout.textContent = `${label} ${x}, ${y}`;
  }

  function showConflict(message) {
    conflict = true;
    showBanner(message, 'error');
    updateButtons();
    renderInspector();
  }

  function showBanner(message, type) {
    elements.statusBanner.textContent = message;
    elements.statusBanner.classList.remove('hidden', 'info');
    if (type === 'info') elements.statusBanner.classList.add('info');
    document.body.classList.add('has-banner');
  }

  function hideBanner() {
    elements.statusBanner.classList.add('hidden');
    document.body.classList.remove('has-banner');
  }

  function showToast(message, error) {
    clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.style.borderColor = error ? 'var(--danger)' : 'var(--success)';
    elements.toast.classList.remove('hidden');
    toastTimer = setTimeout(() => elements.toast.classList.add('hidden'), 3600);
  }

  function currentScene() {
    return model?.pages?.find(page => page.id === currentPageId) || null;
  }

  function preferredPage() {
    return model?.pages?.[0] || null;
  }

  function formatPageConditions(page) {
    const groups = (page.conditionGroupIds || [])
      .map(id => (model?.conditionGroups || []).find(group => group.id === id))
      .filter(Boolean);
    if (groups.length === 0) return '无条件或默认显示';
    return groups.map(group => {
      const state = previewConditions.get(group.id) ? '满足' : '不满足';
      return `${state} · ${formatConditions(group).replace(/\n/g, ' / ')}`;
    }).join('\n');
  }

  function formatConditions(scene) {
    return (scene.conditions || []).map((condition, index) => {
      if (index === 0) return condition;
      const operators = scene.conditionOperators || scene.operators || [];
      return `${operators[index] === 'OR' ? '或' : '且'} ${condition}`;
    }).join('\n');
  }

  function selectedElement() {
    return findElement(selectedElementId);
  }

  function findElement(id) {
    if (!model || !id) return null;
    const active = currentScene();
    const activeBinding = coordinateBindingElements(active).find(element => element.id === id);
    if (activeBinding) return activeBinding;
    for (const scene of model.scenes || []) {
      const found = (scene.elements || []).find(element => element.id === id);
      if (found) return found;
      const binding = coordinateBindingElements(scene).find(element => element.id === id);
      if (binding) return binding;
    }
    return null;
  }

  function positionFor(id, element) {
    return positionForElement(element, new Set());
  }

  function positionForElement(element, resolving) {
    if (resolving.has(element.id)) return { x: element.layoutX, y: element.layoutY };
    resolving.add(element.id);
    const local = localPositionFor(element.id, element);
    const parent = element.parentElementId ? findElement(element.parentElementId) : null;
    const parentPosition = parent ? positionForElement(parent, resolving) : null;
    resolving.delete(element.id);
    return {
      x: local.x + (parentPosition?.x || 0),
      y: local.y + (parentPosition?.y || 0),
    };
  }

  function localPositionFor(id, element) {
    return drafts.get(id) || {
      x: Number.isFinite(element.localLayoutX) ? element.localLayoutX : element.layoutX,
      y: Number.isFinite(element.localLayoutY) ? element.localLayoutY : element.layoutY,
    };
  }

  function localPositionFromGlobal(element, x, y) {
    const parent = element.parentElementId ? findElement(element.parentElementId) : null;
    const parentPosition = parent ? positionFor(parent.id, parent) : null;
    return {
      x: Math.round(x - (parentPosition?.x || 0)),
      y: Math.round(y - (parentPosition?.y || 0)),
    };
  }

  function sourceCoordinate(element, displayValue, axis) {
    if (element.imagePreview?.background
      && Number.isInteger(element.imagePreview.showPosition)) {
      const coordinate = axis === 'x' ? element.x : element.y;
      return coordinate ? coordinate.sourceValue : '--';
    }
    if (element.coordinateMode === 'anchored') {
      const coordinate = axis === 'x' ? element.x : element.y;
      return coordinate ? coordinate.sourceValue : '--';
    }
    const parent = element.parentElementId ? findElement(element.parentElementId) : null;
    const parentPosition = parent ? positionFor(parent.id, parent) : null;
    const localDisplayValue = displayValue - (parentPosition
      ? (axis === 'x' ? parentPosition.x : parentPosition.y)
      : 0);
    const relativeOffset = element.coordinateMode === 'relative' && !parent
      ? (axis === 'x' ? model.offsets.memoX : model.offsets.memoY)
      : 0;
    const sourceBias = axis === 'x'
      ? (element.sourceCoordinateBiasX || 0)
      : (element.sourceCoordinateBiasY || 0);
    return Math.round(localDisplayValue - relativeOffset + sourceBias);
  }

  function assetDescription(element) {
    const asset = element.asset;
    const layers = element.assetLayers || [];
    const descriptions = layers.map(layer => {
      const labels = {
        background: '底图', item: '物品', progress: '进度图', scrollbar: '滚动条',
        hover: '悬停图', pressed: '按下图', thumb: '滑块球', selected: '选中图',
        arrow: '箭头图', 'list-background': '列表底图',
        'scroll-start': '首箭头正常图', 'scroll-start-hover': '首箭头悬停图',
        'scroll-start-pressed': '首箭头按下图', 'scroll-thumb': '滚动滑块正常图',
        'scroll-thumb-hover': '滚动滑块悬停图', 'scroll-thumb-pressed': '滚动滑块按下图',
        'scroll-end': '尾箭头正常图', 'scroll-end-hover': '尾箭头悬停图',
        'scroll-end-pressed': '尾箭头按下图',
      };
      const preview = layer.asset;
      if (!preview) return `${labels[layer.role] || layer.role}: 等待解析`;
      if (preview.status === 'ready') {
        return `${labels[layer.role] || layer.role}: ${preview.archiveLabel || '已就绪'} · ${preview.width || '?'}×${preview.height || '?'}`;
      }
      return `${labels[layer.role] || layer.role}: ${preview.archiveLabel ? `${preview.archiveLabel} · ` : ''}${preview.message || preview.status}`;
    });
    for (const layer of element.modelPreview?.layers || []) {
      const preview = layer.asset;
      if (!preview) {
        descriptions.push(`${layer.label}: 等待解析`);
      } else if (preview.status === 'ready') {
        descriptions.push(
          `${layer.label}: ${preview.archiveLabel || '已就绪'} · ${preview.width || '?'}×${preview.height || '?'}`
        );
      } else {
        descriptions.push(
          `${layer.label}: ${preview.archiveLabel ? `${preview.archiveLabel} · ` : ''}${preview.message || preview.status}`
        );
      }
    }
    if (element.animationPreview) {
      const animation = element.animationPreview;
      const slots = element.animationFrames || [];
      const ready = slots.filter(frame => frame?.status === 'ready').length;
      const missing = Math.max(0, slots.length - ready);
      const details = [
        `动画: ${ready}/${animation.frameCount} 帧${missing ? `（缺 ${missing}，保留时间槽）` : ''}`,
        animation.intervalMs === animation.previewIntervalMs
          ? `${animation.intervalMs}ms`
          : `源码 ${animation.intervalMs}ms / 预览 ${animation.previewIntervalMs}ms`,
        animation.repeatCount === undefined || Number(animation.repeatCount) === 0
          ? '循环' : `${animation.repeatCount} 次`,
        animation.drawMode !== undefined ? `M=${animation.drawMode}` : '',
        animation.repairMode !== undefined ? `R=${animation.repairMode}` : '',
        Number(animation.scale) > 0 ? `scale=${animation.scale}` : '',
        animation.finishFrame !== undefined ? `finishframe=${animation.finishFrame}（基数未知）` : '',
        animation.finishHide !== undefined ? `finishhide=${Number(animation.finishHide)}` : '',
        animation.slowCount !== undefined ? `slowcount=${animation.slowCount}（算法未知）` : '',
        animation.caption ? `标题/备注=${animation.caption}` : '',
        animation.submitIds ? `P=${animation.submitIds}` : '',
      ].filter(Boolean);
      descriptions.push(details.join(' · '));
    }
    if (element.progressPreview?.frameCount) {
      const ready = (element.animationFrames || []).filter(frame => frame.status === 'ready').length;
      descriptions.push(
        `进度动画: ${ready}/${element.progressPreview.frameCount} 帧 · 间隔参数 ${element.progressPreview.frameInterval ?? '?'}`
      );
    }
    if (element.itemPreview?.message) descriptions.push(element.itemPreview.message);
    if (!element.assetRef && element.monsterPreview?.message) {
      descriptions.push(element.monsterPreview.message);
    }
    if (descriptions.length > 0) return descriptions.join('；');
    if (!element.assetRef) return '此语句没有可直接解析的图片素材';
    if (!asset) return '等待素材解析';
    if (asset.status === 'ready') return `${asset.archiveLabel || '素材已就绪'} · ${asset.width || '?'}×${asset.height || '?'}`;
    return `${asset.archiveLabel ? `${asset.archiveLabel} · ` : ''}${asset.message || asset.status}`;
  }

  function canvasNode(id) {
    return elements.dialogCanvas.querySelector(`[data-element-id="${cssEscape(id)}"]`);
  }

  function coordinateBindingVisualPosition(element, scene) {
    const position = positionFor(element.id, element);
    if (element.coordinateTargetKind === 'adddlg-content-origin') {
      const windowPreview = scene?.addDlgWindow;
      const windowTarget = coordinateBindingElement(
        windowPreview?.windowOriginBinding,
        windowPreview
      );
      const windowPosition = windowTarget
        ? positionFor(windowTarget.id, windowTarget)
        : coordinateBindingPosition(undefined, windowPreview?.windowX, windowPreview?.windowY);
      return {
        x: windowPosition.x + position.x,
        y: windowPosition.y + position.y,
      };
    }
    if (element.coordinateTargetKind === 'dialog-background-offset') {
      const geometry = dialogBackgroundGeometry(scene?.background || element.coordinateBindingOwner);
      return { x: geometry.left, y: geometry.top };
    }
    return position;
  }

  function syncCoordinateBindingGeometry(scene) {
    if (!scene) return;
    if (scene.background) {
      const geometry = dialogBackgroundGeometry(scene.background);
      const background = elements.dialogCanvas.querySelector('.dialog-background-preview');
      if (background) {
        background.style.left = `${geometry.left}px`;
        background.style.top = `${geometry.top}px`;
        background.dataset.backgroundOffsetX = String(geometry.offset.x);
        background.dataset.backgroundOffsetY = String(geometry.offset.y);
      }
      if (!scene.addDlgWindow) {
        for (const element of scene.elements || []) moveCanvasNode(element, scene);
      }
    }

    const preview = scene.addDlgWindow;
    if (preview) {
      const windowOrigin = coordinateBindingPosition(
        preview.windowOriginBinding,
        preview.windowX,
        preview.windowY
      );
      const contentOrigin = coordinateBindingPosition(
        preview.contentOriginBinding,
        preview.textOffsetX,
        preview.textOffsetY
      );
      const panel = elements.dialogCanvas.querySelector(
        `.adddlg-window[data-adddlg-window-id="${cssEscape(preview.id || '')}"]`
      );
      if (panel) {
        panel.style.left = `${windowOrigin.x}px`;
        panel.style.top = `${windowOrigin.y}px`;
        const marker = panel.querySelector('.adddlg-content-origin');
        if (marker) {
          marker.style.left = `${contentOrigin.x}px`;
          marker.style.top = `${contentOrigin.y}px`;
        }
      }
      for (const element of scene.elements || []) {
        moveCanvasNode(element, scene);
      }
    }

    for (const target of coordinateBindingElements(scene)) {
      const node = canvasNode(target.id);
      if (!node) continue;
      const position = coordinateBindingVisualPosition(target, scene);
      node.style.left = `${position.x}px`;
      node.style.top = `${position.y}px`;
    }
  }

  function moveCanvasNode(element, scene) {
    const node = canvasNode(element.id);
    if (!node) return;
    const position = sceneElementVisualPosition(element, scene);
    const box = elementCanvasBox(element, position);
    node.style.left = `${box.x}px`;
    node.style.top = `${box.y}px`;
  }

  function moveElementTree(rootId) {
    const scene = currentScene();
    const target = findElement(rootId);
    if (target?.coordinateBinding) {
      syncCoordinateBindingGeometry(scene);
      return;
    }
    for (const element of scene?.elements || []) {
      if (element.id !== rootId && !isDescendantOf(element, rootId)) continue;
      moveCanvasNode(element, scene);
    }
  }

  function isDescendantOf(element, ancestorId) {
    const visited = new Set();
    let current = element;
    while (current?.parentElementId && !visited.has(current.parentElementId)) {
      if (current.parentElementId === ancestorId) return true;
      visited.add(current.parentElementId);
      current = findElement(current.parentElementId);
    }
    return false;
  }

  function cssEscape(value) {
    if (window.CSS?.escape) return window.CSS.escape(value);
    return String(value).replace(/["\\]/g, '\\$&');
  }
})();

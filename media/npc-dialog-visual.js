(function () {
  'use strict';

  const vscode = acquireVsCodeApi();
  const elements = Object.fromEntries([
    'functionTitle', 'fileTitle', 'engineBadge', 'zoomOut', 'zoomIn', 'zoomReset', 'zoomValue',
    'undoButton', 'redoButton', 'reloadButton', 'applyButton', 'saveButton', 'statusBanner',
    'offsetBar', 'offsetSource', 'offsetX', 'offsetY', 'saveOffsets', 'offsetHelp', 'sceneCount',
    'resetPreview', 'sceneList', 'advancedConditions', 'advancedConditionCount', 'advancedConditionList',
    'conditionText', 'variableList', 'changeList', 'sceneTitle', 'canvasSize', 'coordinateReadout',
    'canvasViewport', 'canvasStage', 'dialogCanvas', 'selectionState', 'emptyInspector',
    'elementInspector', 'elementToken', 'elementDescription', 'elementX', 'elementY', 'sourceX',
    'sourceY', 'coordinateMode', 'elementText', 'assetState', 'elementParameters', 'elementWarning', 'locateButton',
    'patchButton', 'rawStatement', 'sceneWarnings', 'unsupportedList', 'toast',
  ].map(id => [id, document.getElementById(id)]));

  let model = null;
  let currentPageId = '';
  let selectedElementId = '';
  let zoom = 1;
  let conflict = false;
  let drafts = new Map();
  let history = [];
  let historyIndex = 0;
  let drag = null;
  let toastTimer = 0;
  let previewConditions = new Map();
  let lastPreviewRevision = -1;
  let lastDirtyState = false;
  let animationTimers = [];
  let dialogTooltip = null;

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
    model = nextModel;
    conflict = false;
    if (!preserveDrafts) {
      drafts = new Map();
      history = [];
      historyIndex = 0;
      selectedElementId = '';
      lastDirtyState = false;
    } else {
      const validElements = new Set(
        (model.scenes || []).flatMap(scene => (scene.elements || []).map(element => element.id))
      );
      drafts = new Map([...drafts].filter(([id]) => validElements.has(id)));
      history = history.filter(entry => validElements.has(entry.id));
      historyIndex = Math.min(historyIndex, history.length);
      if (!validElements.has(selectedElementId)) selectedElementId = '';
    }
    previewConditions = new Map();
    for (const group of model.conditionGroups || []) {
      previewConditions.set(group.id, group.satisfied === true);
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
    renderScene();
    renderInspector();
    renderChangeList();
    updateButtons();
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
    origin.title = '画布原点 0,0';
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
    for (const element of scene.elements || []) renderCanvasElement(element);
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
    if (background.asset?.status === 'ready' && background.asset.url) {
      const image = document.createElement('img');
      image.className = 'dialog-background';
      image.src = background.asset.url;
      image.alt = background.asset.archiveLabel || '对话框背景';
      image.title = background.asset.archiveLabel || '';
      image.draggable = false;
      image.style.left = `${background.asset.offsetX || 0}px`;
      image.style.top = `${background.asset.offsetY || 0}px`;
      elements.dialogCanvas.appendChild(image);
      return;
    }
    const placeholder = document.createElement('div');
    placeholder.className = 'background-placeholder';
    placeholder.textContent = background.asset?.message || `背景 WIL ${background.willIndex ?? '?'} / ${background.imageIndex ?? '?'}`;
    elements.dialogCanvas.appendChild(placeholder);
  }

  function renderCanvasElement(element) {
    const position = positionFor(element.id, element);
    const wrapper = document.createElement('div');
    wrapper.className = `canvas-element kind-${element.kind}${element.editable ? '' : ' locked'}${selectedElementId === element.id ? ' selected' : ''}`;
    wrapper.dataset.elementId = element.id;
    wrapper.style.left = `${position.x}px`;
    wrapper.style.top = `${position.y}px`;
    const visualSize = elementVisualSize(element);
    const assetWidth = visualSize.width;
    const assetHeight = visualSize.height;
    wrapper.style.width = `${Math.max(8, assetWidth)}px`;
    wrapper.style.height = `${Math.max(8, assetHeight)}px`;
    const interactionHint = element.editable
      ? '按住鼠标拖动；方向键微调'
      : (element.warning || '此语句只读');
    wrapper.setAttribute('aria-label', `${element.description}；${interactionHint}`);
    if (!element.tooltipPreview) wrapper.title = `${element.description}\n${interactionHint}`;

    if (element.kind === 'text') {
      const label = document.createElement('span');
      label.className = 'element-text';
      label.textContent = element.text ?? '';
      if (element.color) label.style.color = element.color;
      wrapper.appendChild(label);
    } else if (element.itemPreview) {
      renderItemElement(element, wrapper, visualSize);
    } else if (element.progressPreview) {
      renderProgressElement(element, wrapper, visualSize);
    } else if (element.containerPreview) {
      renderContainerElement(element, wrapper, visualSize);
    } else if (element.animationPreview) {
      renderAnimationElement(element, wrapper);
    } else if (element.kind === 'button' && element.asset?.status === 'ready' && element.asset.url) {
      renderInteractiveAsset(element, wrapper);
    } else if (element.asset?.status === 'ready' && element.asset.url) {
      wrapper.appendChild(createAssetImage(element.asset, element.token));
    } else {
      wrapper.appendChild(createElementPlaceholder(
        element.asset?.archiveLabel || element.text || element.token.replace('<', '')
      ));
    }

    attachDialogTooltip(wrapper, element.tooltipPreview);

    wrapper.addEventListener('mousedown', event => startDrag(event, element));
    wrapper.addEventListener('click', event => {
      event.stopPropagation();
      selectElement(element.id);
    });
    elements.dialogCanvas.appendChild(wrapper);
  }

  function renderAnimationElement(element, wrapper) {
    const frames = (element.animationFrames || []).filter(frame => frame?.status === 'ready' && frame.url);
    if (frames.length === 0) {
      wrapper.appendChild(createElementPlaceholder(element.asset?.message || element.token));
      return;
    }
    let frameIndex = 0;
    let completedLoops = 0;
    const image = createAssetImage(frames[0], element.token, 'asset-image animation-frame-image');
    wrapper.appendChild(image);
    if (frames.length === 1) return;
    const timer = window.setInterval(() => {
      frameIndex = (frameIndex + 1) % frames.length;
      if (frameIndex === 0) {
        completedLoops++;
        if (Number(element.animationPreview.repeatCount) > 0
          && completedLoops >= Number(element.animationPreview.repeatCount)) {
          window.clearInterval(timer);
          animationTimers = animationTimers.filter(value => value !== timer);
          return;
        }
      }
      const frame = frames[frameIndex];
      image.src = frame.url;
      image.alt = frame.archiveLabel || element.token;
      image.style.left = `${frame.offsetX || 0}px`;
      image.style.top = `${frame.offsetY || 0}px`;
    }, Math.max(16, Number(element.animationPreview.intervalMs) || 100));
    animationTimers.push(timer);
  }

  function clearAnimationTimers() {
    for (const timer of animationTimers) window.clearInterval(timer);
    animationTimers = [];
  }

  function renderInteractiveAsset(element, wrapper) {
    const normal = element.asset;
    const hover = layerFor(element, 'hover')?.asset;
    const pressed = layerFor(element, 'pressed')?.asset;
    const image = createAssetImage(normal, element.token, 'asset-image interactive-asset-image');
    const show = asset => {
      if (!asset?.url) return;
      image.src = asset.url;
      image.alt = asset.archiveLabel || element.token;
      image.style.left = `${asset.offsetX || 0}px`;
      image.style.top = `${asset.offsetY || 0}px`;
    };
    wrapper.appendChild(image);
    wrapper.addEventListener('mouseenter', () => show(hover || normal));
    wrapper.addEventListener('mouseleave', () => show(normal));
    wrapper.addEventListener('mousedown', () => show(pressed || hover || normal));
    wrapper.addEventListener('mouseup', () => show(hover || normal));
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
      const detail = document.createElement('span');
      detail.textContent = `IDX ${preview.itemIndex ?? '?'} · 模式 ${preview.itemMode ?? '?'}`;
      tooltip.append(heading, detail);
    } else {
      for (const line of preview.lines || []) {
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
    tooltip.classList.remove('hidden');
    positionDialogTooltip(event, preview);
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
    const previews = (element.itemPreview
      ? [element.asset, layerFor(element, 'background')?.asset]
      : [element.asset, ...(element.assetLayers || []).map(layer => layer.asset)])
      .filter(Boolean);
    let width = Math.max(8, Number(element.width) || 0);
    let height = Math.max(8, Number(element.height) || 0);
    for (const preview of previews) {
      width = Math.max(width, Number(preview.width) || 0);
      height = Math.max(height, Number(preview.height) || 0);
    }
    return { width: width || 72, height: height || 32 };
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

  function createElementPlaceholder(text) {
    const placeholder = document.createElement('div');
    placeholder.className = 'element-placeholder';
    placeholder.textContent = text;
    return placeholder;
  }

  function layerFor(element, role) {
    return (element.assetLayers || []).find(layer => layer.role === role) || null;
  }

  function renderItemElement(element, wrapper, size) {
    wrapper.classList.add('layered-item');
    const frame = layerFor(element, 'background');
    const item = layerFor(element, 'item');
    let rendered = false;
    if (frame?.asset?.status === 'ready' && frame.asset.url) {
      wrapper.appendChild(createAssetImage(frame.asset, '物品框', 'asset-image item-frame-image'));
      rendered = true;
    }
    if (item?.asset?.status === 'ready' && item.asset.url) {
      const image = createAssetImage(item.asset, element.itemPreview.label, 'asset-image item-content-image');
      const itemWidth = Number(item.asset.width) || 0;
      const itemHeight = Number(item.asset.height) || 0;
      const frameWidth = Number(frame?.asset?.width) || size.width;
      const frameHeight = Number(frame?.asset?.height) || size.height;
      image.style.left = `${Math.round((frameWidth - itemWidth) / 2) + (item.asset.offsetX || 0)}px`;
      image.style.top = `${Math.round((frameHeight - itemHeight) / 2) + (item.asset.offsetY || 0)}px`;
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
    if (Number(element.itemPreview.quantity) > 0) {
      const quantity = document.createElement('span');
      quantity.className = 'item-quantity';
      quantity.textContent = String(element.itemPreview.quantity);
      wrapper.appendChild(quantity);
    }
  }

  function renderProgressElement(element, wrapper, size) {
    wrapper.classList.add('layered-progress');
    const background = layerFor(element, 'background');
    const fill = layerFor(element, 'progress');
    let rendered = false;
    if (background?.asset?.status === 'ready' && background.asset.url) {
      wrapper.appendChild(createAssetImage(background.asset, '进度条底图', 'asset-image progress-background-image'));
      rendered = true;
    }
    if (fill?.asset?.status === 'ready' && fill.asset.url) {
      const fillImage = createAssetImage(fill.asset, '进度条图片', 'asset-image progress-fill-image');
      fillImage.style.left = `${(fill.asset.offsetX || 0) + (element.progressPreview.offsetX || 0)}px`;
      fillImage.style.top = `${(fill.asset.offsetY || 0) + (element.progressPreview.offsetY || 0)}px`;
      fillImage.style.clipPath = progressClipPath(
        element.progressPreview.ratio,
        element.progressPreview.direction
      );
      wrapper.appendChild(fillImage);
      rendered = true;
    }
    if (!rendered) wrapper.appendChild(createElementPlaceholder('进度条'));
    const caption = document.createElement('span');
    caption.className = 'progress-caption';
    caption.textContent = progressCaption(element.progressPreview);
    wrapper.appendChild(caption);
  }

  function progressClipPath(ratio, direction) {
    const hidden = Math.round((1 - Math.max(0, Math.min(1, Number(ratio) || 0))) * 10000) / 100;
    if (Number(direction) === 1) return `inset(0 0 0 ${hidden}%)`;
    if (Number(direction) === 2) return `inset(0 0 ${hidden}% 0)`;
    if (Number(direction) === 3) return `inset(${hidden}% 0 0 0)`;
    return `inset(0 ${hidden}% 0 0)`;
  }

  function progressCaption(progress) {
    const percent = Math.round((Number(progress.ratio) || 0) * 100);
    return String(progress.text || `${percent}%`)
      .replace(/%p/gi, String(progress.value))
      .replace(/%m/gi, String(progress.maximum))
      .replace(/%r%/gi, `${percent}%`);
  }

  function renderContainerElement(element, wrapper) {
    wrapper.classList.add('container-preview', `container-${element.containerPreview.variant}`);
    if (element.containerPreview.borderColor) {
      wrapper.style.borderColor = element.containerPreview.borderColor;
    }
    const label = document.createElement('span');
    label.className = 'container-label';
    label.textContent = element.containerPreview.label;
    wrapper.appendChild(label);
    if (element.containerPreview.variant === 'item-grid') {
      const grid = document.createElement('div');
      grid.className = 'item-grid-preview';
      grid.style.gridTemplateColumns = `repeat(${element.containerPreview.columns || 1}, 40px)`;
      for (let index = 0; index < (element.containerPreview.cellCount || 1); index++) {
        const cell = document.createElement('span');
        cell.className = 'item-grid-cell';
        grid.appendChild(cell);
      }
      wrapper.appendChild(grid);
    }
    const scrollbar = layerFor(element, 'scrollbar');
    if (scrollbar?.asset?.status === 'ready' && scrollbar.asset.url) {
      const image = createAssetImage(scrollbar.asset, '滚动条', 'asset-image container-scrollbar-image');
      image.style.left = 'auto';
      image.style.right = '0';
      wrapper.appendChild(image);
    }
  }

  function selectElement(id) {
    selectedElementId = id;
    renderScene();
    renderInspector();
    elements.canvasViewport.focus({ preventScroll: true });
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
    };
    const node = canvasNode(element.id);
    if (node) node.classList.add('dragging');
  }

  function onDragMove(event) {
    if (!drag) return;
    const x = Math.round(drag.before.x + (event.clientX - drag.clientX) / zoom);
    const y = Math.round(drag.before.y + (event.clientY - drag.clientY) / zoom);
    const element = findElement(drag.id);
    if (!element) return;
    const local = localPositionFromGlobal(element, x, y);
    drag.last = { x, y };
    drag.lastLocal = local;
    drafts.set(drag.id, local);
    moveElementTree(drag.id);
    renderInspector();
    renderChangeList();
    notifyDirty();
  }

  function finishDrag() {
    if (!drag) return;
    const node = canvasNode(drag.id);
    if (node) node.classList.remove('dragging');
    if (drag.beforeLocal.x !== drag.lastLocal.x || drag.beforeLocal.y !== drag.lastLocal.y) {
      pushHistory(drag.id, drag.beforeLocal, drag.lastLocal);
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
    const modes = { absolute: '绝对坐标，不叠加 M2 修正', relative: `相对坐标，已叠加修正 ${model.offsets.memoX}, ${model.offsets.memoY}`, flow: '流式布局，无独立坐标', none: '无坐标' };
    elements.coordinateMode.textContent = modes[element.coordinateMode] || element.coordinateMode;
    elements.elementText.textContent = element.text || '--';
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
    const x = Math.floor((event.clientX - rect.left) / zoom);
    const y = Math.floor((event.clientY - rect.top) / zoom);
    elements.coordinateReadout.textContent = `坐标 ${x}, ${y}`;
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
    for (const scene of model.scenes || []) {
      const found = (scene.elements || []).find(element => element.id === id);
      if (found) return found;
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
        hover: '悬停图', pressed: '按下图',
      };
      const preview = layer.asset;
      if (!preview) return `${labels[layer.role] || layer.role}: 等待解析`;
      if (preview.status === 'ready') {
        return `${labels[layer.role] || layer.role}: ${preview.archiveLabel || '已就绪'} · ${preview.width || '?'}×${preview.height || '?'}`;
      }
      return `${labels[layer.role] || layer.role}: ${preview.archiveLabel ? `${preview.archiveLabel} · ` : ''}${preview.message || preview.status}`;
    });
    if (element.animationPreview) {
      const ready = (element.animationFrames || []).filter(frame => frame.status === 'ready').length;
      descriptions.push(`动画: ${ready}/${element.animationPreview.frameCount} 帧 · ${element.animationPreview.intervalMs}ms`);
    }
    if (element.itemPreview?.message) descriptions.push(element.itemPreview.message);
    if (descriptions.length > 0) return descriptions.join('；');
    if (!element.assetRef) return '此语句没有可直接解析的图片素材';
    if (!asset) return '等待素材解析';
    if (asset.status === 'ready') return `${asset.archiveLabel || '素材已就绪'} · ${asset.width || '?'}×${asset.height || '?'}`;
    return `${asset.archiveLabel ? `${asset.archiveLabel} · ` : ''}${asset.message || asset.status}`;
  }

  function canvasNode(id) {
    return elements.dialogCanvas.querySelector(`[data-element-id="${cssEscape(id)}"]`);
  }

  function moveCanvasNode(id, x, y) {
    const node = canvasNode(id);
    if (!node) return;
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
  }

  function moveElementTree(rootId) {
    const scene = currentScene();
    for (const element of scene?.elements || []) {
      if (element.id !== rootId && !isDescendantOf(element, rootId)) continue;
      const position = positionFor(element.id, element);
      moveCanvasNode(element.id, position.x, position.y);
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

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const { interactiveSource, parse } = require('./preview-input-surface-scope.test');
const { globalModel } = require('./preview-global-values.test');
const { removeTemporaryDirectory } = require('./helpers/temp-cleanup');

const root = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '..'));
const uri = file => pathToFileURL(path.join(root, file)).href;

const helperSource = [
  '[@main]', '#ACT', 'GOTO @helper', '#SAY', '<TEXT:主界面:20:20>',
  '[@helper]', '#ACT', 'MESSAGEBOX 提示：<$STR(S$VISIBLE)> @确定 @取消',
].join('\n');
const branchSource = [
  '[@main]', '#IF', 'EQUAL U240 1',
  '#ACT', 'MESSAGEBOX 开启分支 @确定 @取消',
  '#ELSEACT', 'MESSAGEBOX 关闭分支 @确定 @取消',
  '#SAY', '<TEXT:主界面:20:20>',
].join('\n');
const progressSource = [
  '[@main]', '#ACT',
  'SHOWPROGRESSBARDLG <$STR(N$DURATION)> @完成 处理中：<$STR(S$MESSAGE)> 1 @中断',
  '#SAY', '<TEXT:主界面:20:20>',
].join('\n');
const conditionalSurfaceSource = [
  '[@main]', '#SAY', '<TEXT:主界面:20:20>',
  '#IF', 'CHECK [401] 1', '#ACT',
  'MESSAGEBOX 条件消息：<$STR(S$GUARDED)> @确定 @取消',
  'ADDBUTTON 3 11 283 284 285 120 100 0|0 <$STR(S$BUTTON_TITLE)> 253/<$STR(S$BUTTON_TIP)>',
].join('\n');
const dynamicAddButtonSource = [
  '[@main]', '#SAY', '<TEXT:主界面:20:20>', '#ACT',
  'ADDBUTTON 3 12 283 284 285 160 140 0|0 <$STR(S$ADD_TITLE)> 253/<$STR(S$ADD_TIP)>',
].join('\n');
const hiddenSaySource = [
  '[@main]', '#IF', 'CHECK [402] 1', '#SAY',
  '<TEXT:开启值=<$STR(U9)>:20:20>',
  '#ELSESAY', '<TEXT:关闭:20:20>',
].join('\n');
const hiddenStmSource = [
  '[@main]', '#IF', 'CHECK [403] 1', '#SAY',
  '<Text|id=1|x=20|y=20|text=$STM(HP)>',
  '#ELSESAY', '<Text|id=2|x=20|y=20|text=关闭>',
].join('\n');
const snapshotSource = [
  '[@main]', '#ACT',
  'MOV S$R <$STR(S$SRC)>',
  'MESSAGEBOX 第一<$STR(S$R)> @确定 @取消',
  'ADDBUTTON 3 71 283 284 285 20 260 0|1 <$STR(S$R)> 253/第一提示',
  'MOV S$R 固定',
  'MESSAGEBOX 第二<$STR(S$R)> @确定 @取消',
  'ADDBUTTON 3 72 283 284 285 120 260 0|1 <$STR(S$R)> 253/第二提示',
  '#SAY', '<TEXT:主界面:20:20>',
].join('\n');
const deleteButtonSource = [
  '[@main]', '#SAY', '<TEXT:主界面:20:20>', '#ACT',
  'ADDBUTTON 3 63 283 284 285 20 290 0|1 可见按钮 253/提示',
  '#IF', 'CHECK [404] 1', '#ACT', 'DELBUTTON 63',
].join('\n');

const models = {
  globals: {
    initial: globalModel(),
    named: globalModel({ A201: '临时玩家' }),
    changed: globalModel({ A201: '临时玩家', G201: '100' }),
  },
  staticPages: {
    initial: parse('[@main]\nVIP 特权\nHP: <$STR(U9)>\n<下一页/@next>\n[@next]\n#SAY\n<TEXT:下一页内容:20:20>'),
  },
  interactive: {
    initial: parse(interactiveSource),
    changed: parse(interactiveSource, { U203: '42' }),
  },
  helper: {
    initial: parse(helperSource),
  },
  branch: {
    off: parse(branchSource),
    on: parse(branchSource, { U240: '1' }),
  },
  progress: {
    initial: parse(progressSource),
    changed: parse(progressSource, { 'S$MESSAGE': '正在写入属性' }),
  },
  conditional: {
    off: parse(conditionalSurfaceSource),
    on: parse(conditionalSurfaceSource, { '[401]': '1' }),
    title: parse(conditionalSurfaceSource, {
      '[401]': '1',
      'S$BUTTON_TITLE': '属性重载',
    }),
    buttonFilled: parse(conditionalSurfaceSource, {
      '[401]': '1',
      'S$BUTTON_TITLE': '属性重载',
      'S$BUTTON_TIP': '点击后重新计算属性',
    }),
    filled: parse(conditionalSurfaceSource, {
      '[401]': '1',
      'S$BUTTON_TITLE': '属性重载',
      'S$BUTTON_TIP': '点击后重新计算属性',
      'S$GUARDED': '属性已重载',
    }),
  },
  addButton: {
    initial: parse(dynamicAddButtonSource),
    title: parse(dynamicAddButtonSource, { 'S$ADD_TITLE': '属性重载' }),
    complete: parse(dynamicAddButtonSource, {
      'S$ADD_TITLE': '属性重载',
      'S$ADD_TIP': '点击后重新计算属性',
    }),
  },
  hiddenSay: {
    off: parse(hiddenSaySource),
    on: parse(hiddenSaySource, { '[402]': '1' }),
    filled: parse(hiddenSaySource, { '[402]': '1', U9: '99' }),
  },
  hiddenStm: {
    off: parse(hiddenStmSource, {}, '996PC'),
    on: parse(hiddenStmSource, { '[403]': '1' }, '996PC'),
  },
  snapshot: {
    initial: parse(snapshotSource),
    changed: parse(snapshotSource, { 'S$SRC': '来源值' }),
  },
  deleteButton: {
    off: parse(deleteButtonSource),
    on: parse(deleteButtonSource, { '[404]': '1' }),
  },
};
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'boo-preview-input-surface-'));

try {
  let html = fs.readFileSync(path.join(root, 'media/npc-dialog-visual.html'), 'utf8')
    .replaceAll('{{STYLE_URI}}', uri('media/npc-dialog-visual.css'))
    .replaceAll('{{SCRIPT_URI}}', uri('media/npc-dialog-visual.js'));
  const renderer = `<script src="${uri('media/npc-dialog-visual.js')}"></script>`;
  const mock = `<script>
  window.scopeModels=${JSON.stringify(models).replace(/</g, '\\u003c')};
  window.scopeMessages=[];
  window.scopeScenario='interactive';
  window.scopeModelState='initial';
  window.scopeRevision=0;
  window.scopeDeliver=(scenario,state,preserveDrafts)=>{
    scopeScenario=scenario;
    scopeModelState=state;
    const model=scopeModels[scenario]&&scopeModels[scenario][state];
    if(!model)throw Error('missing scope fixture '+scenario+'/'+state);
    const revision=++scopeRevision;
    window.dispatchEvent(new MessageEvent('message',{data:{
      type:'model',model,previewRevision:revision,preserveDrafts:preserveDrafts===true
    }}));
  };
  window.scopeShow=(scenario,state)=>scopeDeliver(scenario,state||'initial',false);
  window.acquireVsCodeApi=()=>({postMessage:message=>{
    scopeMessages.push(Object.assign({scenario:scopeScenario},message));
    if(message.type==='ready'){
      setTimeout(()=>scopeDeliver('interactive','initial',false),0);
      return;
    }
    if(scopeScenario==='globals'&&message.type==='resetPreview'){
      setTimeout(()=>scopeDeliver('globals','initial',true),0);return;
    }
    if(message.type!=='previewInput')return;
    let state;
    if(scopeScenario==='globals'&&message.name==='A201'&&message.value==='临时玩家')state='named';
    if(scopeScenario==='globals'&&message.name==='G201'&&message.value==='100')state='changed';
    if(scopeScenario==='interactive'&&message.name==='U203'&&message.value==='42')state='changed';
    if(scopeScenario==='progress'&&message.name==='S$MESSAGE'&&message.value==='正在写入属性')state='changed';
    if(scopeScenario==='conditional'&&message.name==='[401]')state=message.value==='1'?'on':'off';
    if(scopeScenario==='conditional'&&message.name==='S$BUTTON_TITLE'&&message.value==='属性重载')state='title';
    if(scopeScenario==='conditional'&&message.name==='S$BUTTON_TIP'&&message.value==='点击后重新计算属性')state='buttonFilled';
    if(scopeScenario==='conditional'&&message.name==='S$GUARDED'&&message.value==='属性已重载')state='filled';
    if(scopeScenario==='addButton'&&message.name==='S$ADD_TITLE'&&message.value==='属性重载')state='title';
    if(scopeScenario==='addButton'&&message.name==='S$ADD_TIP'&&message.value==='点击后重新计算属性')state='complete';
    if(scopeScenario==='hiddenSay'&&message.name==='U9'&&message.value==='99')state='filled';
    if(scopeScenario==='snapshot'&&message.name==='S$SRC'&&message.value==='来源值')state='changed';
    if(scopeScenario==='deleteButton'&&message.name==='[404]')state=message.value==='1'?'on':'off';
    if(state)setTimeout(()=>scopeDeliver(scopeScenario,state,true),0);
  }});
  </script>`;
  html = html.replace(renderer, () => mock + renderer);
  html = html.replace('</body>', () => `<script>
  const wait=()=>new Promise(resolve=>setTimeout(resolve,100));
  const waitFor=async(predicate,message)=>{
    for(let attempt=0;attempt<40;attempt++){
      if(predicate())return;
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    throw Error(message||'timed out waiting for DOM update');
  };
  const check=(value,message)=>{if(!value)throw Error(message);};
  const field=name=>[...document.querySelectorAll('[data-preview-name]')]
    .find(input=>input.dataset.previewName===name);
  const fieldNames=()=>[...document.querySelectorAll('[data-preview-name]')]
    .map(input=>input.dataset.previewName).sort();
  const canvas=()=>document.getElementById('dialogCanvas').textContent;
  const cards=()=>[...document.querySelectorAll('.act-ui-preview-card')];
  const cardField=(card,name)=>card&&card.querySelector('[data-act-ui-field="'+name+'"]');
  const cardValue=(card,name)=>cardField(card,name)?.querySelector('.act-ui-field-value')?.textContent||'';
  const addButton=id=>document.querySelector('[data-addbutton-trigger-id="'+id+'"]');
  const visible=node=>{
    if(!node)return false;
    const style=getComputedStyle(node);
    const rect=node.getBoundingClientRect();
    return style.display!=='none'&&style.visibility!=='hidden'&&rect.width>0&&rect.height>0;
  };
  const show=async(scenario,state)=>{scopeShow(scenario,state);await wait();};
  const failures=[];
  const test=async(name,fn)=>{
    try{await fn();}
    catch(error){failures.push(name+': '+(error&&error.message?error.message:String(error)));}
  };
  const tooltipText=async wrapper=>{
    wrapper.dispatchEvent(new MouseEvent('mouseenter',{bubbles:true,clientX:300,clientY:240}));
    await wait();
    const tooltip=document.querySelector('.dialog-tooltip:not(.hidden)');
    const value=tooltip?.textContent||'';
    wrapper.dispatchEvent(new MouseEvent('mouseleave',{bubbles:true}));
    return value;
  };

  window.addEventListener('load',async()=>{
    await wait();

    await test('baseline business-variable projection',async()=>{
      check(fieldNames().length===1&&fieldNames()[0]==='U203',
        'expected only U203, got '+fieldNames().join(','));
      for(const name of ['U201','U202','N$攻击','S$内部','[301]']){
        check(!field(name),'business-only input leaked into DOM: '+name);
      }
      check(canvas().includes('随机结果=0'),'default visible value missing');
      check(canvas().includes('完成这个任务后获得属性'),'main interface text is missing');
      const input=field('U203');
      const rect=input.getBoundingClientRect();
      check(rect.width>0&&rect.height>0,'visible input has no geometry');
      const hit=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);
      check(hit===input||input.contains(hit),'visible input is not hittable');
      input.focus();
      input.value='42';
      input.dispatchEvent(new Event('input',{bubbles:true}));
      input.dispatchEvent(new Event('change',{bubbles:true}));
      await waitFor(()=>canvas().includes('随机结果=42'),'changing U203 did not repaint the canvas');
      check(document.activeElement===field('U203'),'model refresh lost U203 focus');
      const submitted=scopeMessages.filter(message=>message.scenario==='interactive'&&message.type==='previewInput');
      check(submitted.length===1&&submitted[0].name==='U203'&&submitted[0].value==='42',
        'wrong U203 previewInput message');
    });

    await test('automatic GOTO helper MESSAGEBOX',async()=>{
      await show('helper','initial');
      check(fieldNames().length===1&&fieldNames()[0]==='S$VISIBLE',
        'helper visible-message input missing or polluted: '+fieldNames().join(','));
      check(cards().length===1,'expected one helper ACT card, got '+cards().length);
      const card=cards()[0];
      check(card.dataset.actUiCommand==='messagebox','helper card is not MESSAGEBOX');
      check(card.dataset.actUiSourceLabel==='@helper','helper source label was lost');
      check(cardValue(card,'message')==='提示：预览文字','helper message preview is wrong');
      check(visible(card),'helper MESSAGEBOX card has no visible geometry');
      check(!document.getElementById('dialogCanvas').contains(card),'helper ACT card leaked into coordinate canvas');
    });

    await test('ACT and ELSEACT current card branch',async()=>{
      await show('branch','off');
      check(cards().length===1,'false branch rendered '+cards().length+' ACT cards');
      check(cardValue(cards()[0],'message')==='关闭分支','false branch did not render ELSEACT card');
      await show('branch','on');
      check(cards().length===1,'true branch rendered '+cards().length+' ACT cards');
      check(cardValue(cards()[0],'message')==='开启分支','true branch did not render ACT card');
    });

    await test('progress exposes only visible message input',async()=>{
      await show('progress','initial');
      check(fieldNames().length===1&&fieldNames()[0]==='S$MESSAGE',
        'progress inputs must contain only S$MESSAGE, got '+fieldNames().join(','));
      check(!field('N$DURATION'),'runtime-only duration appeared as an input');
      check(cards().length===1&&cards()[0].dataset.actUiCommand==='show-progress-bar',
        'progress card missing');
      check(cardValue(cards()[0],'message')==='处理中：预览文字','progress placeholder message is wrong');
      const duration=cardField(cards()[0],'duration-seconds');
      check(duration&&duration.dataset.actUiFieldStatus==='dynamic',
        'dynamic duration diagnostic was not preserved on the read-only card');
      check(cardValue(cards()[0],'duration-seconds')!=='0',
        'duration borrowed a display/input zero as a timer value');
      const input=field('S$MESSAGE');
      input.focus();
      input.value='正在写入属性';
      input.dispatchEvent(new Event('input',{bubbles:true}));
      input.dispatchEvent(new Event('change',{bubbles:true}));
      await waitFor(()=>cards().length===1&&cardValue(cards()[0],'message')==='处理中：正在写入属性',
        'message input did not refresh progress card text');
      check(!field('N$DURATION'),'duration input appeared after message refresh');
      check(document.activeElement===field('S$MESSAGE'),'progress message refresh lost input focus');
    });

    await test('disabled condition remains switchable',async()=>{
      await show('conditional','off');
      check(cards().length===0,'disabled condition still rendered an ACT card');
      check(!addButton(11),'disabled condition still rendered ADDBUTTON 11');
      const toggle=field('[401]');
      check(JSON.stringify(fieldNames())===JSON.stringify(['[401]']),
        'disabled condition must publish only its enable switch, got '+fieldNames().join(','));
      check(toggle.type==='checkbox'&&!toggle.checked,'condition switch is not an unchecked flag');
      check(visible(toggle),'condition switch has no visible geometry');
      toggle.click();
      await waitFor(()=>cards().length===1&&Boolean(addButton(11)),
        'enabling [401] did not reveal the ACT card and ADDBUTTON');
      check(JSON.stringify(fieldNames())===JSON.stringify([
        'S$BUTTON_TIP','S$BUTTON_TITLE','S$GUARDED','[401]'
      ]),'enabled condition did not publish exactly its visible text inputs: '+fieldNames().join(','));
      check(cardValue(cards()[0],'message')==='条件消息：预览文字','enabled ACT card has wrong placeholder message');
      let button=addButton(11);
      check(visible(button),'enabled ADDBUTTON has no visible geometry');
      check((button.querySelector('.button-caption')?.textContent||'')==='预览文字',
        'enabled ADDBUTTON did not use the title placeholder');
      check((await tooltipText(button))==='预览文字',
        'enabled ADDBUTTON did not use the tooltip placeholder');
      check(field('[401]')?.checked===true,'condition switch did not remain enabled after refresh');

      let buttonInput=field('S$BUTTON_TITLE');
      buttonInput.focus();
      buttonInput.value='属性重载';
      buttonInput.dispatchEvent(new Event('input',{bubbles:true}));
      buttonInput.dispatchEvent(new Event('change',{bubbles:true}));
      await waitFor(()=>((addButton(11)?.querySelector('.button-caption')?.textContent)||'')==='属性重载',
        'conditional title input did not repaint ADDBUTTON 11');
      check(document.activeElement===field('S$BUTTON_TITLE'),
        'conditional title refresh lost input focus');

      buttonInput=field('S$BUTTON_TIP');
      buttonInput.focus();
      buttonInput.value='点击后重新计算属性';
      buttonInput.dispatchEvent(new Event('input',{bubbles:true}));
      buttonInput.dispatchEvent(new Event('change',{bubbles:true}));
      await waitFor(()=>scopeModelState==='buttonFilled',
        'conditional tooltip input model was not delivered');
      button=addButton(11);
      check((button.querySelector('.button-caption')?.textContent||'')==='属性重载',
        'conditional tooltip refresh discarded the entered title');
      check((await tooltipText(button))==='点击后重新计算属性',
        'conditional tooltip input did not repaint ADDBUTTON 11');
      check(document.activeElement===field('S$BUTTON_TIP'),
        'conditional tooltip refresh lost input focus');

      const guarded=field('S$GUARDED');
      check(guarded&&visible(guarded),'enabled branch did not publish its visible card text input');
      guarded.focus();
      guarded.value='属性已重载';
      guarded.dispatchEvent(new Event('input',{bubbles:true}));
      guarded.dispatchEvent(new Event('change',{bubbles:true}));
      await waitFor(()=>cards().length===1&&cardValue(cards()[0],'message')==='条件消息：属性已重载',
        'guarded text input did not repaint the visible card');
      check(document.activeElement===field('S$GUARDED'),'guarded text refresh lost input focus');
      field('[401]').click();
      await waitFor(()=>cards().length===0&&!addButton(11)&&fieldNames().length===1,
        'turning the condition off did not remove its card, button, and dynamic text inputs');
      check(JSON.stringify(fieldNames())===JSON.stringify(['[401]']),
        'turning the branch off did not restore the single-switch input surface');
      const submitted=scopeMessages.filter(message=>message.scenario==='conditional'&&message.type==='previewInput');
      check(submitted.length===5
        &&submitted[0].name==='[401]'&&submitted[0].value==='1'
        &&submitted[1].name==='S$BUTTON_TITLE'&&submitted[1].value==='属性重载'
        &&submitted[2].name==='S$BUTTON_TIP'&&submitted[2].value==='点击后重新计算属性'
        &&submitted[3].name==='S$GUARDED'&&submitted[3].value==='属性已重载'
        &&submitted[4].name==='[401]'&&submitted[4].value==='0',
        'condition surface sent the wrong previewInput sequence');
    });

    await test('hidden SAY and STM branches publish only active inputs',async()=>{
      await show('hiddenSay','off');
      check(JSON.stringify(fieldNames())===JSON.stringify(['[402]']),
        'hidden SAY branch leaked inputs: '+fieldNames().join(','));
      check(canvas().includes('关闭')&&!canvas().includes('开启值='),'hidden SAY branch painted the wrong side');
      await show('hiddenSay','on');
      check(JSON.stringify(fieldNames())===JSON.stringify(['U9','[402]']),
        'active SAY branch did not publish U9: '+fieldNames().join(','));
      check(canvas().includes('开启值=0'),'active SAY branch did not use the numeric placeholder');
      const number=field('U9');
      number.value='99';
      number.dispatchEvent(new Event('input',{bubbles:true}));
      number.dispatchEvent(new Event('change',{bubbles:true}));
      await waitFor(()=>canvas().includes('开启值=99'),'active SAY input did not repaint the canvas');

      await show('hiddenStm','off');
      check(JSON.stringify(fieldNames())===JSON.stringify(['[403]']),
        'hidden 996PC STM branch leaked inputs: '+fieldNames().join(','));
      check(canvas().includes('关闭'),'hidden STM fixture did not display its ELSE branch');
      await show('hiddenStm','on');
      check(JSON.stringify(fieldNames())===JSON.stringify(['STM(HP)','[403]']),
        'active 996PC STM branch did not publish STM(HP): '+fieldNames().join(','));
      const stmWrapper=[...document.querySelectorAll('#dialogCanvas [data-element-id]')]
        .find(node=>node.dataset.elementId.endsWith(':newui-text-996pc'));
      const stmText=stmWrapper?.querySelector('.styled-text-preview');
      check(stmText&&stmText.textContent==='0',
        'active STM target element did not draw the exact numeric placeholder');
      check(visible(stmWrapper)&&visible(stmText),
        'active STM target element or its exact text has no visible geometry');
    });

    await test('DELBUTTON condition reaches the final DOM without simulating a client deletion',async()=>{
      await show('deleteButton','off');
      check(JSON.stringify(fieldNames())===JSON.stringify(['[404]']),
        'attached DELBUTTON condition has the wrong input surface: '+fieldNames().join(','));
      let button=addButton(63);
      check(visible(button),'button controlled by DELBUTTON is not initially visible');
      check(!button.querySelector('.addbutton-lifecycle-boundary'),
        'inactive DELBUTTON already appears on the final button DOM');

      field('[404]').click();
      await waitFor(()=>Boolean(addButton(63)?.querySelector('.addbutton-lifecycle-boundary')),
        'enabling [404] did not attach DELBUTTON lifecycle evidence to the final DOM');
      button=addButton(63);
      const lifecycle=button.querySelector('.addbutton-lifecycle-boundary');
      check(visible(button)&&!visible(lifecycle),
        'DELBUTTON diagnostics must stay hidden on the client-like default surface');
      check(lifecycle.textContent.includes('DELBUTTON 63 · 自己 / self'),
        'active DELBUTTON final DOM lost its button id or scope');
      check((button.querySelector('.button-caption')?.textContent||'')==='可见按钮',
        'local preview incorrectly simulated destructive client deletion');

      const details=document.getElementById('canvasDiagnosticsToggle');
      details.click();
      await wait();
      check(details.getAttribute('aria-pressed')==='true'&&visible(lifecycle),
        'details toggle did not reveal DELBUTTON lifecycle evidence with positive geometry');

      field('[404]').click();
      await waitFor(()=>Boolean(addButton(63))&&!addButton(63).querySelector('.addbutton-lifecycle-boundary'),
        'turning [404] off did not remove DELBUTTON lifecycle evidence');
      details.click();
      await wait();
      check(details.getAttribute('aria-pressed')==='false',
        'DELBUTTON test did not restore the client-like default surface');
    });

    await test('source-order snapshots preserve every visible dependency',async()=>{
      await show('snapshot','initial');
      check(JSON.stringify(fieldNames())===JSON.stringify(['S$SRC']),
        'same-name snapshot dependency was lost or polluted: '+fieldNames().join(','));
      check(cards().length===2,'snapshot fixture did not render both ACT cards');
      check(cardValue(cards()[0],'message')==='第一预览文字','first ACT snapshot has wrong placeholder');
      check(cardValue(cards()[1],'message')==='第二固定','second ACT snapshot has wrong static value');
      check((addButton(71)?.querySelector('.button-caption')?.textContent||'')==='预览文字',
        'first ADDBUTTON snapshot has wrong placeholder');
      check((addButton(72)?.querySelector('.button-caption')?.textContent||'')==='固定',
        'second ADDBUTTON snapshot has wrong static value');
      const sourceInput=field('S$SRC');
      sourceInput.value='来源值';
      sourceInput.dispatchEvent(new Event('input',{bubbles:true}));
      sourceInput.dispatchEvent(new Event('change',{bubbles:true}));
      await waitFor(()=>cards().length===2&&cardValue(cards()[0],'message')==='第一来源值',
        'source-order ACT dependency did not repaint');
      check(cardValue(cards()[1],'message')==='第二固定','source-order refresh changed the later static ACT value');
      check((addButton(71)?.querySelector('.button-caption')?.textContent||'')==='来源值',
        'source-order ADDBUTTON dependency did not repaint');
      check((addButton(72)?.querySelector('.button-caption')?.textContent||'')==='固定',
        'source-order refresh changed the later static ADDBUTTON value');
    });

    await test('ADDBUTTON title and tooltip inputs refresh DOM',async()=>{
      await show('addButton','initial');
      check(JSON.stringify(fieldNames())===JSON.stringify(['S$ADD_TIP','S$ADD_TITLE']),
        'dynamic ADDBUTTON inputs are wrong: '+fieldNames().join(','));
      let button=addButton(12);
      check(visible(button),'dynamic ADDBUTTON is not visible');
      check((button.querySelector('.button-caption')?.textContent||'')==='预览文字',
        'dynamic ADDBUTTON title placeholder is wrong');
      check((await tooltipText(button))==='预览文字','dynamic ADDBUTTON tooltip placeholder is wrong');

      let input=field('S$ADD_TITLE');
      input.focus();
      input.value='属性重载';
      input.dispatchEvent(new Event('input',{bubbles:true}));
      input.dispatchEvent(new Event('change',{bubbles:true}));
      await waitFor(()=>((addButton(12)?.querySelector('.button-caption')?.textContent)||'')==='属性重载',
        'title input did not refresh ADDBUTTON caption');
      check(document.activeElement===field('S$ADD_TITLE'),'title refresh lost input focus');

      input=field('S$ADD_TIP');
      input.focus();
      input.value='点击后重新计算属性';
      input.dispatchEvent(new Event('input',{bubbles:true}));
      input.dispatchEvent(new Event('change',{bubbles:true}));
      await waitFor(()=>scopeModelState==='complete','tooltip input model was not delivered');
      button=addButton(12);
      check((button.querySelector('.button-caption')?.textContent||'')==='属性重载',
        'tooltip refresh discarded the entered title');
      check((await tooltipText(button))==='点击后重新计算属性',
        'tooltip input did not refresh the visible ADDBUTTON tooltip');
      check(document.activeElement===field('S$ADD_TIP'),'tooltip refresh lost input focus');
    });

    await test('persistent G/A defaults remain editable and reset to disk values',async()=>{
      await show('globals','initial');
      check(field('A201')?.value===''&&field('G201')?.value==='40','INI defaults missing from input fields');
      check(canvas().includes('暂无')&&canvas().includes('数量=42'),'INI initial values did not reach GOTO/display');
      check(visible(field('A201'))&&visible(field('G201')),'global fields are not visible');
      for(const [name,value,expected] of [['A201','临时玩家','获取玩家=临时玩家'],['G201','100','数量=102']]){
        const input=field(name);input.focus();input.value=value;
        input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
        await waitFor(()=>canvas().includes(expected),'global edit did not update visible result');
        check(document.activeElement===field(name),'global edit lost focus');
      }
      const player=[...document.querySelectorAll('#dialogCanvas [data-element-id]')]
        .find(node=>node.querySelector('.styled-text-preview')?.textContent==='[查看获取玩家]');
      check(visible(player)&&(await tooltipText(player))==='临时玩家','actual player tooltip did not display the edited A201');
      document.getElementById('resetPreview').click();
      await waitFor(()=>field('G201')?.value==='40'&&field('A201')?.value==='','reset did not restore file defaults');
      check(canvas().includes('暂无')&&canvas().includes('数量=42'),'reset did not restore canvas');
    });

    await test('directive-free captions stay visible',async()=>{
      await show('staticPages','initial');
      check(canvas().includes('VIP 特权')&&canvas().includes('HP: 0'),'static English/mixed captions disappeared');
      check(visible(field('U9')),'static caption has no usable variable input');
    });

    await test('scope preview remains local-only',async()=>{
      check(!scopeMessages.some(message=>['apply','save','locate','previewCondition','openExternal','executeCommand'].includes(message.type)),
        'scope interaction emitted a source, navigation, or execution action');
    });

    document.body.dataset.surfaceScopeDomCount=String(document.querySelectorAll('*').length);
    document.body.dataset.surfaceScope=failures.length===0?'PASS':'ERROR';
    if(failures.length)document.body.dataset.surfaceScopeErrors=failures.join(' || ');
  });
  </script></body>`);

  const fixture = path.join(temp, 'fixture.html');
  fs.writeFileSync(fixture, html);
  const candidates = [...new Set([
    process.env.BOO_BROWSER_EXECUTABLE,
    process.env.BOO_CHROMIUM_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].filter(executable => executable && fs.existsSync(executable)))];
  assert.ok(candidates.length, 'real Edge/Chrome is required');

  const attempts = [];
  let passed;
  for (const [index, executable] of candidates.entries()) {
    const escapedExecutable = executable.replaceAll("'", "''");
    const version = spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `(Get-Item -LiteralPath '${escapedExecutable}').VersionInfo.ProductVersion`,
    ], {
      encoding: 'utf8', windowsHide: true, timeout: 10000,
    });
    const result = spawnSync(executable, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--allow-file-access-from-files',
      '--window-size=1440,1000', '--virtual-time-budget=8000', '--dump-dom',
      `--user-data-dir=${path.join(temp, `profile-${index}`)}`,
      pathToFileURL(fixture).href,
    ], {
      encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024,
    });
    const diagnostic = (result.stdout || '').match(/data-surface-scope="[^"]*"/)?.[0];
    const errors = (result.stdout || '').match(/data-surface-scope-errors="([^"]*)"/)?.[1];
    const domCount = (result.stdout || '').match(/data-surface-scope-dom-count="([^"]*)"/)?.[1];
    attempts.push({
      executable,
      version: (version.stdout || version.stderr || 'unknown').trim(),
      status: result.status,
      error: result.error?.message,
      diagnostic,
      errors,
      domCount,
    });
    if (!result.error && result.status === 0 && result.stdout.includes('data-surface-scope="PASS"')) {
      passed = attempts.at(-1);
      break;
    }
  }
  assert.ok(passed, JSON.stringify(attempts, null, 2));
  console.log(
    `preview-input-surface-scope-browser.test.js: PASS ${passed.executable}; ${passed.version}; DOM=${passed.domCount}`,
  );
} finally {
  removeTemporaryDirectory(temp);
}

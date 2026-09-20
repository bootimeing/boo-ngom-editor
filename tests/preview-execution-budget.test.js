const assert=require('node:assert/strict');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const runtime=path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT||path.join(__dirname,'..'));

function tree(depth){
 const lines=[];
 for(let index=1;index<=depth;index++)lines.push('[@f'+index+']','#ACT',
  ...(index===depth?['INC N0 1']:['GOTO @f'+(index+1),'GOTO @f'+(index+1)]));
 return lines;
}
function resolve(lines,targetLabels=['@main']){
 const {resolveDialogVariables}=require(path.join(runtime,'out/ui-dialog/variable-resolver'));
 return resolveDialogVariables(lines.join('\n'),{engine:'GOM',rootLabel:'@main',targetLabels,previewValues:{}});
}
function output(result,lines,prefix){
 const line=lines.findIndex(value=>value.startsWith(prefix));assert.ok(line>=0);
 const resolved=result.byLabel.get('@MAIN')?.lines.get(line);assert.ok(resolved,'source line diagnostics remain available');
 return resolved;
}
function budgetWarning(result){
 assert.ok(result.warnings.some(value=>/总|全局/.test(value)&&/步|预算|上限/.test(value)),
  'exponential acyclic calls must stop with an explicit shared execution-budget warning: '+JSON.stringify(result.warnings));
}
function child(scenario){
 const started=performance.now();
 if(scenario==='normal'){
  const lines=['[@main]','#ACT','MOV N0 0','GOTO @f1','#SAY','PROBE <$STR(N0)>',...tree(4)];
  const result=resolve(lines),value=output(result,lines,'PROBE ').variables.find(item=>item.name==='N0');
  assert.equal(value.value,'8');assert.equal(value.status,'resolved');assert.deepEqual(result.warnings,[]);
 }else if(scenario==='exponential'){
  const lines=['[@main]','#ACT','MOV N0 7','#SAY','BEFORE <$STR(N0)>','#ACT','MOV N0 0','GOTO @f1','#SAY','AFTER <$STR(N0)>',...tree(20)];
  const result=resolve(lines);budgetWarning(result);
  const value=output(result,lines,'AFTER ').variables.find(item=>item.name==='N0');
  assert.ok(value&&value.status!=='resolved','a partially executed total must not retain static proof');
  assert.equal(value.value,'0','unproved final quantity displays the ordinary numeric fallback');
  assert.ok(result.executionTrace.some(event=>event.resolution.text==='BEFORE 7'),'already emitted source-proved SAY is retained');
  assert.ok(!result.executionTrace.some(event=>event.resolution.text.startsWith('AFTER ')),'the trace must not invent a post-abort SAY execution');
 }else if(scenario==='return'){
  const lines=['[@main]','#ACT','MOV N$RESULT 99','GOTO @outer(|N$RESULT)','#SAY','PROBE <$STR(N$RESULT)>',
   '[@outer]','#ACT','GOTO @f1','RETURN 9',...tree(20)];
  const result=resolve(lines);budgetWarning(result);
  const value=output(result,lines,'PROBE ').variables.find(item=>item.name==='N$RESULT');
  assert.ok(value&&value.status!=='resolved','an outer literal RETURN after the stopped inner call cannot acquire proof');
  assert.equal(value.value,'0','neither the stale caller value 99 nor the unexecuted return 9 may survive');
 }else if(scenario==='shared-targets'){
  const lines=['[@main]','#ACT','MOV N0 0','GOTO @f1','#SAY','PROBE <$STR(N0)>',...tree(15)];
  const result=resolve(lines,['@main','@f1','@f2']);budgetWarning(result);
 }else if(scenario==='inactive-scan-shared'){
  const lines=['[@main]','#ACT','MOV N0 7','#IF','CHECK [401] 1','#ACT',
   ...Array.from({length:120},()=> 'GOTO @helper'),'#IF','#SAY','PROBE <$STR(N0)>',
   '[@helper]','#ACT',...Array.from({length:200},()=> 'INC N0 1')];
  const result=resolve(lines);
  assert.ok(result.warnings.some(value=>/未执行.*全局.*20000/.test(value)),
   'inactive calls must share one bounded scan, not reset a 20000-step budget per call');
  const value=output(result,lines,'PROBE ').variables.find(item=>item.name==='N0');
  assert.equal(value.value,'7','scan-budget exhaustion must not execute or erase the inactive RHS');
  assert.ok(value.previewInputNames.includes('[401]'),'dependencies found before the bound survive');
 }else if(scenario==='parse'){
  const {parse}=require('./preview-inputs-integration.test');
  const lines=['[@main]','#ACT','MOV N0 7','#SAY','<TEXT:已执行=<$STR(N0)>:40:40>','#ACT','MOV N0 0','GOTO @f1','#SAY','<TEXT:结束=<$STR(N0)>:40:80>',...tree(20)];
  const model=parse(lines.join('\n'));budgetWarning(model);
  const resolved=model.pages.flatMap(page=>page.resolvedVariables||[]);
  assert.ok(!resolved.some(value=>value.name==='N0'&&value.status==='resolved'&&value.value!=='7'),
   'actual model must not certify the partial total or an unexecuted final result');
 }else throw Error('unknown bounded child scenario');
 console.log(JSON.stringify({scenario,elapsedMs:Math.round(performance.now()-started),passed:true}));
}
function run(){
 for(const scenario of ['normal','exponential','return','shared-targets','inactive-scan-shared','parse']){
  const result=spawnSync(process.execPath,[__filename,'--bounded-child',scenario],
   {cwd:path.join(__dirname,'..'),env:process.env,encoding:'utf8',windowsHide:true,timeout:8000,maxBuffer:2*1024*1024});
  assert.equal(result.error,undefined,scenario+' exceeded the bounded child limit: '+String(result.error));
  assert.equal(result.status,0,scenario+' failed: '+result.stdout+'\n'+result.stderr);
  const evidence=JSON.parse(result.stdout.trim());assert.equal(evidence.passed,true);console.log(JSON.stringify(evidence));
 }
 console.log('preview-execution-budget.test.js: PASS global bounded acyclic execution, partial-proof revocation, prior SAY, RETURN, targets and real parse');
}
if(require.main===module){if(process.argv[2]==='--bounded-child')child(process.argv[3]);else run();}
module.exports={run};

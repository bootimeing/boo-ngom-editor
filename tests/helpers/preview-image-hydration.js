const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(process.env.BOO_NPC_DIALOG_RUNTIME_ROOT || path.join(__dirname, '../..'));
function manager(vscodeOverrides = {}) {
  const filename = path.join(root, 'out/providers/npc-dialog-visual.js');
  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = Module._load;
  const uri = value => ({fsPath:value,path:value,scheme:'file',toString:()=>value});
  Module._load = function(request, parent, isMain) {
    if(request === 'vscode') return {Uri:{parse:uri,file:uri,joinPath:(base,...parts)=>uri(path.join(base.fsPath,...parts))},
      EventEmitter:class{constructor(){this.event=()=>{};}fire(){}dispose(){}},Disposable:{from:()=>({dispose(){}})},workspace:{},window:{showErrorMessage(){}},commands:{},...vscodeOverrides};
    return original.call(this,request,parent,isMain);
  };
  try { compiled._compile(fs.readFileSync(filename,'utf8')+'\nmodule.exports.TestManager=NpcDialogVisualEditorManager;',filename); }
  finally { Module._load = original; }
  return Object.create(compiled.exports.TestManager.prototype);
}
async function hydrate(model, distinctStates = false) {
  const instance=manager(), requests=[];
  instance.scriptDataResolver={resolveItemFieldByIndex:()=>undefined,resolveItemFieldByName:()=>undefined};
  instance.resolveAsset=reference=>{
    requests.push({...reference});
    const fill=distinctStates?['#44bbee','#f8c23a','#ee6644'][Number(reference.imageIndex)%3]:'#f8c23a';
    return {status:'ready',url:'data:image/svg+xml;base64,'+Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="24"><rect width="40" height="24" fill="${fill}"/></svg>`).toString('base64'),width:40,height:24,offsetX:0,offsetY:0,archiveLabel:'Synthetic test image; not user cache'};
  };
  await instance.hydrateAssets(model,{}, {fileName:'preview-image-test.txt'});
  return requests;
}
module.exports={hydrate,manager};

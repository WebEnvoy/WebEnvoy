import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

const root=fileURLToPath(new URL('.',import.meta.url));
const patched=execFileSync('python3',['-c',`
import sys,importlib.util,zipfile,hashlib
sys.dont_write_bytecode=True
spec=importlib.util.spec_from_file_location('patch',sys.argv[1]+'adoption-patch.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with zipfile.ZipFile('/Applications/Camoufox.app/Contents/Resources/omni.ja') as z:
 s=z.read('chrome/juggler/content/TargetRegistry.js')
 assert hashlib.sha256(s).hexdigest()=='01c55e3aad7b2e2d1076091731c1bafdd156b2b2a7a6226ab531026fcd92a7e1'
 print(m.patch(s.decode()))
`,root],{encoding:'utf8'});
const methods=patched.slice(patched.indexOf('  _listenToNativeBrowser()'),patched.indexOf('  async activateAndRun('));
const dispose=patched.slice(patched.indexOf('  dispose() {\n    this.ensureContextMenuClosed();'),patched.indexOf('\n}\n\nPageTarget.Events'));
let removals=0,bindings=0;
const helper={
  addObserver:()=>()=>{},addEventListener:()=>()=>{},
  addProgressListener:(browser)=>{const context=browser.browsingContext;bindings++;return()=>{assert.equal(browser.browsingContext,context,'progress removed after native swap');removals++;};},
  removeListeners:items=>items.forEach(remove=>remove()),
};
const globals={helper,ChromeUtils:{generateQI:()=>()=>{}},Ci:{nsIWebProgress:{NOTIFY_LOCATION:1}},TargetRegistry:{Events:{TargetDestroyed:'destroyed'}},dump:()=>{}};
const Registry=vm.runInNewContext(`(class {${readFileSync(new URL('./adoption.js',import.meta.url),'utf8')}})`,globals);
const Target=vm.runInNewContext(`(class {${methods}${dispose}})`,globals);
function setup({closing=true,sameContext=true}={}){
  const registry=new Registry();registry._browserToTarget=new Map();registry._browserIdToTarget=new Map();registry.emit=()=>{};
  const owner={pages:new Set()};
  function make(id,ownerContext){
    const context={id,browserId:id};const browser={browsingContext:context};
    const window={gBrowser:{getTabForBrowser:b=>b===browser?tab:null}};
    const tab={linkedBrowser:browser,ownerGlobal:window,isConnected:true,closing:false};browser.ownerGlobal=window;
    const target=new Target();Object.assign(target,{_linkedBrowser:browser,_tab:tab,_window:window,_gBrowser:window.gBrowser,
      _registry:registry,_browserContext:ownerContext,_registeredBrowserId:id,_actor:{},_channel:{},_disposed:false,
      _updateModalDialogs(){},_onNavigated(){},_willChangeBrowserRemoteness(){},ensureContextMenuClosed(){},browserContext(){return this._browserContext;}});
    target._listenToNativeBrowser();ownerContext.pages.add(target);registry._browserToTarget.set(browser,target);registry._browserIdToTarget.set(id,target);
    return {target,browser,tab,context};
  }
  const b=make('B',owner),placeholder=make('placeholder',sameContext?owner:{pages:new Set()});b.tab.closing=closing;
  const start={target:placeholder.browser,detail:b.browser},end={target:placeholder.browser,detail:b.browser};
  return {registry,b,placeholder,owner,start,end,swap(){[b.browser.browsingContext,placeholder.browser.browsingContext]=[placeholder.browser.browsingContext,b.browser.browsingContext];}};
}
const s=setup(),actor=s.b.target._actor,channel=s.b.target._channel;
s.registry._onNativeSwap(s.start);s.registry._onNativeSwap({target:s.b.browser,detail:s.placeholder.browser});
assert.equal(removals,2);assert.equal(s.b.target._nativeSwapPending,true);
s.swap();s.registry._onNativeSwapDone(s.end);
assert.equal(s.b.target._linkedBrowser,s.placeholder.browser);assert.equal(s.b.target._tab,s.placeholder.tab);
assert.equal(s.registry._browserIdToTarget.get('B'),s.b.target);assert.equal(s.registry._browserToTarget.get(s.placeholder.browser),s.b.target);
assert.equal(s.b.target._actor,actor);assert.equal(s.b.target._channel,channel);assert.equal(s.b.target._disposed,false);
assert.equal(s.placeholder.target._disposed,true);assert.equal(s.owner.pages.size,1);assert.equal(s.registry._browserIdToTarget.has('placeholder'),false);
s.registry._onNativeSwapDone({target:s.b.browser,detail:s.placeholder.browser});assert.equal(s.b.target._tab,s.placeholder.tab);
const last=setup({closing:false});last.registry._onNativeSwap(last.start);last.swap();last.registry._onNativeSwapDone(last.end);
assert.equal(last.owner.pages.size,2);last.registry._browserToTarget.get(last.b.browser).dispose();
assert.equal(last.owner.pages.size,1);assert.equal(last.b.target._disposed,false);
const missing=setup();missing.registry._onNativeSwap(missing.start);missing.registry._onNativeSwapDone(missing.end);assert.equal(missing.b.target._nativeSwapPending,true);
const cross=setup({sameContext:false});cross.registry._onNativeSwap(cross.start);cross.swap();cross.registry._onNativeSwapDone(cross.end);assert.equal(cross.b.target._nativeSwapPending,true);
const absent=setup();absent.registry._browserToTarget.delete(absent.placeholder.browser);absent.registry._onNativeSwap(absent.start);assert.equal(absent.b.target._nativeSwapPending,true);
console.log('PASS: native context swap retains real target/actor/channel; listeners detach before swap; duplicate, close-last, partial and cross-context paths');
const {isCurrentObservation}=await import('./observation-reference.mjs');
const reference={epoch:'connection-1',targetId:'B',tabId:'old-tab',windowId:'old-window'};
assert(isCurrentObservation(reference,{...reference}));
for(const key of Object.keys(reference))assert.equal(isCurrentObservation(reference,{...reference,[key]:'replacement'}),false);
assert.equal(isCurrentObservation({},{}),false);assert.equal(isCurrentObservation(reference,null),false);
console.log('PASS: moved/replaced/closed/restarted bindings require a new observation; missing identities never match');

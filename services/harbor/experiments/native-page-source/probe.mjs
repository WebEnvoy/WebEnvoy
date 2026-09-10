// Local-only prototype Driver; no public tool or network protocol endpoint.
import assert from 'node:assert/strict';
import {foreground} from './foreground.mjs';
import {createHash} from 'node:crypto';
import {dirname,join} from 'node:path';
import {createRequire} from 'node:module';
import {readFileSync,appendFileSync} from 'node:fs';
import {createInterface} from 'node:readline';
import {createServer} from 'node:http';
const {RuntimeSessionStore}=await import('../../dist/packages/runtime-api/src/runtime-session.js');
const {ViewerControlStore}=await import('../../dist/packages/runtime-api/src/viewer-control.js');
const require=createRequire(import.meta.url);
const playwrightBundle='/Users/claw/.webenvoy/providers/camoufox/venv/lib/python3.12/site-packages/playwright/driver/package/lib/coreBundle.js';
assert.equal(createHash('sha256').update(readFileSync(playwrightBundle)).digest('hex'),'f74353fcb8e406756a70a6af0dfc4a5069acd577e35ec9d923ccf36ac009c2f5');
const {inprocess}=require(playwrightBundle);
const playwright=inprocess.createInProcessPlaywright();
const raw=JSON.parse(readFileSync(process.argv[2],'utf8'));
const manifestPath=join(dirname(dirname(dirname(dirname(raw.executable_path)))),'prototype-manifest.json');
const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
const digest=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
assert.equal(manifest.kind,'local-only-unadopted-prototype');
assert.equal(digest(new URL('./native-snapshot.js',import.meta.url)),manifest.patch_source_sha256,'prototype_revision_mismatch');
assert.equal(digest(join(dirname(raw.executable_path),'../Resources/omni.ja')),manifest.prototype_jar_sha256);
const nativeState=process.argv[4]?require(process.argv[4]):null;
const options={executablePath:raw.executable_path,args:raw.args,env:raw.env,firefoxUserPrefs:raw.firefox_user_prefs,headless:raw.headless,timeout:30000,...(raw.no_viewport?{viewport:null}:{})};
let count=0,context,browser,ownedProcess,launchIdentity,leaseStore,leaseRef,sequence=0,epoch=null;
const labels=new Map(), windowLabels=new Map();
const server=createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});if(req.url==='/favicon.ico')return res.end('');const label=String.fromCharCode(65+count++);res.end(`<!doctype html><title>Identical native tabs</title><h1>Test page ${label}</h1><input aria-label="Retained text"><button onclick="window.open('/same','_blank')">Open popup</button><p>Local no-account prototype.</p>`);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const emit=value=>{console.log(JSON.stringify(value));appendFileSync(process.argv[3]+'.summary.jsonl',JSON.stringify(value)+'\n',{mode:0o600});};
function pageLabel(page){if(!labels.has(page))labels.set(page,`page-${labels.size+1}`);return labels.get(page);}
function leaseState(){const record=leaseStore.getRecord(leaseRef);return structuredClone({owner:record.facts.control_owner,lock:record.facts.control_lock,generation:record.control_generation,interactions:record.active_provider_interactions});}
async function snapshot(){
  const leaseBefore=leaseState();
  if(!browser.isConnected()||ownedProcess.exitCode!==null)throw new Error('native_connection_closed');
  let timer;
  const started=performance.now();
  const before=nativeState?JSON.parse(nativeState.inspect(ownedProcess.pid,launchIdentity??'')):null;
  try {
    const data=await Promise.race([browser.session.send('Browser.webenvoyNativeSnapshot',{}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('native_snapshot_timeout')),3000);})]);
    assert.equal(data.schema,'webenvoy-native-snapshot/prototype-1');
    if(epoch!==null)assert.equal(data.epoch,epoch,'native_epoch_changed');
    assert(data.sampleSequence>sequence,'native_snapshot_stale');
    assert(performance.now()-started<3000,'native_snapshot_expired');
    const pages=context.pages();
    appendFileSync(process.argv[3],JSON.stringify({kind:'received',data,providerTargets:[...browser._ffPages].map(([targetId,ff])=>({targetId,initialized:Boolean(ff._page.initializedOrUndefined()),exposed:pages.some(page=>page._connection.toImpl(page)===ff._page)}))})+'\n',{mode:0o600});
    const mapped=data.pages.map(row=>{
      const ff=browser._ffPages.get(row.targetId);
      const page=pages.find(candidate=>candidate._connection.toImpl(candidate)===ff?._page);
      assert(page&&!page.isClosed(),'native_page_unmapped');
      return {...row,page,ref:pageLabel(page)};
    });
    assert.equal(new Set(mapped.map(row=>row.page)).size,mapped.length);
    assert.equal(mapped.length,pages.filter(page=>!page.isClosed()).length,'native_inventory_changed');
    const windows=data.windows.map(window=>{
      if(!windowLabels.has(window.windowId))windowLabels.set(window.windowId,`window-${windowLabels.size+1}`);
      const selected=window.selectedTargetId===null?null:mapped.find(row=>row.targetId===window.selectedTargetId&&row.windowId===window.windowId);
      assert(window.selectionStatus!=='known'||selected,'native_selected_unmapped');
      return {window:windowLabels.get(window.windowId),selected:selected?.ref??null,selectionStatus:window.selectionStatus,browserWindowActive:window.browserWindowActive};
    });
    const after=nativeState?JSON.parse(nativeState.inspect(ownedProcess.pid,launchIdentity??'')):null;
    assert.equal(ownedProcess.exitCode,null,'native_process_exited');
    epoch=data.epoch;sequence=data.sampleSequence;
    appendFileSync(process.argv[3],JSON.stringify({kind:'snapshot',data,bindings:mapped.map(({page,...rest})=>rest)})+'\n',{mode:0o600});
    const publicWindows=windows.map(window=>({...window,osForeground:foreground(launchIdentity,before,after,window.browserWindowActive)}));
    return {status:'observed',sequence,controlOwner:leaseBefore.owner,controlUnchanged:true,...(before?{independentNative:{before:{active:before.active,hidden:before.hidden},after:{active:after.active,hidden:after.hidden}}}:{}),windows:publicWindows,pages:mapped.map(row=>({ref:row.ref,window:windowLabels.get(row.windowId)}))};
  } finally {clearTimeout(timer);assert.deepEqual(leaseState(),leaseBefore,'native_read_changed_control');}
}
try {
  context=await playwright.firefox.launchPersistentContext(raw.user_data_dir,options);
  browser=context._connection.toImpl(context)._browser;
  ownedProcess=browser.options.browserProcess.process;
  launchIdentity=nativeState?JSON.parse(nativeState.inspect(ownedProcess.pid)).launch:null;
  const page=context.pages()[0];pageLabel(page);await page.goto(origin+'/same');
  leaseStore=new RuntimeSessionStore(new ViewerControlStore(),async()=>({status:'ready',execution_surface:'local_provider',driver_ref:'prototype-owned-node-pipe',driver_kind:'firefox_juggler',facts:[],page:{current_url:page.url(),title:await page.title(),status:'ready',facts:[]},viewer_entry:{availability:'available',access_mode:'interactive',transport:'local_window',input_capabilities:['keyboard_mouse']},close:()=>context.close()}));
  const session=await leaseStore.createSession({control_owner:'user',holder_ref:'prototype-human',headless:raw.headless,profile_ref:'prototype-isolated-profile',url:page.url()});
  leaseRef=session.runtime_session_ref;assert.equal(session.control_owner,'user');
  emit({event:'ready',...await snapshot()});
  const input=createInterface({input:process.stdin,crlfDelay:Infinity});
  for await(const line of input){
    const command=JSON.parse(line);
    try {
      if(command.op==='snapshot')emit(await snapshot());
      else if(command.op==='inspect'){emit({pages:await Promise.all(context.pages().map(async p=>({ref:pageLabel(p),text:await p.locator('h1').textContent(),opener:await p.opener().then(x=>x?pageLabel(x):null),title:await p.title(),sameUrl:p.url()===origin+'/same'})))});}
      else if(command.op==='disconnect'){const transport=browser._connection._transport;await new Promise(resolve=>{transport._pipeRead.once('close',resolve);transport._pipeRead.destroy();transport._pipeWrite.destroy();});await assert.rejects(snapshot(),/native_connection_closed/);emit({disconnected:true,old_query_rejected:true});await browser.options.browserProcess.kill();break;}
      else if(command.op==='invalid-query'){await assert.rejects(browser.session.send('Browser.webenvoyNativeSnapshot',{unexpected:true}));emit({unexpected_parameter_rejected:true});}
      else if(command.op==='stop'){await context.close();await assert.rejects(snapshot(),/native_connection_closed/);emit({stopped:true,old_query_rejected:true});break;}
      else throw new Error('prototype_command_not_allowed');
    }catch(error){emit({status:'unavailable',reason:String(error.message).slice(0,200)});}
  }
}finally{if(leaseRef)await leaseStore.closeSession(leaseRef);if(context)await context.close();await new Promise(r=>server.close(r));emit({cleanup:'browser-and-local-service-stopped'});}

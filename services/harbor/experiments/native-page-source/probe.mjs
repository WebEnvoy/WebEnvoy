// Local-only prototype Driver; no public tool or network protocol endpoint.
import assert from 'node:assert/strict';
import {foreground} from './foreground.mjs';
import {isCurrentObservation} from './observation-reference.mjs';
import {createHash} from 'node:crypto';
import {dirname,join} from 'node:path';
import {createRequire} from 'node:module';
import {readFileSync,appendFileSync} from 'node:fs';
import {createInterface} from 'node:readline';
import {createServer} from 'node:http';
import {EventEmitter} from 'node:events';
const {RuntimeSessionStore}=await import('../../dist/packages/runtime-api/src/runtime-session.js');
const {ViewerControlStore}=await import('../../dist/packages/runtime-api/src/viewer-control.js');
const require=createRequire(import.meta.url);
const playwrightBundle='/Users/claw/.webenvoy/providers/camoufox/venv/lib/python3.12/site-packages/playwright/driver/package/lib/coreBundle.js';
assert.equal(createHash('sha256').update(readFileSync(playwrightBundle)).digest('hex'),'f74353fcb8e406756a70a6af0dfc4a5069acd577e35ec9d923ccf36ac009c2f5');
const {inprocess}=require(playwrightBundle);
const playwright=inprocess.createInProcessPlaywright();
const raw=JSON.parse(readFileSync(process.argv[2],'utf8'));
const baseline=process.argv.includes('--baseline');
const trace=process.argv.includes('--trace');
const manifestPath=join(dirname(dirname(dirname(dirname(raw.executable_path)))),'prototype-manifest.json');
const digest=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
if(baseline){
  assert.equal(raw.executable_path,'/Applications/Camoufox.app/Contents/MacOS/camoufox');
  assert.equal(digest(join(dirname(raw.executable_path),'../Resources/omni.ja')),'bed61930f353ef21011487c4c0fc84e64103b00617b5f8dd0538fb261d0732a5');
}else{
  const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
  assert.equal(manifest.kind,'local-only-unadopted-prototype');
  assert.equal(digest(new URL('./native-snapshot.js',import.meta.url)),manifest.patch_source_sha256,'prototype_revision_mismatch');
  assert.equal(digest(join(dirname(raw.executable_path),'../Resources/omni.ja')),manifest.prototype_jar_sha256);
}
const nativeState=process.argv[4]&&!process.argv[4].startsWith('--')?require(process.argv[4]):null;
const options={executablePath:raw.executable_path,args:raw.args,env:raw.env,firefoxUserPrefs:raw.firefox_user_prefs,headless:raw.headless,timeout:30000,...(raw.no_viewport?{viewport:null}:{})};
let count=0,context,browser,ownedProcess,launchIdentity,leaseStore,leaseRef,input,sequence=0,epoch=null;
const labels=new Map(), windowLabels=new Map();
const lifecycle=new EventEmitter();
let eventSequence=0;
let currentBindings=[],checkpoint=null,traceTruncated=false;
const server=createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});if(req.url==='/favicon.ico')return res.end('');const label=String.fromCharCode(65+count++);res.end(`<!doctype html><title>Identical native tabs</title><h1>Test page ${label}</h1><input aria-label="Retained text"><button onclick="window.open('/same','_blank')">Open popup</button><button onclick="localStorage.setItem('adoption-marker',document.querySelector('input').value);history.pushState({step:1},'','/same');history.pushState({step:2},'','/same');window.scrollTo(0,240)">Prepare history and scroll</button><p>Local no-account prototype.</p><div style="height:1800px"></div><p>End of fixture</p>`);});
const fixturePort=Number(process.argv.find(arg=>arg.startsWith('--port='))?.slice(7)??0);
assert(Number.isInteger(fixturePort)&&fixturePort>=0&&fixturePort<=65535);
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(fixturePort,'127.0.0.1',resolve);});
const origin=`http://127.0.0.1:${server.address().port}`;
const emit=value=>{console.log(JSON.stringify(value));appendFileSync(process.argv[3]+'.summary.jsonl',JSON.stringify(value)+'\n',{mode:0o600});};
const record=value=>{if(eventSequence>=4096){traceTruncated=true;return;}appendFileSync(process.argv[3],JSON.stringify({eventSequence:++eventSequence,at:performance.now(),...value})+'\n',{mode:0o600});};
function pageLabel(page){if(!labels.has(page))labels.set(page,`page-${labels.size+1}`);return labels.get(page);}
function inventory(){
  const pages=context.pages();
  return [...browser._ffPages].map(([targetId,ff])=>({targetId,initialized:Boolean(ff._page.initializedOrUndefined()),reportedAsNew:ff._reportedAsNew,
    page:pages.find(page=>page._connection.toImpl(page)===ff._page)}));
}
function observeProtocol(direction,message){
  const methods=['Browser.attachedToTarget','Browser.detachedFromTarget','Page.ready','Page.frameAttached','Page.frameDetached','Page.navigationStarted','Page.navigationCommitted','Page.sameDocumentNavigation','Runtime.executionContextCreated','Runtime.executionContextDestroyed'];
  if(direction!=='receive'||!methods.includes(message.method))return;
  const p=message.params||{};
  if(trace)record({kind:'protocol',method:message.method,sessionId:message.sessionId??null,
    targetId:p.targetId??p.targetInfo?.targetId??null,targetSession:p.sessionId??null,openerId:p.targetInfo?.openerId??null,
    frameId:p.frameId??p.auxData?.frameId??null,executionContextId:p.executionContextId??null,navigationId:p.navigationId??null});
  queueMicrotask(()=>lifecycle.emit('change'));
}
function leaseState(){const record=leaseStore.getRecord(leaseRef);return structuredClone({owner:record.facts.control_owner,lock:record.facts.control_lock,generation:record.control_generation,interactions:record.active_provider_interactions});}
async function snapshot(timeoutMs=3000){
  const leaseBefore=leaseState();
  if(!browser.isConnected()||ownedProcess.exitCode!==null)throw new Error('native_connection_closed');
  if(traceTruncated)throw new Error('lifecycle_observation_bound_exceeded');
  let timer;
  const started=performance.now();
  const before=nativeState?JSON.parse(nativeState.inspect(ownedProcess.pid,launchIdentity??'')):null;
  try {
    if(baseline){
      const rows=inventory();
      record({kind:'inventory',rows:rows.map(({page,...row})=>({...row,ref:page?pageLabel(page):null}))});
      assert(rows.every(row=>row.initialized&&row.page),'provider_page_not_ready');
      return {status:'observed',baseline:true,controlUnchanged:true,pages:rows.map(row=>({ref:pageLabel(row.page)}))};
    }
    const data=await Promise.race([browser.session.send('Browser.webenvoyNativeSnapshot',{}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('native_snapshot_timeout')),timeoutMs);})]);
    assert.equal(data.schema,'webenvoy-native-snapshot/prototype-1');
    if(epoch!==null)assert.equal(data.epoch,epoch,'native_epoch_changed');
    assert(data.sampleSequence>sequence,'native_snapshot_stale');
    assert(performance.now()-started<timeoutMs,'native_snapshot_expired');
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
    currentBindings=mapped.map(row=>({...row,epoch}));
    appendFileSync(process.argv[3],JSON.stringify({kind:'snapshot',data,bindings:mapped.map(({page,...rest})=>rest)})+'\n',{mode:0o600});
    const publicWindows=windows.map(window=>({...window,osForeground:foreground(launchIdentity,before,after,window.browserWindowActive)}));
    return {status:'observed',sequence,controlOwner:leaseBefore.owner,controlUnchanged:true,...(before?{independentNative:{before:{active:before.active,hidden:before.hidden},after:{active:after.active,hidden:after.hidden}}}:{}),windows:publicWindows,pages:mapped.map(row=>({ref:row.ref,window:windowLabels.get(row.windowId)}))};
  } finally {clearTimeout(timer);assert.deepEqual(leaseState(),leaseBefore,'native_read_changed_control');}
}
async function waitForAssociation(){
  const deadline=performance.now()+10000;
  let lastError;
  // Subscribe before reading, so a real ready/attach event cannot be lost between attempts.
  while(performance.now()<deadline){
    let timer,changed;
    const next=new Promise(resolve=>{changed=()=>resolve(true);lifecycle.once('change',changed);timer=setTimeout(()=>resolve(false),Math.max(0,deadline-performance.now()));});
    try{return {...await snapshot(Math.min(3000,Math.max(1,deadline-performance.now()))),observationBoundMs:10000};}
    catch(error){lastError=error;record({kind:'association-pending',reason:error.message});}
    finally{if(!lastError){clearTimeout(timer);lifecycle.off('change',changed);}}
    const event=await next;
    clearTimeout(timer);lifecycle.off('change',changed);
    if(!event||!browser.isConnected())break;
    lastError=undefined;
  }
  throw new Error(`association_unavailable_after_10000ms:${lastError?.message??'incomplete'}`);
}
async function inspectFixture(){
  return {pages:await Promise.all(context.pages().map(async p=>{
    assert.equal(p.url(),origin+'/same','synthetic_origin_only');
    return {ref:pageLabel(p),opener:await p.opener().then(x=>x?pageLabel(x):null),...await p.evaluate(()=>({
      label:document.querySelector('h1').textContent,input:document.querySelector('input').value,
      scrollY,historyLength:history.length,historyState:history.state,timeOrigin:performance.timeOrigin,
      title:document.title,sameUrl:location.pathname==='/same',navigationCount:performance.getEntriesByType('navigation').length,
      persistentMarker:localStorage.getItem('adoption-marker'),
    }))};
  }))};
}
async function markFixture(ref){
  await waitForAssociation();
  const binding=currentBindings.find(row=>row.ref===ref);assert(binding,'explicit_page_ref_required');
  const state=(await inspectFixture()).pages.find(row=>row.ref===ref);
  checkpoint={binding,state,pageCount:context.pages().length,leaseRef};
  return {checkpoint:ref,state,pageCount:checkpoint.pageCount};
}
async function verifyFixture(){
  assert(checkpoint,'checkpoint_required');
  const observed=await waitForAssociation();
  const binding=currentBindings.find(row=>row.page===checkpoint.binding.page);assert(binding,'original_client_page_missing');
  const state=(await inspectFixture()).pages.find(row=>row.ref===binding.ref);
  assert.deepEqual(state,checkpoint.state,'synthetic_state_changed');
  assert.equal(context.pages().length,checkpoint.pageCount,'page_count_changed');
  const oldObservationRejected=!isCurrentObservation(checkpoint.binding,binding);
  assert(oldObservationRejected,'native_binding_did_not_change');
  assert.equal(leaseRef,checkpoint.leaseRef,'runtime_session_replaced');
  record({kind:'continuity',oldObservationRejected,sameClientPage:true,sameTarget:binding.targetId===checkpoint.binding.targetId});
  return {continuity:'preserved',sameClientPage:true,sameRuntimeSession:true,sameTarget:binding.targetId===checkpoint.binding.targetId,
    oldObservationRejected,ref:binding.ref,state,observed};
}
async function disconnectTransport(){
  const transport=browser._connection._transport;
  await new Promise(resolve=>{transport._pipeRead.once('close',resolve);transport._pipeRead.destroy();transport._pipeWrite.destroy();});
  await assert.rejects(snapshot(),/native_connection_closed/);
}
try {
  context=await playwright.firefox.launchPersistentContext(raw.user_data_dir,options);
  browser=context._connection.toImpl(context)._browser;
  ownedProcess=browser.options.browserProcess.process;
  launchIdentity=nativeState?JSON.parse(nativeState.inspect(ownedProcess.pid)).launch:null;
  const logger=browser._connection._protocolLogger;
  browser._connection._protocolLogger=(direction,message)=>{observeProtocol(direction,message);logger(direction,message);};
  if(trace){
    const lines=createInterface({input:ownedProcess.stdout});
    lines.on('line',line=>{if(line.startsWith('WEBENVOY_LIFECYCLE ')){
      const event=JSON.parse(line.slice(19));
      record({kind:'provider',event});
      if(event.truncated || event.kind==='trace-unavailable')traceTruncated=true;
      lifecycle.emit('change');
    }});
  }
  context.on('page',page=>{if(trace)record({kind:'client-page',ref:pageLabel(page)});lifecycle.emit('change');});
  const page=context.pages()[0];pageLabel(page);await page.goto(origin+'/same');
  leaseStore=new RuntimeSessionStore(new ViewerControlStore(),async()=>({status:'ready',execution_surface:'local_provider',driver_ref:'prototype-owned-node-pipe',driver_kind:'firefox_juggler',facts:[],page:{current_url:page.url(),title:await page.title(),status:'ready',facts:[]},viewer_entry:{availability:'available',access_mode:'interactive',transport:'local_window',input_capabilities:['keyboard_mouse']},close:()=>context.close()}));
  const session=await leaseStore.createSession({control_owner:'user',holder_ref:'prototype-human',headless:raw.headless,profile_ref:'prototype-profile-'+createHash('sha256').update(raw.user_data_dir).digest('hex').slice(0,12),url:page.url()});
  leaseRef=session.runtime_session_ref;assert.equal(session.control_owner,'user');
  emit({event:'ready',...await snapshot()});
  input=createInterface({input:process.stdin,crlfDelay:Infinity});
  for await(const line of input){
    const command=JSON.parse(line);
    try {
      if(command.op==='snapshot')emit(await snapshot());
      else if(command.op==='inspect')emit(await inspectFixture());
      else if(command.op==='wait-association')emit(await waitForAssociation());
      else if(command.op==='checkpoint')emit(await markFixture(command.ref));
      else if(command.op==='verify-continuity')emit(await verifyFixture());
      else if(command.op==='inventory'){const rows=inventory();record({kind:'inventory',rows:rows.map(({page,...row})=>({...row,ref:page?pageLabel(page):null}))});emit({inventory:rows.map(({page,targetId,...row})=>({...row,ref:page?pageLabel(page):null}))});}
      else if(command.op==='disconnect'){await disconnectTransport();emit({disconnected:true,old_query_rejected:true});await browser.options.browserProcess.kill();break;}
      else if(command.op==='arm-disconnect'){
        browser.session.once('Browser.attachedToTarget',async()=>{
          try{const pending=inventory().filter(row=>!row.initialized).length;assert(pending>0,'no_handover_initialization_window');
            record({kind:'disconnect-during-attach',pending});await disconnectTransport();emit({disconnectedDuringTargetInitialization:true,old_query_rejected:true});
          }catch(error){emit({status:'unavailable',reason:error.message});}
          finally{await browser.options.browserProcess.kill();input.close();}
        });
        emit({armed:'disconnect-on-next-native-target-attach'});
      }
      else if(command.op==='invalid-query'){await assert.rejects(browser.session.send('Browser.webenvoyNativeSnapshot',{unexpected:true}));emit({unexpected_parameter_rejected:true});}
      else if(command.op==='stop'){await context.close();await assert.rejects(snapshot(),/native_connection_closed/);emit({stopped:true,old_query_rejected:true});break;}
      else throw new Error('prototype_command_not_allowed');
    }catch(error){emit({status:'unavailable',reason:String(error.message).slice(0,200)});}
  }
}finally{if(leaseRef)await leaseStore.closeSession(leaseRef);if(context)await context.close();await new Promise(r=>server.close(r));emit({cleanup:'browser-and-local-service-stopped'});process.stdin.pause();}

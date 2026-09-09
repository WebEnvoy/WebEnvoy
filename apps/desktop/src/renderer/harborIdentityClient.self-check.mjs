// Run with: apps/desktop/node_modules/.bin/electron apps/desktop/src/renderer/harborIdentityClient.self-check.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";
const renderer = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(renderer, "../../package.json"));
const { build } = createRequire(realpathSync(require.resolve("vite/package.json")))("esbuild");
const directory = mkdtempSync(join(tmpdir(), "webenvoy-identity-attach-"));
app.setPath("userData", join(directory, "user-data"));
let window;
async function run() {
try {
  const bundle = await build({ bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", stdin: { resolveDir: renderer, loader: "tsx", contents: `
    import React from "react";
    import {createRoot} from "react-dom/client";
    import {IdentityEnvironmentsPage} from "./IdentityEnvironmentsPage";
    import {projectHarborIdentity} from "./harborIdentityProjection";
    const provider={provider_id:"camoufox",display_name:"Camoufox",role:"qualification",install:{status:"installed",path:"/test/browser",version:"0.5.6",launchability:"launchable",reason:null},limitations:[],diagnostics:[]};
    const catalog={schema_version:"harbor-browser-provider-status/v0",providers:[provider],excluded_providers:[]};
    const identity={schema_version:"harbor-local-identity-environment/v0",identity_environment_ref:"identity:public",execution_identity_ref:"execution:public",profile_ref:"profile:public",site_binding:{site_id:"public-docs",origin:"https://example.com",display_name:"Public Docs",account_label:"Public Profile"},login_state:{state:"logged_out",reason:null,recovery_required:true,manual_authentication_state:"required",human_verification:["manual_login"]},browser_storage:{profile_storage_ref:"storage:public",state:"present",cookies_session_state:"present"},environment:{proxy:{state:"missing",proxy_ref:null,label:null},region:null,language:"en-US",timezone:"UTC",browser_family:"firefox",user_agent_summary:null,viewport:null,fingerprint_summary:"provider default"},provider_binding:{selected_provider_id:"camoufox",selection_reason:"configured",requires_user_notice:false,selected_provider:provider,warnings:[],unavailable_reason:null},credential_recovery:{credential_ref:null,recovery_actions:["manual_login"]},diagnostics:[]};
    const session={schema_version:"harbor-runtime-facts/v0",runtime_session_ref:"session:original",identity_environment_ref:identity.identity_environment_ref,profile_ref:identity.profile_ref,provider_ref:"provider:one",lifecycle_state:"active",created_at:"2026-09-09T00:00:00Z",last_seen_at:"2026-09-09T00:00:00Z",current_page:{requested_url:"https://example.com/original",current_url:"https://example.com/original",title:"Original Agent Page",status:"ready"},control_owner:"core_task",control_lock:{owner:"core_task",state:"held"},current_error:null};
    window.check={calls:[],session,original:structuredClone(session),projection:projectHarborIdentity(identity,catalog,new Date().toISOString())};
    window.webenvoyShell={requestOwnerJson:async request=>{
      window.check.calls.push(request);
      let body;
      if(request.path==="/runtime/browser-providers") body=catalog;
      else if(request.path==="/runtime/identity-environments") body={identity_environments:[identity]};
      else if(request.path.endsWith("/session")) body={runtime_session:window.check.session};
      else if(request.path.endsWith("/handoff")){window.check.session={...session,control_owner:"user",control_lock:{owner:"user",state:"held"}};body=window.check.session;}
      else if(request.path.endsWith("/release")){window.check.session={...session,control_owner:"none",control_lock:{owner:"none",state:"released"}};body=window.check.session;}
      else return {ok:false,status:404,error:"unexpected request"};
      return {ok:true,body};
    }};
    createRoot(document.getElementById("root")).render(<IdentityEnvironmentsPage harborEndpoint="http://127.0.0.1:9999" runtimeSupervisorState={{canUseLiveRuntime:true,services:[{id:"harbor",health:{state:"ready"}}]}} tasks={[]} onHarborStateChange={()=>{}} onOpenLibrary={()=>{}} onOpenSettings={()=>{}}/>);
  ` }});
  writeFileSync(join(directory,"ui.js"),bundle.outputFiles[0].text);
  writeFileSync(join(directory,"index.html"),'<div id="root"></div><script src="ui.js"></script>');
  await app.whenReady();
  window=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,sandbox:true}});
  window.webContents.session.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!details.url.startsWith("file:")}));
  await window.loadFile(join(directory,"index.html"));
  const evaluate=source=>window.webContents.executeJavaScript(source);
  const waitFor=async source=>{for(let i=0;i<100;i++){if(await evaluate(source))return;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error(`UI condition not met: ${source}`);};
  const button=label=>`[...document.querySelectorAll('button')].find(el=>el.textContent===${JSON.stringify(label)})`;
  await waitFor("document.querySelector('[data-identity-ref]')");
  assert.equal(await evaluate("window.check.projection.siteId"),"public-docs");
  assert.equal(await evaluate("window.check.projection.siteName"),"Public Docs");
  assert.equal(await evaluate("window.check.projection.browser.targets[0].defaultUrl"),"https://example.com");
  assert.equal(await evaluate("window.check.projection.login.recoveryRequired"),false);
  assert.equal(await evaluate("window.check.projection.readiness.state"),"ready");
  await evaluate("document.querySelector('[data-identity-ref]').click()");
  await waitFor(`${button("接管")} && !${button("接管")}.disabled`);
  assert.equal(await evaluate("document.body.textContent.includes('Original Agent Page')"),true);
  assert.equal(await evaluate("window.check.calls.filter(x=>x.method==='POST').length"),0,"opening details must never open or navigate an instance");
  await evaluate(`${button("接管")}.click()`);
  await waitFor(`${button("交还控制")} && !${button("交还控制")}.disabled`);
  assert.equal(await evaluate(`Boolean(${button("已完成，继续")})`),false,"generic public profiles do not require account authentication");
  assert.equal(await evaluate("window.check.calls.at(-1).path"),"/runtime/sessions/session%3Aoriginal/handoff");
  await evaluate(`${button("交还控制")}.click()`);
  await waitFor(`${button("接管")} && !${button("接管")}.disabled`);
  assert.equal(await evaluate("window.check.calls.at(-1).path"),"/runtime/sessions/session%3Aoriginal/release");
  await evaluate(`window.check.session=null;${button("刷新实例状态")}.click()`);
  await waitFor(`!${button("刷新实例状态")}.disabled && !document.body.textContent.includes('浏览器实例正在运行')`);
  assert.equal(await evaluate(`Boolean(${button("接管")})`),false);
  assert.equal(await evaluate("window.check.calls.some(x=>x.path==='/runtime/identity-environment-sessions')"),false);
  await evaluate(`window.check.session={schema_version:'bad'};${button("刷新实例状态")}.click()`);
  await waitFor("document.body.textContent.includes('状态未知')");
  assert.equal(await evaluate(`Boolean(${button("接管")})`),false);
  await evaluate(`window.check.session={...window.check.original,profile_ref:'profile:other'};${button("刷新实例状态")}.click()`);
  await waitFor(`!${button("刷新实例状态")}.disabled`);
  assert.equal(await evaluate(`Boolean(${button("接管")})`),false);
  await evaluate(`window.check.session={...window.check.original,lifecycle_state:'disconnected'};${button("刷新实例状态")}.click()`);
  await waitFor(`!${button("刷新实例状态")}.disabled`);
  assert.equal(await evaluate(`Boolean(${button("接管")})`),false);
  await evaluate(`window.check.session=window.check.original;${button("刷新实例状态")}.click()`);
  await waitFor(`${button("接管")} && !${button("接管")}.disabled`);
  assert.equal(await evaluate("window.check.calls.some(x=>x.path==='/runtime/identity-environment-sessions')"),false);
  console.log("Identity detail attach: original session GET, handoff/release, generic projection and missing/invalid session refusal passed.");
} catch(error){console.error(error);process.exitCode=1;}
finally{window?.destroy();rmSync(directory,{recursive:true,force:true});app.exit(process.exitCode??0);}
}
void run();

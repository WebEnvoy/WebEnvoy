// Run with: apps/desktop/node_modules/.bin/electron apps/desktop/src/renderer/agentAccessClient.self-check.mjs
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
const directory = mkdtempSync(join(tmpdir(), "webenvoy-agent-access-ui-"));
app.setPath("userData", join(directory, "user-data"));
let window;
async function run() {
try {
  const bundle = await build({ bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", stdin: {
    resolveDir: renderer, loader: "tsx", contents: `
      import React from "react";
      import {createRoot} from "react-dom/client";
      import {AgentAccessPanel} from "./AgentAccessPanel";
      import {projectAgentAccess,createAgentGrantInput} from "./agentAccessClient";
      window.check = {calls:[], rejection:true, unknown:false, receipt:false, reads:0};
      const state = {ok:true,principals:[{principal_id:"principal:one",display_name:"本地 Agent",revoked_at:null}],connections:[{connection_id:"connection:one",principal_id:"principal:one",connected_at:"2026-09-09T00:00:00.000Z",revoked_at:null}],grants:[{grant_id:"grant:one",principal_id:"principal:one",profile_refs:[],allowed_operations:["profile.create"],allowed_origins:["https://example.com"],expires_at:"2099-01-01T00:00:00.000Z",revoked_at:null,creation_template:{template_ref:"template:one",provider_id:"camoufox"},max_created_profiles:2,created_profile_refs:[]}],profile_policies:[],secret:"never-render-this"};
      window.webenvoyShell = {requestOwnerJson:async request=>{
        window.check.calls.push(request);
        if(request.path.includes("/operations/")) return window.check.receipt ? {ok:true,body:{ok:true,operation:{status:"completed",result:{}}}} : {ok:false,status:404,error:"not_found"};
        if(request.method==="GET"){window.check.reads++;const snapshot=structuredClone(state);if(window.check.holdRead){window.check.holdRead=false;await new Promise(resolve=>window.check.releaseRead=resolve);}return {ok:true,body:snapshot};}
        if(window.check.unknown) throw new Error("response lost");
        if(window.check.rejection) return {ok:false,status:403,error:"denied"};
        state.grants[0].revoked_at="2026-09-09T01:00:00.000Z";
        return {ok:true,body:{ok:true,grant:state.grants[0]}};
      }};
      const root=createRoot(document.getElementById("root"));
      window.mount=()=>root.render(<AgentAccessPanel endpoint="http://core.invalid"/>);
      window.projected=projectAgentAccess(state);
      window.grantInput=createAgentGrantInput("principal:one",24,"key");
      window.mount();
    `,
  }});
  writeFileSync(join(directory, "ui.js"), bundle.outputFiles[0].text);
  writeFileSync(join(directory, "index.html"), '<div id="root"></div><script src="ui.js"></script>');
  await app.whenReady();
  window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true } });
  window.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith("file:") }));
  await window.loadFile(join(directory, "index.html"));
  const evaluate = source => window.webContents.executeJavaScript(source);
  const waitFor = async source => {
    for (let attempt = 0; attempt < 100; attempt++) { if (await evaluate(source)) return; await new Promise(resolve => setTimeout(resolve, 20)); }
    throw new Error(`UI condition not met: ${source}`);
  };
  const button = label => `[...document.querySelectorAll('button')].find(el=>el.textContent===${JSON.stringify(label)})`;
  await waitFor("document.body.textContent.includes('connection:one')");
  assert.equal(await evaluate("document.body.textContent.includes('never-render-this')"), false);
  assert.equal(await evaluate("Object.hasOwn(window.projected,'secret')"), false);
  assert.equal(await evaluate("window.grantInput.creation_template.provider_id"), "camoufox");
  assert.equal(await evaluate("window.grantInput.max_created_profiles"), 2);
  assert.deepEqual(await evaluate("window.grantInput.profile_refs"), []);
  await evaluate(`${button("撤销授权")}.click()`);
  await waitFor("document.querySelector('[role=alert]')?.textContent.includes('拒绝')");
  assert.equal(await evaluate("window.check.reads"), 2);
  await evaluate(`window.check.holdRead=true;${button("刷新授权状态")}.click()`);
  await waitFor("typeof window.check.releaseRead==='function'");
  await evaluate(`window.check.rejection=false;${button("撤销授权")}.click()`);
  await waitFor(`${button("撤销授权")}.disabled && document.body.textContent.includes('已撤销')`);
  assert.equal(await evaluate("window.check.reads"), 4);
  await evaluate("window.check.releaseRead()");
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(await evaluate(`${button("撤销授权")}.disabled`), true);
  await evaluate(`window.check.unknown=true;const select=document.querySelector('select');select.value='principal:one';select.dispatchEvent(new Event('change',{bubbles:true}));`);
  await waitFor(`!${button("授予以上管理范围")}.disabled`);
  await evaluate(`${button("授予以上管理范围")}.click()`);
  await waitFor("document.body.textContent.includes('结果未知')");
  assert.equal(await evaluate(`${button("授予以上管理范围")}.disabled`), true);
  const posts = await evaluate("window.check.calls.filter(x=>x.method==='POST').map(x=>x.body.idempotency_key)");
  assert.equal(new Set(posts).size, 3);
  await evaluate(`${button("查询原操作结果")}.click()`);
  await waitFor("document.body.textContent.includes('尚不能确认')");
  assert.equal(await evaluate("window.check.calls.filter(x=>x.method==='POST').length"), 3);
  assert.equal(await evaluate("window.check.calls.find(x=>x.path.includes('/operations/')).path.split('/').pop()"), posts[2]);
  await evaluate(`window.check.receipt=true;${button("查询原操作结果")}.click()`);
  await waitFor("document.body.textContent.includes('已确认原操作')");
  assert.equal(await evaluate("localStorage.length"), 0);
  assert.equal(await evaluate("window.check.calls.filter(x=>x.method==='POST').length"), 3);
  console.log("Agent access UI: lists, refusal, revoke refresh, isolated mutation keys and query-only unknown recovery passed.");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  window?.destroy();
  rmSync(directory, { recursive: true, force: true });
  app.exit(process.exitCode ?? 0);
}
}
void run();

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { normalizeManagedInteractionResponse } from "./camoufox-driver.js";
import { isTrustedManagedInteractionOperation, trustManagedInteractionOperation } from "./managed-interaction.js";

const helper = join(dirname(fileURLToPath(import.meta.url)), "camoufox-driver.py");
test("interaction responses export bounded semantic fields and preserve dispatched uncertainty", () => {
  const page = { current_url: "https://example.com/", title: "Test", status: "ready" };
  const snapshot = { page_ref: `page_${"a".repeat(32)}`, observation_ref: `observation_${"b".repeat(32)}`, controls: [{ target_ref: `target_${"c".repeat(32)}`, role: "textbox", name: "Filter", enabled: true, value: "ordinary" }], text: "Result", truncated: false };
  const valid = { status: "completed", dispatch_state: "dispatched", page, snapshot };
  assert.equal(normalizeManagedInteractionResponse(valid, "https://example.com").status, "completed");
  for (const broken of [{ ...valid, page: { ...page, current_url: "https://denied.example/" } }, { ...valid, snapshot: { ...snapshot, text: "password=private" } }, { ...valid, snapshot: { ...snapshot, controls: [...snapshot.controls, ...snapshot.controls] } }]) {
    assert.equal(normalizeManagedInteractionResponse(broken, "https://example.com").status, "unknown_outcome");
  }
  const lost = normalizeManagedInteractionResponse({ status: "unavailable", dispatch_state: "dispatched", failure_class: "managed_interaction_outcome_unknown", snapshot }, "https://example.com");
  assert.equal(lost.status, "unknown_outcome");
  assert.equal(lost.snapshot, undefined);
  const operation = async () => lost;
  assert.equal(isTrustedManagedInteractionOperation(operation), false);
  assert.equal(isTrustedManagedInteractionOperation(trustManagedInteractionOperation(operation)), true);
});

test("private Driver rejects stale references before input and records dispatched failures without replay", () => {
  const script = String.raw`
import importlib.util, sys
from types import SimpleNamespace
spec=importlib.util.spec_from_file_location("driver",sys.argv[1]); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
class Target:
    enabled=True; connected=True; throws=False; calls=[]
    def wait_for_element_state(self, *args, **kw): pass
    def click(self, **kw):
        if kw.get("trial"): return
        self.calls.append("click")
        if self.throws: raise RuntimeError("private input details")
    def fill(self, value, **kw):
        self.calls.append(("fill",value))
        if self.throws: raise RuntimeError("private input details")
    def press(self, key, **kw): self.calls.append(("press",key))
    def is_visible(self): return self.connected
    def is_enabled(self): return self.enabled
    def evaluate(self, exp): return self.connected
    def hover(self, **kw): pass
class State:
    valid=True
    def evaluate(self, exp, target=None):
        if "state.valid()" in exp: return self.valid
        if "state.describe" in exp: return {"role":"textbox","name":"Filter","enabled":target.enabled} if target.connected else None
        if "state.controls" in exp: return [{"role":"textbox","name":"Filter"}]
        if "state.readText" in exp: return "visible result"
        return True
p=SimpleNamespace(url="https://example.com/",is_closed=lambda:False,title=lambda:"Test",frames=[object()],wait_for_timeout=lambda t:None)
p.mouse=SimpleNamespace(move=lambda *a:None,wheel=lambda x,y:target.calls.append(("wheel",y)))
p.evaluate=lambda exp: {"width":800,"height":600} if "width" in exp else None
m.PAGE=p; m.CONTEXT=SimpleNamespace(pages=[p]); m.install_interaction_guard=lambda origin:None
m.interaction_snapshot=lambda generation:{"page_ref":"new-page","observation_ref":"new-observation","controls":[],"text":"visible result","truncated":False}
state=State(); target=Target()
def reset():
    target.calls=[]; target.enabled=True; target.connected=True; target.throws=False; state.valid=True
    m.INTERACTION_STATE={"handle":state,"targets":{"target":target},"generation":3,"page_ref":"page","observation_ref":"observation"}
base={"expected_origin":"https://example.com","control_generation":3,"page_ref":"page","observation_ref":"observation","target_ref":"target","action":"input","text":"test"}
for override in [{"control_generation":4},{"page_ref":"wrong"},{"observation_ref":"old"},{"target_ref":"missing"}]:
    reset(); result=m.managed_interaction({**base,**override}); assert result["dispatch_state"]=="not_dispatched" and not target.calls, result
reset(); state.valid=False
assert m.managed_interaction(base)["failure_class"]=="managed_interaction_stale_target" and not target.calls
reset(); target.enabled=False
assert m.managed_interaction(base)["dispatch_state"]=="not_dispatched" and not target.calls
reset(); assert m.managed_interaction(base)["status"]=="completed"; assert target.calls==[("fill","test")]
reset(); target.throws=True; result=m.managed_interaction(base)
assert result["status"]=="unknown_outcome" and result["dispatch_state"]=="dispatched" and "snapshot" not in result and target.calls==[("fill","test")],result
for action, extra, expected in [("click",{},"click"),("press",{"key":"Enter"},("press","Enter")),("scroll",{"delta_y":500},("wheel",500))]:
    reset(); result=m.managed_interaction({**base,"action":action,**extra}); assert result["status"]=="completed" and target.calls==[expected],result
reset(); assert m.managed_interaction({**base,"action":"press","key":"Control+L"})["dispatch_state"]=="not_dispatched" and not target.calls
reset(); result=m.managed_interaction({**base,"action":"wait","wait_for":"text","text":"result"}); assert result["status"]=="completed" and not target.calls
reset(); target.connected=False; assert m.managed_interaction({**base,"action":"wait","wait_for":"enabled"})["failure_class"]=="managed_interaction_stale_target"
reset(); m.CONTEXT.pages=[p,object()]; assert m.managed_interaction(base)["failure_class"]=="managed_interaction_window_unsupported" and not target.calls
print("interaction dispatch boundaries passed")
`;
  assert.match(execFileSync(process.env.HARBOR_CAMOUFOX_PYTHON || "python3", ["-c", script, helper], { encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } }), /interaction dispatch boundaries passed/);
});


test("semantic snapshot excludes hidden/sensitive controls and permanently expires on DOM mutations", () => {
  const expression = execFileSync(process.env.HARBOR_CAMOUFOX_PYTHON || "python3", ["-c", "import importlib.util,sys; s=importlib.util.spec_from_file_location('d',sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); print(m.INTERACTION_SNAPSHOT_EXPRESSION)", helper], { encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
  const element = (name: string, type = "text", hidden = false) => ({
    tagName: "INPUT", isConnected: true, id: "", labels: [], readOnly: false, value: "ordinary",
    getAttribute: (key: string) => ({ "aria-label": name, type } as Record<string, string>)[key] ?? null,
    closest: () => hidden ? {} : null, matches: () => false,
    getBoundingClientRect: () => ({ width: 100, height: 24, bottom: 40, right: 120, top: 16, left: 20 })
  });
  const visible = element("Filter"), password = element("Password", "password"), hidden = element("Hidden", "text", true);
  const textElement = { ...visible, tagName: "P" };
  let nodeIndex = 0;
  const records: unknown[] = [];
  const document = { body: {}, querySelectorAll: () => [visible, password, hidden], getElementById: () => null,
    createTreeWalker: () => ({ nextNode: () => [{ parentElement: textElement, textContent: "A visible result" }, { parentElement: textElement, textContent: "token=private" }][nodeIndex++] }) };
  const state = runInNewContext(`(${expression})()`, { document, NodeFilter: { SHOW_TEXT: 4 }, innerWidth: 800, innerHeight: 600,
    getComputedStyle: () => ({ visibility: "visible", display: "block", opacity: "1" }),
    MutationObserver: class { observe() {} disconnect() {} takeRecords() { return records.splice(0); } } });
  assert.equal(state.controls.length, 1);
  assert.equal(state.controls[0].name, "Filter");
  assert.equal(state.controls[0].value, "ordinary");
  assert.equal(state.text, "A visible result");
  assert.equal(state.valid(), true);
  records.push({ type: "childList" });
  assert.equal(state.valid(), false);
  assert.equal(state.valid(), false, "consuming mutation records must never revive an expired target");
});

test("controlled interaction requests reject external origins and redirects while allowing a registered background popup", () => {
  const script = String.raw`
import importlib.util,sys
from types import SimpleNamespace
s=importlib.util.spec_from_file_location('d',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
p=SimpleNamespace(route=lambda *args:None);m.PAGE=p;m.CONTEXT=SimpleNamespace(route=lambda *args:None)
m.install_interaction_guard('https://example.com')
class Route:
    def __init__(self,url,page=p,status=200):
        self.request=SimpleNamespace(url=url,frame=SimpleNamespace(page=page));self.status=status;self.fetched=0;self.aborted=False;self.fulfilled=False
    def abort(self,*args):self.aborted=True
    def fetch(self,**kwargs):
        assert kwargs['max_redirects']==0
        self.fetched+=1
        return SimpleNamespace(status=self.status,dispose=lambda:None)
    def fulfill(self,**kwargs):self.fulfilled=True
popup=object(); m.PAGE_STATES={'popup':{'provider_page_ref':'popup','page':popup,'closed':False}}; m.PAGE_STATE_BY_OBJECT[id(popup)]='popup'
for route in [Route('https://other.example/post'),Route('https://example.com/popup',page=object())]:
    m.INTERACTION_GUARD(route);assert route.aborted and route.fetched==0
background=Route('https://example.com/popup',page=popup);m.INTERACTION_GUARD(background);assert background.fulfilled and not background.aborted
redirect=Route('https://example.com/redirect',status=302);m.INTERACTION_GUARD(redirect);assert redirect.aborted and not redirect.fulfilled and redirect.fetched==1
allowed=Route('https://example.com/filter');m.INTERACTION_GUARD(allowed);assert allowed.fulfilled and not allowed.aborted
print('controlled request boundaries passed')
`;
  assert.match(execFileSync(process.env.HARBOR_CAMOUFOX_PYTHON || "python3", ["-c", script, helper], { encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } }), /controlled request boundaries passed/);
});

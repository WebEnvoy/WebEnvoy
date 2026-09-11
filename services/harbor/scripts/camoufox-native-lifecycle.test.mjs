import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";

const scriptDirectory = fileURLToPath(new URL(".", import.meta.url));
const sourceApp = process.env.HARBOR_CAMOUFOX_SOURCE_APP ?? "/Applications/Camoufox.app";
const sourceOmni = join(sourceApp, "Contents/Resources/omni.ja");
const builder = join(scriptDirectory, "camoufox-native-builder.py");

test("v2 native swap adoption preserves the live target and rejects incomplete relations", { skip: !existsSync(sourceOmni) }, () => {
  const python = process.env.HARBOR_CAMOUFOX_PYTHON ?? process.env.PYTHON ?? "python3";
  const patched = execFileSync(python, ["-B", "-c", String.raw`
import hashlib
import importlib.util
import sys
import zipfile

spec = importlib.util.spec_from_file_location("native_builder", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
with zipfile.ZipFile(sys.argv[2]) as archive:
    source = archive.read("chrome/juggler/content/TargetRegistry.js")
assert hashlib.sha256(open(sys.argv[2], "rb").read()).hexdigest() == module.SOURCE_OMNI_SHA256_PIN
print(module.patch_target_registry(source.decode("utf-8"), tab_handoff=True), end="")
`, builder, sourceOmni], {
    encoding: "utf8",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }
  });

  const registryStart = patched.indexOf("  _onNativeSwap(event)");
  const registryEnd = patched.indexOf("  // Firefox uses nsHttpAuthCache", registryStart);
  const targetStart = patched.indexOf("  _listenToNativeBrowser()");
  const targetEnd = patched.indexOf("  async activateAndRun(", targetStart);
  const disposeStart = patched.indexOf("  dispose() {\n    this.ensureContextMenuClosed();");
  const disposeEnd = patched.indexOf("\n}\n\nPageTarget.Events", disposeStart);
  assert.ok(registryStart >= 0 && registryEnd > registryStart, "native registry methods must be present in the generated patch");
  assert.ok(targetStart >= 0 && targetEnd > targetStart, "native target adoption methods must be present in the generated patch");
  assert.ok(disposeStart >= 0 && disposeEnd > disposeStart, "the generated patch must retain the target disposal method");

  let listenerRemovals = 0;
  let progressBindings = 0;
  const helper = {
    addObserver: () => () => {},
    addEventListener: () => () => {},
    addProgressListener: browser => {
      const context = browser.browsingContext;
      progressBindings++;
      return () => {
        assert.equal(browser.browsingContext, context, "progress listeners detach before the native context changes");
        listenerRemovals++;
      };
    },
    removeListeners: listeners => {
      for (const remove of [...listeners]) remove();
      listeners.splice(0, listeners.length);
    }
  };
  const globals = {
    helper,
    Ci: { nsIWebProgress: { NOTIFY_LOCATION: 1 } },
    ChromeUtils: { generateQI: () => () => {} },
    TargetRegistry: { Events: { TargetDestroyed: "destroyed" } },
    dump: () => {}
  };
  const Registry = vm.runInNewContext(`(class {${patched.slice(registryStart, registryEnd)}})`, globals);
  const Target = vm.runInNewContext(`(class {${patched.slice(targetStart, targetEnd)}${patched.slice(disposeStart, disposeEnd)}})`, globals);

  function setup({ closing = true, sameContext = true } = {}) {
    const registry = new Registry();
    registry._browserToTarget = new Map();
    registry._browserIdToTarget = new Map();
    registry.emit = () => {};
    const owner = { pages: new Set() };

    function make(id, browserContext) {
      const context = { id, browserId: id };
      const browser = { browsingContext: context };
      const window = { gBrowser: null };
      const tab = { linkedBrowser: browser, ownerGlobal: window, isConnected: true, closing: false };
      window.gBrowser = {
        selectedTab: tab,
        getTabForBrowser: candidate => candidate === browser ? tab : null
      };
      browser.ownerGlobal = window;
      const target = new Target();
      Object.assign(target, {
        _linkedBrowser: browser,
        _tab: tab,
        _window: window,
        _gBrowser: window.gBrowser,
        _registry: registry,
        _browserContext: browserContext,
        _registeredBrowserId: id,
        _actor: {},
        _channel: {},
        _disposed: false,
        _updateModalDialogs() {},
        _onNavigated() {},
        _willChangeBrowserRemoteness() {},
        ensureContextMenuClosed() {},
        browserContext() { return this._browserContext; },
        id() { return this._registeredBrowserId; }
      });
      target._listenToNativeBrowser();
      browserContext.pages.add(target);
      registry._browserToTarget.set(browser, target);
      registry._browserIdToTarget.set(id, target);
      return { target, browser, context, tab };
    }

    const otherOwner = sameContext ? owner : { pages: new Set() };
    const real = make("real", owner);
    const placeholder = make("placeholder", otherOwner);
    real.tab.closing = closing;
    return {
      registry,
      owner,
      real,
      placeholder,
      start: { target: placeholder.browser, detail: real.browser },
      end: { target: placeholder.browser, detail: real.browser },
      swap() {
        [real.browser.browsingContext, placeholder.browser.browsingContext] = [placeholder.browser.browsingContext, real.browser.browsingContext];
      }
    };
  }

  const adopted = setup();
  const actor = adopted.real.target._actor;
  const channel = adopted.real.target._channel;
  adopted.registry._onNativeSwap(adopted.start);
  adopted.registry._onNativeSwap({ target: adopted.real.browser, detail: adopted.placeholder.browser });
  assert.equal(adopted.real.target._nativeSwapPending, true);
  assert.equal(listenerRemovals, 2, "both real target listeners detach before the swap");
  adopted.swap();
  adopted.registry._onNativeSwapDone(adopted.end);
  assert.equal(adopted.real.target._linkedBrowser, adopted.placeholder.browser);
  assert.equal(adopted.real.target._tab, adopted.placeholder.tab);
  assert.equal(adopted.real.target._actor, actor, "native adoption retains the Page actor");
  assert.equal(adopted.real.target._channel, channel, "native adoption retains the Page channel");
  assert.equal(adopted.real.target._disposed, false);
  assert.equal(adopted.real.target._nativeSwapPending, false);
  assert.equal(adopted.registry._browserToTarget.get(adopted.placeholder.browser), adopted.real.target, "browser ownership follows the adopted content");
  assert.equal(adopted.registry._browserToTarget.has(adopted.real.browser), false, "the closing placeholder no longer owns the source browser");
  assert.equal(adopted.placeholder.target._disposed, true, "the adopted closing placeholder is disposed");
  assert.equal(adopted.owner.pages.size, 1);
  assert.ok(progressBindings >= 4, "adoption rebinds listeners to the destination browsers");

  const lastTab = setup({ closing: false });
  lastTab.registry._onNativeSwap(lastTab.start);
  lastTab.swap();
  lastTab.registry._onNativeSwapDone(lastTab.end);
  assert.equal(lastTab.owner.pages.size, 2, "a non-closing handoff does not dispose a live target");
  lastTab.registry._browserToTarget.get(lastTab.real.browser).dispose();
  assert.equal(lastTab.owner.pages.size, 1, "a later real close disposes only its target");

  const mismatched = setup();
  mismatched.registry._onNativeSwap(mismatched.start);
  mismatched.registry._onNativeSwapDone(mismatched.end);
  assert.equal(mismatched.real.target._nativeSwapPending, true, "a missing context exchange stays pending");

  const crossContext = setup({ sameContext: false });
  crossContext.registry._onNativeSwap(crossContext.start);
  crossContext.swap();
  crossContext.registry._onNativeSwapDone(crossContext.end);
  assert.equal(crossContext.real.target._nativeSwapPending, true, "cross-context adoption is rejected");

  const absent = setup();
  absent.registry._browserToTarget.delete(absent.placeholder.browser);
  absent.registry._onNativeSwap(absent.start);
  assert.equal(absent.real.target._nativeSwapPending, true, "an unknown counterpart keeps the known target pending");
});

#!/usr/bin/env python3
"""Build a pinned, test-only Camoufox artifact for Harbor phase-1 validation.

The source app and existing Profiles are never modified.  The output is a
separate app with exactly four Juggler entries patched in omni.ja and a
provenance manifest that explicitly denies production/distribution use.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import shutil
import tempfile
import zipfile

CAMOUFOX_VERSION_PIN = "0.5.6"
BROWSER_VERSION_PIN = "152.0.4-beta.30"
SOURCE_OMNI_SHA256_PIN = "bed61930f353ef21011487c4c0fc84e64103b00617b5f8dd0538fb261d0732a5"
PROPERTIES_SHA256_PIN = "10d5cfb6c8eb3824485734362a3920e07b36c3801770fffcc14a3546e56f81f4"
SOURCE_EXECUTABLE_SHA256_PIN = "e468f25acba5085624da4d1ac809fd5679fa281ed2b0265f82efe63904900b33"
SOURCE_INFO_PLIST_SHA256_PIN = "c843c5dd03cb9c6241ec589573bd408df69a5a9dc079aba3e8711ee3adac60d2"
SOURCE_APPLICATION_INI_SHA256_PIN = "b96cb1a88c4c6dd22b308f8125b70a227ef6fb10dee994c8daf47c9cf019f2a5"
ARTIFACT_BUNDLE_IDENTIFIER = "com.webenvoy.camoufox.native504"
ARTIFACT_BUNDLE_NAME = "WebEnvoy Camoufox Native Test"
PATCH_SCHEMA = "webenvoy.camoufox-native/v1"
PATCH_ID = "managed-native-snapshot"
PATCHED_ENTRIES = (
    "chrome/juggler/content/protocol/Protocol.js",
    "chrome/juggler/content/protocol/BrowserHandler.js",
    "chrome/juggler/content/TargetRegistry.js",
    "chrome/juggler/content/protocol/PageHandler.js",
)


class BuildError(RuntimeError):
    pass


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def regular(path: Path, label: str) -> None:
    if not path.is_file() or path.is_symlink():
        raise BuildError(f"{label} must be a regular file: {path}")


def directory(path: Path, label: str) -> None:
    if not path.is_dir() or path.is_symlink():
        raise BuildError(f"{label} must be a real directory: {path}")


def executable_for(app: Path) -> Path:
    info_path = app / "Contents" / "Info.plist"
    regular(info_path, "Info.plist")
    try:
        info = plistlib.loads(info_path.read_bytes())
        name = info["CFBundleExecutable"]
    except (KeyError, TypeError, ValueError, plistlib.InvalidFileException) as error:
        raise BuildError("Info.plist has no valid CFBundleExecutable") from error
    if not isinstance(name, str) or not name or "/" in name:
        raise BuildError("CFBundleExecutable is invalid")
    executable = app / "Contents" / "MacOS" / name
    regular(executable, "Camoufox executable")
    return executable


def check_source(source: Path) -> tuple[Path, dict[str, str]]:
    directory(source, "Camoufox source app")
    executable = executable_for(source)
    resources = source / "Contents" / "Resources"
    directory(resources, "Camoufox resources")
    application_ini = resources / "application.ini"
    properties = resources / "properties.json"
    omni = resources / "omni.ja"
    for path, label in ((application_ini, "application.ini"), (properties, "properties.json"), (omni, "omni.ja")):
        regular(path, label)
    version = ""
    for line in application_ini.read_text(encoding="utf-8").splitlines():
        if line.startswith("Version="):
            version = line.split("=", 1)[1].strip()
            break
    if version != BROWSER_VERSION_PIN:
        raise BuildError(f"browser version is not qualified: {version!r}")
    hashes = {
        "omni.ja": sha256(omni),
        "properties.json": sha256(properties),
        "executable": sha256(executable),
        "info_plist": sha256(source / "Contents" / "Info.plist"),
        "application_ini": sha256(application_ini),
    }
    if hashes != {
        "omni.ja": SOURCE_OMNI_SHA256_PIN,
        "properties.json": PROPERTIES_SHA256_PIN,
        "executable": SOURCE_EXECUTABLE_SHA256_PIN,
        "info_plist": SOURCE_INFO_PLIST_SHA256_PIN,
        "application_ini": SOURCE_APPLICATION_INI_SHA256_PIN,
    }:
        raise BuildError("source Camoufox integrity pins do not match")
    return executable, hashes


def patch_protocol(source: str) -> str:
    anchor = """    'newPage': {
      params: {
        browserContextId: t.Optional(t.String),
      },
      returns: {
        targetId: t.String,
      }
    },
"""
    methods = """    'getWebEnvoyNativeSnapshot': {
      params: {
        browserContextId: t.Optional(t.String),
        timeout: t.Optional(t.Number),
      },
      returns: {
        schemaVersion: t.String,
        epoch: t.String,
        sampleSequence: t.Number,
        selectionStatus: t.Enum(['complete', 'empty', 'partial']),
        activeWindowId: t.Optional(t.String),
        windows: t.Array({
          windowId: t.String,
          osForeground: t.Boolean,
          selectedTabId: t.Optional(t.String),
          pages: t.Array({
            targetId: t.String,
            tabId: t.String,
            browsingContextId: t.String,
            selected: t.Boolean,
          }),
        }),
      },
    },
    'newPageInWindow': {
      params: {
        browserContextId: t.Optional(t.String),
        windowId: t.String,
        timeout: t.Optional(t.Number),
      },
      returns: {
        targetId: t.String,
        windowId: t.String,
        tabId: t.String,
        browsingContextId: t.String,
      },
    },
    'closePageWithSafeReturn': {
      params: {
        browserContextId: t.Optional(t.String),
        targetId: t.String,
        safeTargetId: t.String,
        timeout: t.Optional(t.Number),
      },
      returns: {
        targetId: t.String,
        safeTargetId: t.String,
      },
    },
"""
    if source.count(anchor) != 1:
        raise BuildError("Protocol.js Browser.newPage anchor is not unique")
    return source.replace(anchor, anchor + methods, 1)


def patch_browser_handler(source: str) -> str:
    anchor = """  async ['Browser.newPage']({browserContextId}) {
    const targetId = await this._targetRegistry.newPage({browserContextId});
    return {targetId};
  }
"""
    methods = """  async ['Browser.getWebEnvoyNativeSnapshot']({browserContextId}) {
    if (!this._enabled)
      throw new Error('Browser domain is not enabled');
    return this._targetRegistry.nativeSnapshot({browserContextId});
  }

  async ['Browser.newPageInWindow']({browserContextId, windowId}) {
    if (!this._enabled)
      throw new Error('Browser domain is not enabled');
    return this._targetRegistry.newPageInWindow({browserContextId, windowId});
  }

  async ['Browser.closePageWithSafeReturn']({browserContextId, targetId, safeTargetId}) {
    if (!this._enabled)
      throw new Error('Browser domain is not enabled');
    return this._targetRegistry.closePageWithSafeReturn({browserContextId, targetId, safeTargetId});
  }
"""
    if source.count(anchor) != 1:
        raise BuildError("BrowserHandler.js Browser.newPage anchor is not unique")
    return source.replace(anchor, anchor + methods, 1)


def patch_target_registry(source: str) -> str:
    import_anchor = 'const {AppConstants} = ChromeUtils.importESModule("resource://gre/modules/AppConstants.sys.mjs");\n'
    imports = import_anchor + 'const {TabManager} = ChromeUtils.importESModule("chrome://remote/content/shared/TabManager.sys.mjs");\nconst {UserContextManager} = ChromeUtils.importESModule("chrome://remote/content/shared/UserContextManager.sys.mjs");\n'
    if source.count(import_anchor) != 1:
        raise BuildError("TargetRegistry.js AppConstants import anchor is not unique")
    source = source.replace(import_anchor, imports, 1)
    state_anchor = """    this._browserIdToActor = new Map();
"""
    state = """    this._browserIdToActor = new Map();
    this._nativeEpoch = helper.generateId();
    this._nativeSampleSequence = 0;
    this._nativeWindowIds = new WeakMap();
    this._nativeWindowIdToWindow = new Map();
    this._nativeTabIds = new WeakMap();
"""
    if source.count(state_anchor) != 1:
        raise BuildError("TargetRegistry.js native state anchor is not unique")
    source = source.replace(state_anchor, state, 1)
    method_anchor = """  targetForBrowserId(browserId) {
    return this._browserIdToTarget.get(browserId);
  }
"""
    methods = r'''  _nativeWindowId(window) {
    let windowId = this._nativeWindowIds.get(window);
    if (!windowId) {
      windowId = helper.generateId();
      this._nativeWindowIds.set(window, windowId);
      this._nativeWindowIdToWindow.set(windowId, window);
    }
    return windowId;
  }

  _nativeTabId(tab) {
    let tabId = this._nativeTabIds.get(tab);
    if (!tabId) {
      tabId = helper.generateId();
      this._nativeTabIds.set(tab, tabId);
    }
    return tabId;
  }

  _nativePageFact(target, windowId, tab = target._tab) {
    const linkedBrowser = target._linkedBrowser;
    const browsingContext = linkedBrowser && linkedBrowser.browsingContext;
    if (!tab || target._tab !== tab || !linkedBrowser || !browsingContext || browsingContext.isDiscarded || target._window?.gBrowser?.selectedTab === undefined)
      throw new Error('Native snapshot encountered an incomplete Page relation');
    const browsingContextId = browsingContext.id ?? browsingContext.browserId;
    if (browsingContextId === undefined || browsingContextId === null)
      throw new Error('Native snapshot encountered a Page without BrowsingContext identity');
    return {
      targetId: target.id(),
      tabId: this._nativeTabId(tab),
      browsingContextId: '' + browsingContextId,
      selected: target._window.gBrowser.selectedTab === tab,
      windowId,
    };
  }

  nativeSnapshot({browserContextId}) {
    const browserContext = this.browserContextForId(browserContextId);
    if (!browserContext)
      throw new Error('Native snapshot requested an unknown browser context');
    ++this._nativeSampleSequence;
    let complete = true;
    const grouped = new Map();
    const targetIds = new Set();
    const tabIds = new Set();
    const browsingContextIds = new Set();
    // Enumerate the native tabbrowser independently of BrowserContext.pages.
    // The latter is a Juggler target registry, so it cannot prove that every
    // real tab has a Page target (or that a target still belongs to its tab).
    const nativeTabRecords = [];
    let nativeTabCount = 0;
    for (const window of Services.wm.getEnumerator('navigator:browser')) {
      if (!window.gBrowser || !window.gBrowser.tabs)
        continue;
      for (const tab of window.gBrowser.tabs) {
        // Keep this identical to TargetRegistry's TabOpen ownership path:
        // native tab.userContextId -> _userContextIdToBrowserContext.  Do not
        // infer context from URL, title, attributes, or a Playwright target.
        const nativeContext = this._userContextIdToBrowserContext.get(tab.userContextId);
        if (nativeContext !== browserContext)
          continue;
        ++nativeTabCount;
        const windowId = this._nativeWindowId(window);
        const target = this._browserToTarget.get(tab.linkedBrowser);
        if (!target || target._disposed || target._browserContext !== browserContext || target._window !== window || target._tab !== tab) {
          complete = false;
          continue;
        }
        nativeTabRecords.push({window, windowId, tab, target});
      }
    }
    const registeredTargets = new Set([...browserContext.pages].filter(target => !target._disposed));
    const nativeTargets = new Set(nativeTabRecords.map(record => record.target));
    if (nativeTabRecords.length !== nativeTabCount || nativeTargets.size !== registeredTargets.size || [...registeredTargets].some(target => !nativeTargets.has(target)))
      complete = false;
    // Emit only targets that were proven to be present in the native tab list.
    // A real tab with no target remains a partial/unavailable relation; it is
    // never represented as a closed Page.
    for (const {window, windowId, tab, target} of nativeTabRecords) {
      let group = grouped.get(windowId);
      if (!group) {
        group = {window, pages: []};
        grouped.set(windowId, group);
      }
      const page = this._nativePageFact(target, windowId, tab);
      if (targetIds.has(page.targetId) || tabIds.has(page.tabId) || browsingContextIds.has(page.browsingContextId))
        throw new Error('Native snapshot encountered duplicate Page identity');
      targetIds.add(page.targetId);
      tabIds.add(page.tabId);
      browsingContextIds.add(page.browsingContextId);
      group.pages.push(page);
    }
    const windows = [];
    for (const [windowId, group] of grouped) {
      const selected = group.pages.filter(page => page.selected);
      // The selected tab is complete only when exactly one context Page is
      // natively selected.  OS foreground is reported separately.
      if (selected.length !== 1)
        complete = false;
      windows.push({
        windowId,
        osForeground: Services.focus.activeWindow === group.window,
        selectedTabId: selected.length === 1 ? selected[0].tabId : undefined,
        pages: group.pages.map(page => ({
          targetId: page.targetId,
          tabId: page.tabId,
          browsingContextId: page.browsingContextId,
          selected: page.selected,
        })),
      });
    }
    const activeWindow = Services.wm.getMostRecentWindow('navigator:browser');
    const activeWindowId = [...grouped].find(([, group]) => group.window === activeWindow)?.[0];
    return {
      schemaVersion: 'webenvoy.native-playwright/v1',
      epoch: this._nativeEpoch,
      sampleSequence: this._nativeSampleSequence,
      selectionStatus: nativeTabCount === 0 && registeredTargets.size === 0 ? 'empty' : complete ? 'complete' : 'partial',
      activeWindowId,
      windows,
    };
  }

  async newPageInWindow({browserContextId, windowId}) {
    const browserContext = this.browserContextForId(browserContextId);
    const window = this._nativeWindowIdToWindow.get(windowId);
    if (!browserContext || !window || !window.gBrowser)
      throw new Error('Native background Page requested an unknown window or context');
    const ownsWindow = [...browserContext.pages].some(target => !target._disposed && target._window === window);
    if (!ownsWindow)
      throw new Error('Native background Page window is not owned by this context');
    const publicUserContextId = UserContextManager.getIdByInternalId(browserContext.userContextId);
    if (!publicUserContextId)
      throw new Error('Native background Page context has no public identity');
    const tab = await TabManager.addTab({focus: false, window, userContextId: publicUserContextId});
    let target = this._browserToTarget.get(tab.linkedBrowser);
    while (!target) {
      await helper.awaitEvent(this, TargetRegistry.Events.TargetCreated);
      target = this._browserToTarget.get(tab.linkedBrowser);
    }
    if (target._browserContext !== browserContext || target._window !== window || target._tab !== tab)
      throw new Error('Native background Page relation did not settle in the requested window');
    const fact = this._nativePageFact(target, windowId);
    return {
      targetId: fact.targetId,
      windowId: fact.windowId,
      tabId: fact.tabId,
      browsingContextId: fact.browsingContextId,
    };
  }

  async closePageWithSafeReturn({browserContextId, targetId, safeTargetId}) {
    const browserContext = this.browserContextForId(browserContextId);
    if (!browserContext || typeof targetId !== 'string' || !targetId || typeof safeTargetId !== 'string' || !safeTargetId || targetId === safeTargetId)
      throw new Error('Native close requires distinct target identities and a known browser context');
    const target = [...browserContext.pages].find(candidate => !candidate._disposed && candidate.id() === targetId);
    const safeTarget = [...browserContext.pages].find(candidate => !candidate._disposed && candidate.id() === safeTargetId);
    if (!target || !safeTarget)
      throw new Error('Native close target relation is unavailable');
    if (target._browserContext !== browserContext || safeTarget._browserContext !== browserContext || target._window !== safeTarget._window || !target._window?.gBrowser)
      throw new Error('Native close target and safe return must share the current browser context and window');
    const window = target._window;
    const targetTab = target._tab;
    const safeTab = safeTarget._tab;
    if (!targetTab || !safeTab || targetTab === safeTab || targetTab.linkedBrowser !== target._linkedBrowser || safeTab.linkedBrowser !== safeTarget._linkedBrowser)
      throw new Error('Native close target relation is incomplete');
    const nativeContext = this._userContextIdToBrowserContext.get(targetTab.userContextId);
    const safeNativeContext = this._userContextIdToBrowserContext.get(safeTab.userContextId);
    if (nativeContext !== browserContext || safeNativeContext !== browserContext || !window.gBrowser.tabs.includes(targetTab) || !window.gBrowser.tabs.includes(safeTab))
      throw new Error('Native close target or safe return is not present in its owned native context');

    // Selecting the safe tab directly does not call focus()/bringToFront(), so
    // closing a Page cannot steal OS focus from an unrelated application or
    // another native browser window. Keep skipPermitUnload=false so a native
    // beforeunload guard can veto the removal instead of being bypassed.
    if (window.gBrowser.selectedTab !== safeTab) {
      const switchDone = helper.awaitEvent(window, 'TabSwitchDone');
      window.gBrowser.selectedTab = safeTab;
      await switchDone;
    }
    if (window.gBrowser.selectedTab !== safeTab)
      throw new Error('Native close could not select the safe return tab');
    await TabManager.removeTab(targetTab, {skipPermitUnload: false});
    if (!target._disposed)
      throw new Error('Native close was blocked by beforeunload or did not complete');
    return {targetId, safeTargetId};
  }

'''
    if source.count(method_anchor) != 1:
        raise BuildError("TargetRegistry.js target lookup anchor is not unique")
    return source.replace(method_anchor, method_anchor + methods, 1)


def patch_page_handler(source: str) -> str:
    anchor = """  async ['Page.reload']() {
    await this._pageTarget.activateAndRun(() => {
      const browser = this._pageTarget._tab.linkedBrowser;
      // Camoufox: Firefox 146's Browser:Reload command is a no-op on about:blank
      // (no history entry to reload). Fall back to a forced reloadWithFlags via
      // browsingContext so the load event still fires and init scripts run.
      try {
        const uri = browser.currentURI?.spec;
        if (uri === 'about:blank' || !uri) {
          const bc = browser.browsingContext;
          if (bc && typeof bc.reload === 'function') {
            const Ci = Components.interfaces;
            bc.reload(Ci.nsIWebNavigation.LOAD_FLAGS_NONE);
            return;
          }
        }
      } catch (e) {
        dump(`juggler: reload-fallback failed: ${e}\\n`);
      }
      const doc = browser.ownerDocument;
      doc.getElementById('Browser:Reload').doCommand();
    });
  }
"""
    replacement = """  async ['Page.reload']() {
    const browsingContext = this._pageTarget.linkedBrowser().browsingContext;
    if (!browsingContext || typeof browsingContext.reload !== 'function')
      throw new Error('Page reload has no live BrowsingContext');
    browsingContext.reload(Ci.nsIWebNavigation.LOAD_FLAGS_NONE);
  }
"""
    if source.count(anchor) != 1:
        raise BuildError("PageHandler.js Page.reload anchor is not unique")
    return source.replace(anchor, replacement, 1)


def patch_entries(omni: Path) -> tuple[Path, dict[str, str], dict[str, str]]:
    if sha256(omni) != SOURCE_OMNI_SHA256_PIN:
        raise BuildError("source omni.ja changed before patching")
    with zipfile.ZipFile(omni, "r") as archive:
        members = {info.filename for info in archive.infolist()}
        if any(entry not in members for entry in PATCHED_ENTRIES):
            raise BuildError("source omni.ja is missing a pinned Juggler entry")
        payloads = {name: archive.read(name) for name in members}
        before = {name: hashlib.sha256(payloads[name]).hexdigest() for name in PATCHED_ENTRIES}
        patchers = (patch_protocol, patch_browser_handler, patch_target_registry, patch_page_handler)
        for name, patcher in zip(PATCHED_ENTRIES, patchers):
            payloads[name] = patcher(payloads[name].decode("utf-8")).encode("utf-8")
        after = {name: hashlib.sha256(payloads[name]).hexdigest() for name in PATCHED_ENTRIES}
        descriptor, temporary_name = tempfile.mkstemp(prefix="webenvoy-native-", suffix=".ja")
        os.close(descriptor)
        Path(temporary_name).unlink(missing_ok=True)
        temporary = Path(temporary_name)
        try:
            with zipfile.ZipFile(temporary, "w") as output:
                for info in archive.infolist():
                    output.writestr(info, payloads[info.filename])
        except BaseException:
            temporary.unlink(missing_ok=True)
            raise
    return temporary, before, after


def copy_source(source: Path, output: Path) -> None:
    source = source.expanduser().resolve(strict=False)
    output = output.expanduser().resolve(strict=False)
    if output.exists() or output.is_symlink():
        raise BuildError(f"output already exists: {output}")
    if output == source or source in output.parents or output in source.parents:
        raise BuildError("source and output app paths must be separate")
    output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, output, symlinks=False)


def patch_identity(output: Path) -> None:
    path = output / "Contents" / "Info.plist"
    regular(path, "copied Info.plist")
    try:
        info = plistlib.loads(path.read_bytes())
    except (ValueError, plistlib.InvalidFileException) as error:
        raise BuildError("copied Info.plist is unreadable") from error
    info["CFBundleIdentifier"] = ARTIFACT_BUNDLE_IDENTIFIER
    info["CFBundleName"] = ARTIFACT_BUNDLE_NAME
    info["CFBundleDisplayName"] = ARTIFACT_BUNDLE_NAME
    path.write_bytes(plistlib.dumps(info, fmt=plistlib.FMT_XML, sort_keys=False))


def build(source: Path, output: Path, *, sign: bool) -> dict[str, object]:
    source = source.expanduser().resolve(strict=False)
    output = output.expanduser().resolve(strict=False)
    source_executable, source_hashes = check_source(source)
    if output.exists() or output.is_symlink():
        raise BuildError(f"output already exists: {output}")
    if output == source or source in output.parents or output in source.parents:
        raise BuildError("source and output app paths must be separate")
    temporary, before, after = patch_entries(source / "Contents" / "Resources" / "omni.ja")
    try:
        copy_source(source, output)
        patch_identity(output)
        destination_omni = output / "Contents" / "Resources" / "omni.ja"
        shutil.copy2(temporary, destination_omni)
        # Camoufox's macOS launcher resolves properties.json beside the binary;
        # materialize that exact pinned file in the test artifact so launch does
        # not create a second, unrecorded temporary app layout.
        shutil.copy2(
            output / "Contents" / "Resources" / "properties.json",
            output / "Contents" / "MacOS" / "properties.json",
        )
        manifest = {
        "schema": PATCH_SCHEMA,
        "patch_id": PATCH_ID,
        "distribution_or_production_use_authorized": False,
        "test_only": True,
        "source": {
            "app": str(source),
            "executable": source_executable.name,
            "browser_version": BROWSER_VERSION_PIN,
            **source_hashes,
        },
        "output": {
            "app": str(output),
            "executable": str(output / "Contents" / "MacOS" / source_executable.name),
            "omni_sha256": sha256(output / "Contents" / "Resources" / "omni.ja"),
            "properties_sha256": sha256(output / "Contents" / "Resources" / "properties.json"),
            "executable_sha256": sha256(output / "Contents" / "MacOS" / source_executable.name),
            "info_plist_sha256": sha256(output / "Contents" / "Info.plist"),
            "application_ini_sha256": sha256(output / "Contents" / "Resources" / "application.ini"),
            "adjacent_properties_sha256": sha256(output / "Contents" / "MacOS" / "properties.json"),
        },
        "identity": {"bundle_identifier": ARTIFACT_BUNDLE_IDENTIFIER, "bundle_name": ARTIFACT_BUNDLE_NAME},
        "provider": {"camoufox_version": CAMOUFOX_VERSION_PIN, "browser_version": BROWSER_VERSION_PIN},
        "patched_entries": {
            name: {"before_sha256": before[name], "after_sha256": after[name]}
            for name in PATCHED_ENTRIES
        },
        }
        manifest_path = output / "Contents" / "Resources" / "webenvoy-native-manifest.json"
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return manifest
    finally:
        temporary.unlink(missing_ok=True)


def output_path_safety_check() -> bool:
    """Reject a pre-existing output after normalizing ``..`` without deleting it."""
    with tempfile.TemporaryDirectory(prefix="webenvoy-native-builder-check-") as root_name:
        root = Path(root_name)
        source = root / "source.app"
        source.mkdir()
        existing = root / "existing.app"
        existing.mkdir()
        sentinel = existing / "sentinel"
        sentinel.write_text("keep\n", encoding="utf-8")
        requested = root / "missing-parent" / ".." / "existing.app"
        try:
            copy_source(source, requested)
        except BuildError:
            return sentinel.read_text(encoding="utf-8") == "keep\n"
        return False


def self_check(source: Path) -> dict[str, object]:
    executable, hashes = check_source(source)
    with zipfile.ZipFile(source / "Contents" / "Resources" / "omni.ja") as archive:
        values = {name: archive.read(name).decode("utf-8") for name in PATCHED_ENTRIES}
    patched = (patch_protocol(values[PATCHED_ENTRIES[0]]), patch_browser_handler(values[PATCHED_ENTRIES[1]]), patch_target_registry(values[PATCHED_ENTRIES[2]]), patch_page_handler(values[PATCHED_ENTRIES[3]]))
    checks = {
        "protocol_snapshot": "getWebEnvoyNativeSnapshot" in patched[0],
        "protocol_background_page": "newPageInWindow" in patched[0],
        "protocol_safe_return_close": "closePageWithSafeReturn" in patched[0],
        "handler_snapshot": "Browser.getWebEnvoyNativeSnapshot" in patched[1],
        "handler_safe_return_close": "Browser.closePageWithSafeReturn" in patched[1],
        "registry_snapshot": "nativeSnapshot" in patched[2],
        "registry_background_page": "TabManager.addTab" in patched[2],
        "registry_safe_return_close": "closePageWithSafeReturn" in patched[2] and "selectedTab" in patched[2] and "TabManager.removeTab" in patched[2],
        "registry_native_context_ownership": "_userContextIdToBrowserContext.get(tab.userContextId)" in patched[2],
        "page_reload_uses_browsing_context": "browsingContext.reload(Ci.nsIWebNavigation.LOAD_FLAGS_NONE)" in patched[3] and "activateAndRun" not in patched[3].split("  async ['Page.reload']()", 1)[1].split("  async ['Page.describeNode']", 1)[0],
        "source_unchanged": sha256(source / "Contents" / "Resources" / "omni.ja") == SOURCE_OMNI_SHA256_PIN,
        "existing_output_parent_traversal_safe": output_path_safety_check(),
    }
    if not all(checks.values()):
        raise BuildError("native builder self-check failed")
    return {"status": "verified", "source": str(source), "executable": executable.name, "browser_version": BROWSER_VERSION_PIN, "source_hashes": hashes, "checks": checks}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-app", type=Path, default=Path("/Applications/Camoufox.app"))
    parser.add_argument("--output-app", type=Path)
    parser.add_argument("--self-check", action="store_true", help="verify pins/anchors without creating an app")
    parser.add_argument("--no-adhoc-sign", action="store_true", help="leave the local test artifact unsigned")
    args = parser.parse_args()
    source = args.source_app.expanduser().resolve(strict=False)
    if args.self_check:
        print(json.dumps(self_check(source), ensure_ascii=False, sort_keys=True))
        return 0
    if args.output_app is None:
        parser.error("--output-app is required unless --self-check is used")
    output = args.output_app.expanduser().resolve(strict=False)
    manifest = build(source, output, sign=not args.no_adhoc_sign)
    print(json.dumps({
        "status": "built",
        "artifact": str(output),
        "manifest": str(output / "Contents/Resources/webenvoy-native-manifest.json"),
        "test_only": True,
        "manifest_sha256": sha256(output / "Contents/Resources/webenvoy-native-manifest.json"),
        "output_omni_sha256": manifest["output"]["omni_sha256"],
    }, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BuildError as error:
        raise SystemExit(f"camoufox-native-builder: {error}") from None

"""Driver-owned Playwright 1.60 adapter for the Camoufox provider.

The Python Playwright package remains untouched.  A private, short-lived driver
package is assembled beside the running bridge, copied as a closed file tree,
and patched only in ``coreBundle.js``.  The Python transport is pointed at that
package before ``sync_playwright`` starts, so the adapter runs in the same Node
driver process and uses the regular Playwright connection/channel object graph.
"""

from __future__ import annotations

import hashlib
import importlib.metadata
import inspect
import json
import os
from pathlib import Path
import shutil
import tempfile
from typing import Any


PLAYWRIGHT_VERSION_PIN = "1.60.0"
CORE_BUNDLE_SHA256_PIN = "f74353fcb8e406756a70a6af0dfc4a5069acd577e35ec9d923ccf36ac009c2f5"
CLI_SHA256_PIN = "f1c4075aef116c766092250d7f37b3249a7cee6465d953207fc38c8f6145becd"
UTILS_BUNDLE_SHA256_PIN = "5c42363c10d2f2f5bc91e07feaa9fa5f417a1a55e6559448d0c20d66f73db9e0"
BROWSERS_MANIFEST_SHA256_PIN = "af53e32ffe35a024ddb34563700956b01ada00ac7e9270ba5df0604ec57e38e1"
DRIVER_MANIFEST_SHA256_PIN = "6f7b58cc55449321279f11ca97d4e451c391738b77db32cdbcedf02851e3f097"
ADAPTER_SCHEMA_VERSION = "webenvoy.native-playwright/v1"

# Private closure audit for the pinned Playwright 1.60.0 driver: Python's
# transport enters ``cli.js``; its browser server loads ``lib/coreBundle.js``;
# the only literal relative load in that bundle is ``./utilsBundle``; and
# ``utilsBundle.js`` has no relative loads.  ``package.json`` and
# ``browsers.json`` are the two data manifests read by this entry path.  Those
# five files are therefore independently pinned below; the copied package is
# still materialized as a closed tree so an unexecuted auxiliary asset cannot
# resolve back into a mutable site-packages installation.

# These are private BrowserContext dispatcher methods added to the copied
# Playwright bundle.  Snapshot/create return only Page channels already owned
# by the connection; close returns only the two identities it was given. No
# Page wrapper or target identity is synthesized in Python.
NATIVE_SNAPSHOT_METHOD = "webenvoyNativeSnapshot"
NATIVE_CREATE_PAGE_METHOD = "webenvoyNativeCreatePage"
NATIVE_CLOSE_PAGE_METHOD = "webenvoyNativeClosePage"
NATIVE_SNAPSHOT_SCHEMA = "webenvoy.native-playwright/v1"
NATIVE_REQUEST_RELATION_FIELD = "webenvoyRequestRelation"
NATIVE_REQUEST_RELATION_SCHEMA = "webenvoy.native-playwright/request-relation/v1"
NATIVE_REQUEST_RELATION_MAX_ID_LENGTH = 256


class NativePlaywrightAdapterError(RuntimeError):
    """Raised when the qualified Playwright driver cannot be adapted safely."""


def _regular_file(path: Path, label: str) -> None:
    if not path.is_file() or path.is_symlink():
        raise NativePlaywrightAdapterError(f"Playwright {label} is not a regular file.")


def _hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _patched_bundle(source: str) -> str:
    # Keep the anchor exact: a changed upstream bundle is rejected instead of
    # silently receiving a best-effort textual patch.
    context_anchor = """      async newPage(params2, progress2) {
        return { page: PageDispatcher.from(this, await this._context.newPage(progress2)) };
      }
"""
    context_methods = """      async webenvoyNativeSnapshot(params2, progress2) {
        if (params2 && Object.keys(params2).some((key2) => key2 !== \"timeout\"))
          throw new Error(\"webenvoyNativeSnapshot accepts only its internal timeout\");
        const result2 = await progress2.race(this._context._browser.session.send(\"Browser.getWebEnvoyNativeSnapshot\", {
          browserContextId: this._context._browserContextId
        }));
        if (!result2 || result2.schemaVersion !== \"webenvoy.native-playwright/v1\" || typeof result2.epoch !== \"string\" || !result2.epoch || !Number.isSafeInteger(result2.sampleSequence) || result2.sampleSequence < 1 || ![\"complete\", \"empty\", \"partial\"].includes(result2.selectionStatus) || (result2.activeWindowId !== undefined && typeof result2.activeWindowId !== \"string\") || !Array.isArray(result2.windows))
          throw new Error(\"Native selected-window snapshot returned an invalid schema\");
        const windows = result2.windows.map((window2) => {
          if (!window2 || typeof window2.windowId !== \"string\" || !window2.windowId || typeof window2.osForeground !== \"boolean\" || (window2.selectedTabId !== undefined && typeof window2.selectedTabId !== \"string\") || !Array.isArray(window2.pages))
            throw new Error(\"Native selected-window snapshot returned an invalid window\");
          const pages = window2.pages.map((entry) => {
            if (!entry || typeof entry.targetId !== \"string\" || typeof entry.tabId !== \"string\" || typeof entry.browsingContextId !== \"string\" || typeof entry.selected !== \"boolean\")
              throw new Error(\"Native selected-window snapshot returned an invalid Page fact\");
            const ffPage = this._context._browser._ffPages.get(entry.targetId);
            const page = ffPage && ffPage._browserContext === this._context && ffPage._page && ffPage._page.initializedOrUndefined();
            if (!page)
              throw new Error(\"Native selected-window target has no existing Page\");
            return { page: PageDispatcher.from(this, page), targetId: entry.targetId, tabId: entry.tabId, browsingContextId: entry.browsingContextId, selected: entry.selected };
          });
          const selected = pages.filter((entry) => entry.selected);
          if (window2.selectedTabId !== undefined && (selected.length !== 1 || selected[0].tabId !== window2.selectedTabId))
            throw new Error(\"Native selected-window snapshot has inconsistent selection\");
          if (window2.selectedTabId === undefined && selected.length !== 0)
            throw new Error(\"Native selected-window snapshot omitted its selected tab\");
          return { windowId: window2.windowId, osForeground: window2.osForeground, selectedTabId: window2.selectedTabId, pages };
        });
        if (result2.activeWindowId !== undefined && !windows.some((window2) => window2.windowId === result2.activeWindowId))
          throw new Error(\"Native selected-window snapshot returned an unknown active window\");
        return { schemaVersion: result2.schemaVersion, epoch: result2.epoch, sampleSequence: result2.sampleSequence, selectionStatus: result2.selectionStatus, activeWindowId: result2.activeWindowId, windows };
      }
      async webenvoyNativeCreatePage(params2, progress2) {
        if (!params2 || typeof params2.windowId !== \"string\" || !params2.windowId)
          throw new Error(\"Native background Page requires an existing window\");
        const result2 = await progress2.race(this._context._browser.session.send(\"Browser.newPageInWindow\", {
          browserContextId: this._context._browserContextId,
          windowId: params2.windowId
        }));
        if (!result2 || typeof result2.targetId !== \"string\" || typeof result2.windowId !== \"string\" || typeof result2.tabId !== \"string\" || typeof result2.browsingContextId !== \"string\")
          throw new Error(\"Native background Page creation returned an invalid target\");
        const ffPage = this._context._browser._ffPages.get(result2.targetId);
        const page = ffPage && ffPage._browserContext === this._context && ffPage._page && await progress2.race(ffPage._page.waitForInitializedOrError());
        if (!page || page.isClosed())
          throw new Error(\"Native background Page did not become ready\");
        return { page: PageDispatcher.from(this, page), targetId: result2.targetId, windowId: result2.windowId, tabId: result2.tabId, browsingContextId: result2.browsingContextId };
      }
      async webenvoyNativeClosePage(params2, progress2) {
        if (!params2 || typeof params2.targetId !== \"string\" || !params2.targetId || typeof params2.safeTargetId !== \"string\" || !params2.safeTargetId || params2.targetId === params2.safeTargetId)
          throw new Error(\"Native close requires distinct target identities and a known browser context\");
        const result2 = await progress2.race(this._context._browser.session.send(\"Browser.closePageWithSafeReturn\", {
          browserContextId: this._context._browserContextId,
          targetId: params2.targetId,
          safeTargetId: params2.safeTargetId
        }));
        if (!result2 || typeof result2.targetId !== \"string\" || typeof result2.safeTargetId !== \"string\" || result2.targetId !== params2.targetId || result2.safeTargetId !== params2.safeTargetId)
          throw new Error(\"Native close returned an invalid relation\");
        return result2;
      }
"""
    if source.count(context_anchor) != 1:
        raise NativePlaywrightAdapterError("Playwright BrowserContext adapter anchor is not unique.")
    validator_anchor = """    scheme.BrowserContextNewPageResult = tObject({
      page: tChannel([\"Page\"])
    });
"""
    if source.count(validator_anchor) != 1:
        raise NativePlaywrightAdapterError("Playwright core bundle validator anchor is not unique.")
    validators = """    scheme.BrowserContextWebenvoyNativeSnapshotParams = tOptional(tObject({
      timeout: tOptional(tFloat)
    }));
    scheme.BrowserContextWebenvoyNativeSnapshotResult = tObject({
      schemaVersion: tString,
      epoch: tString,
      sampleSequence: tInt,
      selectionStatus: tString,
      activeWindowId: tOptional(tString),
      windows: tArray(tObject({
        windowId: tString,
        osForeground: tBoolean,
        selectedTabId: tOptional(tString),
        pages: tArray(tObject({
          page: tChannel([\"Page\"]),
          targetId: tString,
          tabId: tString,
          browsingContextId: tString,
          selected: tBoolean
        }))
      }))
    });
    scheme.BrowserContextWebenvoyNativeCreatePageParams = tObject({
      windowId: tString,
      timeout: tOptional(tFloat)
    });
    scheme.BrowserContextWebenvoyNativeCreatePageResult = tObject({
      page: tChannel([\"Page\"]),
      targetId: tString,
      windowId: tString,
      tabId: tString,
      browsingContextId: tString
    });
    scheme.BrowserContextWebenvoyNativeClosePageParams = tObject({
      targetId: tString,
      safeTargetId: tString,
      timeout: tOptional(tFloat)
    });
    scheme.BrowserContextWebenvoyNativeClosePageResult = tObject({
      targetId: tString,
      safeTargetId: tString
    });
    scheme.WebEnvoyRequestRelation = tObject({
      schemaVersion: tString,
      targetId: tString,
      openerId: tOptional(tString),
      browserContextId: tOptional(tString)
    });
"""
    request_initializer_anchor = """    scheme.RequestInitializer = tObject({
      frame: tOptional(tChannel([\"Frame\"])),
      serviceWorker: tOptional(tChannel([\"Worker\"])),
      url: tString,
      resourceType: tString,
      method: tString,
      postData: tOptional(tBinary),
      headers: tArray(tType(\"NameValue\")),
      isNavigationRequest: tBoolean,
      redirectedFrom: tOptional(tChannel([\"Request\"]))
    });
"""
    ffpage_attach_anchor = """        const ffPage = new FFPage(session2, context2, opener);
        this._ffPages.set(targetId, ffPage);
"""
    ffpage_attach_patch = """        const ffPage = new FFPage(session2, context2, opener);
        ffPage._webenvoyNativeRequestTargetId = targetId;
        ffPage._webenvoyNativeRequestOpenerId = typeof openerId === \"string\" && openerId ? openerId : void 0;
        ffPage._webenvoyNativeRequestContextId = typeof browserContextId === \"string\" && browserContextId ? browserContextId : void 0;
        this._ffPages.set(targetId, ffPage);
"""
    request_dispatcher_anchor = """        const postData = request2.postDataBuffer();
        const frame = request2.frame();
        const page = request2.frame()?._page;
"""
    request_dispatcher_patch = """        const postData = request2.postDataBuffer();
        const frame = request2.frame();
        const page = frame?._page;
        const relation = page && page.browserContext === scope._context ? (() => {
          const delegate = page.delegate;
          const targetId = delegate?._webenvoyNativeRequestTargetId;
          if (typeof targetId !== \"string\" || !targetId)
            return void 0;
          const openerId = delegate?._webenvoyNativeRequestOpenerId;
          const browserContextId = delegate?._webenvoyNativeRequestContextId;
          return {
            schemaVersion: \"webenvoy.native-playwright/request-relation/v1\",
            targetId,
            ...(typeof openerId === \"string\" && openerId ? { openerId } : {}),
            ...(typeof browserContextId === \"string\" && browserContextId ? { browserContextId } : {})
          };
        })() : void 0;
"""
    request_initializer = """      redirectedFrom: _RequestDispatcher.fromNullable(scope, request2.redirectedFrom())
"""
    request_initializer_with_relation = """      redirectedFrom: _RequestDispatcher.fromNullable(scope, request2.redirectedFrom()),
          webenvoyRequestRelation: relation
"""
    patched = source.replace(validator_anchor, validator_anchor + validators, 1)
    if source.count(request_initializer_anchor) != 1:
        raise NativePlaywrightAdapterError("Playwright Request initializer anchor is not unique.")
    if source.count(ffpage_attach_anchor) != 1:
        raise NativePlaywrightAdapterError("Playwright Firefox target attach anchor is not unique.")
    if source.count(request_dispatcher_anchor) != 1:
        raise NativePlaywrightAdapterError("Playwright Request dispatcher anchor is not unique.")
    if source.count(request_initializer) != 1:
        raise NativePlaywrightAdapterError("Playwright Request dispatcher initializer anchor is not unique.")
    patched = patched.replace(request_initializer_anchor, request_initializer_anchor.replace(
        "      redirectedFrom: tOptional(tChannel([\"Request\"]))",
        "      redirectedFrom: tOptional(tChannel([\"Request\"])),\n      webenvoyRequestRelation: tOptional(tType(\"WebEnvoyRequestRelation\"))"
    ), 1)
    patched = patched.replace(ffpage_attach_anchor, ffpage_attach_patch, 1)
    patched = patched.replace(request_dispatcher_anchor, request_dispatcher_patch, 1)
    patched = patched.replace(request_initializer, request_initializer_with_relation, 1)
    return patched.replace(context_anchor, context_anchor + context_methods, 1)


class NativePlaywrightDriver:
    """Owns the temporary package and the transport monkeypatch lifetime."""

    def __init__(self, package_dir: Path, driver_dir: Path) -> None:
        self.package_dir = package_dir
        self.driver_dir = driver_dir
        self._old_compute: Any = None
        self._transport_module: Any = None
        self._closed = False

    def install(self) -> None:
        import playwright
        from playwright._impl import _transport

        if importlib.metadata.version("playwright") != PLAYWRIGHT_VERSION_PIN:
            raise NativePlaywrightAdapterError("Playwright Python package version is not qualified.")
        source_driver = Path(inspect.getfile(playwright)).parent / "driver"
        source_package = source_driver / "package"
        source_bundle = source_package / "lib" / "coreBundle.js"
        source_cli = source_package / "cli.js"
        source_utils = source_package / "lib" / "utilsBundle.js"
        source_manifest = source_package / "package.json"
        for path, label in ((source_bundle, "coreBundle.js"), (source_cli, "cli.js"),
                            (source_utils, "utilsBundle.js"), (source_manifest, "package.json")):
            _regular_file(path, label)
        browsers_manifest = source_package / "browsers.json"
        _regular_file(browsers_manifest, "browsers.json")
        expected_hashes = {
            source_bundle: CORE_BUNDLE_SHA256_PIN,
            source_cli: CLI_SHA256_PIN,
            source_utils: UTILS_BUNDLE_SHA256_PIN,
            source_manifest: DRIVER_MANIFEST_SHA256_PIN,
            browsers_manifest: BROWSERS_MANIFEST_SHA256_PIN,
        }
        if any(_hash(path) != expected for path, expected in expected_hashes.items()):
            raise NativePlaywrightAdapterError("Playwright core bundle integrity check failed.")
        if json.loads(source_manifest.read_text(encoding="utf-8")).get("version") != PLAYWRIGHT_VERSION_PIN:
            raise NativePlaywrightAdapterError("Playwright driver manifest version is not qualified.")

        # Copy the complete driver package. A symlinked secondary JS module can
        # drift or disappear while this short-lived provider connection is
        # running, so the managed package is a real, closed file tree.
        shutil.copytree(source_package, self.package_dir, symlinks=False)
        for path in self.package_dir.rglob("*"):
            if path.is_symlink() or (path.exists() and not path.is_file() and not path.is_dir()):
                raise NativePlaywrightAdapterError("Playwright driver package is not a closed file tree.")
        (self.package_dir / "lib" / "coreBundle.js").write_text(
            _patched_bundle(source_bundle.read_text(encoding="utf-8")), encoding="utf-8"
        )

        # _transport imported compute_driver_executable by name. Replace only
        # that function for this process; no installed package file is edited.
        self._transport_module = _transport
        self._old_compute = _transport.compute_driver_executable
        node = source_driver / ("node.exe" if os.name == "nt" else "node")
        _regular_file(node, "Node runtime")
        custom_cli = str(self.package_dir / "cli.js")
        _transport.compute_driver_executable = lambda: (str(node), custom_cli)

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        try:
            if self._transport_module is not None and self._old_compute is not None:
                self._transport_module.compute_driver_executable = self._old_compute
        finally:
            # ``driver_dir`` is the adapter-owned mkdtemp root.  Remove it as
            # well as the copied package so repeated launches do not leave
            # empty provider-driver directories behind.  The caller's Profile
            # is never below this root and is not touched here.
            shutil.rmtree(self.driver_dir, ignore_errors=True)

    def native_snapshot(self, browser: Any, context: Any) -> dict[str, Any]:
        """Invoke the fixed BrowserContext method through this driver's connection."""
        return native_snapshot(browser, context)

    def create_background_page(self, context: Any, window_id: str) -> Any:
        return create_background_page(context, window_id)

    def close_page_with_safe_return(self, context: Any, target_id: str, safe_target_id: str) -> dict[str, str]:
        return close_page_with_safe_return(context, target_id, safe_target_id)

    def request_relation(self, request: Any) -> dict[str, str | None] | None:
        """Read the fixed relation field from one Request initializer.

        The field is attached by the Node RequestDispatcher while constructing
        the route/request object.  Reading it locally avoids a nested protocol
        call from an event handler and never asks Playwright to initialize a
        popup Page.
        """
        return request_relation(request)


def install_native_playwright_driver() -> NativePlaywrightDriver:
    root = Path(tempfile.mkdtemp(prefix="webenvoy-playwright-driver-"))
    package_dir = root / "package"
    adapter = NativePlaywrightDriver(package_dir, root)
    try:
        adapter.install()
    except BaseException:
        shutil.rmtree(root, ignore_errors=True)
        raise
    return adapter


def _channel_page(channel: Any, pages: list[Any]) -> Any:
    implementation = getattr(channel, "_object", None)
    if implementation is None:
        raise NativePlaywrightAdapterError("Native snapshot returned no Page channel.")
    for candidate in pages:
        if getattr(candidate, "_impl_obj", None) is implementation:
            return candidate
    raise NativePlaywrightAdapterError("Native snapshot Page channel is not owned by this context.")


def _timeout_calculator(context: Any) -> Any:
    """Reuse BrowserContext's Playwright timeout policy for native methods.

    Native dispatcher methods may wait for a target or tab-switch event.  Passing
    ``None`` here would omit the protocol deadline and leave those waits
    unbounded if the browser never emits the event.  The private impl context is
    already the source used by Playwright's generated operations, so retaining
    its calculator keeps the adapter on the normal timeout/bridge path.
    """
    implementation = getattr(context, "_impl_obj", None)
    settings = getattr(implementation, "_timeout_settings", None)
    calculator = getattr(settings, "timeout", None)
    if not callable(calculator):
        raise NativePlaywrightAdapterError("Native Playwright context has no bounded timeout calculator.")
    return calculator


def _request_relation_id(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value or len(value) > NATIVE_REQUEST_RELATION_MAX_ID_LENGTH:
        raise NativePlaywrightAdapterError(f"Native request relation has an invalid {label}.")
    return value


def request_relation(request: Any) -> dict[str, str | None] | None:
    """Parse the private Request initializer relation without resolving a Page.

    ``Request.frame`` is intentionally not touched here: Python Playwright
    raises for a navigation request emitted before its client Page is ready.
    A missing field is the legacy/non-Firefox path; a present malformed field
    is an adapter incompatibility and must fail closed at the Driver boundary.
    """
    implementation = getattr(request, "_impl_obj", request)
    initializer = getattr(implementation, "_initializer", None)
    if not isinstance(initializer, dict):
        return None
    raw = initializer.get(NATIVE_REQUEST_RELATION_FIELD)
    if raw is None:
        return None
    if not isinstance(raw, dict) or set(raw) - {"schemaVersion", "targetId", "openerId", "browserContextId"}:
        raise NativePlaywrightAdapterError("Native request relation returned an invalid schema.")
    if raw.get("schemaVersion") != NATIVE_REQUEST_RELATION_SCHEMA:
        raise NativePlaywrightAdapterError("Native request relation returned an unsupported schema.")
    target_id = _request_relation_id(raw.get("targetId"), "targetId")
    opener_id = raw.get("openerId")
    if opener_id is not None:
        opener_id = _request_relation_id(opener_id, "openerId")
        if opener_id == target_id:
            raise NativePlaywrightAdapterError("Native request relation has identical target and opener.")
    browser_context_id = raw.get("browserContextId")
    if browser_context_id is not None:
        browser_context_id = _request_relation_id(browser_context_id, "browserContextId")
    return {"target_id": target_id, "opener_id": opener_id, "browser_context_id": browser_context_id}


def native_snapshot(browser: Any, context: Any) -> dict[str, Any]:
    """Call the fixed BrowserContext method and map existing Page channels.

    The native result is deliberately validated as a complete relation.  A
    stale target, duplicate target/tab/context identity, or missing context
    Page is unavailable; the caller never falls back to URL/title matching.
    """
    if browser is None or context is None:
        raise NativePlaywrightAdapterError("Native selected-window snapshot has no browser context.")
    sync = getattr(context, "_sync", None)
    channel = getattr(getattr(context, "_impl_obj", None), "_channel", None)
    if not callable(sync) or channel is None:
        raise NativePlaywrightAdapterError("Native selected-window snapshot has no context channel.")
    result = sync(channel.send_return_as_dict(NATIVE_SNAPSHOT_METHOD, _timeout_calculator(context), None))
    if (
        not isinstance(result, dict)
        or result.get("schemaVersion") != NATIVE_SNAPSHOT_SCHEMA
        or not isinstance(result.get("epoch"), str)
        or not result["epoch"]
        or type(result.get("sampleSequence")) is not int
        or result["sampleSequence"] < 1
        or result.get("selectionStatus") not in {"complete", "empty", "partial"}
        or (result.get("activeWindowId") is not None and not isinstance(result.get("activeWindowId"), str))
        or not isinstance(result.get("windows"), list)
    ):
        raise NativePlaywrightAdapterError("Native selected-window snapshot returned an invalid schema.")
    pages = list(getattr(context, "pages", []) or [])
    mapped: list[dict[str, Any]] = []
    seen_pages: set[int] = set()
    seen_targets: set[str] = set()
    seen_tabs: set[str] = set()
    seen_contexts: set[str] = set()
    seen_windows: set[str] = set()
    windows: list[dict[str, Any]] = []
    for window in result["windows"]:
        if not isinstance(window, dict) or not isinstance(window.get("windowId"), str) or not window["windowId"] or window["windowId"] in seen_windows:
            raise NativePlaywrightAdapterError("Native selected-window snapshot returned duplicate or invalid windows.")
        seen_windows.add(window["windowId"])
        native_pages = window.get("pages")
        if not isinstance(native_pages, list):
            raise NativePlaywrightAdapterError("Native selected-window snapshot returned an incomplete window.")
        if not isinstance(window.get("osForeground"), bool):
            raise NativePlaywrightAdapterError("Native selected-window snapshot returned an invalid foreground fact.")
        selected_tab_id = window.get("selectedTabId")
        if selected_tab_id is not None and (not isinstance(selected_tab_id, str) or not selected_tab_id):
            raise NativePlaywrightAdapterError("Native selected-window snapshot returned an invalid selected tab.")
        window_pages: list[dict[str, Any]] = []
        for entry in native_pages:
            if not isinstance(entry, dict) or not isinstance(entry.get("targetId"), str) or not entry["targetId"] or not isinstance(entry.get("tabId"), str) or not entry["tabId"] or not isinstance(entry.get("browsingContextId"), str) or not entry["browsingContextId"] or type(entry.get("selected")) is not bool:
                raise NativePlaywrightAdapterError("Native selected-window snapshot returned malformed Page facts.")
            target_id, tab_id, browsing_context_id = entry["targetId"], entry["tabId"], entry["browsingContextId"]
            if target_id in seen_targets or tab_id in seen_tabs or browsing_context_id in seen_contexts:
                raise NativePlaywrightAdapterError("Native selected-window snapshot returned duplicate native identities.")
            page = _channel_page(entry.get("page"), pages)
            page_key = id(page)
            if page_key in seen_pages:
                raise NativePlaywrightAdapterError("Native selected-window snapshot mapped one Page more than once.")
            seen_pages.add(page_key)
            seen_targets.add(target_id)
            seen_tabs.add(tab_id)
            seen_contexts.add(browsing_context_id)
            facts = {"page": page, "target_id": target_id, "tab_id": tab_id, "browsing_context_id": browsing_context_id,
                     "window_id": window["windowId"], "selected": entry["selected"]}
            mapped.append(facts)
            window_pages.append({key: value for key, value in facts.items() if key != "page"})
        selected = [entry for entry in window_pages if entry["selected"]]
        if selected_tab_id is not None and (len(selected) != 1 or selected[0]["tab_id"] != selected_tab_id):
            raise NativePlaywrightAdapterError("Native selected-window snapshot has inconsistent selection.")
        if selected_tab_id is None and selected:
            raise NativePlaywrightAdapterError("Native selected-window snapshot omitted its selected tab.")
        windows.append({"window_id": window["windowId"], "os_foreground": window["osForeground"],
                        "selected_tab_id": selected_tab_id, "pages": window_pages})
    if len(seen_pages) != len(pages):
        raise NativePlaywrightAdapterError("Native selected-window snapshot did not map every context Page.")
    active_window_id = result.get("activeWindowId")
    if active_window_id is not None and active_window_id not in seen_windows:
        raise NativePlaywrightAdapterError("Native selected-window snapshot returned an unknown active window.")
    return {
        "schema_version": result["schemaVersion"],
        "epoch": result["epoch"],
        "sample_sequence": result["sampleSequence"],
        "selection_status": result["selectionStatus"],
        "active_window_id": active_window_id,
        "windows": windows,
        "pages": mapped,
        "selected_pages": [entry for entry in mapped if entry["selected"]],
    }


def create_background_page(context: Any, window_id: str) -> Any:
    """Create a Page in an existing native window without selecting/focusing it."""
    if context is None or not isinstance(window_id, str) or not window_id:
        raise NativePlaywrightAdapterError("Native background Page requires an existing window.")
    sync = getattr(context, "_sync", None)
    channel = getattr(getattr(context, "_impl_obj", None), "_channel", None)
    if not callable(sync) or channel is None:
        raise NativePlaywrightAdapterError("Native background Page has no context channel.")
    result = sync(channel.send_return_as_dict(NATIVE_CREATE_PAGE_METHOD, _timeout_calculator(context), {"windowId": window_id}))
    if not isinstance(result, dict) or not isinstance(result.get("targetId"), str) or not isinstance(result.get("windowId"), str) or not isinstance(result.get("tabId"), str) or not isinstance(result.get("browsingContextId"), str) or result["windowId"] != window_id:
        raise NativePlaywrightAdapterError("Native background Page returned an invalid target.")
    page = _channel_page(result.get("page"), list(getattr(context, "pages", []) or []))
    if getattr(page, "is_closed", lambda: False)():
        raise NativePlaywrightAdapterError("Native background Page is already closed.")
    return page


def close_page_with_safe_return(context: Any, target_id: str, safe_target_id: str) -> dict[str, str]:
    """Close one target after selecting a proven same-window safe target."""
    if context is None or not isinstance(target_id, str) or not target_id or not isinstance(safe_target_id, str) or not safe_target_id or target_id == safe_target_id:
        raise NativePlaywrightAdapterError("Native close requires distinct target identities and a known browser context.")
    sync = getattr(context, "_sync", None)
    channel = getattr(getattr(context, "_impl_obj", None), "_channel", None)
    if not callable(sync) or channel is None:
        raise NativePlaywrightAdapterError("Native close has no context channel.")
    result = sync(channel.send_return_as_dict(NATIVE_CLOSE_PAGE_METHOD, _timeout_calculator(context), {
        "targetId": target_id,
        "safeTargetId": safe_target_id,
    }))
    if not isinstance(result, dict) or result.get("targetId") != target_id or result.get("safeTargetId") != safe_target_id:
        raise NativePlaywrightAdapterError("Native close returned an invalid relation.")
    return {"target_id": target_id, "safe_target_id": safe_target_id}

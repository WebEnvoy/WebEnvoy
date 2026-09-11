#!/usr/bin/env python3
"""Small pure-Python fixture for the Camoufox v1 environment contract."""

from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import os
import tempfile
import types
from pathlib import Path
from unittest.mock import patch


DRIVER_PATH = Path(__file__).with_name("camoufox-driver.py")
SPEC = importlib.util.spec_from_file_location("webenvoy_camoufox_driver", DRIVER_PATH)
assert SPEC and SPEC.loader
DRIVER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DRIVER)


def observed(screen_width: int = 1920) -> dict[str, object]:
    return {
        "language": "en-US",
        "languages": ["en-US"],
        "timezone": "UTC",
        "viewport": {"width": 1280, "height": 720},
        "screen": {"width": screen_width, "height": 1080, "avail_width": screen_width, "avail_height": 1040},
        "hardware_concurrency": 8,
        "device_memory": None,
        "webgl_vendor": "fixture-vendor",
        "webgl_renderer": "fixture-renderer",
        "fonts_hash": None,
        "voices_hash": None,
        "canvas_hash": "a" * 64,
        "audio_hash": "b" * 64,
    }


class Page:
    def __init__(self) -> None:
        self.value = observed()

    def evaluate(self, expression: str) -> dict[str, object]:
        assert expression.startswith("mw:")
        return copy.deepcopy(self.value)


def raises(callable_object, message: str) -> None:
    try:
        callable_object()
    except ValueError as error:
        assert message in str(error), str(error)
    else:
        raise AssertionError(f"expected ValueError containing {message!r}")


with tempfile.TemporaryDirectory(prefix="camoufox-environment-fixture-") as temporary:
    profile = Path(temporary) / "profile"
    config = {
        "screen.width": 1920,
        "screen.height": 1080,
        "window.screenX": 32,
        "window.screenY": 24,
        "window.outerWidth": 1280,
        "window.outerHeight": 760,
        "window.innerWidth": 1264,
        "window.innerHeight": 720,
        "timezone": "UTC",
        "locale:language": "en-US",
        "canvas:seed": "fixture-canvas-seed",
        "fonts:spacing_seed": "fixture-font-seed",
    }
    bundle = DRIVER.build_environment_bundle(config)
    assert DRIVER.extract_camoufox_config({"env": {"CAMOU_CONFIG_2": "b\"}", "CAMOU_CONFIG_1": "{\"a\":\""}}) == {"a": "b"}
    with_config_hash = bundle["config_sha256"]
    DRIVER.save_environment_bundle(profile, bundle)
    assert DRIVER.load_environment_bundle(profile)["config_sha256"] == with_config_hash
    assert (DRIVER.environment_bundle_path(profile).stat().st_mode & 0o777) == 0o600

    replay = copy.deepcopy(config)
    DRIVER.apply_environment_overrides(replay, timezone="Asia/Tokyo", viewport={"width": 1000, "height": 700})
    assert replay["timezone"] == "Asia/Tokyo"
    assert replay["window.outerWidth"] == 1000 and replay["window.outerHeight"] == 700
    assert DRIVER.json_hash(DRIVER.identity_config(replay)) == bundle["identity_hash"]
    assert config["timezone"] == "UTC"

    page = Page()
    DRIVER.PROFILE_DIR = str(profile)
    DRIVER.PAGE = page
    DRIVER.DIAGNOSTIC_INSTANCE_REF = "1" * 32
    first = DRIVER.environment_read()
    assert first["status"] == "completed" and first["continuity"]["state"] == "unknown"
    assert first["observed_at"].endswith(".000Z")
    second = DRIVER.environment_read()
    assert second["continuity"]["state"] == "unknown"
    assert "canvas_hash" in second["continuity"]["unknown_fields"]
    DRIVER.DIAGNOSTIC_INSTANCE_REF = "2" * 32
    second = DRIVER.environment_read()
    assert second["continuity"]["state"] == "match"
    page.value["canvas_hash"] = "c" * 64
    assert "canvas_hash" in DRIVER.environment_read()["continuity"]["changed_fields"]
    page.value = observed()

    # Legacy PNG evidence stays intact; an algorithm upgrade is not a match.
    legacy = DRIVER.load_environment_bundle(profile)
    del legacy["baseline"]["canvas"]
    legacy["baseline"]["observed"]["canvas_hash"] = "d" * 64
    legacy["baseline_sha256"] = DRIVER.json_hash(legacy["baseline"])
    DRIVER.update_environment_bundle(profile, legacy)
    migrated = DRIVER.environment_read()
    assert migrated["continuity"]["state"] == "unknown"
    persisted = DRIVER.load_environment_bundle(profile)
    assert persisted["baseline"]["observed"] == legacy["baseline"]["observed"]
    assert persisted["config"] == legacy["config"] and persisted["identity_hash"] == legacy["identity_hash"]
    assert DRIVER.environment_read()["continuity"]["state"] == "unknown"
    DRIVER.DIAGNOSTIC_INSTANCE_REF = "3" * 32
    assert DRIVER.environment_read()["continuity"]["state"] == "match"
    page.value["canvas_hash"] = "c" * 64
    assert "canvas_hash" in DRIVER.environment_read()["continuity"]["changed_fields"]
    page.value = observed(1600)
    drift = DRIVER.environment_read()
    assert drift["continuity"]["state"] == "drift"
    assert "screen" in drift["continuity"]["checked_fields"]
    assert "screen" in drift["continuity"]["changed_fields"]

    broken = copy.deepcopy(DRIVER.load_environment_bundle(profile))
    broken["identity_hash"] = "0" * 64
    raises(lambda: DRIVER.validate_environment_bundle(broken), "hash")
    broken["identity_hash"] = bundle["identity_hash"]
    broken["provider"] = "chrome"
    raises(lambda: DRIVER.validate_environment_bundle(broken), "provider")
    path = DRIVER.environment_bundle_path(profile)
    path.write_text("{", encoding="utf-8")
    os.chmod(path, 0o600)
    raises(lambda: DRIVER.load_environment_bundle(profile), "corrupt")

    missing = Path(temporary) / "legacy-profile"
    missing.mkdir()
    (missing / "places.sqlite").write_text("fixture", encoding="utf-8")
    assert DRIVER.profile_has_environment_state(missing)

print("camoufox environment fixture passed")

# Exercise the real launch/close boundary with a Provider stand-in. Source audit
# and installed-browser live separately verify the pinned package's merge rules.
with tempfile.TemporaryDirectory(prefix="camoufox-launch-replay-") as temporary:
    root = Path(temporary)
    resources = root / "Camoufox.app" / "Contents" / "Resources"
    resources.mkdir(parents=True)
    (resources / "application.ini").write_text("[App]\nVersion=" + DRIVER.BROWSER_VERSION_PIN, encoding="utf-8")
    (resources / "properties.json").write_text("[]", encoding="utf-8")
    executable = resources.parent / "MacOS" / "camoufox"
    profile = root / "profile"
    calls = {"options": 0, "browser": 0}
    fail_browser = False
    change_identity = False
    seen = []

    def options(**kwargs):
        calls["options"] += 1
        config = copy.deepcopy(kwargs["config"])
        config.setdefault("canvas:seed", calls["options"])
        config.setdefault("audio:seed", calls["options"])
        config.setdefault("fonts:spacing_seed", calls["options"])
        config.setdefault("screen.width", 1920)
        if calls["options"] > 1:
            config["screen.availLeft"] = 0  # Optional BrowserForge key absent on the original draw.
        if change_identity:
            config["canvas:seed"] = -1
        seen.append(config)
        return {"env": {"CAMOU_CONFIG_1": json.dumps(config)}, "timezone_id": kwargs["timezone_id"], "firefox_user_prefs": kwargs["firefox_user_prefs"]}

    def browser(*args, **kwargs):
        calls["browser"] += 1
        assert "screen.availLeft" not in DRIVER.extract_camoufox_config(kwargs["from_options"])
        assert kwargs["from_options"]["timezone_id"] == seen[-1]["timezone"]
        assert kwargs["from_options"]["firefox_user_prefs"]["roverfox.s.timezone_0"] == seen[-1]["timezone"]
        # Persistence precedes browser creation, even if creation then fails.
        assert DRIVER.load_environment_bundle(profile)["config"]["canvas:seed"] == seen[0]["canvas:seed"]
        if fail_browser:
            raise ValueError("fixture launch failure")
        page = types.SimpleNamespace(url="about:blank", title=lambda: "", on=lambda *_: None, bring_to_front=lambda: None)
        return types.SimpleNamespace(pages=[page], browser=types.SimpleNamespace(version=DRIVER.BROWSER_VERSION_PIN), close=lambda: None)

    camoufox = types.ModuleType("camoufox")
    camoufox.launch_options, camoufox.NewBrowser = options, browser
    utils = types.ModuleType("camoufox.utils")
    utils.get_env_vars = lambda config, *args, **kwargs: {"CAMOU_CONFIG_1": json.dumps(config)}
    sync = types.ModuleType("playwright.sync_api")
    sync.TimeoutError = TimeoutError
    sync.sync_playwright = lambda: types.SimpleNamespace(start=lambda: types.SimpleNamespace(stop=lambda: None))
    class NativeAdapter:
        def install_native_playwright_driver(self):
            return self
        def native_snapshot(self, _browser, context):
            page = context.pages[0]
            return {
                "schema_version": "webenvoy.native-playwright/v1",
                "epoch": "fixture-epoch",
                "sample_sequence": 1,
                "selection_status": "complete",
                "active_window_id": "fixture-window",
                "windows": [{
                    "window_id": "fixture-window",
                    "os_foreground": True,
                    "selected_tab_id": "fixture-tab",
                    "pages": [{
                        "page": page,
                        "target_id": "fixture-target",
                        "tab_id": "fixture-tab",
                        "browsing_context_id": "fixture-context",
                        "window_id": "fixture-window",
                        "selected": True,
                    }],
                }],
                "pages": [{
                    "page": page,
                    "target_id": "fixture-target",
                    "tab_id": "fixture-tab",
                    "browsing_context_id": "fixture-context",
                    "window_id": "fixture-window",
                    "selected": True,
                }],
                "selected_pages": [{
                    "page": page,
                    "target_id": "fixture-target",
                    "tab_id": "fixture-tab",
                    "browsing_context_id": "fixture-context",
                    "window_id": "fixture-window",
                    "selected": True,
                }],
            }
        def create_background_page(self, context, _window_id):
            return context.pages[0]
        def close_page_with_safe_return(self, _context, target_id, safe_target_id):
            return {"target_id": target_id, "safe_target_id": safe_target_id}
        def close(self):
            pass
    native_adapter = NativeAdapter()
    modules = {"camoufox": camoufox, "camoufox.utils": utils, "playwright": types.ModuleType("playwright"), "playwright.sync_api": sync}
    with patch.dict(DRIVER.sys.modules, modules), patch.object(DRIVER.sys, "version_info", (3, 12)), \
         patch.object(DRIVER.importlib.metadata, "version", side_effect=lambda name: {"camoufox": DRIVER.CAMOUFOX_VERSION_PIN, "playwright": "1.60.0"}[name]), \
         patch.object(DRIVER, "PROPERTIES_SHA256_PIN", hashlib.sha256(b"[]").hexdigest()), \
         patch.object(DRIVER, "prepare_properties", side_effect=lambda path: (path, "fixture")), \
         patch.object(DRIVER, "native_playwright_adapter_module", return_value=native_adapter):
        request = {"profile_dir": str(profile), "executable_path": str(executable), "timezone": "UTC"}
        fail_browser = True
        raises(lambda: DRIVER.launch(request), "launch failure")
        baseline_bytes = DRIVER.environment_bundle_path(profile).read_bytes()
        fail_browser = False
        DRIVER.launch(request)
        DRIVER.close()
        DRIVER.launch({**request, "timezone": "Asia/Tokyo"})
        DRIVER.close()
        assert seen[0]["canvas:seed"] == seen[1]["canvas:seed"] == seen[2]["canvas:seed"]
        assert seen[-1]["timezone"] == "Asia/Tokyo"
        assert DRIVER.environment_bundle_path(profile).read_bytes() == baseline_bytes
        before = calls.copy()
        change_identity = True
        raises(lambda: DRIVER.launch(request), "replay changed")
        assert calls["browser"] == before["browser"]
        assert DRIVER.environment_bundle_path(profile).read_bytes() == baseline_bytes
        change_identity = False
        for key, value in (("schema_version", 99), ("browser_version", "future")):
            broken = json.loads(baseline_bytes)
            broken[key] = value
            DRIVER.environment_bundle_path(profile).write_text(json.dumps(broken), encoding="utf-8")
            before = calls.copy()
            raises(lambda: DRIVER.launch(request), "unsupported")
            assert calls == before
        DRIVER.environment_bundle_path(profile).write_bytes(baseline_bytes)
        with patch.object(DRIVER.importlib.metadata, "version", return_value="unqualified"):
            before = calls.copy()
            raises(lambda: DRIVER.launch(request), "pins")
            assert calls == before
        DRIVER.environment_bundle_path(profile).unlink()
        (profile / "places.sqlite").write_text("fixture", encoding="utf-8")
        before = calls.copy()
        raises(lambda: DRIVER.launch(request), "non-empty")
        assert calls == before
        assert not DRIVER.environment_bundle_path(profile).exists()
        DRIVER.close()

print("camoufox real launch boundary fixture passed")

# Keep the private adapter's Channel call contract executable in a dependency-
# free fixture. Playwright 1.60 takes (method, timeout_calculator, params), so
# passing params in the second position must fail this exact-signature stand-in.
ADAPTER_PATH = Path(__file__).with_name("camoufox-native-playwright.py")
ADAPTER_SPEC = importlib.util.spec_from_file_location("webenvoy_camoufox_native_playwright_fixture", ADAPTER_PATH)
assert ADAPTER_SPEC and ADAPTER_SPEC.loader
ADAPTER = importlib.util.module_from_spec(ADAPTER_SPEC)
ADAPTER_SPEC.loader.exec_module(ADAPTER)


class ExactChannel:
    def __init__(self, page_channel) -> None:
        self.page_channel = page_channel
        self.calls = []

    def send_return_as_dict(self, method, timeout_calculator, params=None, is_internal=False, title=None):
        assert callable(timeout_calculator)
        assert timeout_calculator(None) == 4_000
        self.calls.append((method, params))
        if method == ADAPTER.NATIVE_SNAPSHOT_METHOD:
            return {
                "schemaVersion": ADAPTER.NATIVE_SNAPSHOT_SCHEMA,
                "epoch": "fixture-epoch",
                "sampleSequence": 1,
                "selectionStatus": "complete",
                "activeWindowId": "fixture-window",
                "windows": [{
                    "windowId": "fixture-window",
                    "osForeground": True,
                    "selectedTabId": "fixture-tab",
                    "pages": [{
                        "targetId": "fixture-target",
                        "tabId": "fixture-tab",
                        "browsingContextId": "fixture-context",
                        "selected": True,
                        "page": self.page_channel,
                    }],
                }],
            }
        if method == ADAPTER.NATIVE_CREATE_PAGE_METHOD:
            assert params == {"windowId": "fixture-window"}
            return {
                "targetId": "fixture-target",
                "windowId": "fixture-window",
                "tabId": "fixture-tab",
                "browsingContextId": "fixture-context",
                "page": self.page_channel,
            }
        if method == ADAPTER.NATIVE_CLOSE_PAGE_METHOD:
            assert params == {"targetId": "fixture-target", "safeTargetId": "fixture-safe-target"}
            return {"targetId": "fixture-target", "safeTargetId": "fixture-safe-target"}
        raise AssertionError(f"unexpected native method: {method}")


page_impl = object()
page_channel = types.SimpleNamespace(_object=page_impl)
channel = ExactChannel(page_channel)
context_impl = types.SimpleNamespace(
    _channel=channel,
    _timeout_settings=types.SimpleNamespace(timeout=lambda _timeout=None: 4_000),
)
context = types.SimpleNamespace(
    _sync=lambda value: value,
    _impl_obj=context_impl,
    pages=[types.SimpleNamespace(_impl_obj=page_impl, is_closed=lambda: False)],
)
assert ADAPTER.native_snapshot(object(), context)["sample_sequence"] == 1
assert ADAPTER.create_background_page(context, "fixture-window") is context.pages[0]
assert ADAPTER.close_page_with_safe_return(context, "fixture-target", "fixture-safe-target") == {
    "target_id": "fixture-target",
    "safe_target_id": "fixture-safe-target",
}
assert channel.calls == [
    (ADAPTER.NATIVE_SNAPSHOT_METHOD, None),
    (ADAPTER.NATIVE_CREATE_PAGE_METHOD, {"windowId": "fixture-window"}),
    (ADAPTER.NATIVE_CLOSE_PAGE_METHOD, {"targetId": "fixture-target", "safeTargetId": "fixture-safe-target"}),
]
print("camoufox native Playwright Channel fixture passed")

# Native Page relation fixtures are deliberately pure: they exercise the
# Driver's bidirectional identity checks without starting a browser or
# reconstructing a Page from URL/title facts.
class RelationPage:
    def __init__(self, name: str) -> None:
        self.name = name
        self.url = "about:blank"

    def title(self) -> str:
        return self.name

    def is_closed(self) -> bool:
        return False

    def on(self, *_args) -> None:
        pass

    def bring_to_front(self) -> None:
        pass


def native_relation(epoch: str, sequence: int, pages: list[tuple[RelationPage, str, str, str, str, bool]], active_window_id: str = "window-a") -> dict[str, object]:
    facts = [
        {"page": page, "target_id": target, "tab_id": tab, "browsing_context_id": context,
         "window_id": window, "selected": selected}
        for page, target, tab, context, window, selected in pages
    ]
    return {
        "epoch": epoch,
        "sample_sequence": sequence,
        "selection_status": "complete",
        "active_window_id": active_window_id,
        "windows": [{
            "window_id": "window-a", "os_foreground": True,
            "pages": [{key: value for key, value in item.items() if key != "page"} for item in facts],
        }],
        "pages": facts,
    }


class RelationAdapter:
    def __init__(self, *samples: dict[str, object]) -> None:
        self.samples = list(samples)
        self.calls = 0

    def native_snapshot(self, _browser, _context) -> dict[str, object]:
        self.calls += 1
        return self.samples.pop(0) if self.samples else self.samples[-1]


DRIVER.reset_provider_pages()
DRIVER.PAGE = None
DRIVER.CONTEXT = types.SimpleNamespace(browser=object())
DRIVER.NATIVE_PLAYWRIGHT_ADAPTER = None
original_max_tombstones = DRIVER.MAX_PAGE_TOMBSTONES
try:
    original = RelationPage("original")
    DRIVER.CONTEXT.pages = [original]
    DRIVER.register_provider_page(original)
    first_sample = native_relation("relation-epoch", 1, [(original, "target-a", "tab-a", "context-a", "window-a", True)])
    replacement = RelationPage("replacement")
    replacement_sample = native_relation("relation-epoch", 2, [(replacement, "target-a", "tab-a", "context-a", "window-a", True)])
    relation_adapter = RelationAdapter(first_sample, replacement_sample)
    DRIVER.NATIVE_PLAYWRIGHT_ADAPTER = relation_adapter
    DRIVER.PAGE = original
    DRIVER.refresh_native_selected_page()
    original_state = DRIVER.page_state_for(original)
    assert original_state and original_state["native_target_id"] == "target-a"
    try:
        DRIVER.refresh_native_selected_page()
    except RuntimeError as error:
        assert "replacement Page object" in str(error)
    else:
        raise AssertionError("replacement Page object was accepted")
    assert DRIVER.NATIVE_RELATION_INVALID is True
    assert DRIVER.NATIVE_RELATION_SAMPLE_SEQUENCE == 1
    assert DRIVER.PAGE is original and original_state["native_target_id"] == "target-a"
    calls_after_replacement = relation_adapter.calls
    try:
        DRIVER.refresh_native_selected_page()
    except RuntimeError as error:
        assert "permanently unavailable" in str(error)
    else:
        raise AssertionError("invalid native relation was recoverable without a new binding")
    assert relation_adapter.calls == calls_after_replacement

    # A malformed or changed second sample must not partially clear the last
    # trusted active selection or freshness watermark.
    DRIVER.reset_provider_pages()
    page_a, page_b = RelationPage("a"), RelationPage("b")
    DRIVER.CONTEXT.pages = [page_a, page_b]
    DRIVER.register_provider_page(page_a)
    DRIVER.register_provider_page(page_b)
    atomic_first = native_relation("atomic-epoch", 1, [
        (page_a, "target-a", "tab-a", "context-a", "window-a", True),
        (page_b, "target-b", "tab-b", "context-b", "window-a", False),
    ])
    atomic_changed = native_relation("atomic-epoch", 2, [
        (page_a, "target-a", "tab-a", "context-a", "window-a", True),
        (page_b, "target-b-new", "tab-b", "context-b", "window-a", False),
    ])
    atomic_adapter = RelationAdapter(atomic_first, atomic_changed)
    DRIVER.NATIVE_PLAYWRIGHT_ADAPTER = atomic_adapter
    DRIVER.PAGE = page_a
    DRIVER.refresh_native_selected_page()
    before_atomic = (DRIVER.PAGE, DRIVER.NATIVE_RELATION_SAMPLE_SEQUENCE,
                     DRIVER.page_state_for(page_a).get("native_active"),
                     DRIVER.page_state_for(page_b).get("native_selected"))
    try:
        DRIVER.refresh_native_selected_page()
    except RuntimeError as error:
        assert "identity changed" in str(error)
    else:
        raise AssertionError("changed native identity was accepted")
    after_atomic = (DRIVER.PAGE, DRIVER.NATIVE_RELATION_SAMPLE_SEQUENCE,
                    DRIVER.page_state_for(page_a).get("native_active"),
                    DRIVER.page_state_for(page_b).get("native_selected"))
    assert after_atomic == before_atomic

    stale_adapter = RelationAdapter(native_relation("stale-epoch", 1, [
        (page_a, "target-a", "tab-a", "context-a", "window-a", True),
    ]), native_relation("stale-epoch", 1, [
        (page_a, "target-a", "tab-a", "context-a", "window-a", True),
    ]))
    DRIVER.reset_provider_pages()
    DRIVER.CONTEXT.pages = [page_a]
    DRIVER.register_provider_page(page_a)
    DRIVER.NATIVE_PLAYWRIGHT_ADAPTER = stale_adapter
    DRIVER.PAGE = page_a
    DRIVER.refresh_native_selected_page()
    try:
        DRIVER.refresh_native_selected_page()
    except RuntimeError as error:
        assert "stale" in str(error)
    else:
        raise AssertionError("non-monotonic native sample was accepted")
    assert DRIVER.NATIVE_RELATION_SAMPLE_SEQUENCE == 1

    # Confirmed close tombstones are bounded; an unconfirmed close remains
    # visible because dropping it would hide an unresolved native relation.
    DRIVER.reset_provider_pages()
    DRIVER.NATIVE_PLAYWRIGHT_ADAPTER = None
    DRIVER.MAX_PAGE_TOMBSTONES = 2
    tombstone_pages = [RelationPage(f"closed-{index}") for index in range(4)]
    for index, page in enumerate(tombstone_pages):
        state = DRIVER.register_provider_page(page)
        state.update({"closed": True, "closed_at": float(index), "native_close_confirmed": index != 3,
                      "native_browsing_context_id": f"context-{index}"})
    visible_tombstones = DRIVER.all_page_states()
    visible_names = {item["title"] for item in visible_tombstones}
    assert visible_names == {"closed-1", "closed-2"}
    assert len([item for item in visible_tombstones if item["status"] == "closed"]) == 2
    assert any(state["page"].title() == "closed-3" for state in DRIVER.PAGE_STATES.values())
finally:
    DRIVER.MAX_PAGE_TOMBSTONES = original_max_tombstones
    DRIVER.NATIVE_PLAYWRIGHT_ADAPTER = None
    DRIVER.PAGE = None
    DRIVER.CONTEXT = None
    DRIVER.reset_provider_pages()

print("camoufox native Page relation fixtures passed")

# Interaction origin scopes are resolved by Page identity and opener identity,
# never by the active Page as a global fallback.
class GuardPage:
    def __init__(self, name: str, opener=None) -> None:
        self.name, self.opener = name, opener
        self.url = "https://example.com/"
        self.routes = []

    def on(self, *_args) -> None:
        pass

    def route(self, _pattern, handler) -> None:
        self.routes.append(handler)

    def unroute(self, _pattern, handler) -> None:
        if handler in self.routes:
            self.routes.remove(handler)

    def is_closed(self) -> bool:
        return False


class GuardRoute:
    def __init__(self, url: str, page: GuardPage, status: int = 200) -> None:
        self.request = types.SimpleNamespace(url=url, frame=types.SimpleNamespace(page=page))
        self.status, self.fetched, self.aborted, self.fulfilled = status, 0, False, False

    def fetch(self, **kwargs):
        assert kwargs["max_redirects"] == 0
        self.fetched += 1
        return types.SimpleNamespace(status=self.status, dispose=lambda: None)

    def abort(self, *_args) -> None:
        self.aborted = True

    def fulfill(self, **_kwargs) -> None:
        self.fulfilled = True


DRIVER.PAGE = GuardPage("active")
DRIVER.CONTEXT = types.SimpleNamespace(route=lambda _pattern, handler: setattr(DRIVER.CONTEXT, "guard", handler), unroute=lambda *_args: None)
DRIVER.reset_provider_pages()
DRIVER.PAGE = GuardPage("active")
active_page = DRIVER.PAGE
popup_page = GuardPage("popup", active_page)
other_page = GuardPage("other")
DRIVER.CONTEXT.pages = [active_page, popup_page, other_page]
DRIVER.register_provider_page(active_page)
DRIVER.register_provider_page(popup_page, active_page)
DRIVER.register_provider_page(other_page)
DRIVER.install_interaction_guard("https://example.com", ["https://example.com", "https://second.example"])
handler = DRIVER.INTERACTION_GUARD
assert handler is not None
for page, url in ((active_page, "https://second.example/active"), (popup_page, "https://second.example/popup")):
    route = GuardRoute(url, page)
    handler(route)
    assert route.fulfilled and not route.aborted and route.fetched == 1
for page, url in ((popup_page, "https://third.example/blocked"), (other_page, "https://second.example/unrelated")):
    route = GuardRoute(url, page)
    handler(route)
    assert route.aborted and not route.fulfilled and route.fetched == 0
DRIVER.clear_interaction_guard()
DRIVER.PAGE = None
DRIVER.CONTEXT = None
DRIVER.reset_provider_pages()
print("camoufox per-Page/opener interaction guard fixture passed")

# Managed public reads and observations must use the exact private Page binding
# supplied by Harbor.  The active Page is deliberately a different window.
class PublicPage:
    def __init__(self, url: str, text: str) -> None:
        self.url, self.text, self.routes, self.evaluations = url, text, [], 0
        self.main_frame = object()

    def title(self) -> str:
        return self.text[:64]

    def evaluate(self, expression: str, *_args):
        assert expression.startswith("mw:")
        self.evaluations += 1
        if "location.origin !== expected" in expression:
            return {"text": self.text, "truncated": False}
        return {"current_url": self.url, "title": self.title(), "ready_state": "complete", "stable_id": None}

    def route(self, _pattern, handler) -> None:
        self.routes.append(handler)

    def unroute(self, _pattern, handler) -> None:
        if handler in self.routes:
            self.routes.remove(handler)

    def is_closed(self) -> bool:
        return False

    def goto(self, url: str, **_kwargs) -> None:
        self.url = url


DRIVER.reset_provider_pages()
active_public_page = PublicPage("https://one.example/active", "active text")
background_public_page = PublicPage("https://two.example/background", "background text")
DRIVER.PAGE = active_public_page
active_public_state = DRIVER.register_provider_page(active_public_page)
background_public_state = DRIVER.register_provider_page(background_public_page)
background_ref = background_public_state["provider_page_ref"]
public_result = DRIVER.managed_public_page({
    "provider_page_ref": background_ref,
    "expected_origin": "https://two.example",
})
assert public_result["text"] == "background text"
assert public_result["page"]["current_url"] == "https://two.example/background"
assert active_public_page.evaluations == 0
assert DRIVER.managed_public_page({
    "provider_page_ref": background_ref,
    "expected_origin": "https://one.example",
})["failure_class"] == "managed_public_origin_denied"
assert background_public_page.evaluations == 1
assert DRIVER.managed_public_page({"expected_origin": "https://one.example"})["failure_class"] == "page_selection_required"
assert active_public_page.evaluations == 0
observation = DRIVER.managed_observe({
    "provider_page_ref": background_ref,
    "expected_origin": "https://two.example",
    "expression": "(() => ({ current_url: location.href }))()",
})
assert observation["current_url"] == "https://two.example/background"
try:
    DRIVER.managed_observe({
        "provider_page_ref": background_ref,
        "expected_origin": "https://one.example",
        "expression": "(() => ({}))()",
    })
except ValueError as error:
    assert "managed_observation_origin_denied" in str(error)
else:
    raise AssertionError("wrong-origin managed observation was accepted")
background_public_state["closed"] = True
assert DRIVER.managed_public_page({
    "provider_page_ref": background_ref,
    "expected_origin": "https://two.example",
})["failure_class"] == "managed_public_page_unavailable"
DRIVER.clear_public_navigation_guard()
DRIVER.PAGE = None
DRIVER.CONTEXT = None
DRIVER.reset_provider_pages()
print("camoufox managed Page binding fixture passed")

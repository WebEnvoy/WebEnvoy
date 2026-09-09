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
        page = types.SimpleNamespace(url="about:blank", title=lambda: "", on=lambda *_: None)
        return types.SimpleNamespace(pages=[page], browser=types.SimpleNamespace(version=DRIVER.BROWSER_VERSION_PIN), close=lambda: None)

    camoufox = types.ModuleType("camoufox")
    camoufox.launch_options, camoufox.NewBrowser = options, browser
    utils = types.ModuleType("camoufox.utils")
    utils.get_env_vars = lambda config, *args, **kwargs: {"CAMOU_CONFIG_1": json.dumps(config)}
    sync = types.ModuleType("playwright.sync_api")
    sync.TimeoutError = TimeoutError
    sync.sync_playwright = lambda: types.SimpleNamespace(start=lambda: types.SimpleNamespace(stop=lambda: None))
    modules = {"camoufox": camoufox, "camoufox.utils": utils, "playwright": types.ModuleType("playwright"), "playwright.sync_api": sync}
    with patch.dict(DRIVER.sys.modules, modules), patch.object(DRIVER.sys, "version_info", (3, 12)), \
         patch.object(DRIVER.importlib.metadata, "version", side_effect=lambda name: {"camoufox": DRIVER.CAMOUFOX_VERSION_PIN, "playwright": "1.60.0"}[name]), \
         patch.object(DRIVER, "PROPERTIES_SHA256_PIN", hashlib.sha256(b"[]").hexdigest()), \
         patch.object(DRIVER, "prepare_properties", side_effect=lambda path: (path, "fixture")):
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

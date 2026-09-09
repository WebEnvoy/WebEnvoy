#!/usr/bin/env python3
"""Small pure-Python fixture for the Camoufox v1 environment contract."""

from __future__ import annotations

import copy
import importlib.util
import json
import os
import tempfile
from pathlib import Path


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
    first = DRIVER.environment_read()
    assert first["status"] == "completed" and first["continuity"]["state"] == "unknown"
    assert first["observed_at"].endswith(".000Z")
    second = DRIVER.environment_read()
    assert second["continuity"]["state"] == "match"
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

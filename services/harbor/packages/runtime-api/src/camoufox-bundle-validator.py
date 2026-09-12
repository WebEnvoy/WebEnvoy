#!/usr/bin/env python3
"""Stdlib-only validator for retained Camoufox environment bundles.

This helper is deliberately not a browser driver.  It never imports Camoufox
or Playwright, starts a process, writes a Profile, or rewrites an installation.
Harbor uses the JSON-lines entrypoint only to validate a retained bundle during
Profile recovery; bundle creation remains an upstream/provider responsibility.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import stat
import sys
from pathlib import Path
from typing import Any


CAMOUFOX_VERSION_PIN = "0.5.6"
BROWSER_VERSION_PIN = "152.0.4-beta.30"
PROPERTIES_SHA256_PIN = "10d5cfb6c8eb3824485734362a3920e07b36c3801770fffcc14a3546e56f81f4"
ENVIRONMENT_BUNDLE_FILENAME = ".webenvoy-camoufox-environment.v1.json"
MAX_ENVIRONMENT_BUNDLE_BYTES = 2 * 1024 * 1024
CANVAS_HASH_ALGORITHM = "rgba8-240x60-v1"
DYNAMIC_ENVIRONMENT_CONFIG_KEYS = frozenset({
    "timezone",
    "locale:language",
    "locale:region",
    "locale:script",
    "locale:all",
    "navigator.language",
    "window.outerWidth",
    "window.outerHeight",
    "window.innerWidth",
    "window.innerHeight",
    "window.screenX",
    "window.screenY",
})
CONTINUITY_STABLE_FIELDS = (
    "screen",
    "hardware_concurrency",
    "webgl_vendor",
    "webgl_renderer",
    "canvas_hash",
    "audio_hash",
)


def canonical_json(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def json_hash(value: Any) -> str:
    return hashlib.sha256(canonical_json(value)).hexdigest()


def identity_config(config: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in config.items()
        if key not in DYNAMIC_ENVIRONMENT_CONFIG_KEYS
    }


def environment_bundle_path(profile_dir: str | Path) -> Path:
    return Path(profile_dir).absolute() / ENVIRONMENT_BUNDLE_FILENAME


def profile_has_environment_state(profile_dir: str | Path) -> bool:
    profile = Path(profile_dir).absolute()
    if not profile.exists():
        return False
    if not profile.is_dir():
        raise ValueError("Camoufox managed profile path is not a directory.")
    return any(entry.name != ENVIRONMENT_BUNDLE_FILENAME for entry in profile.iterdir())


def validate_environment_bundle(bundle: Any) -> dict[str, Any]:
    required = {
        "schema_version",
        "provider",
        "camoufox_version",
        "browser_version",
        "properties_sha256",
        "config",
        "config_sha256",
        "identity_hash",
        "baseline",
        "baseline_sha256",
    }
    if not isinstance(bundle, dict) or not required.issubset(bundle) or set(bundle) - required - {"launch_options", "context_options"}:
        raise ValueError("Camoufox environment bundle schema is unsupported or corrupt.")
    if (
        type(bundle["schema_version"]) is not int
        or bundle["schema_version"] != 1
        or bundle["provider"] != "camoufox"
        or bundle["camoufox_version"] != CAMOUFOX_VERSION_PIN
        or bundle["browser_version"] != BROWSER_VERSION_PIN
        or bundle["properties_sha256"] != PROPERTIES_SHA256_PIN
    ):
        raise ValueError("Camoufox environment bundle provider or version is unsupported.")

    config = bundle["config"]
    if not isinstance(config, dict) or not config:
        raise ValueError("Camoufox environment bundle config is corrupt.")
    try:
        config_hash = json_hash(config)
        identity_hash = json_hash(identity_config(config))
    except (TypeError, ValueError, OverflowError) as error:
        raise ValueError("Camoufox environment bundle config is not valid JSON.") from error
    if len(canonical_json(config)) > MAX_ENVIRONMENT_BUNDLE_BYTES:
        raise ValueError("Camoufox environment bundle config is too large.")
    if bundle["config_sha256"] != config_hash or bundle["identity_hash"] != identity_hash:
        raise ValueError("Camoufox environment bundle hash does not match its config.")

    # New upstream launches persist the complete public launch_options result
    # beside the historical config projection. Retained old bundles do not
    # have this field and remain valid for recovery-only inspection.
    if "launch_options" in bundle:
        options = bundle["launch_options"]
        if not isinstance(options, dict) or set(options) - {"args", "env", "executable_path", "firefox_user_prefs", "headless"}:
            raise ValueError("Camoufox launch options are unsupported or corrupt.")
        if not isinstance(options.get("args"), list) or not all(isinstance(item, str) for item in options["args"]):
            raise ValueError("Camoufox launch options args are corrupt.")
        if not isinstance(options.get("env"), dict) or not all(isinstance(key, str) and isinstance(value, str) for key, value in options["env"].items()):
            raise ValueError("Camoufox launch options env is corrupt.")
        if not isinstance(options.get("executable_path"), str) or not options["executable_path"] or not isinstance(options.get("headless"), bool):
            raise ValueError("Camoufox launch options are incomplete.")

    if "context_options" in bundle:
        context_options = bundle["context_options"]
        if not isinstance(context_options, dict) or set(context_options) - {"viewport"}:
            raise ValueError("Camoufox context options are unsupported or corrupt.")
        viewport = context_options.get("viewport")
        if viewport is not None and (
            not isinstance(viewport, dict)
            or set(viewport) != {"width", "height"}
            or type(viewport["width"]) is not int
            or type(viewport["height"]) is not int
            or not 200 <= viewport["width"] <= 16384
            or not 200 <= viewport["height"] <= 16384
        ):
            raise ValueError("Camoufox context viewport is corrupt.")

    baseline = bundle["baseline"]
    baseline_hash = bundle["baseline_sha256"]
    if baseline is None:
        if baseline_hash is not None:
            raise ValueError("Camoufox environment bundle baseline hash is corrupt.")
    else:
        if not isinstance(baseline, dict) or set(baseline) not in ({"observed_at", "observed"}, {"observed_at", "observed", "canvas"}):
            raise ValueError("Camoufox environment bundle baseline is corrupt.")
        canvas = baseline.get("canvas")
        if "canvas" in baseline and (
            not isinstance(canvas, dict)
            or set(canvas) != {"algorithm", "instance_ref", "hash"}
            or canvas["algorithm"] != CANVAS_HASH_ALGORITHM
            or not isinstance(canvas["instance_ref"], str)
            or not re.fullmatch(r"[0-9a-f]{32}", canvas["instance_ref"])
            or (canvas["hash"] is not None and (not isinstance(canvas["hash"], str) or not re.fullmatch(r"[0-9a-f]{64}", canvas["hash"])))
        ):
            raise ValueError("Camoufox Canvas baseline algorithm is unsupported or corrupt.")
        if (
            not isinstance(baseline["observed_at"], str)
            or not baseline["observed_at"]
            or len(baseline["observed_at"] ) > 64
            or not isinstance(baseline["observed"], dict)
            or set(baseline["observed"]) != set(CONTINUITY_STABLE_FIELDS)
            or baseline_hash != json_hash(baseline)
        ):
            raise ValueError("Camoufox environment bundle baseline is corrupt.")
    return bundle


def load_environment_bundle(profile_dir: str | Path) -> dict[str, Any]:
    path = environment_bundle_path(profile_dir)
    if not os.path.lexists(path):
        raise FileNotFoundError("Camoufox environment bundle is missing.")
    if path.is_symlink():
        raise ValueError("Camoufox environment bundle must not be a symlink.")
    try:
        metadata = path.stat()
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_mode & 0o077:
            raise ValueError("Camoufox environment bundle permissions or file type are unsafe.")
        if metadata.st_size > MAX_ENVIRONMENT_BUNDLE_BYTES:
            raise ValueError("Camoufox environment bundle is too large.")
        bundle = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ValueError("Camoufox environment bundle is corrupt or unreadable.") from error
    return validate_environment_bundle(bundle)


def validate_environment_bundle_request(request: dict[str, Any]) -> dict[str, Any]:
    profile_dir = request.get("profile_dir")
    if not isinstance(profile_dir, str) or not profile_dir:
        raise ValueError("Camoufox environment validation requires a managed profile.")
    bundle = load_environment_bundle(profile_dir)
    return {
        "valid": True,
        "provider": bundle["provider"],
        "camoufox_version": bundle["camoufox_version"],
        "browser_version": bundle["browser_version"],
        "properties_sha256": bundle["properties_sha256"],
        "config_sha256": bundle["config_sha256"],
        "identity_hash": bundle["identity_hash"],
        "bundle_hash": json_hash(bundle),
        "baseline_present": bundle["baseline"] is not None,
    }


def build_environment_bundle(config: dict[str, Any]) -> dict[str, Any]:
    """Build a test bundle shape without importing or launching a provider."""
    if not isinstance(config, dict) or not config:
        raise ValueError("Camoufox bundle config must be a non-empty object.")
    try:
        copied = json.loads(canonical_json(config))
    except (TypeError, ValueError, OverflowError) as error:
        raise ValueError("Camoufox bundle config is not valid JSON.") from error
    bundle = {
        "schema_version": 1,
        "provider": "camoufox",
        "camoufox_version": CAMOUFOX_VERSION_PIN,
        "browser_version": BROWSER_VERSION_PIN,
        "properties_sha256": PROPERTIES_SHA256_PIN,
        "config": copied,
        "config_sha256": json_hash(copied),
        "identity_hash": json_hash(identity_config(copied)),
        "baseline": None,
        "baseline_sha256": None,
    }
    return validate_environment_bundle(bundle)


def _safe_error(error: BaseException) -> str:
    message = " ".join(str(error).split())[:240]
    return f"{type(error).__name__}: {message}" if message else type(error).__name__


def main() -> None:
    sys.stdout.reconfigure(line_buffering=True)
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        message_id = 0
        try:
            request = json.loads(line)
            if not isinstance(request, dict):
                raise ValueError("Validator request must be an object.")
            message_id = request.get("id") if isinstance(request.get("id"), int) else 0
            if request.get("op") != "validate_environment_bundle":
                raise ValueError("Camoufox bundle validator operation is not allowlisted.")
            result = validate_environment_bundle_request(request)
            sys.stdout.write(json.dumps({"id": message_id, "status": "ok", "result": result}, ensure_ascii=False, separators=(",", ":")) + "\n")
            sys.stdout.flush()
        except BaseException as error:
            sys.stdout.write(json.dumps({"id": message_id, "status": "error", "message": _safe_error(error)}, ensure_ascii=False, separators=(",", ":")) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Camoufox adapter for the shared public Playwright JSONL driver.

Only this module imports Camoufox and retains its pinned source, properties,
launch options, environment bundle and replay behavior.
"""

from __future__ import annotations

import asyncio
import hashlib
import importlib.metadata
import json
import os
import re
import sys
import time
from copy import deepcopy
from pathlib import Path
from typing import Any

from camoufox import DefaultAddons
from camoufox.utils import get_env_vars, launch_options
from camoufox_bundle_validator import (
    BROWSER_VERSION_PIN,
    CAMOUFOX_VERSION_PIN,
    ENVIRONMENT_BUNDLE_FILENAME,
    PROPERTIES_SHA256_PIN,
    canonical_json,
    identity_config,
    json_hash,
    validate_environment_bundle,
)
import playwright_shared_driver as _shared
from playwright_shared_driver import (
    DOWNLOAD_CANCEL_GRACE_S,
    DOWNLOAD_SETTLE_GRACE_S,
    Driver,
    DownloadLimitExceeded,
    DownloadTimeout,
    PageState,
    PlaywrightError,
    Route,
    TimeoutError,
    async_playwright,
    dispatch,
    main as _shared_main,
    parse_viewport,
    safe_origin,
    set_default_adapter,
    validate_timezone_id,
    viewer_entry,
    validated_origins,
)

CAMOU_CONFIG_CHUNK = re.compile(r"^CAMOU_CONFIG_(\d+)$")

PLAYWRIGHT_VERSION_PIN = "1.60.0"
SOURCE_SHA256_PIN = "3b43e766574f286a6a63296cf58b660b7a3120952086c869b4df4c9a71604bc3"
MAX_PENDING_COMMANDS = _shared.MAX_PENDING_COMMANDS
MAX_LINE = _shared.MAX_LINE


def valid_pin(source: dict[str, Any]) -> bool:
    return (
        source.get("source") == "official_release"
        and source.get("source_sha256") == SOURCE_SHA256_PIN
        and source.get("camoufox_version") == CAMOUFOX_VERSION_PIN
        and source.get("browser_version") == BROWSER_VERSION_PIN
        and source.get("playwright_version") == PLAYWRIGHT_VERSION_PIN
    )


def bundle_path(profile_dir: str) -> Path:
    path = Path(profile_dir).absolute()
    if not path.is_dir() or path.is_symlink():
        raise ValueError("Managed Profile directory is unavailable.")
    return path / ENVIRONMENT_BUNDLE_FILENAME


def profile_has_state(profile_dir: str) -> bool:
    path = Path(profile_dir).absolute()
    return path.is_dir() and any(item.name != ENVIRONMENT_BUNDLE_FILENAME for item in path.iterdir())


def json_safe_options(options: dict[str, Any]) -> dict[str, Any]:
    try:
        copied = json.loads(canonical_json(options))
    except (TypeError, ValueError, OverflowError) as error:
        raise ValueError("launch_options returned non-serializable options.") from error
    if not isinstance(copied, dict) or not copied.get("executable_path") or not isinstance(copied.get("args", []), list) or not isinstance(copied.get("env", {}), dict):
        raise ValueError("launch_options did not return complete native options.")
    return copied


def canonical_executable_path(value: Any) -> str:
    if not isinstance(value, str) or not value or "\x00" in value:
        raise ValueError("Camoufox browser executable is missing.")
    try:
        path = Path(value).resolve(strict=True)
    except (OSError, RuntimeError, ValueError) as error:
        raise ValueError("Camoufox browser executable is unavailable.") from error
    if not path.is_file():
        raise ValueError("Camoufox browser executable is not a file.")
    return str(path)


def verify_launch_executable(request: dict[str, Any], options: dict[str, Any]) -> None:
    requested = canonical_executable_path(request.get("browser_path"))
    actual = canonical_executable_path(options.get("executable_path"))
    if actual != requested:
        raise ValueError("Camoufox launch executable does not match the owner-verified browser path.")


def camoufox_config_chunks(options: dict[str, Any]) -> list[tuple[int, str]]:
    """Return the complete, ordered config chunks emitted by Camoufox."""
    environment = options.get("env")
    if not isinstance(environment, dict):
        raise ValueError("Camoufox launch options have no environment config.")
    chunks: list[tuple[int, str]] = []
    for key, value in environment.items():
        match = CAMOU_CONFIG_CHUNK.fullmatch(key) if isinstance(key, str) else None
        if match is None:
            continue
        index = int(match[1])
        if index < 1 or not isinstance(value, str):
            raise ValueError("Camoufox environment config chunks are corrupt.")
        chunks.append((index, value))
    chunks.sort(key=lambda item: item[0])
    if not chunks or [index for index, _ in chunks] != list(range(1, len(chunks) + 1)):
        raise ValueError("Camoufox environment config chunks are incomplete.")
    return chunks


def decode_camoufox_config(options: dict[str, Any]) -> dict[str, Any]:
    """Decode the JSON object produced by the public upstream launch API."""
    encoded = "".join(value for _, value in camoufox_config_chunks(options))
    try:
        config = json.loads(encoded)
    except (TypeError, ValueError, json.JSONDecodeError) as error:
        raise ValueError("Camoufox environment config is not valid JSON.") from error
    if not isinstance(config, dict) or not config:
        raise ValueError("Camoufox environment config is not a non-empty object.")
    try:
        canonical_json(config)
    except (TypeError, ValueError, OverflowError, UnicodeEncodeError) as error:
        raise ValueError("Camoufox environment config is not valid JSON.") from error
    return config


def replace_camoufox_config(options: dict[str, Any], config: dict[str, Any], user_agent_os: str) -> dict[str, Any]:
    """Use the pinned public encoder while preserving non-Camoufox env state."""
    executable_path = options.get("executable_path")
    environment = options.get("env")
    if not isinstance(executable_path, str) or not executable_path or not isinstance(environment, dict):
        raise ValueError("Camoufox launch options are incomplete.")
    try:
        generated_environment = get_env_vars(config, user_agent_os, path=Path(executable_path))
    except (OSError, TypeError, ValueError) as error:
        raise ValueError("Camoufox public environment config generation failed.") from error
    if not isinstance(generated_environment, dict):
        raise ValueError("Camoufox public environment config is corrupt.")
    generated_chunks = {
        key: value
        for key, value in generated_environment.items()
        if isinstance(key, str) and CAMOU_CONFIG_CHUNK.fullmatch(key)
    }
    if not generated_chunks or any(not isinstance(value, str) for value in generated_chunks.values()):
        raise ValueError("Camoufox public environment config has no valid chunks.")
    updated_environment = dict(environment)
    for index, _ in camoufox_config_chunks(options):
        updated_environment.pop(f"CAMOU_CONFIG_{index}", None)
    updated_environment.update(generated_chunks)
    return {**options, "env": updated_environment}


def write_bundle(profile_dir: str, options: dict[str, Any], context_options: dict[str, Any]) -> dict[str, Any]:
    config = decode_camoufox_config(options)
    bundle = {
        "schema_version": 1,
        "provider": "camoufox",
        "camoufox_version": CAMOUFOX_VERSION_PIN,
        "browser_version": BROWSER_VERSION_PIN,
        "properties_sha256": PROPERTIES_SHA256_PIN,
        "config": config,
        "config_sha256": json_hash(config),
        "identity_hash": json_hash(identity_config(config)),
        "baseline": None,
        "baseline_sha256": None,
        "launch_options": options,
        "context_options": context_options,
    }
    validate_environment_bundle(bundle)
    path = bundle_path(profile_dir)
    if path.exists() or path.is_symlink():
        return load_bundle(profile_dir)
    temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}-{time.time_ns()}")
    temporary.write_bytes(canonical_json(bundle) + b"\n")
    os.chmod(temporary, 0o600)
    try:
        os.link(temporary, path)
    except FileExistsError:
        temporary.unlink(missing_ok=True)
        return load_bundle(profile_dir)
    finally:
        temporary.unlink(missing_ok=True)
    return bundle


def update_persisted_timezone(profile_dir: str, bundle: dict[str, Any], timezone_id: Any) -> dict[str, Any]:
    """Atomically update the supported timezone in context and CAMOU config."""
    if not isinstance(timezone_id, str) or not timezone_id:
        return bundle
    timezone_id = validate_timezone_id(timezone_id)
    context_options = bundle.get("context_options", {})
    if not isinstance(context_options, dict):
        raise ValueError("Camoufox context options are corrupt.")
    launch_options = bundle.get("launch_options")
    if not isinstance(launch_options, dict):
        raise ValueError("Camoufox environment bundle has no complete launch options.")
    config = decode_camoufox_config(launch_options)
    config_timezone = config.get("timezone")
    if not isinstance(config_timezone, str) or not config_timezone:
        raise ValueError("Camoufox environment config has no supported timezone field.")
    validate_timezone_id(config_timezone)
    stored_config = bundle.get("config")
    if not isinstance(stored_config, dict):
        raise ValueError("Camoufox environment bundle config is corrupt.")
    if stored_config != config:
        raise ValueError("Camoufox environment bundle config disagrees with launch options.")
    updated_config = dict(config)
    updated_config["timezone"] = timezone_id
    if set(updated_config) != set(config) or any(updated_config[key] != config[key] for key in config if key != "timezone"):
        raise ValueError("Camoufox timezone update touched immutable config fields.")
    updated_options = replace_camoufox_config(launch_options, updated_config, "mac") if config_timezone != timezone_id else launch_options
    if any(updated_options[key] != launch_options[key] for key in ("args", "executable_path", "firefox_user_prefs", "headless")):
        raise ValueError("Camoufox timezone update touched immutable launch state.")
    updated_environment = updated_options.get("env")
    original_environment = launch_options.get("env")
    if not isinstance(updated_environment, dict) or not isinstance(original_environment, dict):
        raise ValueError("Camoufox launch options environment is corrupt.")
    for key, value in original_environment.items():
        if not CAMOU_CONFIG_CHUNK.fullmatch(key) and updated_environment.get(key) != value:
            raise ValueError("Camoufox timezone update touched immutable environment state.")
    if decode_camoufox_config(updated_options) != updated_config:
        raise ValueError("Camoufox timezone update did not persist the complete config.")
    if identity_config(updated_config) != identity_config(config):
        raise ValueError("Camoufox timezone update touched immutable identity state.")
    updated_context_options = {**context_options, "timezone_id": timezone_id}
    updated = {
        **bundle,
        "config": updated_config,
        "config_sha256": json_hash(updated_config),
        "identity_hash": json_hash(identity_config(updated_config)),
        "launch_options": updated_options,
        "context_options": updated_context_options,
    }
    if config_timezone == timezone_id and context_options.get("timezone_id") == timezone_id:
        return bundle
    validate_environment_bundle(updated)
    path = bundle_path(profile_dir)
    temporary = path.with_name(f".{path.name}.timezone-{os.getpid()}-{time.time_ns()}")
    temporary.write_bytes(canonical_json(updated) + b"\n")
    os.chmod(temporary, 0o600)
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
    return updated


def load_bundle(profile_dir: str) -> dict[str, Any]:
    path = bundle_path(profile_dir)
    if path.is_symlink() or not path.is_file() or path.stat().st_mode & 0o077:
        raise ValueError("Camoufox environment bundle is unsafe.")
    bundle = json.loads(path.read_text(encoding="utf-8"))
    validate_environment_bundle(bundle)
    options = bundle.get("launch_options")
    if not isinstance(options, dict):
        raise ValueError("Camoufox environment bundle has no complete launch options.")
    if bundle.get("config") != decode_camoufox_config(options):
        raise ValueError("Camoufox environment bundle config disagrees with launch options.")
    return bundle


def options_for(request: dict[str, Any], profile_dir: str) -> tuple[dict[str, Any], dict[str, Any], bool, dict[str, Any]]:
    bundle = load_bundle(profile_dir) if Path(profile_dir, ENVIRONMENT_BUNDLE_FILENAME).exists() else None
    if bundle is not None:
        verify_launch_executable(request, bundle["launch_options"])
        environment = request.get("environment") if isinstance(request.get("environment"), dict) else {}
        bundle = update_persisted_timezone(profile_dir, bundle, environment.get("timezone"))
        context_options = bundle.get("context_options", {})
        if not isinstance(context_options, dict):
            raise ValueError("Camoufox context options are corrupt.")
        return deepcopy(bundle["launch_options"]), bundle, True, deepcopy(context_options)
    if profile_has_state(profile_dir):
        raise ValueError("Managed Profile has state but no exact Camoufox launch bundle.")
    source = request.get("source")
    if not isinstance(source, dict) or not valid_pin(source):
        raise ValueError("Camoufox source/version/hash is not trusted.")
    environment = request.get("environment") if isinstance(request.get("environment"), dict) else {}
    config = {}
    if isinstance(environment.get("timezone"), str) and environment["timezone"]:
        config["timezone"] = environment["timezone"]
    timezone_id = environment.get("timezone") if isinstance(environment.get("timezone"), str) and environment["timezone"] else None
    locale = environment.get("language") if isinstance(environment.get("language"), str) and environment["language"] else None
    proxy = {"server": environment["proxy_server"]} if isinstance(environment.get("proxy_server"), str) and environment["proxy_server"] else None
    context_options = {}
    if (viewport := parse_viewport(environment.get("viewport"))):
        context_options["viewport"] = viewport
    if timezone_id:
        timezone_id = validate_timezone_id(timezone_id)
        context_options["timezone_id"] = timezone_id
    executable = canonical_executable_path(request["browser_path"])
    # The public Camoufox validator resolves properties.json beside the path
    # supplied to launch_options. Official macOS bundles keep it in
    # Contents/Resources while the executable lives in Contents/MacOS, so use
    # a sibling Resources path for public config validation and bind the actual
    # launch path back to the owner-verified executable before the final guard.
    config_executable = Path(executable)
    if sys.platform == "darwin":
        config_executable = config_executable.parent.parent / "Resources" / "camoufox"
    options = launch_options(
        browser=f"official/{BROWSER_VERSION_PIN}",
        executable_path=str(config_executable),
        env={},
        headless=bool(request.get("headless", False)),
        os="macos" if sys.platform == "darwin" else sys.platform,
        ff_version=152,
        main_world_eval=True,
        config=config,
        locale=locale,
        proxy=proxy,
        exclude_addons=[DefaultAddons.UBO],
    )
    options = json_safe_options(options)
    options["executable_path"] = executable
    verify_launch_executable(request, options)
    bundle = write_bundle(profile_dir, options, context_options)
    verify_launch_executable(request, bundle["launch_options"])
    return options, bundle, False, context_options


def verify_runtime_pins(request: dict[str, Any]) -> str:
    if importlib.metadata.version("camoufox") != CAMOUFOX_VERSION_PIN or importlib.metadata.version("playwright") != PLAYWRIGHT_VERSION_PIN:
        raise ValueError("Camoufox Python/Playwright package pins do not match the owner binding.")
    executable = request.get("browser_path")
    root = request.get("install_root")
    if not isinstance(executable, str) or not executable:
        raise ValueError("Camoufox browser executable is missing.")
    candidates = []
    if isinstance(root, str) and root:
        root_path = Path(root).absolute()
        candidates.extend([root_path / "Resources" / "properties.json", root_path / "Contents" / "Resources" / "properties.json", root_path / "properties.json"])
    executable_path = Path(executable).absolute()
    candidates.extend([executable_path.parent.parent / "Resources" / "properties.json", executable_path.parent / "Resources" / "properties.json", executable_path.parent / "properties.json"])
    properties = next((candidate for candidate in candidates if candidate.is_file() and not candidate.is_symlink()), None)
    if properties is None or hashlib.sha256(properties.read_bytes()).hexdigest() != PROPERTIES_SHA256_PIN:
        raise ValueError("Camoufox Resources/properties.json does not match the fixed hash pin.")
    return PROPERTIES_SHA256_PIN



class CamoufoxAdapter:
    provider_id = "camoufox"
    browser_type = "firefox"
    driver_ref = "camoufox-upstream-jsonl"
    properties_sha256 = PROPERTIES_SHA256_PIN

    @staticmethod
    def verify(request: dict[str, Any]) -> list[dict[str, str]]:
        source = request.get("source")
        if not isinstance(source, dict) or not valid_pin(source):
            raise ValueError("Camoufox source/version/hash is not trusted.")
        properties_sha256 = verify_runtime_pins(request)
        return [
            {"key": "provider.camoufox.source", "source": "observed", "value": str(source["source"])},
            {"key": "provider.camoufox.source_sha256", "source": "validation_evidence", "value": str(source["source_sha256"])},
            {"key": "provider.camoufox.version", "source": "observed", "value": str(source["camoufox_version"])},
            {"key": "provider.camoufox.browser_version", "source": "observed", "value": str(source["browser_version"])},
            {"key": "provider.camoufox.playwright_version", "source": "observed", "value": str(source["playwright_version"])},
            {"key": "provider.camoufox.properties_sha256", "source": "validation_evidence", "value": properties_sha256},
        ]

    @staticmethod
    def prepare(request: dict[str, Any], profile_dir: str) -> tuple[dict[str, Any], dict[str, Any], bool, dict[str, Any]]:
        return options_for(request, profile_dir)

    @staticmethod
    def environment(bundle: dict[str, Any] | None) -> dict[str, Any]:
        bundle_hash = bundle.get("identity_hash") if isinstance(bundle, dict) else None
        return {
            "camoufox_version": CAMOUFOX_VERSION_PIN,
            "browser_version": BROWSER_VERSION_PIN,
            "properties_sha256": PROPERTIES_SHA256_PIN,
            "bundle_hash": bundle_hash,
        }

    @staticmethod
    def playwright_factory() -> Any:
        return async_playwright()


_DEFAULT_CAMOUFOX_ADAPTER = CamoufoxAdapter()
set_default_adapter(_DEFAULT_CAMOUFOX_ADAPTER)


async def main_async() -> None:
    # Preserve the historical test/entrypoint seam while delegating all
    # Page, route, file, diagnostics and lifecycle behavior to one module.
    _shared.MAX_PENDING_COMMANDS = MAX_PENDING_COMMANDS
    _shared.MAX_LINE = MAX_LINE
    _shared.DOWNLOAD_CANCEL_GRACE_S = DOWNLOAD_CANCEL_GRACE_S
    _shared.DOWNLOAD_SETTLE_GRACE_S = DOWNLOAD_SETTLE_GRACE_S
    _shared.dispatch = dispatch
    _shared.sys.stdin = sys.stdin
    _shared.sys.stdout = sys.stdout
    await _shared.main_async(_DEFAULT_CAMOUFOX_ADAPTER)


def main() -> None:
    _shared_main(_DEFAULT_CAMOUFOX_ADAPTER)


if __name__ == "__main__":
    main()

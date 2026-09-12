#!/usr/bin/env python3
"""Small JSONL bridge for the pinned, public Camoufox/Playwright API.

This module intentionally has no browser-specific compatibility layer.  It
calls ``camoufox.utils.launch_options`` once for a new managed Profile, saves
the complete returned options, and reuses that exact JSON object on replay.
All browser operations below use public synchronous Playwright objects.
"""

from __future__ import annotations

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
from urllib.parse import urljoin
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from camoufox.utils import get_env_vars, launch_options
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import Page, Route, TimeoutError, sync_playwright

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


PLAYWRIGHT_VERSION_PIN = "1.60.0"
SOURCE_SHA256_PIN = "3b43e766574f286a6a63296cf58b660b7a3120952086c869b4df4c9a71604bc3"
MAX_EVENTS = 64
MAX_TEXT = 64 * 1024
MAX_LINE = 2 * 1024 * 1024
MAX_REDIRECT_HOPS = 10
REDIRECT_STATUSES = frozenset({300, 301, 302, 303, 307, 308})
CAMOU_CONFIG_CHUNK = re.compile(r"^CAMOU_CONFIG_(\d+)$")
REF = re.compile(r"^[A-Za-z0-9:_./-]{1,256}$")
SENSITIVE = re.compile(r"(?:bearer\s+\S+|(?:token|cookie|password|secret|authorization)\s*[:=]\s*[^\s,}]+)", re.I)


def safe_origin(value: str) -> str | None:
    try:
        from urllib.parse import urlsplit

        parsed = urlsplit(value)
        if parsed.scheme not in ("http", "https") or not parsed.netloc or parsed.username or parsed.password:
            return None
        return f"{parsed.scheme}://{parsed.netloc}" if value == f"{parsed.scheme}://{parsed.netloc}" else None
    except ValueError:
        return None


def origin_of(value: str) -> str | None:
    try:
        from urllib.parse import urlsplit

        parsed = urlsplit(value)
        if parsed.scheme not in ("http", "https") or not parsed.netloc or parsed.username or parsed.password:
            return None
        return f"{parsed.scheme}://{parsed.netloc}"
    except ValueError:
        return None


def safe_url(value: str) -> str | None:
    origin = origin_of(value)
    if not origin:
        return None
    try:
        from urllib.parse import urlsplit

        parsed = urlsplit(value)
        return f"{origin}{parsed.path or '/'}{('?'+parsed.query) if parsed.query else ''}"
    except ValueError:
        return None


def validated_origins(value: Any) -> set[str]:
    if not isinstance(value, list) or any(not isinstance(origin, str) or safe_origin(origin) != origin for origin in value):
        return set()
    return set(value)


def redirect_target(response_url: str, status: int, headers: Any) -> str | None:
    """Resolve one redirect without permitting a non-web or malformed URL."""
    if status not in REDIRECT_STATUSES or not hasattr(headers, "items"):
        return None
    location = next((value for key, value in headers.items() if str(key).lower() == "location"), None)
    if not isinstance(location, str) or not location.strip() or len(location) > 4096 or any(ord(char) < 0x20 for char in location):
        return None
    try:
        return safe_url(urljoin(response_url, location.strip()))
    except ValueError:
        return None


def redirect_method(status: int, method: str) -> str:
    """Apply browser redirect method semantics for a manually fetched hop."""
    normalized = method.upper()
    return "GET" if status in (301, 302, 303) and normalized not in ("GET", "HEAD") else normalized


def validate_timezone_id(value: Any) -> str:
    if not isinstance(value, str) or not value or len(value) > 128 or any(ord(char) < 0x20 or ord(char) == 0x7f for char in value):
        raise ValueError("Camoufox timezone is invalid.")
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError) as error:
        raise ValueError("Camoufox timezone is not a valid IANA timezone.") from error
    return value


def safe_text(value: Any, limit: int = MAX_TEXT) -> str:
    text = value if isinstance(value, str) else str(value or "")
    text = re.sub(r"[\x00-\x1f\x7f]", " ", text)
    if SENSITIVE.search(text):
        return "[redacted]"
    text = re.sub(r"([?&][^=\s&]+)=([^\s&#]*)", r"\1=<redacted>", text)
    return " ".join(text.split())[:limit]


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


def parse_viewport(value: Any) -> dict[str, int] | None:
    if value is None or value == "系统默认":
        return None
    if not isinstance(value, str):
        raise ValueError("Camoufox viewport is invalid.")
    match = re.fullmatch(r"(\d{2,5})x(\d{2,5})", value)
    if not match or not 200 <= int(match[1]) <= 16384 or not 200 <= int(match[2]) <= 16384:
        raise ValueError("Camoufox viewport is invalid.")
    return {"width": int(match[1]), "height": int(match[2])}


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
    options = launch_options(
        browser=f"official/{BROWSER_VERSION_PIN}",
        env={},
        headless=bool(request.get("headless", False)),
        os="macos" if sys.platform == "darwin" else sys.platform,
        ff_version=152,
        main_world_eval=True,
        config=config,
        locale=locale,
        proxy=proxy,
    )
    options = json_safe_options(options)
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


class PageState:
    def __init__(self, ref: str, page: Page, origins: list[str], opener: str | None = None):
        self.ref = ref
        self.page = page
        self.origins = set(origins)
        self.opener = opener
        self.generation = 1
        self.controls: dict[str, tuple[str, str, str | None]] = {}
        self.events: list[dict[str, Any]] = []
        self.last_url = page.url
        self.relation_pending = False
        self.relation_rejection = False
        self.relation_rejection_count = 0

    def facts(self, task_selected: bool = False) -> dict[str, Any]:
        # A user may close a Page between any two public Playwright reads.
        # Treat a target-closed read as a trusted tombstone so one stale Page
        # cannot make the whole Page list unavailable while other Pages live.
        closed: bool | None = False
        try:
            closed = self.page.is_closed()
        except PlaywrightError:
            closed = None
        try:
            current = safe_url(self.page.url)
        except PlaywrightError:
            current = None
            try:
                closed = self.page.is_closed()
            except PlaywrightError:
                closed = None
        title = ""
        if closed is not True:
            try:
                title = safe_text(self.page.title(), 256)
            except PlaywrightError:
                try:
                    closed = self.page.is_closed()
                except PlaywrightError:
                    closed = None
            else:
                try:
                    closed = self.page.is_closed()
                except PlaywrightError:
                    closed = None
        return {
            "provider_page_ref": self.ref,
            "current_url": current,
            "title": title,
            "status": "closed" if closed is True else "ready" if closed is False and current and (not self.relation_rejection or self.origins) else "unknown",
            "origin": origin_of(current or "") if current else None,
            "document_generation": self.generation,
            **({"task_selected": True} if task_selected else {}),
            **({"opener_provider_page_ref": self.opener} if self.opener else {}),
            "facts": [
                {"key": "page.relation", "source": "validation_evidence", "value": "unavailable"},
                {"key": "page.initial_request", "source": "validation_evidence", "value": "not_dispatched"},
                {"key": "page.blocked_reason", "source": "validation_evidence", "value": "page_relation_unavailable"},
                {"key": "page.rejected_unattributed_count", "source": "validation_evidence", "value": str(self.relation_rejection_count)},
            ] if self.relation_rejection else [],
        }

    def add_event(self, event: dict[str, Any]) -> None:
        self.events.append(event)
        del self.events[:-MAX_EVENTS]


class Driver:
    def __init__(self, request: dict[str, Any]):
        profile_dir = request.get("profile_dir")
        if not isinstance(profile_dir, str) or not profile_dir:
            raise ValueError("Managed Profile is required.")
        source = request.get("source")
        if not isinstance(source, dict) or not valid_pin(source):
            raise ValueError("Camoufox source/version/hash is not trusted.")
        self.properties_sha256 = verify_runtime_pins(request)
        self.request = request
        self.profile_dir = profile_dir
        self.options, self.bundle, self.replay, self.context_options = options_for(request, profile_dir)
        self.unattributed_rejection_count = 0
        self.pages: dict[str, PageState] = {}
        self.next_ref = 1
        self.current: str | None = None
        self.playwright: Any = None
        self.context: Any = None
        try:
            self.playwright = sync_playwright().start()
            launch = dict(self.options)
            launch.update(self.context_options)
            launch["user_data_dir"] = profile_dir
            # Keep the persistent context offline until the route guard is
            # installed. Any restored-page request is still subject to that
            # guard; the requested document navigation follows explicitly.
            launch["offline"] = True
            launch["service_workers"] = "block"
            self.context = self.playwright.firefox.launch_persistent_context(**launch)
            self.context.on("page", self.on_page)
            self.context.route("**/*", self.route)
            page = self.context.pages[0] if self.context.pages else self.context.new_page()
            self.context.set_offline(False)
            initial_origin = origin_of(str(request.get("url", "")))
            state = next((item for item in self.pages.values() if item.page == page), None)
            if state is None:
                state = self.register(page, [initial_origin] if initial_origin else [])
            else:
                state.origins.update([initial_origin] if initial_origin else [])
            self.current = state.ref
            self.navigate(state, str(request.get("url", "about:blank")), [initial_origin] if initial_origin else [])
        except BaseException:
            try:
                if self.context is not None:
                    self.context.close()
            finally:
                if self.playwright is not None:
                    self.playwright.stop()
            raise

    def register(self, page: Page, origins: list[str], opener: str | None = None) -> PageState:
        state = PageState(f"page:{self.next_ref}", page, [origin for origin in origins if origin])
        self.next_ref += 1
        self.pages[state.ref] = state
        page.on("framenavigated", lambda frame: self.on_navigate(state, frame))
        page.on("request", lambda request: self.network_request(state, request))
        page.on("response", lambda response: self.network_response(state, response))
        page.on("requestfailed", lambda request: self.network_failure(state, request))
        page.on("console", lambda message: self.console_event(state, message))
        page.on("pageerror", lambda error: self.page_error(state, error))
        return state

    def on_page(self, page: Page) -> None:
        existing = next((item for item in self.pages.values() if item.page == page), None)
        if existing is not None:
            if existing.relation_pending:
                self.resolve_page_opener(existing, page)
            return
        state = self.register(page, [], None)
        self.resolve_page_opener(state, page)

    def resolve_page_opener(self, state: PageState, page: Page) -> None:
        opener_ref = None
        opener_origins: list[str] = []
        try:
            opener = page.opener
            if callable(opener):
                opener = opener()
            opener_state = next((item for item in self.pages.values() if item.page == opener), None)
            if opener_state is not None:
                opener_ref = opener_state.ref
                opener_origins = list(opener_state.origins)
        except Exception:
            opener_ref = None
        if opener_ref is not None:
            state.opener = opener_ref
            state.origins.update(opener_origins)
        state.relation_pending = False

    def route(self, route: Route) -> None:
        request = route.request
        try:
            page = request.frame.page
        except PlaywrightError:
            self.unattributed_rejection_count = min(self.unattributed_rejection_count + 1, MAX_EVENTS)
            route.abort("blockedbyclient")
            return
        state = next((item for item in self.pages.values() if item.page == page), None)
        request_origin = origin_of(request.url)
        # This check is deliberately before continue/fetch: an unowned popup
        # cannot acquire a Page by racing its first navigation request.
        if state is None:
            state = self.register(page, [])
            state.relation_pending = True
            state.relation_rejection = True
            state.relation_rejection_count += 1
            request_url = getattr(request, "url", None)
            request_url = request_url if isinstance(request_url, str) else ""
            sanitized_url = safe_url(request_url)
            request_event = {
                "event_ref": f"event:{state.ref}:{time.time_ns()}",
                "kind": "failure",
                "observed_at": now(),
                "page_ref": state.ref,
                "document_generation": state.generation,
                "method": str(getattr(request, "method", "GET")),
                "resource_kind": getattr(request, "resource_type", "other") or "other",
                "failure_class": "blocked",
                "relation": "unavailable",
                "dispatch_state": "not_dispatched",
            }
            if sanitized_url:
                request_event["url"] = safe_text(sanitized_url, 2_048)
            request_event_origin = origin_of(request_url)
            if request_event_origin:
                request_event["origin"] = request_event_origin
            state.add_event(request_event)
            route.abort("blockedbyclient")
            return
        if request_origin is None or request_origin not in state.origins:
            route.abort("blockedbyclient")
            return
        method = str(getattr(request, "method", "GET")).upper()
        # ``Request.post_data`` decodes the body as UTF-8.  A standard file
        # input can legitimately dispatch arbitrary bytes (PNG/PDF/etc.), so
        # reading that text projection would fail before the guard can fetch
        # or reject the request.  Prefer Playwright's public binary property;
        # retain the text projection only for older/fake request objects used
        # by the deterministic contract tests.
        try:
            post_data = request.post_data_buffer
        except (AttributeError, PlaywrightError, UnicodeDecodeError):
            post_data = None
        if post_data is None:
            try:
                post_data = request.post_data
            except (AttributeError, PlaywrightError, UnicodeDecodeError):
                post_data = None
        response = None
        try:
            # Playwright routing only invokes this handler for the first URL
            # in a redirect chain. Fetch one hop at a time so Location is
            # checked before the next network request is issued.
            response = route.fetch(max_redirects=0, timeout=int(self.request.get("timeout_ms", 60_000)))
            for hop in range(MAX_REDIRECT_HOPS + 1):
                status = int(response.status)
                location = next((value for key, value in response.headers.items() if str(key).lower() == "location"), None)
                if status not in REDIRECT_STATUSES or not location:
                    route.fulfill(response=response)
                    response = None
                    return
                target = redirect_target(response.url, status, response.headers)
                if not target or origin_of(target) not in state.origins or hop >= MAX_REDIRECT_HOPS:
                    response.dispose()
                    response = None
                    route.abort("blockedbyclient")
                    return
                next_method = redirect_method(status, method)
                next_post_data = post_data if next_method not in ("GET", "HEAD") else ""
                response.dispose()
                response = route.fetch(
                    url=target,
                    method=next_method,
                    post_data=next_post_data,
                    max_redirects=0,
                    timeout=int(self.request.get("timeout_ms", 60_000)),
                )
                method = next_method
            if response is not None:
                response.dispose()
                response = None
            route.abort("blockedbyclient")
        except Exception:
            if response is not None:
                try:
                    response.dispose()
                except Exception:
                    pass
            try:
                route.abort("blockedbyclient")
            except Exception:
                pass

    def navigate(self, state: PageState, url: str, origins: list[str]) -> dict[str, Any]:
        scope = self.apply_page_scope(state, origins, require_current=False)
        target_origin = origin_of(url)
        if not target_origin or target_origin not in scope:
            raise ValueError("Page navigation origin is not authorized.")
        state.page.goto(url, wait_until="domcontentloaded", timeout=int(self.request.get("timeout_ms", 60_000)))
        return state.facts(task_selected=state.ref == self.current)

    def apply_page_scope(self, state: PageState, origins: Any, require_current: bool = True) -> set[str]:
        if state.relation_rejection and not state.origins:
            raise ValueError("Page relation is unavailable.")
        scope = validated_origins(origins)
        state.origins = scope
        if require_current and origin_of(state.page.url) not in scope:
            raise ValueError("Current Page origin is not authorized.")
        return scope

    def on_navigate(self, state: PageState, frame: Any) -> None:
        if frame != state.page.main_frame:
            return
        state.generation += 1
        state.controls.clear()
        state.last_url = state.page.url

    def list_pages(self) -> list[dict[str, Any]]:
        return [state.facts(task_selected=state.ref == self.current) for state in self.pages.values()]

    def interact(self, request: dict[str, Any]) -> dict[str, Any]:
        state = self.state(request)
        action = request.get("action")
        expected = request.get("expected_origin")
        scope = validated_origins(request.get("authorized_origins"))
        current_origin = origin_of(state.page.url)
        if action == "snapshot":
            if not isinstance(expected, str) or expected not in scope or current_origin != expected or expected not in state.origins:
                return {"status": "unavailable", "dispatch_state": "not_dispatched", "failure_class": "wrong_page", "page": state.facts()}
        else:
            try:
                scope = self.apply_page_scope(state, request.get("authorized_origins"))
            except ValueError:
                return {"status": "unavailable", "dispatch_state": "not_dispatched", "failure_class": "wrong_page", "page": state.facts()}
            if not isinstance(expected, str) or expected not in scope or current_origin != expected:
                return {"status": "unavailable", "dispatch_state": "not_dispatched", "failure_class": "wrong_page", "page": state.facts()}
        try:
            if action == "snapshot":
                return {"status": "completed", "dispatch_state": "not_dispatched", "page": state.facts(), "snapshot": self.snapshot(state)}
            if action == "click":
                self.locator(state, request).click(timeout=int(request.get("timeout_ms", 5_000)))
            elif action == "input":
                text = request.get("text")
                if not isinstance(text, str) or len(text) > MAX_TEXT:
                    return {"status": "unavailable", "dispatch_state": "not_dispatched", "failure_class": "invalid_contract", "page": state.facts()}
                self.locator(state, request).fill(text, timeout=int(request.get("timeout_ms", 5_000)))
            elif action == "press":
                key = request.get("key")
                if not isinstance(key, str) or not re.fullmatch(r"[A-Za-z0-9_+\- ]{1,32}", key):
                    return {"status": "unavailable", "dispatch_state": "not_dispatched", "failure_class": "invalid_contract", "page": state.facts()}
                self.locator(state, request).press(key, timeout=int(request.get("timeout_ms", 5_000)))
            elif action == "scroll":
                delta = request.get("delta_y")
                if not isinstance(delta, (int, float)) or not -100_000 <= delta <= 100_000:
                    return {"status": "unavailable", "dispatch_state": "not_dispatched", "failure_class": "invalid_contract", "page": state.facts()}
                state.page.mouse.wheel(0, delta)
            elif action == "wait":
                state.page.wait_for_timeout(min(max(int(request.get("timeout_ms", 250)), 0), 5_000))
            else:
                return {"status": "unavailable", "dispatch_state": "not_dispatched", "failure_class": "invalid_contract", "page": state.facts()}
            return {"status": "completed", "dispatch_state": "dispatched", "page": state.facts()}
        except TimeoutError:
            return {"status": "unknown_outcome", "dispatch_state": "dispatched", "failure_class": "timeout", "page": state.facts()}
        except Exception as error:
            return {"status": "unknown_outcome", "dispatch_state": "dispatched", "failure_class": safe_text(error, 128), "page": state.facts()}

    def snapshot(self, state: PageState) -> dict[str, Any]:
        raw = state.page.evaluate("""() => {
          const visible = e => { const r=e.getBoundingClientRect(), s=getComputedStyle(e); return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden'; };
          const implicitRole = e => {
            const explicit = e.getAttribute('role'); if (explicit) return explicit;
            if (e.tagName === 'BUTTON' || (e.tagName === 'INPUT' && ['button','submit','reset'].includes(e.type))) return 'button';
            if (e.tagName === 'A' && e.hasAttribute('href')) return 'link';
            if (e.tagName === 'INPUT' && e.type === 'file') return 'file';
            if (e.tagName === 'TEXTAREA' || (e.tagName === 'INPUT' && !['checkbox','radio','file','hidden','button','submit','reset'].includes(e.type))) return 'textbox';
            if (e.tagName === 'INPUT' && e.type === 'checkbox') return 'checkbox';
            if (e.tagName === 'INPUT' && e.type === 'radio') return 'radio';
            if (e.tagName === 'SELECT') return 'combobox';
            return null;
          };
          const nodes = [...document.querySelectorAll('button,a,input,textarea,select,[role]')].filter(visible).map(e => ({ e, role: implicitRole(e) })).filter(item => item.role).slice(0,128);
          return { text: (document.body?.innerText || '').slice(0,65536), controls: nodes.map((item,i) => ({ i, role: item.role, name: (item.e.getAttribute('aria-label') || item.e.innerText || item.e.value || '').trim().slice(0,256), href: item.e.tagName === 'A' ? item.e.getAttribute('href') : null, enabled: !item.e.disabled })) };
        }""")
        controls = []
        state.controls.clear()
        for item in (raw.get("controls", []) if isinstance(raw, dict) else []):
            if not isinstance(item, dict) or not isinstance(item.get("i"), int) or not isinstance(item.get("role"), str) or not isinstance(item.get("name"), str):
                continue
            ref = f"control:{item['i']}"
            href = item.get("href") if isinstance(item.get("href"), str) else None
            state.controls[ref] = (item["role"], item["name"], href)
            controls.append({"target_ref": ref, "role": safe_text(item["role"], 64), "name": safe_text(item["name"], 256), "enabled": item.get("enabled") is True})
        text = safe_text(raw.get("text", "") if isinstance(raw, dict) else "")
        return {"page_ref": state.ref, "observation_ref": f"observation:{state.ref}:{state.generation}", "controls": controls, "text": text, "truncated": len(text) >= MAX_TEXT}

    def locator(self, state: PageState, request: dict[str, Any]):
        ref = request.get("target_ref")
        if not isinstance(ref, str) or ref not in state.controls:
            raise ValueError("Target ref is not from the current Page observation.")
        role, name, *_metadata = state.controls[ref]
        return state.page.get_by_role(role, name=name, exact=True)

    def observe(self, request: dict[str, Any]) -> dict[str, Any]:
        state = self.state(request)
        raw = state.page.evaluate("""() => ({ current_url: location.origin + location.pathname, title: document.title.slice(0,256), ready_state: document.readyState, stable_id: null })""")
        raw["document_generation"] = state.generation
        return {**state.facts(task_selected=state.ref == self.current), "observation": raw}

    def public_page(self, request: dict[str, Any]) -> dict[str, Any]:
        state = self.state(request)
        expected = request.get("expected_origin")
        if not isinstance(expected, str) or expected not in state.origins or origin_of(state.page.url) != expected:
            return {"status": "unavailable", "failure_class": "wrong_page", "retryable": False, "page": state.facts()}
        text = safe_text(state.page.locator("body").inner_text(timeout=5_000))
        return {"status": "completed", "page": state.facts(), "text": text, "truncated": len(text) >= MAX_TEXT}

    def diagnostics(self, request: dict[str, Any]) -> dict[str, Any]:
        state = self.state(request)
        expected = request.get("origin")
        if not isinstance(expected, str) or expected not in state.origins or origin_of(state.page.url) != expected:
            return {"status": "unavailable", "failure_class": "wrong_page", "retryable": False}
        cursor = request.get("cursor", "0")
        if not isinstance(cursor, str) or not cursor.isdigit():
            return {"status": "unavailable", "failure_class": "cursor_stale", "retryable": False}
        start = min(int(cursor), len(state.events))
        events = state.events[start:start + min(int(request.get("limit", MAX_EVENTS)), MAX_EVENTS)]
        network = [event for event in events if event.get("kind") in ("request", "response", "failure")]
        console = [event for event in events if event.get("level") in ("warn", "error", "pageerror")]
        return {"status": "completed", "page_ref": state.ref, "document_generation": state.generation, "page": state.facts(), "cursor": str(start), "next_cursor": str(start + len(events)), "truncated": start + len(events) < len(state.events), "observed_at": now(), "network": network, "console": console}

    def environment(self, request: dict[str, Any]) -> dict[str, Any]:
        state = self.state(request)
        observed = state.page.evaluate("""() => ({ language: navigator.language || null, languages: navigator.languages || [], timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null, viewport: { width: innerWidth, height: innerHeight }, screen: { width: screen.width, height: screen.height }, hardware_concurrency: navigator.hardwareConcurrency || null, device_memory: navigator.deviceMemory || null, webgl_vendor: null, webgl_renderer: null, fonts_hash: null, voices_hash: null, canvas_hash: null, audio_hash: null })""")
        bundle_hash = self.bundle["identity_hash"]
        return {"status": "completed", "observed_at": now(), "provider": {"camoufox_version": CAMOUFOX_VERSION_PIN, "browser_version": BROWSER_VERSION_PIN, "properties_sha256": PROPERTIES_SHA256_PIN}, "bundle_hash": bundle_hash, "observed": observed, "continuity": {"state": "unknown", "checked_fields": [], "changed_fields": [], "unknown_fields": ["screen", "hardware_concurrency", "webgl_vendor", "webgl_renderer", "canvas_hash", "audio_hash"]}}

    def screenshot(self, request: dict[str, Any]) -> dict[str, Any]:
        state = self.state(request)
        path = Path(self.profile_dir, f".webenvoy-screenshot-{time.time_ns()}.png")
        state.page.screenshot(path=str(path), type="png")
        data = path.read_bytes()
        return {"status": "completed", "screenshot_ref": "screenshot:" + hashlib.sha256(data).hexdigest(), "mime_type": "image/png", "byte_length": len(data), "sha256": hashlib.sha256(data).hexdigest(), "captured_at": now()}

    def file_operation(self, request: dict[str, Any]) -> dict[str, Any]:
        """Deliver one owner-resolved file through a standard Page control.

        Paths in this method are Harbor-private staging paths.  The Agent only
        supplies opaque target/material references to Core; Harbor resolves
        them before this public Playwright boundary is called.
        """
        state = self.state(request)
        expected = request.get("expected_origin")
        scope = validated_origins(request.get("authorized_origins"))
        if not isinstance(expected, str) or expected not in scope or expected not in state.origins or origin_of(state.page.url) != expected:
            return {"status": "unavailable", "dispatch_state": "not_dispatched", "operation": request.get("operation"), "failure_class": "wrong_page", "page": state.facts()}
        operation = request.get("operation")
        target = request.get("target_ref")
        if operation not in ("upload", "download") or not isinstance(target, str) or not REF.fullmatch(target):
            return {"status": "unavailable", "dispatch_state": "not_dispatched", "operation": operation, "failure_class": "file_operation_invalid", "page": state.facts()}
        timeout = int(request.get("timeout_ms", self.request.get("timeout_ms", 60_000)))
        if operation == "upload":
            source = request.get("source_path")
            if not isinstance(source, str) or not source or "\x00" in source:
                return {"status": "unavailable", "dispatch_state": "not_dispatched", "operation": "upload", "failure_class": "file_source_unavailable", "page": state.facts()}
            if target not in self.controls or self.controls[target][0] != "file":
                return {"status": "unavailable", "dispatch_state": "not_dispatched", "operation": "upload", "failure_class": "file_input_unavailable", "page": state.facts()}
            try:
                source_path = Path(source)
                with source_path.open("rb", buffering=0) as handle:
                    source_size = os.fstat(handle.fileno()).st_size
                if source_size < 1 or source_size > 10 * 1024 * 1024:
                    return {"status": "unavailable", "dispatch_state": "not_dispatched", "operation": "upload", "failure_class": "file_limit_exceeded", "page": state.facts()}
                inputs = state.page.locator('input[type="file"]')
                if inputs.count() != 1 or not inputs.is_visible(timeout=timeout):
                    return {"status": "unavailable", "dispatch_state": "not_dispatched", "operation": "upload", "failure_class": "file_input_unavailable", "page": state.facts()}
                existing = inputs.evaluate("e => e.files ? e.files.length : 0")
                if existing:
                    return {"status": "unavailable", "dispatch_state": "not_dispatched", "operation": "upload", "failure_class": "file_input_not_empty", "page": state.facts()}
                inputs.set_input_files(str(source_path), timeout=timeout)
                return {"status": "completed", "dispatch_state": "dispatched", "operation": "upload", "page": state.facts(), "browser_delivery": "completed", "page_receipt": "unknown", "page_processing": "unknown", "business_commit": "not_observed"}
            except TimeoutError:
                return {"status": "unknown_outcome", "dispatch_state": "dispatched", "operation": "upload", "failure_class": "timeout", "page": state.facts()}
            except Exception as error:
                return {"status": "unknown_outcome", "dispatch_state": "dispatched", "operation": "upload", "failure_class": safe_text(error, 128), "page": state.facts()}

        if target not in self.controls:
            return {"status": "unavailable", "dispatch_state": "not_dispatched", "operation": "download", "failure_class": "download_target_unsupported", "page": state.facts()}
        role, _name, *metadata = self.controls[target]
        observed_href = metadata[0] if metadata else None
        if role != "link":
            return {"status": "unavailable", "dispatch_state": "not_dispatched", "operation": "download", "failure_class": "download_target_unsupported", "page": state.facts()}
        staging = request.get("staging_path")
        if not isinstance(staging, str) or not staging or "\x00" in staging:
            return {"status": "unavailable", "dispatch_state": "not_dispatched", "operation": "download", "failure_class": "download_staging_unavailable", "page": state.facts()}
        try:
            link = self.locator(state, request)
            href = link.get_attribute("href")
            resolved = safe_url(urljoin(state.page.url, href or "")) if isinstance(href, str) else None
            observed_resolved = safe_url(urljoin(state.page.url, observed_href or "")) if observed_href else None
            if not resolved or not observed_resolved or resolved != observed_resolved or origin_of(resolved) != expected:
                return {"status": "unavailable", "dispatch_state": "not_dispatched", "operation": "download", "failure_class": "download_target_unsupported", "page": state.facts()}
            with state.page.expect_download(timeout=timeout) as download_info:
                link.click(timeout=timeout)
            download = download_info.value
            try:
                download_page = download.page
                if callable(download_page):
                    download_page = download_page()
            except Exception:
                download_page = None
            if download_page is not state.page:
                return {"status": "unknown_outcome", "dispatch_state": "dispatched", "operation": "download", "failure_class": "download_relation_unavailable", "page": state.facts()}
            download_url = safe_url(download.url)
            if not download_url or origin_of(download_url) not in scope:
                return {"status": "unknown_outcome", "dispatch_state": "dispatched", "operation": "download", "failure_class": "download_relation_unavailable", "page": state.facts()}
            failure = download.failure()
            if failure:
                return {"status": "unknown_outcome", "dispatch_state": "dispatched", "operation": "download", "failure_class": safe_text(failure, 128), "page": state.facts()}
            download.save_as(staging)
            staged = Path(staging)
            size = staged.stat().st_size
            if size > 10 * 1024 * 1024:
                return {"status": "unknown_outcome", "dispatch_state": "dispatched", "operation": "download", "failure_class": "file_limit_exceeded", "page": state.facts()}
            digest = hashlib.sha256()
            with staged.open("rb", buffering=0) as handle:
                while True:
                    chunk = handle.read(1024 * 1024)
                    if not chunk:
                        break
                    digest.update(chunk)
            suggested = safe_text(download.suggested_filename(), 128)
            if not suggested or "/" in suggested or "\\" in suggested:
                return {"status": "unknown_outcome", "dispatch_state": "dispatched", "operation": "download", "failure_class": "download_name_invalid", "page": state.facts()}
            return {"status": "completed", "dispatch_state": "dispatched", "operation": "download", "page": state.facts(), "browser_delivery": "completed", "page_receipt": "observed", "page_processing": "unknown", "business_commit": "not_observed", "download": {"page_url": safe_url(state.page.url), "url": download_url, "suggested_filename": suggested, "byte_length": size, "sha256": digest.hexdigest(), "staging_path": staging}}
        except TimeoutError:
            return {"status": "unknown_outcome", "dispatch_state": "dispatched", "operation": "download", "failure_class": "timeout", "page": state.facts()}
        except Exception as error:
            return {"status": "unknown_outcome", "dispatch_state": "dispatched", "operation": "download", "failure_class": safe_text(error, 128), "page": state.facts()}

    def state(self, request: dict[str, Any]) -> PageState:
        ref = request.get("provider_page_ref")
        if not isinstance(ref, str) or ref not in self.pages:
            raise ValueError("Page relation is unavailable.")
        state = self.pages[ref]
        if state.page.is_closed():
            raise ValueError("Page is closed.")
        return state

    def close(self) -> None:
        context = getattr(self, "context", None)
        playwright = getattr(self, "playwright", None)
        self.context = None
        self.playwright = None
        try:
            if context is not None:
                context.close()
        finally:
            if playwright is not None:
                playwright.stop()

    def network_request(self, state: PageState, request: Any) -> None:
        self.add_network(state, request, "request")

    def network_response(self, state: PageState, response: Any) -> None:
        self.add_network(state, response.request, "response", response.status)

    def network_failure(self, state: PageState, request: Any) -> None:
        self.add_network(state, request, "failure", failure_class="connection")

    def add_network(self, state: PageState, request: Any, kind: str, status: int | None = None, failure_class: str | None = None) -> None:
        url = safe_url(request.url)
        if not url or origin_of(url) not in state.origins:
            return
        state.add_event({"event_ref": f"event:{state.ref}:{time.time_ns()}", "request_ref": f"request:{hashlib.sha256(request.url.encode()).hexdigest()[:16]}", "kind": kind, "observed_at": now(), "page_ref": state.ref, "document_generation": state.generation, "method": request.method, "url": url, "origin": origin_of(url), "resource_kind": request.resource_type or "other", **({"status": status} if status is not None else {}), **({"failure_class": failure_class} if failure_class else {})})

    def console_event(self, state: PageState, message: Any) -> None:
        state.add_event({"event_ref": f"event:{state.ref}:{time.time_ns()}", "level": message.type if message.type in ("warn", "error") else "warn", "observed_at": now(), "page_ref": state.ref, "document_generation": state.generation, "text": safe_text(message.text), "origin": origin_of(state.page.url)})

    def page_error(self, state: PageState, error: Any) -> None:
        state.add_event({"event_ref": f"event:{state.ref}:{time.time_ns()}", "level": "pageerror", "observed_at": now(), "page_ref": state.ref, "document_generation": state.generation, "text": safe_text(error), "origin": origin_of(state.page.url)})


def now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())


def viewer_entry(headless: bool) -> dict[str, Any]:
    if headless:
        return {
            "availability": "unsupported",
            "access_mode": "none",
            "transport": "not_applicable",
            "input_capabilities": [],
            "unavailable_reason": "unsupported",
        }
    return {
        "availability": "available",
        "access_mode": "interactive",
        "transport": "local_window",
        "input_capabilities": ["keyboard_mouse"],
    }


def dispatch(driver: Driver, request: dict[str, Any]) -> Any:
    op = request.get("op")
    if op == "page_list": return {"pages": driver.list_pages(), "rejected_unattributed_count": driver.unattributed_rejection_count}
    if op == "page_open":
        origins = list(validated_origins(request.get("authorized_origins")))
        page = driver.context.new_page()
        state = next((item for item in driver.pages.values() if item.page == page), None) or driver.register(page, origins)
        state.origins = set(origins)
        driver.current = state.ref
        if request.get("url"):
            driver.navigate(state, request["url"], origins)
        return state.facts(task_selected=True)
    if op == "page_activate":
        state = driver.state(request)
        driver.current = state.ref
        return state.facts(task_selected=True)
    if op == "page_close":
        state = driver.state(request)
        state.page.close()
        target = request.get("safe_return_provider_page_ref")
        if isinstance(target, str) and target in driver.pages and not driver.pages[target].page.is_closed():
            driver.current = target
        elif driver.current == state.ref:
            fallback = next((item.ref for item in driver.pages.values() if not item.page.is_closed()), None)
            driver.current = fallback
        return driver.list_pages()
    if op == "page_navigate":
        state = driver.state(request)
        origins = list(validated_origins(request.get("authorized_origins")))
        if request.get("action") == "reload":
            driver.apply_page_scope(state, origins)
            state.page.reload()
        elif request.get("action") == "back":
            driver.apply_page_scope(state, origins)
            state.page.go_back()
        elif request.get("action") == "forward":
            driver.apply_page_scope(state, origins)
            state.page.go_forward()
        else: driver.navigate(state, str(request.get("url", "")), origins)
        return state.facts(task_selected=state.ref == driver.current)
    if op == "observe": return driver.observe(request)
    if op == "observe_identity": return driver.observe(request).get("observation", {})
    if op == "interact": return driver.interact(request)
    if op == "read_public_page": return driver.public_page(request)
    if op == "diagnostics": return driver.diagnostics(request)
    if op == "environment": return driver.environment(request)
    if op == "screenshot": return driver.screenshot(request)
    if op == "file_operation": return driver.file_operation(request)
    if op == "close": driver.close(); return {"closed": True}
    raise ValueError("Driver operation is not allowlisted.")


def main() -> None:
    sys.stdout.reconfigure(line_buffering=True)
    driver: Driver | None = None
    for raw in sys.stdin:
        if len(raw.encode("utf-8")) > MAX_LINE:
            print(json.dumps({"id": 0, "status": "error", "message": "Driver request is too large."}, separators=(",", ":")), flush=True)
            continue
        message_id = 0
        try:
            request = json.loads(raw)
            if not isinstance(request, dict): raise ValueError("Driver request must be an object.")
            message_id = request.get("id") if isinstance(request.get("id"), int) else 0
            if request.get("op") == "launch":
                if driver is not None: raise ValueError("Driver is already launched.")
                driver = Driver(request)
                result = {"status": "ready", "driver_ref": "camoufox-upstream-jsonl", "page": driver.pages[driver.current].facts(task_selected=True), "pages": driver.list_pages(), "viewer_entry": viewer_entry(bool(driver.request.get("headless", False))), "facts": [{"key": "driver.api", "source": "observed", "value": "playwright_public"}, {"key": "launch_options.replay", "source": "observed", "value": "exact" if driver.replay else "created"}, {"key": "provider.camoufox.properties_sha256", "source": "validation_evidence", "value": driver.properties_sha256}]}
            elif driver is None:
                raise ValueError("Driver has not launched.")
            else:
                result = dispatch(driver, request)
            print(json.dumps({"id": message_id, "status": "ok", "result": result}, ensure_ascii=False, separators=(",", ":")), flush=True)
        except BaseException as error:
            print(json.dumps({"id": message_id, "status": "error", "message": f"{type(error).__name__}: {safe_text(error, 240)}"}, ensure_ascii=False, separators=(",", ":")), flush=True)


if __name__ == "__main__":
    main()

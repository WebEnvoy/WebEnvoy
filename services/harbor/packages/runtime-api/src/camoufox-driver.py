#!/usr/bin/env python3
"""Small private JSON-lines bridge for the Harbor Camoufox driver.

The bridge deliberately exposes only page facts and bounded readiness facts.  It
does not print DOM, storage, cookies, network bodies, or a Playwright endpoint.
"""

from __future__ import annotations

import contextlib
import configparser
from collections import deque
from datetime import datetime, timezone
import copy
import importlib.metadata
import importlib.util
import hashlib
import json
import math
import os
import platform
import re
import shutil
import stat
import sys
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urljoin, urlparse


PLAYWRIGHT: Any = None
PLAYWRIGHT_TIMEOUT_ERROR: type[BaseException] | None = None
CONTEXT: Any = None
PAGE: Any = None
NATIVE_PLAYWRIGHT_ADAPTER: Any = None
PAGE_STATES: dict[str, dict[str, Any]] = {}
PAGE_STATE_BY_OBJECT: dict[int, str] = {}
MAX_PAGE_TOMBSTONES = 64
NATIVE_RELATION_EPOCH: str | None = None
NATIVE_RELATION_SAMPLE_SEQUENCE = 0
NATIVE_RELATION_INVALID = False
NATIVE_REQUEST_DENIED_BY_TARGET: dict[str, str] = {}
NATIVE_REQUEST_DENIED_LIMIT = 64
PAGE_CONTEXT_HANDLER: Any = None
PROFILE_DIR = ""
EXECUTABLE_PATH = ""
LAUNCH_EXECUTABLE_PATH = ""
LAUNCH_LAYOUT_DIR = ""
PROPERTIES_SOURCE = "adjacent"
PUBLIC_NAVIGATION_GUARDS: dict[str, Any] = {}
PUBLIC_NAVIGATION_ALLOWED_ORIGINS: dict[str, str] = {}
PUBLIC_NAVIGATION_DENIED: dict[str, str] = {}
PAGE_NAVIGATION_GUARDS: dict[str, Any] = {}
PAGE_NAVIGATION_ALLOWED_ORIGINS: dict[str, set[str]] = {}
PAGE_NAVIGATION_DENIED: dict[str, str] = {}
PAGE_NAVIGATION_CONTEXT_GUARD: Any = None
INTERACTION_GUARD: Any = None
INTERACTION_GUARD_PAGE: Any = None
INTERACTION_STATE: dict[str, Any] | None = None
# Navigation and interaction handlers must consume the same most-recent
# per-Page grant. Keep the old interaction name as an alias for callers that
# pre-bind that scope before installing the guard.
PAGE_INTERACTION_ALLOWED_ORIGINS: dict[str, set[str]] = PAGE_NAVIGATION_ALLOWED_ORIGINS
INTERACTION_DENIED: str | None = None


def native_playwright_adapter_module() -> Any:
    """Load the adjacent, driver-owned adapter without changing site-packages."""
    path = Path(__file__).with_name("camoufox-native-playwright.py")
    spec = importlib.util.spec_from_file_location("webenvoy_camoufox_native_playwright", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Camoufox native Playwright adapter is not installed.")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
DIAGNOSTIC_EVENTS: deque[dict[str, Any]] = deque(maxlen=128)
DIAGNOSTIC_CURSOR = 0
DIAGNOSTIC_INSTANCE_REF = ""
DIAGNOSTIC_PAGE_REF = ""
DIAGNOSTIC_DOCUMENT_GENERATION = 0
DIAGNOSTIC_REQUESTS: dict[int, tuple[dict[str, Any], float]] = {}
DIAGNOSTIC_REQUEST_LIMIT = 256
DIAGNOSTIC_SECRET_PATTERN = re.compile(
    r'''(?:\bbearer\s+\S+|["']?(?:authorization|cookie|password|passwd|secret|token|credential|api[_ -]?key|access[_ -]?(?:key|token)|refresh[_ -]?token|session)["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^,\s}]+))''',
    re.IGNORECASE,
)
DIAGNOSTIC_SENSITIVE_PATH_PATTERN = re.compile(
    r"(?:^|/)(?:authorization|bearer|cookie|password|passwd|secret|token|credential|api[_ -]?key|access[_ -]?(?:key|token)|refresh[_ -]?token|session)(?:/|$)",
    re.IGNORECASE,
)
DIAGNOSTIC_URL_PATTERN = re.compile(r'''https?://[^\s"'<>]+''', re.IGNORECASE)

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
ENVIRONMENT_OBSERVED_FIELDS = (
    "language",
    "languages",
    "timezone",
    "viewport",
    "screen",
    "hardware_concurrency",
    "device_memory",
    "webgl_vendor",
    "webgl_renderer",
    "fonts_hash",
    "voices_hash",
    "canvas_hash",
    "audio_hash",
)


def send(message_id: int, status: str, **payload: Any) -> None:
    result = {"id": message_id, "status": status, **payload}
    sys.stdout.write(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def diagnostic_path(path: str) -> str | None:
    if len(path) > 512:
        return None
    try:
        decoded = unquote(path)
    except Exception:
        decoded = path
    return "/<redacted>" if DIAGNOSTIC_SENSITIVE_PATH_PATTERN.search(decoded) or DIAGNOSTIC_SECRET_PATTERN.search(decoded) else path or "/"


def diagnostics_url(value: Any) -> tuple[str, str] | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = urlparse(value)
        if parsed.scheme not in ("http", "https") or parsed.username or parsed.password or not parsed.netloc:
            return None
        path = diagnostic_path(parsed.path)
        if path is None:
            return None
        origin = f"{parsed.scheme}://{parsed.netloc}"
        return f"{origin}{path}", origin
    except ValueError:
        return None


def diagnostic_text(value: Any, limit: int = 512) -> tuple[str, bool]:
    text = str(value)
    if DIAGNOSTIC_SECRET_PATTERN.search(text):
        return "[redacted]", False
    text = re.sub(r"[\x00-\x1f\x7f]", " ", text)
    text = " ".join(text.split())
    # Normalize complete URLs before the generic query scrub.  If the query
    # is replaced first, the angle bracket in ``<redacted>`` terminates the
    # URL matcher and leaks the original fragment as a detached suffix.
    text = DIAGNOSTIC_URL_PATTERN.sub(lambda match: (diagnostics_url(match.group(0)) or ("[redacted]", ""))[0], text)
    text = re.sub(r"([?&][^=\s&]+)=([^\s&#]*)", r"\1=<redacted>", text)
    return text[:limit], len(text) > limit


def safe_text(value: str) -> str:
    return diagnostic_text(value)[0]


def diagnostics_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def diagnostic_event(kind: str, _page_ref: str | None = None, _document_generation: int | None = None, **payload: Any) -> None:
    global DIAGNOSTIC_CURSOR
    DIAGNOSTIC_CURSOR += 1
    DIAGNOSTIC_EVENTS.append({"event_ref": f"event:{DIAGNOSTIC_CURSOR}", "kind": kind, "observed_at": diagnostics_now(), "page_ref": _page_ref or DIAGNOSTIC_PAGE_REF, "document_generation": _document_generation or DIAGNOSTIC_DOCUMENT_GENERATION, **payload, "_cursor": DIAGNOSTIC_CURSOR})


def diagnostic_resource_kind(value: Any) -> str:
    return value if value in ("document", "script", "stylesheet", "image", "font", "xhr", "fetch", "websocket") else "other"


def diagnostic_page_origin(page: Any) -> str | None:
    try:
        current = diagnostics_url(str(page.url))
        return current[1] if current else None
    except Exception:
        return None


def diagnostic_cursor(position: int, page_ref: str | None = None, generation: int | None = None) -> str:
    return f"cursor:{DIAGNOSTIC_INSTANCE_REF}:{page_ref or DIAGNOSTIC_PAGE_REF}:{generation or DIAGNOSTIC_DOCUMENT_GENERATION}:{position}"


def parse_diagnostic_cursor(value: Any, page_ref: str | None = None, generation: int | None = None) -> int | None:
    if not isinstance(value, str):
        return None
    parts = value.split(":")
    if len(parts) != 5 or parts[0] != "cursor" or parts[1] != DIAGNOSTIC_INSTANCE_REF or parts[2] != (page_ref or DIAGNOSTIC_PAGE_REF) or parts[3] != str(generation or DIAGNOSTIC_DOCUMENT_GENERATION):
        return None
    try:
        position = int(parts[4])
    except ValueError:
        return None
    return position if position >= 0 else None


def rotate_diagnostic_page() -> None:
    global DIAGNOSTIC_PAGE_REF, DIAGNOSTIC_DOCUMENT_GENERATION
    DIAGNOSTIC_DOCUMENT_GENERATION += 1
    DIAGNOSTIC_PAGE_REF = f"page_{uuid.uuid4().hex}"


def attach_diagnostics(page: Any) -> None:
    global DIAGNOSTIC_INSTANCE_REF, DIAGNOSTIC_PAGE_REF, DIAGNOSTIC_DOCUMENT_GENERATION
    if not DIAGNOSTIC_INSTANCE_REF:
        DIAGNOSTIC_INSTANCE_REF = uuid.uuid4().hex
    page_state = page_state_for(page)
    newly_registered = page_state is None
    if newly_registered:
        page_state = register_provider_page(page)
    # A diagnostic Page binding is distinct from the private provider handle.
    # It must rotate with each document so a cursor or observation from the
    # previous document cannot be reused after navigation.
    page_ref = (page_state or {}).get("diagnostic_page_ref") or f"page_{uuid.uuid4().hex}"
    if page_state and page_state.get("diagnostics_attached"):
        return
    if page_state:
        page_state["diagnostics_attached"] = True
        page_state["diagnostic_page_ref"] = page_ref
    DIAGNOSTIC_PAGE_REF = page_ref
    DIAGNOSTIC_DOCUMENT_GENERATION = int((page_state or {}).get("document_generation", 1))
    def emit(kind: str, **payload: Any) -> None:
        generation = int((page_state or {}).get("document_generation", DIAGNOSTIC_DOCUMENT_GENERATION))
        diagnostic_event(kind, _page_ref=(page_state or {}).get("diagnostic_page_ref") or page_ref, _document_generation=generation, **payload)
    pending_navigation: tuple[int, dict[str, Any]] | None = None

    def is_main_navigation(request: Any) -> bool:
        try:
            if request.frame != page.main_frame:
                return False
        except Exception:
            return False
        try:
            return bool(request.is_navigation_request())
        except Exception:
            return getattr(request, "resource_type", None) == "document"

    def request_event(request: Any) -> None:
        nonlocal pending_navigation
        try:
            safe = diagnostics_url(request.url)
            if safe:
                emit("request", method=str(request.method)[:16].upper(), url=safe[0], origin=safe[1], resource_kind=diagnostic_resource_kind(request.resource_type))
                DIAGNOSTIC_REQUESTS[id(request)] = (DIAGNOSTIC_EVENTS[-1], time.monotonic())
                if is_main_navigation(request):
                    pending_navigation = (id(request), DIAGNOSTIC_EVENTS[-1])
                while len(DIAGNOSTIC_REQUESTS) > DIAGNOSTIC_REQUEST_LIMIT:
                    DIAGNOSTIC_REQUESTS.pop(next(iter(DIAGNOSTIC_REQUESTS)))
        except Exception:
            pass

    def response_event(response: Any) -> None:
        try:
            safe = diagnostics_url(response.url)
            if safe:
                state = DIAGNOSTIC_REQUESTS.get(id(response.request))
                if state is None:
                    return
                event, started = state
                redirected = getattr(response.request, "redirected_from", None) is not None
                emit("response", request_ref=event["event_ref"], page_ref=event["page_ref"], document_generation=event["document_generation"], method=str(response.request.method)[:16].upper(), url=safe[0], origin=safe[1], resource_kind=diagnostic_resource_kind(response.request.resource_type), status=int(response.status), duration_ms=round((time.monotonic() - started) * 1000), redirected=redirected)
        except Exception:
            pass

    def failed_event(request: Any) -> None:
        nonlocal pending_navigation
        try:
            safe = diagnostics_url(request.url)
            if safe:
                error_text = str(request.failure or "unknown").lower()
                failure = "timeout" if "timeout" in error_text else "aborted" if "abort" in error_text else "connection"
                if pending_navigation is not None and pending_navigation[0] == id(request):
                    pending_navigation = None
                state = DIAGNOSTIC_REQUESTS.pop(id(request), None)
                if state is None:
                    return
                event, started = state
                emit("failure", request_ref=event["event_ref"], page_ref=event["page_ref"], document_generation=event["document_generation"], method=str(request.method)[:16].upper(), url=safe[0], origin=safe[1], resource_kind=diagnostic_resource_kind(request.resource_type), failure_class=failure, duration_ms=round((time.monotonic() - started) * 1000), redirected=getattr(request, "redirected_from", None) is not None)
        except Exception:
            pass

    def console_event(message: Any) -> None:
        try:
            level = str(message.type)
            if level not in ("warning", "error"):
                return
            location = message.location or {}
            source = diagnostics_url(location.get("url"))
            event_origin = source[1] if source else diagnostic_page_origin(page)
            text, truncated = diagnostic_text(message.text)
            emit("console", _origin=event_origin, level="warn" if level == "warning" else "error", text=text, truncated=truncated, **({"source": {"url": source[0], "line": location.get("lineNumber", 0), "column": location.get("columnNumber", 0)}} if source else {}))
        except Exception:
            pass

    def page_error(error: Any) -> None:
        try:
            text, truncated = diagnostic_text(error)
            emit("console", _origin=diagnostic_page_origin(page), level="pageerror", text=text, truncated=truncated)
        except Exception:
            pass

    def navigated(frame: Any) -> None:
        nonlocal pending_navigation
        try:
            if frame == page.main_frame:
                if pending_navigation is None and INTERACTION_STATE is not None:
                    try:
                        if INTERACTION_STATE["handle"].evaluate("state => state.sameDocument()"):
                            return
                    except Exception:
                        pass  # A destroyed execution context is a replaced document.
                if page_state:
                    # register_provider_page owns the generation counter;
                    # this listener only rebinds the navigation event.
                    pass
                else:
                    rotate_diagnostic_page()
                if pending_navigation is not None:
                    request_event_ref = pending_navigation[1]["event_ref"]
                    for event in DIAGNOSTIC_EVENTS:
                        if event["event_ref"] == request_event_ref or event.get("request_ref") == request_event_ref:
                            event["page_ref"] = (page_state or {}).get("diagnostic_page_ref") or page_ref
                            event["document_generation"] = int((page_state or {}).get("document_generation", DIAGNOSTIC_DOCUMENT_GENERATION))
                pending_navigation = None
        except Exception:
            pass

    page.on("request", request_event)
    page.on("response", response_event)
    page.on("requestfailed", failed_event)
    page.on("requestfinished", lambda request: DIAGNOSTIC_REQUESTS.pop(id(request), None))
    page.on("console", console_event)
    page.on("pageerror", page_error)
    page.on("framenavigated", navigated)


def diagnostics_read(request: dict[str, Any]) -> dict[str, Any]:
    if PAGE is None:
        return {"status": "unavailable", "failure_class": "provider_unavailable", "message": "Camoufox Driver has no active page.", "retryable": False}
    provider_requested_ref = request.get("provider_page_ref")
    public_requested_ref = request.get("page_ref")
    target_state = page_by_provider_ref(provider_requested_ref) if isinstance(provider_requested_ref, str) else page_state_for(PAGE)
    target_page = target_state.get("page") if target_state else PAGE
    target_ref = (target_state or {}).get("diagnostic_page_ref") or public_requested_ref or provider_page_ref(PAGE) or DIAGNOSTIC_PAGE_REF
    target_generation = int((target_state or {}).get("document_generation", DIAGNOSTIC_DOCUMENT_GENERATION))
    try:
        title = safe_text(str(target_page.title()))[:256]
    except Exception:
        return {"status": "unavailable", "failure_class": "provider_unavailable", "message": "The requested Page is no longer observable.", "retryable": False}
    # Reading the title can flush the provider's pending navigation callbacks
    # (and therefore rotate the diagnostic Page binding). Resolve the current
    # binding after that flush before validating the public reference/cursor.
    target_ref = (target_state or {}).get("diagnostic_page_ref") or target_ref
    target_generation = int((target_state or {}).get("document_generation", target_generation))
    origin = request.get("origin")
    current = diagnostics_url(str(target_page.url))
    if not isinstance(origin, str) or not current or current[1] != origin:
        return {"status": "unavailable", "failure_class": "wrong_page", "message": "The requested page origin does not match the requested origin.", "retryable": False}
    if public_requested_ref is not None and public_requested_ref != target_ref:
        return {"status": "unavailable", "failure_class": "stale_page", "message": "The requested Page binding is stale.", "retryable": False}
    cursor = request.get("cursor")
    after = parse_diagnostic_cursor(cursor, target_ref, target_generation) if cursor is not None else None
    page_events = [event for event in DIAGNOSTIC_EVENTS if event.get("page_ref") == target_ref and event.get("document_generation") == target_generation]
    page_events = page_events[-128:]
    oldest = page_events[0]["_cursor"] if page_events else DIAGNOSTIC_CURSOR + 1
    if cursor is not None and (after is None or after > DIAGNOSTIC_CURSOR or after < oldest - 1):
        return {"status": "unavailable", "failure_class": "cursor_stale", "message": "The diagnostics cursor is invalid or no longer retained for this Instance Page generation.", "retryable": True}
    if after is None:
        after = oldest - 1
    limit = request.get("limit", 64)
    high_watermark = DIAGNOSTIC_CURSOR
    retained = [event for event in page_events if event["_cursor"] > after and event["_cursor"] <= high_watermark and event.get("origin", event.get("_origin")) == current[1]]
    events = retained[:max(1, min(64, int(limit)))]
    network, console = [], []
    for event in events:
        public = {key: value for key, value in event.items() if not key.startswith("_")}
        if event["kind"] == "console":
            console.append(public)
        else:
            network.append(public)
    last = events[-1]["_cursor"] if events else after
    return {"status": "completed", "page_ref": target_ref, "document_generation": target_generation, "page": {"current_url": current[0], "title": title, "status": "ready"}, "cursor": diagnostic_cursor(after, target_ref, target_generation), "next_cursor": diagnostic_cursor(last, target_ref, target_generation), "truncated": (oldest > 1 and after == oldest - 1) or len(retained) > len(events), "observed_at": diagnostics_now(), "network": network, "console": console}


def safe_error(error: BaseException) -> str:
    message = str(error).replace(PROFILE_DIR, "<profile>").replace(EXECUTABLE_PATH, "<browser>")
    message = safe_text(" ".join(message.split()))[:240]
    return f"{type(error).__name__}: {message}" if message else type(error).__name__


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
    if not isinstance(bundle, dict) or set(bundle) != required:
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
            or len(baseline["observed_at"]) > 64
            or not isinstance(baseline["observed"], dict)
            or set(baseline["observed"]) != set(CONTINUITY_STABLE_FIELDS)
            or baseline_hash != json_hash(baseline)
        ):
            raise ValueError("Camoufox environment bundle baseline is corrupt.")
    return bundle


def _atomic_write_environment_bundle(path: Path, bundle: dict[str, Any], replace: bool) -> None:
    payload = canonical_json(bundle) + b"\n"
    if len(payload) > MAX_ENVIRONMENT_BUNDLE_BYTES:
        raise ValueError("Camoufox environment bundle is too large.")
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temp_name = ""
    try:
        temp_fd, temp_name = tempfile.mkstemp(
            prefix=f".{ENVIRONMENT_BUNDLE_FILENAME}.",
            dir=path.parent,
        )
        with os.fdopen(temp_fd, "wb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        if replace:
            os.replace(temp_name, path)
            temp_name = ""
        else:
            # link() publishes the complete inode without overwriting a bundle
            # created by a competing Profile owner.
            os.link(temp_name, path)
            os.unlink(temp_name)
            temp_name = ""
        os.chmod(path, 0o600)
        directory_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        if temp_name:
            with contextlib.suppress(FileNotFoundError):
                os.unlink(temp_name)


def save_environment_bundle(profile_dir: str | Path, bundle: dict[str, Any]) -> dict[str, Any]:
    bundle = validate_environment_bundle(bundle)
    path = environment_bundle_path(profile_dir)
    if os.path.lexists(path):
        raise ValueError("Camoufox environment bundle already exists.")
    _atomic_write_environment_bundle(path, bundle, replace=False)
    return bundle


def update_environment_bundle(profile_dir: str | Path, bundle: dict[str, Any]) -> dict[str, Any]:
    bundle = validate_environment_bundle(bundle)
    path = environment_bundle_path(profile_dir)
    if not os.path.lexists(path) or path.is_symlink():
        raise ValueError("Camoufox environment bundle is missing or unsafe.")
    _atomic_write_environment_bundle(path, bundle, replace=True)
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
    if not isinstance(config, dict) or not config:
        raise ValueError("Camoufox launch did not produce a provider config.")
    try:
        canonical_json(config)
    except (TypeError, ValueError, OverflowError) as error:
        raise ValueError("Camoufox launch produced a config that is not valid JSON.") from error
    bundle = {
        "schema_version": 1,
        "provider": "camoufox",
        "camoufox_version": CAMOUFOX_VERSION_PIN,
        "browser_version": BROWSER_VERSION_PIN,
        "properties_sha256": PROPERTIES_SHA256_PIN,
        "config": copy.deepcopy(config),
        "config_sha256": json_hash(config),
        "identity_hash": json_hash(identity_config(config)),
        "baseline": None,
        "baseline_sha256": None,
    }
    return validate_environment_bundle(bundle)


def extract_camoufox_config(options: dict[str, Any]) -> dict[str, Any]:
    env = options.get("env") if isinstance(options, dict) else None
    if not isinstance(env, dict):
        raise ValueError("Camoufox launch did not return its private config environment.")
    chunks: list[tuple[int, str]] = []
    for key, value in env.items():
        match = re.fullmatch(r"CAMOU_CONFIG_(\d+)", str(key))
        if match and isinstance(value, str):
            chunks.append((int(match.group(1)), value))
    chunks.sort()
    if not chunks or [number for number, _ in chunks] != list(range(1, len(chunks) + 1)):
        raise ValueError("Camoufox launch returned incomplete private config chunks.")
    try:
        config = json.loads("".join(value for _, value in chunks))
    except (UnicodeError, json.JSONDecodeError) as error:
        raise ValueError("Camoufox launch returned corrupt private config.") from error
    if not isinstance(config, dict):
        raise ValueError("Camoufox launch returned a non-object private config.")
    return config


def replay_environment_options(options: dict[str, Any], bundle: dict[str, Any], target_os: str, executable: str) -> None:
    from camoufox.utils import get_env_vars

    candidate = extract_camoufox_config(options)
    # A stored absence is part of the identity too: BrowserForge can generate
    # optional keys on a later draw. Never inject those into an existing Profile.
    replay = {key: value for key, value in candidate.items() if key in bundle["config"] or key in DYNAMIC_ENVIRONMENT_CONFIG_KEYS}
    if json_hash(identity_config(replay)) != bundle["identity_hash"]:
        raise ValueError("Camoufox environment replay changed the stored identity.")
    options["env"] = {key: value for key, value in options["env"].items() if not key.startswith("CAMOU_CONFIG_")}
    options["env"].update(get_env_vars(replay, target_os, path=Path(executable)))


def environment_viewport(value: Any) -> tuple[int, int] | None:
    if value is None:
        return None
    if (
        not isinstance(value, dict)
        or type(value.get("width")) is not int
        or type(value.get("height")) is not int
        or not 200 <= value["width"] <= 16_384
        or not 200 <= value["height"] <= 16_384
    ):
        raise ValueError("Camoufox viewport configuration is unsupported.")
    return value["width"], value["height"]


def apply_environment_overrides(
    config: dict[str, Any],
    *,
    timezone: Any = None,
    viewport: Any = None,
) -> dict[str, Any]:
    if not isinstance(config, dict):
        raise ValueError("Camoufox replay config is corrupt.")
    if isinstance(timezone, str) and timezone:
        config["timezone"] = timezone
    viewport_dimensions = environment_viewport(viewport)
    if viewport_dimensions is None:
        return config

    for axis in ("Width", "Height"):
        value = viewport_dimensions[0 if axis == "Width" else 1]
        outer_key = f"window.outer{axis}"
        inner_key = f"window.inner{axis}"
        old_outer = config.get(outer_key)
        old_inner = config.get(inner_key)
        chrome = old_outer - old_inner if type(old_outer) is int and type(old_inner) is int else 0
        config[outer_key] = value
        if type(old_inner) is int:
            config[inner_key] = max(1, value - max(0, chrome))

        screen = config.get(f"screen.{axis.lower()}")
        position_key = "window.screenX" if axis == "Width" else "window.screenY"
        position = config.get(position_key)
        if type(screen) is int and type(position) is int:
            config[position_key] = max(0, min(position, max(0, screen - value)))
    return config


def _continuity_baseline(observed: dict[str, Any], observed_at: str) -> dict[str, Any]:
    return {
        "observed_at": observed_at,
        "observed": {field: observed.get(field) for field in CONTINUITY_STABLE_FIELDS},
        "canvas": _canvas_baseline(observed),
    }


def _canvas_baseline(observed: dict[str, Any]) -> dict[str, Any]:
    return {"algorithm": CANVAS_HASH_ALGORITHM, "instance_ref": DIAGNOSTIC_INSTANCE_REF, "hash": observed.get("canvas_hash")}


def compare_environment_continuity(bundle: dict[str, Any], observed: dict[str, Any]) -> dict[str, Any]:
    baseline = bundle.get("baseline")
    if not isinstance(baseline, dict) or not isinstance(baseline.get("observed"), dict):
        return {
            "state": "unknown",
            "checked_fields": [],
            "changed_fields": [],
            "unknown_fields": list(CONTINUITY_STABLE_FIELDS),
        }
    checked: list[str] = []
    changed: list[str] = []
    unknown: list[str] = []
    previous = baseline["observed"]
    for field in CONTINUITY_STABLE_FIELDS:
        before = previous.get(field)
        current = observed.get(field)
        if field == "canvas_hash":
            canvas = baseline.get("canvas")
            if not isinstance(canvas, dict) or canvas["instance_ref"] == DIAGNOSTIC_INSTANCE_REF:
                unknown.append(field)
                continue
            before = canvas["hash"]
        if before is None or current is None:
            unknown.append(field)
        elif before != current:
            checked.append(field)
            changed.append(field)
        else:
            checked.append(field)
    state = "drift" if changed else "match" if not unknown else "unknown"
    return {
        "state": state,
        "checked_fields": checked,
        "changed_fields": changed,
        "unknown_fields": unknown,
    }


def establish_environment_baseline(
    profile_dir: str | Path,
    bundle: dict[str, Any],
    observed: dict[str, Any],
    observed_at: str,
) -> dict[str, Any]:
    if bundle.get("baseline") is not None:
        raise ValueError("Camoufox environment baseline already exists.")
    updated = copy.deepcopy(bundle)
    updated["baseline"] = _continuity_baseline(observed, observed_at)
    updated["baseline_sha256"] = json_hash(updated["baseline"])
    return update_environment_bundle(profile_dir, updated)


def _safe_observed_string(value: Any, limit: int = 256) -> str | None:
    if not isinstance(value, str) or not value or len(value) > limit or any(ord(char) < 32 or ord(char) == 127 for char in value):
        return None
    return value


def _safe_observed_dimensions(value: Any, keys: tuple[str, ...]) -> dict[str, int] | None:
    if not isinstance(value, dict):
        return None
    result: dict[str, int] = {}
    for key in keys:
        candidate = value.get(key)
        if type(candidate) is not int or not 1 <= candidate <= 65_536:
            return None
        result[key] = candidate
    return result


def sanitize_environment_observation(raw: Any) -> dict[str, Any]:
    observed = {field: None for field in ENVIRONMENT_OBSERVED_FIELDS}
    if not isinstance(raw, dict):
        raise ValueError("Camoufox environment readback is unavailable.")
    observed["language"] = _safe_observed_string(raw.get("language"), 64)
    languages = raw.get("languages")
    if isinstance(languages, list) and len(languages) <= 16:
        observed["languages"] = [item for item in (_safe_observed_string(value, 64) for value in languages) if item is not None]
    observed["timezone"] = _safe_observed_string(raw.get("timezone"), 128)
    observed["viewport"] = _safe_observed_dimensions(raw.get("viewport"), ("width", "height"))
    observed["screen"] = _safe_observed_dimensions(raw.get("screen"), ("width", "height", "avail_width", "avail_height"))
    hardware = raw.get("hardware_concurrency")
    if type(hardware) is int and 1 <= hardware <= 1024:
        observed["hardware_concurrency"] = hardware
    memory = raw.get("device_memory")
    if (type(memory) in (int, float) and not isinstance(memory, bool) and math.isfinite(memory) and 0 < memory <= 1024):
        observed["device_memory"] = memory
    observed["webgl_vendor"] = _safe_observed_string(raw.get("webgl_vendor"))
    observed["webgl_renderer"] = _safe_observed_string(raw.get("webgl_renderer"))
    for field in ("fonts_hash", "voices_hash", "canvas_hash", "audio_hash"):
        value = raw.get(field)
        if isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value):
            observed[field] = value
    return observed


def environment_read(request: dict[str, Any] | None = None) -> dict[str, Any]:
    del request
    if PAGE is None:
        raise RuntimeError("Camoufox Driver has no active page.")
    bundle = load_environment_bundle(PROFILE_DIR)
    with contextlib.redirect_stdout(sys.stderr):
        raw = PAGE.evaluate("mw:" + ENVIRONMENT_READ_EXPRESSION)
    observed = sanitize_environment_observation(raw)
    observed_at = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
    if bundle["baseline"] is None:
        bundle = establish_environment_baseline(PROFILE_DIR, bundle, observed, observed_at)
        continuity = {
            "state": "unknown",
            "checked_fields": [],
            "changed_fields": [],
            "unknown_fields": list(CONTINUITY_STABLE_FIELDS),
        }
    else:
        if "canvas" not in bundle["baseline"]:
            # Upgrade observation only: retain the original PNG hash and every
            # identity/config value. This launch cannot verify its own baseline.
            bundle["baseline"]["canvas"] = _canvas_baseline(observed)
            bundle["baseline_sha256"] = json_hash(bundle["baseline"])
            bundle = update_environment_bundle(PROFILE_DIR, bundle)
        continuity = compare_environment_continuity(bundle, observed)
    return {
        "status": "completed",
        "observed_at": observed_at,
        "provider": {
            "camoufox_version": CAMOUFOX_VERSION_PIN,
            "browser_version": BROWSER_VERSION_PIN,
            "properties_sha256": PROPERTIES_SHA256_PIN,
        },
        "bundle_hash": bundle["identity_hash"],
        "observed": observed,
        "continuity": continuity,
    }


def prepare_properties(executable_path: str) -> tuple[str, str]:
    """Return a Camoufox-compatible executable path without mutating the install.

    Camoufox 0.5.6 resolves properties.json beside the executable it receives,
    while the official macOS bundle keeps that public file in Contents/Resources.
    When those paths differ, independently copy the bundle into a Driver-owned
    temporary layout. Never share writable inodes with the external install.
    """
    executable = Path(executable_path).absolute()
    adjacent = executable.parent / "properties.json"
    resources = executable.parent.parent / "Resources" / "properties.json"
    if adjacent.is_file():
        if resources.is_file() and adjacent.read_bytes() != resources.read_bytes():
            raise ValueError("Camoufox properties.json beside the executable disagrees with Contents/Resources.")
        return str(executable), "adjacent"
    if resources.is_file():
        global LAUNCH_LAYOUT_DIR
        layout = Path(tempfile.mkdtemp(prefix="harbor-camoufox-driver-"))
        LAUNCH_LAYOUT_DIR = str(layout)
        try:
            source_app = executable.parent.parent.parent
            staged_app = layout / source_app.name

            # Materialize only contained links; every staged byte is independently
            # owned so browser writes cannot modify the external installation.
            source_root = source_app.resolve(strict=True)
            for entry in source_app.rglob("*"):
                if entry.is_symlink() and not entry.resolve(strict=True).is_relative_to(source_root):
                    raise ValueError("Camoufox bundle contains an external symlink.")
            shutil.copytree(source_app, staged_app, symlinks=False)
            staged_macos = staged_app / "Contents" / "MacOS"
            staged_executable = staged_macos / executable.name
            # Copy only the public upstream metadata that Camoufox's public
            # launch_options() insists on finding beside the executable.
            shutil.copyfile(resources, staged_macos / "properties.json")
        except BaseException:
            cleanup_launch_layout()
            raise
        return str(staged_executable), "resources_copy"
    raise FileNotFoundError("Camoufox properties.json is missing beside the executable and in Contents/Resources.")


def cleanup_launch_layout() -> None:
    global LAUNCH_LAYOUT_DIR, LAUNCH_EXECUTABLE_PATH
    if LAUNCH_LAYOUT_DIR:
        shutil.rmtree(LAUNCH_LAYOUT_DIR, ignore_errors=True)
    LAUNCH_LAYOUT_DIR = ""
    LAUNCH_EXECUTABLE_PATH = ""


def firefox_major(executable_path: str) -> int:
    executable = Path(executable_path).absolute()
    candidates = (
        executable.parent / "application.ini",
        executable.parent.parent / "Resources" / "application.ini",
    )
    for candidate in candidates:
        if not candidate.is_file():
            continue
        parser = configparser.ConfigParser()
        parser.read(candidate)
        version = parser.get("App", "Version", fallback="")
        major = version.split(".", 1)[0]
        if major.isdigit():
            return int(major)
    raise FileNotFoundError("Camoufox application.ini does not expose a browser major version.")


def page_facts() -> dict[str, Any]:
    return facts_for_page(PAGE)


def facts_for_page(page: Any) -> dict[str, Any]:
    if page is None:
        return {"current_url": None, "title": None, "status": "unavailable"}
    current_url: str | None
    try:
        raw_url = str(page.url) if page.url else ""
        safe_url = diagnostics_url(raw_url)
        # about:blank is the only non-network URL needed before the first
        # navigation.  Public page facts otherwise use the same complete-URL
        # sanitizer as diagnostics, so query/fragment removal cannot corrupt
        # the path or leave an unredacted suffix behind.
        current_url = safe_url[0] if safe_url else ("about:blank" if raw_url == "about:blank" else None)
    except Exception:
        current_url = None
    try:
        title = safe_text(str(page.title()))[:512]
    except Exception:
        title = None
    return {"current_url": current_url, "title": title, "status": "ready" if current_url is not None else "unknown"}


def page_state_for(page: Any) -> dict[str, Any] | None:
    """Return the private provider state for a Playwright Page object."""
    ref = PAGE_STATE_BY_OBJECT.get(id(page))
    return PAGE_STATES.get(ref) if ref else None


def provider_page_ref(page: Any) -> str | None:
    state = page_state_for(page)
    return state.get("provider_page_ref") if state else None


def page_state_facts(state: dict[str, Any]) -> dict[str, Any]:
    page = state.get("page")
    facts = facts_for_page(page)
    current_url = facts.get("current_url")
    # A private driver handle is deliberately the only page identity emitted
    # on this pipe. Harbor replaces it with an opaque public page_ref.
    return {
        **facts,
        "provider_page_ref": state["provider_page_ref"],
        "document_generation": int(state.get("document_generation", 1)),
        # Active is a provider fact only after the fixed native snapshot has
        # marked this exact window selected.  A Python object pointer is not a
        # focus signal and is intentionally never sufficient on its own.
        # native_selected is a per-window browser fact. Harbor's public active
        # Page is the one selected Page in the trusted native active window;
        # merely being selected in another native window is not enough.
        "status": "closed" if state.get("closed") else facts["status"],
        "active": state.get("page") is PAGE and state.get("native_active") is True and not state.get("closed"),
        **({"opener_provider_page_ref": state["opener_provider_page_ref"]} if state.get("opener_provider_page_ref") else {})
    }


def _prune_page_tombstones() -> None:
    tombstones = [state for state in PAGE_STATES.values() if state.get("closed") and state.get("native_close_confirmed")]
    if len(tombstones) <= MAX_PAGE_TOMBSTONES:
        return
    tombstones.sort(key=lambda state: float(state.get("closed_at", 0.0)))
    for state in tombstones[:-MAX_PAGE_TOMBSTONES]:
        ref = state.get("provider_page_ref")
        if isinstance(ref, str):
            PAGE_STATES.pop(ref, None)
            PAGE_STATE_BY_OBJECT.pop(id(state.get("page")), None)


def all_page_states() -> list[dict[str, Any]]:
    _prune_page_tombstones()
    return [page_state_facts(state) for state in PAGE_STATES.values()
            if not state.get("closed") or state.get("native_close_confirmed")]


def live_page_states() -> list[dict[str, Any]]:
    return [page_state_facts(state) for state in PAGE_STATES.values() if not state.get("closed")]


def register_provider_page(page: Any, opener: Any = None) -> dict[str, Any]:
    """Track a browser Page without exporting the Playwright object."""
    existing = page_state_for(page)
    if existing is not None:
        if opener is not None and not existing.get("opener_provider_page_ref"):
            existing["opener_provider_page_ref"] = provider_page_ref(opener)
        return existing
    ref = f"provider_page_{uuid.uuid4().hex}"
    state: dict[str, Any] = {
        "provider_page_ref": ref,
        "page": page,
        "document_generation": 1,
        "closed": False,
    }
    opener_ref = provider_page_ref(opener) if opener is not None else None
    if opener_ref:
        state["opener_provider_page_ref"] = opener_ref
    PAGE_STATES[ref] = state
    PAGE_STATE_BY_OBJECT[id(page)] = ref

    def on_frame_navigated(frame: Any) -> None:
        try:
            if frame == page.main_frame:
                # A same-document history transition still creates a new
                # public document binding; the registry cannot safely infer
                # that distinction from a URL comparison alone.
                state["document_generation"] = int(state.get("document_generation", 1)) + 1
                state["diagnostic_page_ref"] = f"page_{uuid.uuid4().hex}"
                state.pop("interaction_page_ref", None)
        except Exception:
            pass

    def on_close() -> None:
        global PAGE
        state["closed"] = True
        state["closed_at"] = time.monotonic()
        state["native_close_confirmed"] = False
        target_id = state.get("native_target_id")
        if isinstance(target_id, str):
            NATIVE_REQUEST_DENIED_BY_TARGET.pop(target_id, None)
        PAGE_STATE_BY_OBJECT.pop(id(page), None)
        guard = PAGE_NAVIGATION_GUARDS.pop(ref, None)
        PAGE_NAVIGATION_ALLOWED_ORIGINS.pop(ref, None)
        PAGE_NAVIGATION_DENIED.pop(ref, None)
        public_guard = PUBLIC_NAVIGATION_GUARDS.pop(ref, None)
        PUBLIC_NAVIGATION_ALLOWED_ORIGINS.pop(ref, None)
        PUBLIC_NAVIGATION_DENIED.pop(ref, None)
        if guard is not None:
            with contextlib.suppress(Exception):
                page.unroute("**/*", guard)
        if public_guard is not None:
            with contextlib.suppress(Exception):
                page.unroute("**/*", public_guard)
        if page is PAGE:
            # Native close is not an activation signal. Leave active unset
            # until a provider focus event or an explicit page.activate.
            PAGE = None

    def on_dialog(dialog: Any) -> None:
        try:
            if str(getattr(dialog, "type", "")) == "beforeunload":
                state["beforeunload_blocked"] = True
            dialog.dismiss()
        except Exception:
            pass

    with contextlib.suppress(Exception):
        page.on("framenavigated", on_frame_navigated)
        page.on("close", on_close)
        page.on("dialog", on_dialog)
    return state


def set_active_provider_page(page: Any) -> dict[str, Any]:
    global PAGE
    if page is None or getattr(page, "is_closed", lambda: False)():
        raise ValueError("Camoufox Driver Page is closed.")
    state = page_state_for(page) or register_provider_page(page)
    # Do not publish the new active Page until native focus succeeds. A
    # failed bring-to-front must remain an unavailable/unknown activation.
    page.bring_to_front()
    PAGE = page
    if NATIVE_PLAYWRIGHT_ADAPTER is not None:
        refresh_native_selected_page()
    return page_state_facts(state)


def context_page_created(page: Any) -> None:
    opener = None
    with contextlib.suppress(Exception):
        opener = page.opener
        if callable(opener):
            opener = opener()
    register_provider_page(page, opener)
    with contextlib.suppress(Exception):
        attach_diagnostics(page)


def install_page_context_handler() -> None:
    global PAGE_CONTEXT_HANDLER
    if CONTEXT is None or PAGE_CONTEXT_HANDLER is not None:
        return
    PAGE_CONTEXT_HANDLER = context_page_created
    with contextlib.suppress(Exception):
        CONTEXT.on("page", PAGE_CONTEXT_HANDLER)


def reset_provider_pages() -> None:
    global PAGE_CONTEXT_HANDLER, PAGE_NAVIGATION_CONTEXT_GUARD, NATIVE_RELATION_EPOCH, NATIVE_RELATION_SAMPLE_SEQUENCE, NATIVE_RELATION_INVALID, NATIVE_REQUEST_DENIED_BY_TARGET, INTERACTION_DENIED
    if PAGE_NAVIGATION_CONTEXT_GUARD is not None and CONTEXT is not None:
        with contextlib.suppress(Exception):
            CONTEXT.unroute("**/*", PAGE_NAVIGATION_CONTEXT_GUARD)
    PAGE_STATES.clear()
    PAGE_STATE_BY_OBJECT.clear()
    PAGE_NAVIGATION_GUARDS.clear()
    PAGE_NAVIGATION_ALLOWED_ORIGINS.clear()
    PAGE_NAVIGATION_DENIED.clear()
    PUBLIC_NAVIGATION_GUARDS.clear()
    PUBLIC_NAVIGATION_ALLOWED_ORIGINS.clear()
    PUBLIC_NAVIGATION_DENIED.clear()
    INTERACTION_DENIED = None
    PAGE_CONTEXT_HANDLER = None
    PAGE_NAVIGATION_CONTEXT_GUARD = None
    NATIVE_RELATION_EPOCH = None
    NATIVE_RELATION_SAMPLE_SEQUENCE = 0
    NATIVE_RELATION_INVALID = False
    NATIVE_REQUEST_DENIED_BY_TARGET.clear()


def page_by_provider_ref(ref: Any) -> dict[str, Any] | None:
    return PAGE_STATES.get(ref) if isinstance(ref, str) else None


def managed_page_state(request: dict[str, Any], selection_failure: str, unavailable_failure: str) -> tuple[dict[str, Any] | None, str | None]:
    """Resolve a managed operation to one exact Page binding.

    An explicit Provider handle is authoritative.  The legacy omitted-handle
    path is kept only for a single Page; an active global Page never selects
    one of several live Pages.
    """
    requested_ref = request.get("provider_page_ref")
    if requested_ref is not None:
        state = page_by_provider_ref(requested_ref)
        if state is None or state.get("closed") or state.get("page") is None:
            return None, unavailable_failure
        page = state["page"]
        with contextlib.suppress(Exception):
            if page.is_closed():
                return None, unavailable_failure
        return state, None

    live = [state for state in PAGE_STATES.values() if not state.get("closed") and state.get("page") is not None]
    if len(live) > 1:
        return None, selection_failure
    if live:
        return live[0], None
    if PAGE is None:
        return None, unavailable_failure
    state = page_state_for(PAGE) or register_provider_page(PAGE)
    if state.get("closed"):
        return None, unavailable_failure
    return state, None


def xhs_probe_expression() -> str:
    return """(() => {
      const text = document.body?.innerText || "";
      const challengeSurface = typeof document.querySelectorAll === 'function' && Array.from(document.querySelectorAll('[class*="captcha"], [id*="captcha"], [class*="challenge"], [id*="challenge"], [class*="security-check"], [id*="security-check"]')).some((element) => {
        const view = document.defaultView;
        if (!view) return false;
        const style = view.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 &&
          rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < view.innerHeight && rect.left < view.innerWidth;
      });
      const challenge = /验证码|安全验证|访问异常|captcha|challenge required|verification challenge|security check|verification required|complete verification/i.test(text) || challengeSurface;
      const login = /登录后|扫码登录|手机号登录/.test(text) || location.pathname.startsWith('/login') || Boolean(document.querySelector('.login-dialog, [class*="login"] form, [class*="login"] [class*="qrcode"]'));
      const app = document.querySelector('#app');
      const vue = app?.__vue_app__;
      const pinia = window.__PINIA__ || window.__pinia || vue?.config?.globalProperties?.$pinia;
      return {
        origin: location.origin,
        pathname: location.pathname,
        ready: document.readyState !== 'loading',
        login_like: login,
        challenge_like: challenge,
        vue_ready: Boolean(vue),
        pinia_ready: pinia?._s instanceof Map
      };
    })()"""


def boss_probe_expression() -> str:
    return """(() => {
      const text = document.body?.innerText || "";
      const challenge = /验证码|安全验证|访问异常|captcha|challenge|security check|verification/i.test(text);
      const login = /登录|登陆|sign in|login/i.test(text) || location.pathname.startsWith('/login');
      const app = document.querySelector('#app');
      const vue = app?.__vue_app__;
      const cards = document.querySelectorAll('.job-card, .job-card-wrapper, [class*="job-card"], .job-list li');
      return {
        origin: location.origin,
        pathname: location.pathname,
        ready: document.readyState !== 'loading',
        login_like: login,
        challenge_like: challenge,
        vue_owned: Boolean(vue),
        rendered_surface: cards.length > 0,
        job_cards_valid: cards.length > 0,
        job_card_count: cards.length
      };
    })()"""


ENVIRONMENT_READ_EXPRESSION = r"""(async () => {
  const clean = (value, limit) => {
    if (typeof value !== 'string' || !value || value.length > limit || /[\u0000-\u001f\u007f]/.test(value)) return null;
    return value;
  };
  const integer = (value, max) => Number.isInteger(value) && value >= 1 && value <= max ? value : null;
  const dimensions = (value, keys) => {
    if (!value) return null;
    const result = {};
    for (const key of keys) {
      const number = integer(value[key], 65536);
      if (number === null) return null;
      result[key] = number;
    }
    return result;
  };
  const digest = async value => {
    try {
      if (!globalThis.crypto?.subtle || typeof TextEncoder !== 'function') return null;
      const bytes = await globalThis.crypto.subtle.digest('SHA-256', typeof value === 'string' ? new TextEncoder().encode(value) : value);
      return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
    } catch { return null; }
  };

  const language = clean(navigator.language, 64);
  const languages = Array.isArray(navigator.languages)
    ? navigator.languages.slice(0, 16).map(value => clean(value, 64)).filter(Boolean)
    : null;
  let timezone = null;
  try { timezone = clean(Intl.DateTimeFormat().resolvedOptions().timeZone, 128); } catch {}

  const viewport = dimensions({width: innerWidth, height: innerHeight}, ['width', 'height']);
  const screenValue = globalThis.screen;
  const screen = dimensions(screenValue, ['width', 'height', 'availWidth', 'availHeight']);
  const normalizedScreen = screen && {
    width: screen.width,
    height: screen.height,
    avail_width: screen.availWidth,
    avail_height: screen.availHeight
  };

  let webglVendor = null;
  let webglRenderer = null;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (gl) {
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      webglVendor = clean(gl.getParameter(debug?.UNMASKED_VENDOR_WEBGL || gl.VENDOR), 256);
      webglRenderer = clean(gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL || gl.RENDERER), 256);
    }
  } catch {}

  let fontsHash = null;
  try {
    const fonts = Array.from(document.fonts || []).slice(0, 256).map(font => [
      String(font.family || ''), String(font.style || ''), String(font.weight || ''),
      String(font.stretch || ''), String(font.status || '')
    ]).sort();
    if (fonts.length) fontsHash = await digest(JSON.stringify(fonts));
  } catch {}

  let voicesHash = null;
  try {
    const voices = typeof globalThis.speechSynthesis?.getVoices === 'function'
      ? globalThis.speechSynthesis.getVoices().slice(0, 256).map(voice => [
        String(voice.name || ''), String(voice.lang || ''), String(voice.voiceURI || ''),
        Boolean(voice.default), Boolean(voice.localService)
      ]).sort()
      : [];
    if (voices.length) voicesHash = await digest(JSON.stringify(voices));
  } catch {}

  let canvasHash = null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 240; canvas.height = 60;
    const context = canvas.getContext('2d');
    if (context) {
      context.fillStyle = '#18324b'; context.fillRect(0, 0, 240, 60);
      context.fillStyle = '#d7edf7'; context.font = '16px sans-serif';
      context.textBaseline = 'middle'; context.fillText('WebEnvoy continuity', 8, 30);
      canvasHash = await digest(context.getImageData(0, 0, 240, 60).data);
    }
  } catch {}

  let audioHash = null;
  try {
    const AudioContext = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
    if (AudioContext) {
      const context = new AudioContext(1, 2048, 44100);
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const compressor = context.createDynamicsCompressor();
      oscillator.type = 'triangle'; oscillator.frequency.value = 997;
      gain.gain.value = 0.25;
      oscillator.connect(gain); gain.connect(compressor); compressor.connect(context.destination);
      oscillator.start(0); oscillator.stop(0.02);
      const rendered = await context.startRendering();
      const samples = rendered.getChannelData(0);
      const bounded = [];
      for (let index = 0; index < samples.length; index += 8) bounded.push(Math.round(samples[index] * 10000000) / 10000000);
      audioHash = await digest(JSON.stringify(bounded));
    }
  } catch {}

  return {
    language,
    languages,
    timezone,
    viewport,
    screen: normalizedScreen || null,
    hardware_concurrency: integer(navigator.hardwareConcurrency, 1024),
    device_memory: typeof navigator.deviceMemory === 'number' && Number.isFinite(navigator.deviceMemory) && navigator.deviceMemory > 0 && navigator.deviceMemory <= 1024 ? navigator.deviceMemory : null,
    webgl_vendor: webglVendor,
    webgl_renderer: webglRenderer,
    fonts_hash: fontsHash,
    voices_hash: voicesHash,
    canvas_hash: canvasHash,
    audio_hash: audioHash
  };
})()"""


def launch(request: dict[str, Any]) -> dict[str, Any]:
    global PLAYWRIGHT, PLAYWRIGHT_TIMEOUT_ERROR, CONTEXT, PAGE, NATIVE_PLAYWRIGHT_ADAPTER, PROFILE_DIR, EXECUTABLE_PATH, LAUNCH_EXECUTABLE_PATH, PROPERTIES_SOURCE, DIAGNOSTIC_EVENTS, DIAGNOSTIC_CURSOR, DIAGNOSTIC_INSTANCE_REF
    PROFILE_DIR = str(Path(str(request.get("profile_dir", ""))).absolute()) if request.get("profile_dir") else ""
    EXECUTABLE_PATH = str(request.get("executable_path", ""))
    if not PROFILE_DIR or not EXECUTABLE_PATH:
        raise ValueError("Camoufox Driver launch requires an executable and managed profile.")
    if sys.version_info[:2] != (3, 12) or importlib.metadata.version("camoufox") != CAMOUFOX_VERSION_PIN or importlib.metadata.version("playwright") != "1.60.0":
        raise ValueError("Camoufox Driver runtime does not match the qualified Python/package pins.")
    parser = configparser.ConfigParser()
    parser.read(Path(EXECUTABLE_PATH).parent.parent / "Resources" / "application.ini")
    if parser.get("App", "Version", fallback="") != BROWSER_VERSION_PIN:
        raise ValueError("Camoufox browser does not match the qualified version pin.")
    properties = Path(EXECUTABLE_PATH).parent.parent / "Resources" / "properties.json"
    if hashlib.sha256(properties.read_bytes()).hexdigest() != PROPERTIES_SHA256_PIN:
        raise ValueError("Camoufox properties.json does not match the qualified browser schema pin.")
    Path(PROFILE_DIR).mkdir(parents=True, exist_ok=True, mode=0o700)
    bundle_path = environment_bundle_path(PROFILE_DIR)
    if os.path.lexists(bundle_path):
        bundle = load_environment_bundle(PROFILE_DIR)
    else:
        if profile_has_environment_state(PROFILE_DIR):
            raise ValueError("Camoufox environment bundle is missing from a non-empty managed profile.")
        bundle = None
    LAUNCH_EXECUTABLE_PATH, PROPERTIES_SOURCE = prepare_properties(EXECUTABLE_PATH)
    from camoufox import NewBrowser, launch_options
    from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, sync_playwright
    PLAYWRIGHT_TIMEOUT_ERROR = PlaywrightTimeoutError
    NATIVE_PLAYWRIGHT_ADAPTER = native_playwright_adapter_module().install_native_playwright_driver()

    locale = request.get("locale")
    timezone = request.get("timezone")
    viewport = request.get("viewport")
    proxy_server = request.get("proxy_server")
    config = copy.deepcopy(bundle["config"]) if bundle is not None else ({"timezone": timezone} if isinstance(timezone, str) and timezone else {})
    proxy = {"server": proxy_server} if isinstance(proxy_server, str) and proxy_server else None
    window = None
    if bundle is not None:
        apply_environment_overrides(config, timezone=timezone, viewport=viewport)
    else:
        window = environment_viewport(viewport)

    target_os = {"darwin": "macos", "win32": "windows", "linux": "linux"}.get(sys.platform, "linux")
    launch_timezone = config.get("timezone") if isinstance(config.get("timezone"), str) and config.get("timezone") else None
    provider_env = {key: value for key, value in os.environ.items() if not key.startswith("CAMOU_CONFIG_")}
    firefox_prefs = {
        # Ask the native browser to keep diverted/new tabs in the background.
        # Active facts still come only from the provider's tracked focus state;
        # Agent input cannot override these provider-owned preferences.
        "browser.tabs.loadDivertedInBackground": True,
        "browser.tabs.loadInBackground": True,
        "browser.link.open_newwindow": 3,
        "focusmanager.testmode": False,
    }
    if launch_timezone:
        firefox_prefs["roverfox.s.timezone_0"] = launch_timezone
    with contextlib.redirect_stdout(sys.stderr):
        options = launch_options(
            executable_path=LAUNCH_EXECUTABLE_PATH,
            user_data_dir=PROFILE_DIR,
            headless=bool(request.get("headless", True)),
            ff_version=firefox_major(EXECUTABLE_PATH),
            os=target_os,
            locale=locale if isinstance(locale, str) and locale else None,
            window=window,
            config=config,
            timezone_id=launch_timezone,
            # The pinned default persistent context reads this cached preference
            # before CAMOU_CONFIG, even after a native timezone_id override.
            firefox_user_prefs=firefox_prefs,
            proxy=proxy,
            enable_cache=True,
            main_world_eval=True,
            i_know_what_im_doing=True,
            env=provider_env,
        )
        if bundle is None:
            bundle = save_environment_bundle(PROFILE_DIR, build_environment_bundle(extract_camoufox_config(options)))
        else:
            replay_environment_options(options, bundle, target_os, LAUNCH_EXECUTABLE_PATH)
        PLAYWRIGHT = sync_playwright().start()
        # NewBrowser is the package's public persistent-context entrypoint. It
        # also applies Camoufox's no_viewport rule when a spoofed window is
        # configured, which avoids the known Juggler viewport handshake hang.
        CONTEXT = NewBrowser(PLAYWRIGHT, from_options=options, persistent_context=True)
        reset_provider_pages()
        PAGE = CONTEXT.pages[0] if CONTEXT.pages else CONTEXT.new_page()
        for existing_page in list(getattr(CONTEXT, "pages", []) or []):
            register_provider_page(existing_page)
        if page_state_for(PAGE) is None:
            register_provider_page(PAGE)
        set_active_provider_page(PAGE)
        install_page_context_handler()
        DIAGNOSTIC_EVENTS.clear()
        DIAGNOSTIC_REQUESTS.clear()
        DIAGNOSTIC_CURSOR = 0
        DIAGNOSTIC_INSTANCE_REF = uuid.uuid4().hex
        for state in PAGE_STATES.values():
            attach_diagnostics(state["page"])
        url = request.get("url")
        if isinstance(url, str) and url:
            if request.get("operation_scope") == "profile_management":
                install_public_navigation_guard(public_origin(url))
            PAGE.goto(url, wait_until="domcontentloaded", timeout=int(request.get("timeout_ms", 5_000)))

    browser = CONTEXT.browser if CONTEXT is not None else None
    browser_version = None
    if browser is not None:
        try:
            browser_version = str(browser.version)
        except Exception:
            browser_version = None
    try:
        camoufox_version = importlib.metadata.version("camoufox")
    except importlib.metadata.PackageNotFoundError:
        camoufox_version = None
    return {
        "page": page_facts(),
        "pages": all_page_states(),
        "python_version": platform.python_version(),
        "camoufox_version": camoufox_version,
        "playwright_version": importlib.metadata.version("playwright"),
        "browser_version": browser_version,
        "properties_source": PROPERTIES_SOURCE,
    }


def open_url(request: dict[str, Any]) -> dict[str, Any]:
    if PAGE is None:
        raise RuntimeError("Camoufox Driver has no active page.")
    url = request.get("url")
    if not isinstance(url, str) or not url:
        raise ValueError("Camoufox Driver open_url requires a URL.")
    with contextlib.redirect_stdout(sys.stderr):
        if request.get("operation_scope") == "profile_management":
            install_public_navigation_guard(public_origin(url))
        PAGE.goto(url, wait_until="domcontentloaded", timeout=int(request.get("timeout_ms", 5_000)))
    return {"page": page_facts()}


def public_origin(value: str) -> str:
    try:
        parsed = urlparse(value)
        return f"{parsed.scheme}://{parsed.netloc}"
    except ValueError:
        return ""


def valid_public_origin(value: Any) -> bool:
    """Accept only an exact credential-free HTTP(S) origin."""
    if not isinstance(value, str) or not value or public_origin(value) != value:
        return False
    try:
        parsed = urlparse(value)
        return parsed.scheme in ("http", "https") and bool(parsed.netloc) and not parsed.username and not parsed.password
    except ValueError:
        return False


def authorized_origin_set(value: Any, expected: str) -> set[str] | None:
    """Validate Core's already-intersected origin set at the Driver boundary."""
    if value is None:
        allowed = {expected}
    elif isinstance(value, (list, tuple, set)) and 0 < len(value) <= 64 and all(valid_public_origin(origin) for origin in value):
        allowed = set(value)
    else:
        return None
    return allowed if expected in allowed else set()


def navigation_location(response: Any, request_url: str) -> str | None:
    headers = getattr(response, "headers", {})
    if callable(headers):
        with contextlib.suppress(Exception):
            headers = headers()
    if not isinstance(headers, dict):
        return None
    location = next((value for key, value in headers.items() if str(key).lower() == "location"), None)
    if not isinstance(location, str) or not location or len(location) > 4096:
        return None
    try:
        resolved = urljoin(request_url, location)
        parsed = urlparse(resolved)
        if parsed.scheme not in ("http", "https") or not parsed.netloc or parsed.username or parsed.password:
            return None
        return resolved
    except Exception:
        return None


def request_page(request: Any) -> Any:
    return request_page_with_fallback(request, True)


def request_native_relation(request: Any) -> dict[str, str | None] | None:
    """Read the fixed adapter relation without asking Request.frame to resolve."""
    adapter = NATIVE_PLAYWRIGHT_ADAPTER
    resolver = getattr(adapter, "request_relation", None) if adapter is not None else None
    if not callable(resolver):
        return None
    return resolver(request)


def native_context_id() -> str | None:
    """Read an optional native context id exposed by the qualified adapter."""
    implementation = getattr(CONTEXT, "_impl_obj", None) if CONTEXT is not None else None
    value = getattr(implementation, "_browser_context_id", None)
    return value if isinstance(value, str) and value else None


def state_by_native_target(target_id: Any) -> dict[str, Any] | None:
    """Resolve one live registry state by the adapter's exact target identity."""
    if not isinstance(target_id, str) or not target_id:
        return None
    live = [state for state in PAGE_STATES.values() if not state.get("closed") and state.get("native_target_id") == target_id]
    closed = [state for state in PAGE_STATES.values() if state.get("closed") and state.get("native_target_id") == target_id]
    if len(live) > 1 or len(closed) > 1 or (live and closed):
        raise RuntimeError("Native request target maps to multiple Page states.")
    if closed:
        raise RuntimeError("Native request target is closed.")
    return live[0] if live else None


def request_page_binding(request: Any) -> dict[str, Any]:
    """Return exact request/target/opener relation facts for a route guard.

    A popup can emit its first navigation before Python has received the Page
    event.  In that window ``request.frame`` is intentionally unavailable.  A
    qualified adapter relation may still identify the native target and its
    opener; an opener can supply an existing origin scope, but it never stands
    in for the popup Page itself.
    """
    relation = request_native_relation(request)
    target_page = None
    with contextlib.suppress(Exception):
        frame = request.frame
        target_page = frame.page

    target_state = page_state_for(target_page) if target_page is not None else None
    opener_state = None
    if relation is not None:
        relation_context_id = relation.get("browser_context_id")
        expected_context_id = native_context_id()
        if expected_context_id is not None and relation_context_id not in (None, expected_context_id):
            raise RuntimeError("Native request context disagrees with the active BrowserContext.")
        target_by_id = state_by_native_target(relation.get("target_id"))
        if target_state is not None:
            known_target = target_state.get("native_target_id")
            if known_target is not None and known_target != relation.get("target_id"):
                raise RuntimeError("Native request target disagrees with its Page state.")
            if target_by_id is not None and target_by_id is not target_state:
                raise RuntimeError("Native request target maps to a different Page state.")
            # The client Page object is already the exact target.  Snapshot
            # reconciliation may not have written its native id yet, so do
            # not manufacture that identity from a single request.
            target_by_id = target_state
        target_state = target_by_id
        opener_id = relation.get("opener_id")
        if opener_id is not None:
            opener_state = state_by_native_target(opener_id)
        if target_state is not None:
            expected_opener = target_state.get("opener_provider_page_ref")
            actual_opener = opener_state.get("provider_page_ref") if opener_state is not None else None
            if expected_opener is not None and actual_opener != expected_opener:
                raise RuntimeError("Native request opener disagrees with its Page state.")
            if expected_opener is None and opener_id is not None and opener_state is None:
                raise RuntimeError("Native request opener is not a live Page state.")
            target_page = target_state.get("page")
        elif opener_state is not None:
            # Deliberately leave target_page unset: the opener is only an
            # authorization ancestor while the popup's Page channel is not
            # ready/registered.
            target_page = None
    return {
        "relation": relation,
        "target_page": target_page,
        "target_state": target_state,
        "opener_state": opener_state,
    }


def request_page_with_fallback(request: Any, fallback: bool = True) -> Any:
    binding = request_page_binding(request)
    page = binding.get("target_page")
    if page is not None:
        return page
    # Once the adapter has supplied a relation, falling back to PAGE would
    # silently authorize a popup against an unrelated active Page.
    if binding.get("relation") is not None:
        return None
    return PAGE if fallback else None


def mark_request_navigation_denied(binding: dict[str, Any], failure: str) -> None:
    state = binding.get("target_state")
    if isinstance(state, dict):
        ref = state.get("provider_page_ref")
        if isinstance(ref, str) and ref:
            PAGE_NAVIGATION_DENIED[ref] = failure
            return
    relation = binding.get("relation")
    target_id = relation.get("target_id") if isinstance(relation, dict) else None
    if not isinstance(target_id, str) or not target_id:
        return
    if target_id not in NATIVE_REQUEST_DENIED_BY_TARGET and len(NATIVE_REQUEST_DENIED_BY_TARGET) >= NATIVE_REQUEST_DENIED_LIMIT:
        oldest = next(iter(NATIVE_REQUEST_DENIED_BY_TARGET), None)
        if oldest is not None:
            NATIVE_REQUEST_DENIED_BY_TARGET.pop(oldest, None)
    NATIVE_REQUEST_DENIED_BY_TARGET[target_id] = failure


def page_opener(page: Any) -> Any:
    """Read the provider's opener relation without guessing from URL/title."""
    if page is None:
        return None
    with contextlib.suppress(Exception):
        opener = getattr(page, "opener", None)
        if callable(opener):
            opener = opener()
        return opener
    return None


def ensure_provider_page(page: Any) -> dict[str, Any] | None:
    """Register a Page discovered by a context route and retain its opener ref."""
    if page is None:
        return None
    state = page_state_for(page)
    opener = page_opener(page)
    if state is None:
        state = register_provider_page(page, opener)
    elif opener is not None and not state.get("opener_provider_page_ref"):
        opener_ref = provider_page_ref(opener)
        if opener_ref:
            state["opener_provider_page_ref"] = opener_ref
    return state


def inherited_page_origins(mapping: dict[str, set[str]], page: Any) -> set[str] | None:
    """Resolve a page's own or opener-inherited origin scope.

    A missing mapping is intentionally different from an empty mapping.  The
    former means this Page is outside the operation scope; the latter is an
    explicit deny-all scope.  Opener traversal is bounded and identity based.
    """
    state = ensure_provider_page(page)
    if state is None or state.get("closed"):
        return None
    visited: set[str] = set()
    while state is not None:
        ref = state.get("provider_page_ref")
        if not isinstance(ref, str) or not ref or ref in visited:
            return None
        visited.add(ref)
        allowed = mapping.get(ref)
        if allowed is not None:
            return allowed
        opener_ref = state.get("opener_provider_page_ref")
        state = PAGE_STATES.get(opener_ref) if isinstance(opener_ref, str) else None
        if state is not None and state.get("closed"):
            return None
    return None


def request_redirect_hops(request: Any) -> int:
    hops = 0
    current = request
    seen: set[int] = set()
    while current is not None and id(current) not in seen and hops < 16:
        seen.add(id(current))
        with contextlib.suppress(Exception):
            current = current.redirected_from
            hops += 1
            continue
        break
    return hops


def follow_authorized_redirect(route: Any, response: Any, request: Any, allowed: set[str], denied: str) -> bool:
    """Follow one redirect in the browser after validating its actual target.

    Playwright's route.fetch(max_redirects=0) gives us the Location response
    without sending the next hop. The pinned 1.60 API exposes the private
    redirected-navigation continuation used here; falling back to continue()
    would lose the preflight boundary, so an unqualified runtime is rejected.
    """
    location = navigation_location(response, str(getattr(request, "url", "")))
    destination_origin = public_origin(location) if location else ""
    # A redirect continuation must stay bound to the Page that produced the
    # request. Falling back to the global active Page could attach a redirect
    # failure to an unrelated window when Playwright cannot resolve a frame.
    binding = request_page_binding(request)
    if not location or destination_origin not in allowed or request_redirect_hops(request) >= 8:
        mark_request_navigation_denied(binding, denied)
        route.abort("blockedbyclient")
        return False
    implementation = getattr(route, "_impl_obj", None)
    continuation = getattr(implementation, "_redirected_navigation_request", None)
    sync = getattr(route, "_sync", None)
    if not callable(continuation) or not callable(sync):
        mark_request_navigation_denied(binding, "navigation_guard_unavailable")
        route.abort("failed")
        return False
    try:
        sync(continuation(location))
        return True
    except Exception:
        mark_request_navigation_denied(binding, "navigation_guard_unavailable")
        route.abort("failed")
        return False


def install_page_navigation_guard(page: Any, authorized_origins: list[str] | tuple[str, ...] | set[str]) -> None:
    """Install a per-Page, per-hop origin guard for page.* navigation."""
    global PAGE_NAVIGATION_CONTEXT_GUARD
    state = page_state_for(page) or register_provider_page(page)
    page_ref = state["provider_page_ref"]
    allowed = {origin for origin in authorized_origins if isinstance(origin, str) and public_origin(origin) == origin}
    PAGE_NAVIGATION_ALLOWED_ORIGINS[page_ref] = allowed
    PAGE_NAVIGATION_DENIED.pop(page_ref, None)

    # A Page route outranks the active interaction context guard only on the
    # Page currently bound to that interaction. Background Page navigation
    # still needs its own route while the active interaction is on another
    # Page; its scope is independent and remains exact to this Page.
    if INTERACTION_GUARD is not None and page is INTERACTION_GUARD_PAGE:
        # The shared per-Page map above is the latest Core-authorized scope;
        # the already-attached interaction handler evaluates it directly.
        previous = PAGE_NAVIGATION_GUARDS.pop(page_ref, None)
        if previous is not None:
            with contextlib.suppress(Exception):
                page.unroute("**/*", previous)
        return

    def guard(route: Any) -> None:
        request = route.request
        binding = request_page_binding(request)
        request_page_object = binding.get("target_page")
        if binding.get("relation") is not None and request_page_object is None:
            # A Page route must not use its closure-bound Page to authorize an
            # unregistered popup target. The context guard may authorize it
            # from a proven opener relation instead.
            mark_request_navigation_denied(binding, "navigation_guard_unavailable")
            route.abort("failed")
            return
        request_page_object = request_page_object or page
        if request_page_object is not page:
            route.continue_()
            return
        request_origin = public_origin(str(getattr(request, "url", "")))
        request_page_ref = provider_page_ref(request_page_object) or page_ref
        request_allowed = inherited_page_origins(PAGE_NAVIGATION_ALLOWED_ORIGINS, request_page_object)
        # This handler is attached to one known Page. If Playwright cannot
        # resolve the frame, the closure-bound Page is the only safe identity;
        # it is never replaced by the global active Page.
        if request_allowed is None:
            request_allowed = allowed if request_page_object is page else None
        if request_allowed is None or request_origin not in request_allowed:
            mark_request_navigation_denied(binding, "navigation_origin_denied")
            route.abort("blockedbyclient")
            return
        response = None
        try:
            response = route.fetch(max_redirects=0, timeout=15_000)
            status = int(getattr(response, "status", 0))
            if 300 <= status < 400:
                follow_authorized_redirect(route, response, request, request_allowed, "navigation_origin_denied")
            else:
                route.fulfill(response=response)
        except Exception:
            mark_request_navigation_denied(binding, "navigation_guard_unavailable")
            with contextlib.suppress(Exception):
                route.abort("failed")
        finally:
            if response is not None:
                with contextlib.suppress(Exception):
                    response.dispose()

    previous = PAGE_NAVIGATION_GUARDS.get(page_ref)
    if previous is not None:
        with contextlib.suppress(Exception):
            page.unroute("**/*", previous)
    PAGE_NAVIGATION_GUARDS[page_ref] = guard
    with contextlib.suppress(Exception):
        page.route("**/*", guard)

    if PAGE_NAVIGATION_CONTEXT_GUARD is None and CONTEXT is not None:
        def context_guard(route: Any) -> None:
            request = route.request
            try:
                binding = request_page_binding(request)
            except Exception:
                with contextlib.suppress(Exception):
                    route.abort("failed")
                return
            relation = binding.get("relation")
            target_page = binding.get("target_page")
            target_state = binding.get("target_state")
            opener_state = binding.get("opener_state")
            if relation is None:
                if target_state is None and target_page is None:
                    # A legacy request with no Page relation is outside this
                    # context guard; do not turn the guard into a global proxy.
                    route.continue_()
                    return
                if target_state is None and page_opener(target_page) is not None:
                    # A context route can win the race with Playwright's
                    # ``page`` event. Register only when the browser proves an
                    # opener; an unrelated unknown Page remains out of scope.
                    target_state = ensure_provider_page(target_page)
            elif target_state is None and opener_state is None:
                # A native relation with no live target or opener is not a
                # legacy request. It cannot be authorized or attributed.
                mark_request_navigation_denied(binding, "navigation_guard_unavailable")
                route.abort("failed")
                return

            if relation is not None and target_state is None and opener_state is not None:
                # The popup target may not have a Page channel yet. The opener
                # supplies only the inherited scope; it never becomes target.
                allowed_for_request = inherited_page_origins(
                    PAGE_NAVIGATION_ALLOWED_ORIGINS, opener_state.get("page")
                )
            else:
                allowed_for_request = inherited_page_origins(
                    PAGE_NAVIGATION_ALLOWED_ORIGINS, target_page
                ) if target_state is not None and target_page is not None else None
            request_origin = public_origin(str(getattr(request, "url", "")))
            if allowed_for_request is None:
                # The context guard only owns Pages participating in a page
                # operation (or a popup with a known in-scope opener).
                route.continue_()
                return
            if request_origin not in allowed_for_request:
                mark_request_navigation_denied(binding, "navigation_origin_denied")
                route.abort("blockedbyclient")
                return
            response = None
            try:
                response = route.fetch(max_redirects=0, timeout=15_000)
                status = int(getattr(response, "status", 0))
                if 300 <= status < 400:
                    follow_authorized_redirect(route, response, request, allowed_for_request, "navigation_origin_denied")
                else:
                    route.fulfill(response=response)
            except Exception:
                mark_request_navigation_denied(binding, "navigation_guard_unavailable")
                with contextlib.suppress(Exception):
                    route.abort("failed")
            finally:
                if response is not None:
                    with contextlib.suppress(Exception):
                        response.dispose()
        PAGE_NAVIGATION_CONTEXT_GUARD = context_guard
        with contextlib.suppress(Exception):
            CONTEXT.route("**/*", context_guard)


def page_navigation_failure(page: Any) -> str | None:
    ref = provider_page_ref(page)
    return PAGE_NAVIGATION_DENIED.get(ref) if ref else None


def page_navigation_state(page: Any) -> dict[str, Any]:
    state = page_state_for(page) or register_provider_page(page)
    facts = page_state_facts(state)
    failure = page_navigation_failure(page)
    if failure:
        facts["status"] = "failed"
        facts["error"] = {"code": "url_unreachable", "message": failure, "retryable": False}
    return facts


def refresh_native_selected_page() -> None:
    """Reconcile active state from the provider's native window selection."""
    global PAGE, NATIVE_RELATION_EPOCH, NATIVE_RELATION_SAMPLE_SEQUENCE, NATIVE_RELATION_INVALID
    if NATIVE_PLAYWRIGHT_ADAPTER is None or CONTEXT is None:
        return
    if NATIVE_RELATION_INVALID:
        raise RuntimeError("Native Page relation is permanently unavailable after an identity replacement.")
    browser = getattr(CONTEXT, "browser", None)
    selection = NATIVE_PLAYWRIGHT_ADAPTER.native_snapshot(browser, CONTEXT)
    if not isinstance(selection, dict):
        raise RuntimeError("Native selected-window snapshot returned no relation.")
    if selection.get("selection_status") == "partial":
        raise RuntimeError("Native selected-window snapshot is incomplete.")
    epoch = selection.get("epoch")
    sample_sequence = selection.get("sample_sequence")
    if not isinstance(epoch, str) or not epoch or type(sample_sequence) is not int or sample_sequence < 1:
        raise RuntimeError("Native selected-window snapshot returned no freshness relation.")
    if NATIVE_RELATION_EPOCH is not None and epoch != NATIVE_RELATION_EPOCH:
        raise RuntimeError("Native selected-window snapshot changed its relation epoch.")
    if sample_sequence <= NATIVE_RELATION_SAMPLE_SEQUENCE:
        raise RuntimeError("Native selected-window snapshot is stale.")
    native_pages = selection.get("pages")
    if not isinstance(native_pages, list):
        raise RuntimeError("Native selected-window snapshot returned no Page facts.")

    # Resolve every native fact before mutating any state. A BrowserContext can
    # expose a fresh Page wrapper after a native target replacement; matching by
    # URL or title would silently turn that replacement into a close+open.
    previous_by_browsing_context: dict[str, list[dict[str, Any]]] = {}
    for candidate in PAGE_STATES.values():
        browsing_context_id = candidate.get("native_browsing_context_id")
        if isinstance(browsing_context_id, str) and browsing_context_id:
            previous_by_browsing_context.setdefault(browsing_context_id, []).append(candidate)

    mapped: list[tuple[dict[str, Any], dict[str, Any]]] = []
    mapped_states: set[int] = set()
    for native_facts in native_pages:
        native_page = native_facts.get("page") if isinstance(native_facts, dict) else None
        state = page_state_for(native_page)
        if state is None or state.get("closed"):
            browsing_context_id = native_facts.get("browsing_context_id") if isinstance(native_facts, dict) else None
            candidates = previous_by_browsing_context.get(browsing_context_id, []) if isinstance(browsing_context_id, str) else []
            target_id = native_facts.get("target_id") if isinstance(native_facts, dict) else None
            if candidates and any(candidate.get("page") is not native_page for candidate in candidates):
                NATIVE_RELATION_INVALID = True
                raise RuntimeError("Native browsing context moved to a replacement Page object.")
            if candidates and any(candidate.get("native_target_id") not in (None, target_id) for candidate in candidates):
                NATIVE_RELATION_INVALID = True
                raise RuntimeError("Native browsing context moved to a different target or Page object.")
            raise RuntimeError("Native selected-window snapshot returned an unknown Page relation.")
        if not all(isinstance(native_facts.get(key), str) and native_facts.get(key) for key in ("target_id", "tab_id", "browsing_context_id", "window_id")):
            raise RuntimeError("Native selected-window snapshot returned incomplete Page identity.")
        if id(state) in mapped_states:
            raise RuntimeError("Native selected-window snapshot mapped one Page more than once.")
        mapped_states.add(id(state))
        for prior in previous_by_browsing_context.get(native_facts["browsing_context_id"], []):
            if prior is state:
                continue
            if prior.get("native_target_id") != native_facts["target_id"]:
                NATIVE_RELATION_INVALID = True
                raise RuntimeError("Native browsing context moved to a different target or Page object.")
            raise RuntimeError("Native browsing context is mapped to multiple Page objects.")
        identity_pairs = (
            ("native_target_id", "target_id"),
            ("native_tab_id", "tab_id"),
            ("native_browsing_context_id", "browsing_context_id"),
            ("native_window_id", "window_id"),
        )
        for state_key, fact_key in identity_pairs:
            previous = state.get(state_key)
            if previous is not None and previous != native_facts[fact_key]:
                NATIVE_RELATION_INVALID = True
                raise RuntimeError("Native Page identity changed across samples.")
        mapped.append((state, native_facts))

    open_states = [state for state in PAGE_STATES.values() if not state.get("closed")]
    if any(id(state) not in mapped_states for state in open_states):
        raise RuntimeError("Native selected-window snapshot omitted an open Page.")

    window_foreground = {
        window["window_id"]: window.get("os_foreground")
        for window in selection.get("windows", [])
        if isinstance(window, dict) and isinstance(window.get("window_id"), str)
    }
    selected_pages = [facts for _, facts in mapped if facts.get("selected") is True]
    active_window_id = selection.get("active_window_id")
    active_candidates = [facts for facts in selected_pages if facts.get("window_id") == active_window_id]
    if active_window_id is not None and len(active_candidates) != 1:
        raise RuntimeError("Native selected-window snapshot did not prove one active-window Page.")

    # Commit only after the full bidirectional relation and freshness checks
    # pass. This preserves the last trusted native identities on any failure.
    for candidate in open_states:
        candidate["native_selected"] = False
        candidate["native_active"] = False
    for state, native_facts in mapped:
        if state.get("closed"):
            raise RuntimeError("Native selected-window snapshot retained a closed Page.")
        state["native_selected"] = native_facts["selected"] is True
        state["native_window_id"] = native_facts["window_id"]
        state["native_tab_id"] = native_facts["tab_id"]
        state["native_target_id"] = native_facts["target_id"]
        state["native_browsing_context_id"] = native_facts["browsing_context_id"]
        state["native_os_foreground"] = window_foreground.get(native_facts["window_id"])
        pending_failure = NATIVE_REQUEST_DENIED_BY_TARGET.pop(native_facts["target_id"], None)
        if pending_failure:
            PAGE_NAVIGATION_DENIED[state["provider_page_ref"]] = pending_failure
    for candidate in PAGE_STATES.values():
        if candidate.get("closed") and id(candidate) not in mapped_states:
            if candidate.get("native_browsing_context_id"):
                candidate["native_close_confirmed"] = True
            candidate["native_selected"] = False
            candidate["native_active"] = False
    NATIVE_RELATION_EPOCH = epoch
    NATIVE_RELATION_SAMPLE_SEQUENCE = sample_sequence
    if active_window_id is not None:
        active_state = next((state for state, facts in mapped if facts is active_candidates[0]), None)
        if active_state is None or active_state.get("closed"):
            raise RuntimeError("Native selected-window snapshot returned an unusable active Page.")
        active_state["native_active"] = True
        PAGE = active_candidates[0]["page"]
    elif PAGE is not None and page_state_for(PAGE) is not None and (page_state_for(PAGE) or {}).get("native_selected") is True:
        # Another application may be in front; retain the prior task Page
        # rather than treating OS foreground absence as a browser failure.
        pass
    elif not selected_pages:
        PAGE = None


def list_pages() -> dict[str, Any]:
    refresh_native_selected_page()
    return {"pages": all_page_states()}


def open_page(request: dict[str, Any]) -> dict[str, Any]:
    if CONTEXT is None:
        raise RuntimeError("Camoufox Driver has no active context.")
    url = request.get("url")
    if url is not None and (not isinstance(url, str) or not url):
        raise ValueError("Camoufox Driver open_page URL is invalid.")
    if NATIVE_PLAYWRIGHT_ADAPTER is None:
        raise RuntimeError("Camoufox Driver native background Page adapter is unavailable.")
    with contextlib.redirect_stdout(sys.stderr):
        # The provider's BrowserContext.newPage opens a new native window and
        # focuses it. Use only a window identity just reconciled from native
        # gBrowser tabs, and ask the fixed adapter to add an unfocused tab to
        # that existing window.
        refresh_native_selected_page()
        owner_state = page_state_for(PAGE)
        window_id = owner_state.get("native_window_id") if owner_state else None
        if not isinstance(window_id, str) or not window_id:
            raise RuntimeError("Camoufox Driver has no trusted native window for a background Page.")
        page = NATIVE_PLAYWRIGHT_ADAPTER.create_background_page(CONTEXT, window_id)
        register_provider_page(page)
        with contextlib.suppress(Exception):
            attach_diagnostics(page)
        if isinstance(url, str):
            install_page_navigation_guard(page, request.get("authorized_origins", []))
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=int(request.get("timeout_ms", 15_000)))
            except Exception:
                if not page_navigation_failure(page):
                    raise
        refresh_native_selected_page()
    failure = page_navigation_failure(page)
    return {"page": page_navigation_state(page), "pages": all_page_states(), **({"failure_class": failure} if failure else {})}


def activate_page(request: dict[str, Any]) -> dict[str, Any]:
    state = page_by_provider_ref(request.get("provider_page_ref"))
    if state is None or state.get("closed"):
        raise ValueError("Camoufox Driver Page handle is stale.")
    with contextlib.redirect_stdout(sys.stderr):
        facts = set_active_provider_page(state["page"])
    return {"page": facts, "pages": all_page_states()}


def close_page(request: dict[str, Any]) -> dict[str, Any]:
    state = page_by_provider_ref(request.get("provider_page_ref"))
    if state is None or state.get("closed"):
        raise ValueError("Camoufox Driver Page handle is stale.")
    page = state["page"]
    safe_return_ref = request.get("safe_return_provider_page_ref")
    safe_return_state = None
    if safe_return_ref is not None:
        if not isinstance(safe_return_ref, str) or not safe_return_ref:
            raise ValueError("Camoufox Driver safe return Page handle is invalid.")
        safe_return_state = page_by_provider_ref(safe_return_ref)
        if safe_return_state is None or safe_return_state.get("closed") or safe_return_state is state:
            raise ValueError("Camoufox Driver safe return Page handle is stale.")
        safe_return_page = safe_return_state.get("page")
        if safe_return_page is None or getattr(safe_return_page, "is_closed", lambda: False)():
            raise ValueError("Camoufox Driver safe return Page is unavailable.")
    with contextlib.redirect_stdout(sys.stderr):
        if safe_return_state is not None:
            if NATIVE_PLAYWRIGHT_ADAPTER is None or CONTEXT is None:
                raise RuntimeError("Camoufox Driver native safe-return close is unavailable.")
            # The native entry validates both target identities against the
            # same BrowserContext and native window, selects the safe tab via
            # gBrowser.selectedTab without focusing its OS window, then uses
            # the browser's real removeTab path with beforeunload semantics.
            refresh_native_selected_page()
            target_id = state.get("native_target_id")
            safe_target_id = safe_return_state.get("native_target_id")
            if not isinstance(target_id, str) or not target_id or not isinstance(safe_target_id, str) or not safe_target_id:
                raise RuntimeError("Camoufox Driver native close relation is unavailable.")
            NATIVE_PLAYWRIGHT_ADAPTER.close_page_with_safe_return(CONTEXT, target_id, safe_target_id)
        else:
            page.close()
    # Playwright may not emit close synchronously on a mocked page.
    state["closed"] = True
    state["closed_at"] = time.monotonic()
    state["native_close_confirmed"] = False
    PAGE_STATE_BY_OBJECT.pop(id(page), None)
    if NATIVE_PLAYWRIGHT_ADAPTER is not None:
        refresh_native_selected_page()
    if safe_return_state is not None:
        current_safe = page_state_for(safe_return_state["page"])
        if current_safe is None or current_safe.get("closed") or PAGE is not current_safe.get("page") or current_safe.get("native_active") is not True:
            raise RuntimeError("Camoufox Driver did not select the safe return Page during close.")
    return {"pages": live_page_states(), "confirmed_closed_provider_page_refs": [state["provider_page_ref"]]}


def navigate_page(request: dict[str, Any]) -> dict[str, Any]:
    state = page_by_provider_ref(request.get("provider_page_ref"))
    if state is None or state.get("closed"):
        raise ValueError("Camoufox Driver Page handle is stale.")
    page = state["page"]
    action = request.get("action")
    if action not in ("navigate", "reload", "back", "forward"):
        raise ValueError("Camoufox Driver Page navigation action is unsupported.")
    allowed = request.get("authorized_origins", [])
    install_page_navigation_guard(page, allowed)
    state.pop("beforeunload_blocked", None)
    with contextlib.redirect_stdout(sys.stderr):
        try:
            if NATIVE_PLAYWRIGHT_ADAPTER is not None:
                # Navigation is a Provider mutation. Reconcile immediately
                # before dispatch and require the exact Page object still to
                # own the requested private binding; URL/title or stale native
                # IDs are not sufficient after a target replacement.
                refresh_native_selected_page()
                current_state = page_state_for(page)
                if current_state is not state or current_state.get("closed"):
                    raise RuntimeError("Native Page relation unavailable before navigation.")
            if action == "navigate":
                url = request.get("url")
                if not isinstance(url, str) or not url:
                    raise ValueError("Camoufox Driver navigate requires a URL.")
                page.goto(url, wait_until="domcontentloaded", timeout=int(request.get("timeout_ms", 15_000)))
            elif action == "reload":
                page.reload(wait_until="domcontentloaded", timeout=int(request.get("timeout_ms", 15_000)))
            elif action == "back":
                page.go_back(wait_until="domcontentloaded", timeout=int(request.get("timeout_ms", 15_000)))
            else:
                page.go_forward(wait_until="domcontentloaded", timeout=int(request.get("timeout_ms", 15_000)))
        except Exception:
            if not page_navigation_failure(page):
                raise
    if state.pop("beforeunload_blocked", False):
        PAGE_NAVIGATION_DENIED[state["provider_page_ref"]] = "navigation_beforeunload_blocked"
    failure = page_navigation_failure(page)
    return {"page": page_navigation_state(page), "pages": all_page_states(), **({"failure_class": failure} if failure else {})}


def install_public_navigation_guard(expected_origin: str, page: Any = None) -> None:
    """Install a single-origin guard on one exact Page object."""
    page = PAGE if page is None else page
    if page is None:
        raise RuntimeError("Camoufox Driver has no Page for public navigation.")
    state = page_state_for(page) or register_provider_page(page)
    page_ref = state["provider_page_ref"]
    previous = PUBLIC_NAVIGATION_GUARDS.get(page_ref)
    previous_origin = PUBLIC_NAVIGATION_ALLOWED_ORIGINS.get(page_ref)
    PUBLIC_NAVIGATION_ALLOWED_ORIGINS[page_ref] = expected_origin
    PUBLIC_NAVIGATION_DENIED.pop(page_ref, None)
    if previous is not None and previous_origin == expected_origin:
        return
    if previous is not None:
        with contextlib.suppress(Exception):
            page.unroute("**/*", previous)

    def guard(route: Any) -> None:
        request = route.request
        try:
            if not request.is_navigation_request():
                route.continue_()
                return
            # A Page route is already scoped by Playwright to this Page. Use
            # the exact relation when available, but retain the closure's
            # Page only for the legacy no-relation path.
            binding = request_page_binding(request)
            request_page_object = binding.get("target_page")
            if binding.get("relation") is not None and request_page_object is None:
                PUBLIC_NAVIGATION_DENIED[page_ref] = "managed_public_navigation_unavailable"
                mark_request_navigation_denied(binding, "navigation_guard_unavailable")
                route.abort("failed")
                return
            if request_page_object is not None and request_page_object is not page:
                route.continue_()
                return
            frame = None
            with contextlib.suppress(Exception):
                frame = request.frame
            if frame is not None and frame is not page.main_frame:
                route.continue_()
                return
            request_origin = public_origin(str(getattr(request, "url", "")))
            if request_origin != expected_origin or request.method != "GET":
                PUBLIC_NAVIGATION_DENIED[page_ref] = "managed_public_navigation_blocked"
                route.abort("blockedbyclient")
                return
            # Playwright does not route redirected requests individually. Intercept
            # this original Page navigation response without following ANY redirect,
            # then render it in the same Page. Never export the response body.
            response = None
            try:
                response = route.fetch(max_redirects=0, timeout=15_000)
                if 300 <= response.status < 400:
                    PUBLIC_NAVIGATION_DENIED[page_ref] = "managed_public_redirect_blocked"
                    route.abort("blockedbyclient")
                else:
                    route.fulfill(response=response)
            except Exception:
                PUBLIC_NAVIGATION_DENIED[page_ref] = "managed_public_navigation_unavailable"
                route.abort("failed")
            finally:
                if response is not None:
                    response.dispose()
        except Exception:
            PUBLIC_NAVIGATION_DENIED[page_ref] = "managed_public_navigation_unavailable"
            with contextlib.suppress(Exception):
                route.abort("failed")
    PUBLIC_NAVIGATION_GUARDS[page_ref] = guard
    page.route("**/*", guard)


def public_navigation_failure(page: Any) -> str | None:
    ref = provider_page_ref(page)
    return PUBLIC_NAVIGATION_DENIED.get(ref) if ref else None


def clear_public_navigation_guard() -> dict[str, Any]:
    for page_ref, guard in list(PUBLIC_NAVIGATION_GUARDS.items()):
        state = PAGE_STATES.get(page_ref)
        page = state.get("page") if state else None
        if page is not None:
            with contextlib.suppress(Exception):
                page.unroute("**/*", guard)
    PUBLIC_NAVIGATION_GUARDS.clear()
    PUBLIC_NAVIGATION_ALLOWED_ORIGINS.clear()
    PUBLIC_NAVIGATION_DENIED.clear()
    clear_interaction_guard()
    return {"cleared": True}


def managed_public_page(request: dict[str, Any]) -> dict[str, Any]:
    expected = request.get("expected_origin")
    if not isinstance(expected, str) or public_origin(expected) != expected:
        return {"failure_class": "managed_public_origin_denied"}
    state, selection_failure = managed_page_state(request, "page_selection_required", "managed_public_page_unavailable")
    if selection_failure:
        return {"failure_class": selection_failure}
    assert state is not None
    page = state["page"]
    target = request.get("url")
    with contextlib.redirect_stdout(sys.stderr):
        if target is not None:
            if not isinstance(target, str) or public_origin(target) != expected:
                return {"failure_class": "managed_public_origin_denied"}
            install_public_navigation_guard(expected, page)
            try:
                page.goto(target, wait_until="domcontentloaded", timeout=15_000)
            except Exception:
                failure = public_navigation_failure(page)
                if failure:
                    return {"failure_class": failure, "page": facts_for_page(page)}
                raise
        if public_origin(str(page.url)) != expected:
            return {"failure_class": "managed_public_navigation_redirected" if target is not None else "managed_public_origin_denied", "page": facts_for_page(page)}
        if target is not None:
            return {"page": facts_for_page(page)}
        install_public_navigation_guard(expected, page)
        # Fixed read-only expression. No selectors, expressions or script from an Agent.
        observed = page.evaluate("""mw:(expected => {
          if (location.origin !== expected) return null;
          const root = document.querySelector('main, article') || document.body;
          if (!root) return null;
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          const parts = []; let length = 0, truncated = false, node;
          while ((node = walker.nextNode())) {
            const el = node.parentElement;
            if (!el || el.closest('script,style,noscript,input,textarea,select,button,form,[contenteditable],[hidden],[aria-hidden="true"]')) continue;
            const style = getComputedStyle(el);
            if (style.display === 'none' || style.visibility !== 'visible' || !el.getClientRects().length) continue;
            const text = node.textContent.replace(/\\s+/g, ' ').trim();
            if (!text) continue;
            parts.push(text); length += text.length + 1;
            if (length > 4096) { truncated = true; break; }
          }
          return { text: parts.join(' ').slice(0, 4096), truncated };
        })""", expected)
        if public_origin(str(page.url)) != expected or not isinstance(observed, dict):
            return {"failure_class": "managed_public_origin_denied"}
        text = public_text(observed.get("text"), 4096)
        if not text:
            return {"failure_class": "managed_public_content_unavailable"}
        return {"page": facts_for_page(page), "text": text, "truncated": observed.get("truncated") is True}


def managed_observe(request: dict[str, Any]) -> Any:
    expected = request.get("expected_origin")
    if expected is not None:
        if not isinstance(expected, str) or public_origin(expected) != expected:
            raise ValueError("managed_observation_origin_denied")
    state, selection_failure = managed_page_state(request, "page_selection_required", "managed_observation_unavailable")
    if selection_failure:
        raise ValueError(selection_failure)
    assert state is not None
    page = state["page"]
    if expected is not None and public_origin(str(page.url)) != expected:
        raise ValueError("managed_observation_origin_denied")
    expression = request.get("expression")
    if not isinstance(expression, str) or not expression:
        raise ValueError("managed_observation_expression_invalid")
    with contextlib.redirect_stdout(sys.stderr):
        observation = page.evaluate("mw:" + expression)
    if expected is not None and public_origin(str(page.url)) != expected:
        raise ValueError("managed_observation_origin_denied")
    return observation


# This handle is never installed on window. The observer and ElementHandles stay
# private to the Driver, so a page cannot supply its own target map or generation.
INTERACTION_SNAPSHOT_EXPRESSION = r"""() => {
  const doc = document;
  let changed = false;
  const observer = new MutationObserver(() => { changed = true; });
  observer.observe(doc, {subtree:true, childList:true, attributes:true, characterData:true});
  const sensitive = /password|passwd|token|cookie|secret|credential|authorization|one.time|验证码|密码|口令|密钥/i;
  const clean = (value, limit) => {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length <= limit && !sensitive.test(text) ? text : '';
  };
  const visible = el => {
    if (!el?.isConnected || el.closest('[hidden],[aria-hidden="true"],dialog:not([open])')) return false;
    const rect = el.getBoundingClientRect();
    let left=Math.max(0,rect.left), top=Math.max(0,rect.top), right=Math.min(innerWidth,rect.right), bottom=Math.min(innerHeight,rect.bottom);
    for (let node=el; node; node=node.parentElement) {
      const style=getComputedStyle(node);
      if (style.visibility !== 'visible' || style.display === 'none' || Number(style.opacity) === 0) return false;
      if (node !== el && /auto|scroll|hidden|clip/.test(style.overflowX + style.overflowY)) {
        const clip=node.getBoundingClientRect();
        left=Math.max(left,clip.left); right=Math.min(right,clip.right); top=Math.max(top,clip.top); bottom=Math.min(bottom,clip.bottom);
      }
    }
    return right > left && bottom > top;
  };
  const describe = el => {
    if (!visible(el)) return null;
    const tag = el.tagName.toLowerCase(), type = (el.getAttribute('type') || 'text').toLowerCase();
    const name = clean(el.getAttribute('aria-label') ||
      (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).map(id => doc.getElementById(id)?.innerText || '').join(' ').trim() ||
      Array.from(el.labels || []).map(label => label.innerText).join(' ') ||
      (tag === 'input' || tag === 'textarea' ? el.getAttribute('placeholder') : el.innerText), 160);
    if (!name || sensitive.test([name, el.id, el.getAttribute('name'), el.getAttribute('autocomplete'), type].join(' '))) return null;
    const editable = tag === 'textarea' || tag === 'input' && ['text','search','number'].includes(type);
    const role = el.getAttribute('role') || (editable ? 'textbox' : tag === 'button' || tag === 'input' && ['button','submit','reset'].includes(type) ? 'button' : tag === 'a' ? 'link' : '');
    if (!['textbox','button','link','checkbox','radio','region'].includes(role)) return null;
    if (role === 'textbox' && !editable) return null;
    const enabled = !el.matches(':disabled') && el.getAttribute('aria-disabled') !== 'true' && (!editable || !el.readOnly);
    return {role, name, enabled, ...(editable ? {value:clean(el.value, 512)} : {})};
  };
  const nodes = [], controls = [];
  let truncated = false;
  const candidates = doc.querySelectorAll('input,textarea,button,a[href],[role]');
  for (let index=0; index < Math.min(candidates.length, 2048); index++) {
    const item = describe(candidates[index]);
    if (!item) continue;
    if (nodes.length >= 64) { truncated=true; break; }
    nodes.push(candidates[index]); controls.push(item);
  }
  truncated ||= candidates.length > 2048;
  const readText = () => {
    if (!doc.body) return '';
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    const parts=[]; let node, count=0, length=0;
    while ((node=walker.nextNode()) && count++ < 10000) {
      const el=node.parentElement;
      if (!el || !visible(el) || el.closest('script,style,noscript,input,textarea,select,[contenteditable]')) continue;
      const text=clean(node.textContent, 1024);
      if (!text) continue;
      parts.push(text); length += text.length+1;
      if (length > 4096) { truncated=true; break; }
    }
    return parts.join(' ').slice(0,4096);
  };
  const text=readText();
  return {doc, nodes, controls, text, truncated,
    valid: () => { changed ||= observer.takeRecords().length > 0 || nodes.some((el,index) => JSON.stringify(describe(el)) !== JSON.stringify(controls[index])); return doc === document && !changed; },
    sameDocument: () => doc === document,
    describe, readText, dispose: () => observer.disconnect()};
}"""


def discard_interaction_snapshot() -> None:
    global INTERACTION_STATE
    if INTERACTION_STATE is not None:
        with contextlib.suppress(Exception):
            INTERACTION_STATE["handle"].evaluate("state => state.dispose()")
        for handle in INTERACTION_STATE["targets"].values():
            with contextlib.suppress(Exception):
                handle.dispose()
        with contextlib.suppress(Exception):
            INTERACTION_STATE["handle"].dispose()
    INTERACTION_STATE = None


def clear_interaction_guard() -> None:
    global INTERACTION_GUARD, INTERACTION_GUARD_PAGE, INTERACTION_DENIED
    if INTERACTION_GUARD is not None:
        if INTERACTION_GUARD_PAGE is not None:
            with contextlib.suppress(Exception):
                INTERACTION_GUARD_PAGE.unroute("**/*", INTERACTION_GUARD)
        if CONTEXT is not None:
            with contextlib.suppress(Exception):
                CONTEXT.unroute("**/*", INTERACTION_GUARD)
    INTERACTION_GUARD = None
    INTERACTION_GUARD_PAGE = None
    INTERACTION_DENIED = None
    discard_interaction_snapshot()


def detach_public_navigation_guard_for_interaction() -> None:
    """Remove public-page guards before a multi-origin interaction."""
    for page_ref, guard in list(PUBLIC_NAVIGATION_GUARDS.items()):
        state = PAGE_STATES.get(page_ref)
        page = state.get("page") if state else None
        if page is not None:
            with contextlib.suppress(Exception):
                page.unroute("**/*", guard)
    PUBLIC_NAVIGATION_GUARDS.clear()
    PUBLIC_NAVIGATION_ALLOWED_ORIGINS.clear()
    PUBLIC_NAVIGATION_DENIED.clear()


def detach_page_navigation_guards_for_interaction() -> None:
    """Remove Page routes that would outrank the interaction context route."""
    for page_ref, guard in list(PAGE_NAVIGATION_GUARDS.items()):
        state = PAGE_STATES.get(page_ref)
        page = state.get("page") if state else None
        if page is not None:
            with contextlib.suppress(Exception):
                page.unroute("**/*", guard)
    PAGE_NAVIGATION_GUARDS.clear()


def install_interaction_guard(expected: str, authorized_origins: Any = None) -> None:
    """Guard every request by its Page's own or opener-inherited origin set."""
    global INTERACTION_GUARD, INTERACTION_GUARD_PAGE, INTERACTION_DENIED
    if not valid_public_origin(expected):
        raise ValueError("Managed interaction expected origin is invalid.")
    active_state = ensure_provider_page(PAGE)
    if active_state is None:
        raise RuntimeError("Managed interaction has no active Page binding.")
    active_ref = active_state["provider_page_ref"]
    existing_scope = PAGE_INTERACTION_ALLOWED_ORIGINS.get(active_ref)
    if authorized_origins is None:
        # managed_interaction writes Core's explicit intersection before calling
        # this function.  The fallback keeps the private helper useful for the
        # legacy dependency-free fixture while never becoming a production
        # fallback when an operation scope is already present.
        allowed = existing_scope if existing_scope is not None else {expected}
        legacy_unscoped = existing_scope is None
    else:
        allowed = authorized_origin_set(authorized_origins, expected)
        if allowed is None or not allowed:
            raise ValueError("Managed interaction origin scope is invalid.")
        legacy_unscoped = False
    PAGE_INTERACTION_ALLOWED_ORIGINS[active_ref] = set(allowed)
    PAGE_NAVIGATION_DENIED.pop(active_ref, None)

    # A profile-management guard is intentionally single-origin. Keeping it
    # attached would silently reject an otherwise authorized second origin.
    detach_public_navigation_guard_for_interaction()
    # Page routes outrank context routes in Playwright. Remove stale page
    # navigation handlers before the interaction handler is (re)bound.
    detach_page_navigation_guards_for_interaction()
    if INTERACTION_GUARD is not None:
        if INTERACTION_GUARD_PAGE is not PAGE:
            if INTERACTION_GUARD_PAGE is not None:
                with contextlib.suppress(Exception):
                    INTERACTION_GUARD_PAGE.unroute("**/*", INTERACTION_GUARD)
            PAGE.route("**/*", INTERACTION_GUARD)
            INTERACTION_GUARD_PAGE = PAGE
        return

    def guard(route: Any) -> None:
        global INTERACTION_DENIED
        request = route.request
        try:
            binding = request_page_binding(request)
            relation = binding.get("relation")
            target_page = binding.get("target_page")
            target_state = binding.get("target_state")
            opener_state = binding.get("opener_state")
            if relation is None:
                if target_state is None and page_opener(target_page) is not None:
                    # A context route can win the race with Playwright's
                    # ``page`` event. Register only when the browser itself
                    # proves an opener; unrelated unknown Pages stay out.
                    target_state = ensure_provider_page(target_page)
                scope_page = target_page
            elif target_state is not None:
                # The relation's target Page is exact; never use the opener
                # as the request target when this mapping is available.
                scope_page = target_page
            elif opener_state is not None:
                # A popup's first request can precede its Page event. Its
                # opener supplies authorization only, not a Page registration.
                scope_page = opener_state.get("page")
            else:
                mark_request_navigation_denied(binding, "managed_interaction_window_unsupported")
                INTERACTION_DENIED = "managed_interaction_window_unsupported"
                route.abort("blockedbyclient")
                return

            target_ref = target_state["provider_page_ref"] if target_state is not None else None
            allowed_for_page = inherited_page_origins(PAGE_INTERACTION_ALLOWED_ORIGINS, scope_page)
            if allowed_for_page is None and legacy_unscoped and target_ref in PAGE_STATES:
                # Only the dependency-free direct helper fixture reaches this
                # compatibility branch. Managed calls pre-bind active scope.
                allowed_for_page = {expected}
            if allowed_for_page is None:
                mark_request_navigation_denied(binding, "managed_interaction_window_unsupported")
                INTERACTION_DENIED = "managed_interaction_window_unsupported"
                route.abort("blockedbyclient")
                return
            request_origin = public_origin(str(getattr(request, "url", "")))
            if request_origin not in allowed_for_page:
                mark_request_navigation_denied(binding, "managed_interaction_request_blocked")
                INTERACTION_DENIED = "managed_interaction_request_blocked"
                if target_ref:
                    PAGE_NAVIGATION_DENIED[target_ref] = "managed_interaction_request_blocked"
                route.abort("blockedbyclient")
                return
        except Exception:
            INTERACTION_DENIED = "managed_interaction_request_blocked"
            route.abort("blockedbyclient")
            return
        # The controlled Page and a Provider-registered background popup may
        # run same-origin validation requests. Each redirect hop is checked
        # before the next request is sent.
        response = None
        try:
            response = route.fetch(max_redirects=0, timeout=10_000)
            if 300 <= response.status < 400:
                if not follow_authorized_redirect(route, response, request, allowed_for_page, "managed_interaction_redirect_blocked"):
                    INTERACTION_DENIED = "managed_interaction_redirect_blocked"
            else:
                route.fulfill(response=response)
        except Exception:
            INTERACTION_DENIED = "managed_interaction_request_blocked"
            route.abort("failed")
        finally:
            if response is not None:
                response.dispose()
    INTERACTION_GUARD = guard
    INTERACTION_GUARD_PAGE = PAGE
    CONTEXT.route("**/*", guard)  # Includes the first request of a popup.
    PAGE.route("**/*", guard)


def interaction_surface(expected: str) -> str | None:
    if PAGE is None or PAGE.is_closed():
        return "managed_interaction_page_missing"
    if public_origin(str(PAGE.url)) != expected:
        return "managed_public_origin_denied"
    parsed = urlparse(str(PAGE.url))
    if parsed.username or parsed.password:
        return "managed_interaction_url_unsupported"
    if len(PAGE.frames) != 1:
        return "managed_interaction_window_unsupported"
    if CONTEXT is not None:
        for candidate in getattr(CONTEXT, "pages", []) or []:
            if candidate is not PAGE and page_state_for(candidate) is None:
                return "managed_interaction_window_unsupported"
    return None


class InteractionSnapshotError(Exception):
    pass


def interaction_snapshot(generation: int) -> dict[str, Any]:
    global INTERACTION_STATE
    page_state = page_state_for(PAGE) or register_provider_page(PAGE)
    page_state.setdefault("diagnostic_page_ref", DIAGNOSTIC_PAGE_REF or "page_" + uuid.uuid4().hex)
    diagnostic_ref = page_state.get("diagnostic_page_ref") or DIAGNOSTIC_PAGE_REF
    candidate = diagnostic_ref if re.fullmatch(r"page_[0-9a-f]{32}", diagnostic_ref or "") else "page_" + uuid.uuid4().hex
    page_ref = page_state.setdefault("interaction_page_ref", candidate)
    if INTERACTION_STATE is not None:
        with contextlib.suppress(Exception):
            if INTERACTION_STATE["handle"].evaluate("state => state.sameDocument()"):
                page_ref = INTERACTION_STATE["page_ref"]
    discard_interaction_snapshot()
    try:
        # DOM handles must stay in Camoufox's isolated world; main-world
        # evaluation cannot return element references. No page JS state is needed.
        handle = PAGE.evaluate_handle(INTERACTION_SNAPSHOT_EXPRESSION)
    except Exception as error:
        raise InteractionSnapshotError("handle_" + type(error).__name__.lower()) from None
    try:
        observed = handle.evaluate("state => ({controls:state.controls,text:state.text,truncated:state.truncated})")
        if not isinstance(observed, dict) or not isinstance(observed.get("controls"), list):
            raise TypeError()
    except Exception as error:
        handle.dispose()
        raise InteractionSnapshotError("readback_" + type(error).__name__.lower()) from None
    nodes = handle.get_property("nodes")
    targets = {}
    try:
        for index, control in enumerate(observed["controls"]):
            ref = "target_" + uuid.uuid4().hex
            targets[ref] = nodes.get_property(str(index)).as_element()
            control["target_ref"] = ref
    finally:
        nodes.dispose()
    observation_ref = "observation_" + uuid.uuid4().hex
    INTERACTION_STATE = {"handle":handle, "targets":targets, "generation":generation,
                         "page_ref":page_ref, "observation_ref":observation_ref}
    return {"page_ref":page_ref, "observation_ref":observation_ref, **observed}


def managed_interaction(request: dict[str, Any]) -> dict[str, Any]:
    dispatched = False
    def refused(code: str) -> dict[str, Any]:
        return {"status":"unknown_outcome" if dispatched else "unavailable",
                "dispatch_state":"dispatched" if dispatched else "not_dispatched", "failure_class":code}
    action, expected = request.get("action"), request.get("expected_origin")
    generation = request.get("control_generation")
    timeout = request.get("timeout_ms", 5000)
    if action not in ("snapshot", "click", "input", "press", "scroll", "wait") or not valid_public_origin(expected) or type(generation) is not int or generation < 0 or type(timeout) is not int or not 1 <= timeout <= 10000:
        return refused("managed_interaction_invalid_input")
    allowed_origins = authorized_origin_set(request.get("authorized_origins"), expected)
    if allowed_origins is None:
        return refused("managed_interaction_invalid_input")
    if not allowed_origins:
        return refused("managed_interaction_origin_denied")
    try:
        with contextlib.redirect_stdout(sys.stderr):
            provider_ref = request.get("provider_page_ref")
            selected = page_by_provider_ref(provider_ref) if isinstance(provider_ref, str) else page_state_for(PAGE)
            # Legacy fixture providers do not expose a private Page handle;
            # the existing single-Page interaction contract remains valid for
            # them while Camoufox uses the explicit provider binding.
            if isinstance(provider_ref, str) and (selected is None or selected.get("closed") or selected.get("page") is not PAGE):
                return refused("managed_interaction_page_not_active")
            controlled_page = PAGE
            if NATIVE_PLAYWRIGHT_ADAPTER is not None:
                try:
                    refresh_native_selected_page()
                except Exception:
                    return refused("managed_interaction_relation_unavailable")
                if PAGE is not controlled_page:
                    return refused("managed_interaction_page_not_active")
                current_state = page_state_for(controlled_page)
                if current_state is None or current_state.get("closed") or current_state.get("native_active") is not True:
                    return refused("managed_interaction_page_not_active")

            def native_dispatch_failure() -> str | None:
                if NATIVE_PLAYWRIGHT_ADAPTER is None:
                    return None
                try:
                    refresh_native_selected_page()
                except Exception:
                    return "managed_interaction_relation_unavailable"
                state = page_state_for(controlled_page)
                if PAGE is not controlled_page or state is None or state.get("closed") or state.get("native_active") is not True:
                    return "managed_interaction_page_not_active"
                return None

            failure = interaction_surface(expected)
            if failure:
                return refused(failure)
            active_state = page_state_for(controlled_page) or register_provider_page(controlled_page)
            PAGE_INTERACTION_ALLOWED_ORIGINS[active_state["provider_page_ref"]] = allowed_origins
            install_interaction_guard(expected)
            target = None
            if action != "snapshot":
                state = INTERACTION_STATE
                if state is None or request.get("page_ref") != state["page_ref"] or request.get("observation_ref") != state["observation_ref"] or generation != state["generation"]:
                    return refused("managed_interaction_stale_target")
                if request.get("target_ref") is not None:
                    target = state["targets"].get(request["target_ref"])
                    if target is None:
                        return refused("managed_interaction_stale_target")
                if action != "wait" and not state["handle"].evaluate("state => state.valid()"):
                    return refused("managed_interaction_stale_target")
            if action in ("click", "input", "press"):
                if target is None:
                    return refused("managed_interaction_target_required")
                descriptor = state["handle"].evaluate("(state, el) => state.describe(el)", target)
                if not descriptor or not descriptor["enabled"]:
                    return refused("managed_interaction_target_unavailable")
                peers = state["handle"].evaluate("state => state.controls")
                if sum(item["role"] == descriptor["role"] and item["name"] == descriptor["name"] for item in peers) != 1:
                    return refused("managed_interaction_target_ambiguous")
                # Same handle throughout: no selector retries that could hit a
                # replacement element. Playwright checks visibility/stability.
                target.wait_for_element_state("stable", timeout=timeout)
                if not state["handle"].evaluate("state => state.valid()"):
                    return refused("managed_interaction_stale_target")
                if action == "input":
                    value = request.get("text")
                    if descriptor["role"] != "textbox" or not isinstance(value,str) or len(value) > 512 or re.search(r"[\x00-\x1f\x7f]|password|token|cookie|secret|credential|authorization|验证码|密码",value,re.I):
                        return refused("managed_interaction_input_refused")
                    failure = native_dispatch_failure()
                    if failure:
                        return refused(failure)
                    dispatched = True
                    target.fill(value, timeout=timeout)
                elif action == "press":
                    if request.get("key") not in ("Enter","Tab","Escape","ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Home","End","Backspace","Delete","Space"):
                        return refused("managed_interaction_key_refused")
                    failure = native_dispatch_failure()
                    if failure:
                        return refused(failure)
                    dispatched = True
                    target.press(request["key"], timeout=timeout)
                else:
                    failure = native_dispatch_failure()
                    if failure:
                        return refused(failure)
                    dispatched = True
                    target.click(timeout=timeout, no_wait_after=True)
            elif action == "scroll":
                delta = request.get("delta_y")
                if type(delta) is not int or delta == 0 or abs(delta) > 2000:
                    return refused("managed_interaction_scroll_refused")
                if target is not None:
                    if not target.is_visible():
                        return refused("managed_interaction_target_unavailable")
                    failure = native_dispatch_failure()
                    if failure:
                        return refused(failure)
                    dispatched = True
                    target.hover(timeout=timeout)
                else:
                    viewport = PAGE.evaluate("mw:({width:innerWidth,height:innerHeight})")
                    failure = native_dispatch_failure()
                    if failure:
                        return refused(failure)
                    dispatched = True
                    PAGE.mouse.move(viewport["width"]//2, viewport["height"]//2)
                if not state["handle"].evaluate("state => state.valid()"):
                    return refused("managed_interaction_stale_target")
                failure = native_dispatch_failure()
                if failure:
                    return refused(failure)
                dispatched = True
                PAGE.mouse.wheel(0, delta)
                # Allow the delivered wheel to update layout. The new snapshot,
                # rather than dispatch alone, supplies the scroll result.
                PAGE.evaluate("mw:() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
            elif action == "wait":
                condition = request.get("wait_for")
                if condition not in ("page_changed","text","enabled") or condition == "enabled" and target is None or condition == "text" and (not isinstance(request.get("text"), str) or not 1 <= len(request["text"]) <= 512):
                    return refused("managed_interaction_wait_refused")
                deadline = time.monotonic() + timeout/1000
                while True:
                    failure = interaction_surface(expected)
                    if failure:
                        return refused(failure)
                    if condition == "page_changed":
                        try:
                            ready = not state["handle"].evaluate("state => state.valid()")
                        except Exception:
                            ready = True  # A same-origin document navigation destroyed the old handle.
                    elif condition == "text":
                        ready = request["text"] in state["handle"].evaluate("state => state.readText()")
                    else:
                        if not target.evaluate("el => el.isConnected"):
                            return refused("managed_interaction_stale_target")
                        ready = target.is_visible() and target.is_enabled()
                    if ready:
                        break
                    if time.monotonic() >= deadline:
                        return refused("managed_interaction_wait_timeout")
                    PAGE.wait_for_timeout(min(50, max(1, (deadline-time.monotonic())*1000)))
            if NATIVE_PLAYWRIGHT_ADAPTER is not None:
                try:
                    refresh_native_selected_page()
                except Exception:
                    return refused("managed_interaction_relation_unavailable")
                if PAGE is not controlled_page:
                    return refused("managed_interaction_page_not_active")
            failure = interaction_surface(expected) or INTERACTION_DENIED or page_navigation_failure(controlled_page)
            if failure:
                return refused(failure)
            snapshot = interaction_snapshot(generation)
            return {"status":"completed", "dispatch_state":"dispatched" if dispatched else "not_dispatched",
                    "page":{**page_facts(), "title":public_text(str(PAGE.title()), 256)}, "snapshot":snapshot}
    except InteractionSnapshotError as error:
        return refused("managed_interaction_snapshot_" + str(error))
    except Exception:
        return refused("managed_interaction_outcome_unknown" if dispatched else "managed_interaction_target_unavailable")


def site_resource_probe(request: dict[str, Any]) -> dict[str, Any]:
    if PAGE is None:
        raise RuntimeError("Camoufox Driver has no active page.")
    site_id = request.get("site_id")
    if site_id not in ("xiaohongshu", "boss"):
        raise ValueError("Camoufox Driver site probe is not allowlisted.")
    expression = xhs_probe_expression() if site_id == "xiaohongshu" else boss_probe_expression()
    with contextlib.redirect_stdout(sys.stderr):
        # Site-owned Vue/Pinia objects are invisible in Camoufox's default sandbox.
        observation = PAGE.evaluate("mw:" + expression)
    if not isinstance(observation, dict):
        raise RuntimeError("Camoufox Driver returned no public site observation.")
    return {"observation": observation}


def public_text(value: Any, limit: int) -> str:
    if not isinstance(value, str):
        return ""
    text = " ".join(value.split())
    if not text or len(text) > limit or any(ord(char) < 32 or ord(char) == 127 for char in text):
        return ""
    if re.search(r"(?:token|cookie|authorization|password|secret|credential)\s*[=:]\s*\S+", text, re.I):
        return ""
    return text


def public_metric(value: Any) -> str:
    text = str(value).strip() if isinstance(value, (str, int, float)) and not isinstance(value, bool) else ""
    return text if 0 < len(text) <= 40 and re.fullmatch(r"[0-9０-９.,+\-\s万千百wWkKmM]+", text) else ""


def first_present(mapping: dict[str, Any], keys: tuple[str, ...]) -> Any:
    return next((mapping[key] for key in keys if mapping.get(key) is not None), None)


def unavailable_read(failure_class: str, message: str, retryable: bool) -> dict[str, Any]:
    return {"status": "unavailable", "failure_class": failure_class, "message": message, "retryable": retryable}


def summarize_xhs_network(payload: Any) -> dict[str, dict[str, Any]] | dict[str, Any]:
    if not isinstance(payload, dict) or payload.get("success") is not True or payload.get("code") != 0:
        return unavailable_read("permission_denied", "Xiaohongshu rejected the bounded search read.", False)
    data = payload.get("data")
    items = data.get("items") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return unavailable_read("site_changed", "Xiaohongshu search response has no bounded item list.", False)
    if not items:
        return unavailable_read("empty_result", "Xiaohongshu search returned no notes.", False)
    result: dict[str, dict[str, Any]] = {}
    for item in items[:60]:
        if not isinstance(item, dict):
            continue
        card = item.get("note_card") if isinstance(item.get("note_card"), dict) else item.get("noteCard")
        card = card if isinstance(card, dict) else {}
        note_ids = [item.get("id"), item.get("note_id"), item.get("noteId"), card.get("id"), card.get("note_id"), card.get("noteId")]
        note_ids = [value.lower() for value in note_ids if isinstance(value, str) and re.fullmatch(r"[a-f0-9]{24}", value, re.I)]
        if not note_ids or len(set(note_ids)) != 1:
            continue
        title = public_text(card.get("display_title") or card.get("displayTitle") or card.get("title"), 200)
        if not title:
            continue
        user = card.get("user") if isinstance(card.get("user"), dict) else {}
        interactions = card.get("interact_info") if isinstance(card.get("interact_info"), dict) else card.get("interactInfo")
        interactions = interactions if isinstance(interactions, dict) else {}
        author = public_text(user.get("nickname") or user.get("display_name") or user.get("displayName") or user.get("name"), 100)
        metrics = {
            "likes": public_metric(first_present(interactions, ("liked_count", "likedCount", "likes"))),
            "comments": public_metric(first_present(interactions, ("comment_count", "commentCount", "comments"))),
            "collects": public_metric(first_present(interactions, ("collected_count", "collectedCount", "collects"))),
        }
        result[note_ids[0]] = {
            "title": title,
            **({"author_display_name": author} if author else {}),
            **({"interaction_metrics": {key: value for key, value in metrics.items() if value}} if any(metrics.values()) else {}),
        }
    return result if result else unavailable_read("field_missing", "Xiaohongshu search items have no bounded public title.", False)


def read_operation_probe(request: dict[str, Any]) -> dict[str, Any]:
    if CONTEXT is None:
        raise RuntimeError("Camoufox Driver has no active context.")
    if request.get("site_id") != "xiaohongshu" or request.get("operation_id") != "xhs_search_notes":
        return {"page": page_facts(), "observation": unavailable_read("provider_probe_unavailable", "Read operation is not supported by this Driver.", False)}
    target_url = request.get("target_url")
    expected_origin = request.get("expected_origin")
    query = request.get("query")
    limit = request.get("limit", 15)
    if not isinstance(target_url, str) or expected_origin != "https://www.xiaohongshu.com" or not isinstance(query, str) or not 1 <= len(query) <= 200:
        return {"page": page_facts(), "observation": unavailable_read("site_changed", "Read operation binding is invalid.", False)}
    parsed = urlparse(target_url)
    params = parse_qs(parsed.query, keep_blank_values=True)
    if parsed.scheme != "https" or parsed.netloc != "www.xiaohongshu.com" or parsed.path not in ("/search_result", "/search_result/") or params != {"keyword": [query], "source": ["web_search_result_notes"]}:
        return {"page": page_facts(), "observation": unavailable_read("origin_drift", "Read target is outside the pinned Xiaohongshu search route.", False)}
    if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 15:
        limit = 15

    read_page = CONTEXT.new_page()
    try:
        with contextlib.redirect_stdout(sys.stderr):
            with read_page.expect_response(
                lambda response: urlparse(response.url).scheme == "https" and urlparse(response.url).netloc == "so.xiaohongshu.com" and urlparse(response.url).path == "/api/sns/web/v2/search/notes" and response.request.method == "POST",
                timeout=12_000,
            ) as response_info:
                read_page.goto(target_url, wait_until="domcontentloaded", timeout=12_000)
            response = response_info.value
            body = response.body()
            if not body or len(body) > 512 * 1024:
                observation = unavailable_read("network_resource_unavailable", "Xiaohongshu search response exceeds the bounded read limit.", True)
                return {"page": facts_for_page(read_page), "observation": observation}
            network = summarize_xhs_network(json.loads(body.decode("utf-8")))
            if "status" in network:
                return {"page": facts_for_page(read_page), "observation": network}
            read_page.wait_for_timeout(500)
            rendered = read_page.evaluate(r"""mw:(expectedQuery) => {
              const pinia = window.__PINIA__ || window.__pinia || document.querySelector('#app')?.__vue_app__?.config?.globalProperties?.$pinia;
              const store = pinia?._s instanceof Map ? pinia._s.get('search') : undefined;
              const unwrap = (value) => value && typeof value === 'object' && 'value' in value ? value.value : value;
              const clean = (value, max) => {
                if (typeof value !== 'string') return '';
                const text = value.replace(/\s+/g, ' ').trim();
                return text && text.length <= max && !/[\u0000-\u001f\u007f]/.test(text) ? text : '';
              };
              const metric = (...values) => {
                const value = values.find((entry) => typeof entry === 'number' || typeof entry === 'string');
                const text = value === undefined ? '' : String(value).trim();
                return text.length <= 40 && /^[0-9０-９.,+\-\s万千百wWkKmM]+$/u.test(text) ? text : '';
              };
              const feeds = unwrap(store?.feeds);
              const items = Array.isArray(feeds) ? feeds.slice(0, 60).flatMap((feed) => {
                const card = unwrap(feed?.noteCard) || unwrap(feed?.note_card) || {};
                const ids = [unwrap(feed?.id), unwrap(feed?.noteId), unwrap(feed?.note_id), unwrap(card?.id), unwrap(card?.noteId), unwrap(card?.note_id)]
                  .filter((value) => typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value)).map((value) => value.toLowerCase());
                if (!ids.length || new Set(ids).size !== 1) return [];
                const title = clean(unwrap(card?.displayTitle) || unwrap(card?.display_title) || unwrap(card?.title), 200);
                if (!title) return [];
                const user = unwrap(card?.user) || {};
                const interactions = unwrap(card?.interactInfo) || unwrap(card?.interact_info) || {};
                const author = clean(unwrap(user?.nickname) || unwrap(user?.displayName) || unwrap(user?.display_name) || unwrap(user?.name), 100);
                const metrics = { likes: metric(unwrap(interactions?.likedCount), unwrap(interactions?.liked_count), unwrap(interactions?.likes)), comments: metric(unwrap(interactions?.commentCount), unwrap(interactions?.comment_count), unwrap(interactions?.comments)), collects: metric(unwrap(interactions?.collectedCount), unwrap(interactions?.collected_count), unwrap(interactions?.collects)) };
                return [{ id: ids[0], title, ...(author ? { author_display_name: author } : {}), ...(Object.values(metrics).some(Boolean) ? { interaction_metrics: Object.fromEntries(Object.entries(metrics).filter(([, value]) => value)) } : {}) }];
              }) : [];
              const linked = new Set(Array.from(document.querySelectorAll('a[href*="/explore/"]')).flatMap((anchor) => {
                try { const match = /^\/explore\/([a-f0-9]{24})$/i.exec(new URL(anchor.getAttribute('href') || anchor.href, location.origin).pathname); return match ? [match[1].toLowerCase()] : []; } catch { return []; }
              }));
              const text = document.body?.innerText || '';
              return { origin: location.origin, pathname: location.pathname, pinia_ready: unwrap(store?.searchValue) === expectedQuery && Array.isArray(feeds), login_like: /登录后|扫码登录|手机号登录/.test(text) || location.pathname.startsWith('/login'), challenge_like: /验证码|安全验证|访问异常|captcha|challenge required|verification challenge/i.test(text), items: items.filter((item) => linked.has(item.id)) };
            }""", query)

        if not isinstance(rendered, dict) or rendered.get("origin") != expected_origin:
            observation = unavailable_read("origin_drift", "Xiaohongshu search page changed origin.", False)
        elif rendered.get("challenge_like") is True:
            observation = unavailable_read("safety_challenge", "Xiaohongshu search shows a safety challenge.", False)
        elif rendered.get("login_like") is True:
            observation = unavailable_read("not_logged_in", "Xiaohongshu search requires manual login.", False)
        elif rendered.get("pinia_ready") is not True:
            observation = unavailable_read("site_changed", "Xiaohongshu search no longer exposes the pinned Pinia surface.", False)
        elif not isinstance(rendered.get("items"), list):
            observation = unavailable_read("page_not_ready", "Xiaohongshu rendered search surface is not ready.", True)
        else:
            correlated = []
            for item in rendered["items"]:
                if not isinstance(item, dict) or not isinstance(item.get("id"), str):
                    continue
                network_item = network.get(item["id"])
                public_item = {key: value for key, value in item.items() if key != "id"}
                if network_item == public_item:
                    correlated.append((item["id"], public_item))
            correlated = correlated[:limit]
            if not correlated:
                observation = unavailable_read("site_changed", "Xiaohongshu network and rendered search summaries do not match.", False)
            else:
                observation = {
                    "status": "completed",
                    "observed_origin": expected_origin,
                    "response_status": response.status,
                    "detail_urls": [f"https://www.xiaohongshu.com/explore/{note_id}" for note_id, _ in correlated],
                    "search_items": [item for _, item in correlated],
                }
        return {"page": facts_for_page(read_page), "observation": observation}
    except (UnicodeDecodeError, json.JSONDecodeError):
        return {"page": facts_for_page(read_page), "observation": unavailable_read("site_changed", "Xiaohongshu search response is not valid bounded JSON.", False)}
    except Exception as error:
        if PLAYWRIGHT_TIMEOUT_ERROR is None or not isinstance(error, PLAYWRIGHT_TIMEOUT_ERROR):
            raise
        return {"page": facts_for_page(read_page), "observation": unavailable_read("network_resource_unavailable", "Xiaohongshu search response was not observed in time.", True)}
    finally:
        with contextlib.suppress(Exception), contextlib.redirect_stdout(sys.stderr):
            read_page.close()


def close() -> None:
    global PLAYWRIGHT, CONTEXT, PAGE, NATIVE_PLAYWRIGHT_ADAPTER
    try:
        with contextlib.redirect_stdout(sys.stderr):
            try:
                if CONTEXT is not None:
                    CONTEXT.close()
            finally:
                if PLAYWRIGHT is not None:
                    PLAYWRIGHT.stop()
    finally:
        if NATIVE_PLAYWRIGHT_ADAPTER is not None:
            with contextlib.suppress(Exception):
                NATIVE_PLAYWRIGHT_ADAPTER.close()
        NATIVE_PLAYWRIGHT_ADAPTER = None
        PAGE = None
        CONTEXT = None
        PLAYWRIGHT = None
        reset_provider_pages()
        cleanup_launch_layout()


def main() -> None:
    sys.stdout.reconfigure(line_buffering=True)
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
            if not isinstance(request, dict):
                raise ValueError("Driver request must be an object.")
            message_id = request.get("id")
            if not isinstance(message_id, int):
                continue
            op = request.get("op")
            if op == "launch":
                send(message_id, "ready", **launch(request))
            elif op == "open_url":
                send(message_id, "ok", **open_url(request))
            elif op == "list_pages":
                send(message_id, "ok", **list_pages())
            elif op == "open_page":
                send(message_id, "ok", **open_page(request))
            elif op == "activate_page":
                send(message_id, "ok", **activate_page(request))
            elif op == "close_page":
                send(message_id, "ok", **close_page(request))
            elif op == "navigate_page":
                send(message_id, "ok", **navigate_page(request))
            elif op == "clear_public_navigation_guard":
                send(message_id, "ok", **clear_public_navigation_guard())
            elif op == "managed_public_page":
                send(message_id, "ok", **managed_public_page(request))
            elif op == "managed_interaction":
                send(message_id, "ok", result=managed_interaction(request))
            elif op == "managed_observe":
                # Private pipe command; the expression is fixed by the Harbor adapter,
                # never accepted from the public HTTP API.
                send(message_id, "ok", observation=managed_observe(request))
            elif op == "diagnostics_read":
                send(message_id, "ok", diagnostics=diagnostics_read(request))
            elif op == "environment_read":
                send(message_id, "ok", result=environment_read(request))
            elif op == "validate_environment_bundle":
                send(message_id, "ok", result=validate_environment_bundle_request(request))
            elif op == "site_resource_probe":
                send(message_id, "ok", **site_resource_probe(request))
            elif op == "read_operation_probe":
                send(message_id, "ok", **read_operation_probe(request))
            elif op == "close":
                close()
                send(message_id, "ok")
            else:
                raise ValueError("Camoufox Driver operation is not allowlisted.")
        except BaseException as error:
            send(message_id if isinstance(locals().get("message_id"), int) else 0, "error", message=safe_error(error))


if __name__ == "__main__":
    try:
        main()
    finally:
        close()

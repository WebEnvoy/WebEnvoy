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
PAGE_STATES: dict[str, dict[str, Any]] = {}
PAGE_STATE_BY_OBJECT: dict[int, str] = {}
PAGE_CONTEXT_HANDLER: Any = None
PROFILE_DIR = ""
EXECUTABLE_PATH = ""
LAUNCH_EXECUTABLE_PATH = ""
LAUNCH_LAYOUT_DIR = ""
PROPERTIES_SOURCE = "adjacent"
PUBLIC_NAVIGATION_GUARD: Any = None
PUBLIC_NAVIGATION_ORIGIN = ""
PUBLIC_NAVIGATION_DENIED: str | None = None
PAGE_NAVIGATION_GUARDS: dict[str, Any] = {}
PAGE_NAVIGATION_ALLOWED_ORIGINS: dict[str, set[str]] = {}
PAGE_NAVIGATION_DENIED: dict[str, str] = {}
PAGE_NAVIGATION_CONTEXT_GUARD: Any = None
INTERACTION_GUARD: Any = None
INTERACTION_STATE: dict[str, Any] | None = None
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
    text = re.sub(r"([?&][^=\s&]+)=([^\s&#]*)", r"\1=<redacted>", text)
    text = DIAGNOSTIC_URL_PATTERN.sub(lambda match: (diagnostics_url(match.group(0)) or ("[redacted]", ""))[0], text)
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
        current_url = safe_text(str(page.url)) if page.url else None
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
        "active": page is PAGE,
        **({"opener_provider_page_ref": state["opener_provider_page_ref"]} if state.get("opener_provider_page_ref") else {})
    }


def all_page_states() -> list[dict[str, Any]]:
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
        PAGE_STATE_BY_OBJECT.pop(id(page), None)
        guard = PAGE_NAVIGATION_GUARDS.pop(ref, None)
        PAGE_NAVIGATION_ALLOWED_ORIGINS.pop(ref, None)
        PAGE_NAVIGATION_DENIED.pop(ref, None)
        if guard is not None:
            with contextlib.suppress(Exception):
                page.unroute("**/*", guard)
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
    PAGE = page
    for candidate in PAGE_STATES.values():
        candidate["active"] = candidate["page"] is page and not candidate.get("closed")
    with contextlib.suppress(Exception):
        page.bring_to_front()
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
    global PAGE_CONTEXT_HANDLER, PAGE_NAVIGATION_CONTEXT_GUARD
    if PAGE_NAVIGATION_CONTEXT_GUARD is not None and CONTEXT is not None:
        with contextlib.suppress(Exception):
            CONTEXT.unroute("**/*", PAGE_NAVIGATION_CONTEXT_GUARD)
    PAGE_STATES.clear()
    PAGE_STATE_BY_OBJECT.clear()
    PAGE_NAVIGATION_GUARDS.clear()
    PAGE_NAVIGATION_ALLOWED_ORIGINS.clear()
    PAGE_NAVIGATION_DENIED.clear()
    PAGE_CONTEXT_HANDLER = None
    PAGE_NAVIGATION_CONTEXT_GUARD = None


def page_by_provider_ref(ref: Any) -> dict[str, Any] | None:
    return PAGE_STATES.get(ref) if isinstance(ref, str) else None


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
    global PLAYWRIGHT, PLAYWRIGHT_TIMEOUT_ERROR, CONTEXT, PAGE, PROFILE_DIR, EXECUTABLE_PATH, LAUNCH_EXECUTABLE_PATH, PROPERTIES_SOURCE, DIAGNOSTIC_EVENTS, DIAGNOSTIC_CURSOR, DIAGNOSTIC_INSTANCE_REF
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
    parsed = urlparse(value)
    return f"{parsed.scheme}://{parsed.netloc}"


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
    with contextlib.suppress(Exception):
        frame = request.frame
        page = frame.page
        if page is not None:
            return page
    return PAGE


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
    page = request_page(request)
    page_ref = provider_page_ref(page)
    if not location or destination_origin not in allowed or request_redirect_hops(request) >= 8:
        if page_ref:
            PAGE_NAVIGATION_DENIED[page_ref] = denied
        route.abort("blockedbyclient")
        return False
    implementation = getattr(route, "_impl_obj", None)
    continuation = getattr(implementation, "_redirected_navigation_request", None)
    sync = getattr(route, "_sync", None)
    if not callable(continuation) or not callable(sync):
        if page_ref:
            PAGE_NAVIGATION_DENIED[page_ref] = "navigation_guard_unavailable"
        route.abort("failed")
        return False
    try:
        sync(continuation(location))
        return True
    except Exception:
        if page_ref:
            PAGE_NAVIGATION_DENIED[page_ref] = "navigation_guard_unavailable"
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

    def guard(route: Any) -> None:
        request = route.request
        request_origin = public_origin(str(getattr(request, "url", "")))
        request_page_ref = provider_page_ref(request_page(request)) or page_ref
        if request_origin not in allowed:
            PAGE_NAVIGATION_DENIED[request_page_ref] = "navigation_origin_denied"
            route.abort("blockedbyclient")
            return
        response = None
        try:
            response = route.fetch(max_redirects=0, timeout=15_000)
            status = int(getattr(response, "status", 0))
            if 300 <= status < 400:
                follow_authorized_redirect(route, response, request, allowed, "navigation_origin_denied")
            else:
                route.fulfill(response=response)
        except Exception:
            PAGE_NAVIGATION_DENIED[request_page_ref] = "navigation_guard_unavailable"
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
            target_page = request_page(request)
            target_ref = provider_page_ref(target_page)
            active_ref = provider_page_ref(PAGE)
            target_allowed = PAGE_NAVIGATION_ALLOWED_ORIGINS.get(target_ref or "")
            allowed_for_request = target_allowed if target_allowed is not None else PAGE_NAVIGATION_ALLOWED_ORIGINS.get(active_ref or "", set())
            request_origin = public_origin(str(getattr(request, "url", "")))
            failure_ref = target_ref or active_ref
            if not allowed_for_request:
                # The context guard only owns pages participating in a page
                # operation; unrelated provider traffic stays untouched.
                route.continue_()
                return
            if request_origin not in allowed_for_request:
                if failure_ref:
                    PAGE_NAVIGATION_DENIED[failure_ref] = "navigation_origin_denied"
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
                if failure_ref:
                    PAGE_NAVIGATION_DENIED[failure_ref] = "navigation_guard_unavailable"
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


def list_pages() -> dict[str, Any]:
    return {"pages": all_page_states()}


def open_page(request: dict[str, Any]) -> dict[str, Any]:
    if CONTEXT is None:
        raise RuntimeError("Camoufox Driver has no active context.")
    url = request.get("url")
    if url is not None and (not isinstance(url, str) or not url):
        raise ValueError("Camoufox Driver open_page URL is invalid.")
    with contextlib.redirect_stdout(sys.stderr):
        page = CONTEXT.new_page()
        register_provider_page(page)
        if isinstance(url, str):
            install_page_navigation_guard(page, request.get("authorized_origins", []))
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=int(request.get("timeout_ms", 15_000)))
            except Exception:
                if not page_navigation_failure(page):
                    raise
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
    with contextlib.redirect_stdout(sys.stderr):
        page.close()
    # Playwright may not emit close synchronously on a mocked page.
    state["closed"] = True
    return {"pages": all_page_states()}


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


def install_public_navigation_guard(expected_origin: str) -> None:
    global PUBLIC_NAVIGATION_GUARD, PUBLIC_NAVIGATION_ORIGIN, PUBLIC_NAVIGATION_DENIED
    PUBLIC_NAVIGATION_ORIGIN = expected_origin
    PUBLIC_NAVIGATION_DENIED = None
    if PUBLIC_NAVIGATION_GUARD is not None:
        return
    def guard(route: Any) -> None:
        global PUBLIC_NAVIGATION_DENIED
        request = route.request
        if not request.is_navigation_request() or request.frame != PAGE.main_frame:
            route.continue_()
            return
        if public_origin(request.url) != PUBLIC_NAVIGATION_ORIGIN or request.method != "GET":
            PUBLIC_NAVIGATION_DENIED = "managed_public_navigation_blocked"
            route.abort("blockedbyclient")
            return
        # Playwright does not route redirected requests individually. Intercept
        # this original Page navigation response without following ANY redirect,
        # then render it in the same Page. Never export the response body.
        response = None
        try:
            response = route.fetch(max_redirects=0, timeout=15_000)
            if 300 <= response.status < 400:
                PUBLIC_NAVIGATION_DENIED = "managed_public_redirect_blocked"
                route.abort("blockedbyclient")
            else:
                route.fulfill(response=response)
        except Exception:
            PUBLIC_NAVIGATION_DENIED = "managed_public_navigation_unavailable"
            route.abort("failed")
        finally:
            if response is not None:
                response.dispose()
    PUBLIC_NAVIGATION_GUARD = guard
    PAGE.route("**/*", guard)


def clear_public_navigation_guard() -> dict[str, Any]:
    global PUBLIC_NAVIGATION_GUARD, PUBLIC_NAVIGATION_ORIGIN, PUBLIC_NAVIGATION_DENIED
    if PUBLIC_NAVIGATION_GUARD is not None and PAGE is not None:
        PAGE.unroute("**/*", PUBLIC_NAVIGATION_GUARD)
    clear_interaction_guard()
    PUBLIC_NAVIGATION_GUARD = None
    PUBLIC_NAVIGATION_ORIGIN = ""
    PUBLIC_NAVIGATION_DENIED = None
    return {"cleared": True}


def managed_public_page(request: dict[str, Any]) -> dict[str, Any]:
    if PAGE is None:
        raise RuntimeError("Camoufox Driver has no active page.")
    expected = request.get("expected_origin")
    if not isinstance(expected, str) or public_origin(expected) != expected:
        return {"failure_class": "managed_public_origin_denied"}
    target = request.get("url")
    with contextlib.redirect_stdout(sys.stderr):
        if target is not None:
            if not isinstance(target, str) or public_origin(target) != expected:
                return {"failure_class": "managed_public_origin_denied"}
            install_public_navigation_guard(expected)
            try:
                PAGE.goto(target, wait_until="domcontentloaded", timeout=15_000)
            except Exception:
                if PUBLIC_NAVIGATION_DENIED:
                    return {"failure_class": PUBLIC_NAVIGATION_DENIED, "page": page_facts()}
                raise
        if public_origin(str(PAGE.url)) != expected:
            return {"failure_class": "managed_public_navigation_redirected" if target is not None else "managed_public_origin_denied", "page": page_facts()}
        if target is not None:
            return {"page": page_facts()}
        install_public_navigation_guard(expected)
        # Fixed read-only expression. No selectors, expressions or script from an Agent.
        observed = PAGE.evaluate("""mw:(expected => {
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
        if public_origin(str(PAGE.url)) != expected or not isinstance(observed, dict):
            return {"failure_class": "managed_public_origin_denied"}
        text = public_text(observed.get("text"), 4096)
        if not text:
            return {"failure_class": "managed_public_content_unavailable"}
        return {"page": page_facts(), "text": text, "truncated": observed.get("truncated") is True}


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
    global INTERACTION_GUARD
    if INTERACTION_GUARD is not None:
        PAGE.unroute("**/*", INTERACTION_GUARD)
        CONTEXT.unroute("**/*", INTERACTION_GUARD)
    INTERACTION_GUARD = None
    discard_interaction_snapshot()


def install_interaction_guard(expected: str) -> None:
    global INTERACTION_GUARD, PUBLIC_NAVIGATION_DENIED
    install_public_navigation_guard(expected)
    if INTERACTION_GUARD is not None:
        return
    def guard(route: Any) -> None:
        global PUBLIC_NAVIGATION_DENIED
        request = route.request
        if public_origin(request.url) != PUBLIC_NAVIGATION_ORIGIN:
            PUBLIC_NAVIGATION_DENIED = "managed_interaction_request_blocked"
            route.abort("blockedbyclient")
            return
        try:
            target_page = request_page(request)
            if target_page is not PAGE and page_state_for(target_page) is None:
                PUBLIC_NAVIGATION_DENIED = "managed_interaction_window_unsupported"
                route.abort("blockedbyclient")
                return
        except Exception:
            PUBLIC_NAVIGATION_DENIED = "managed_interaction_request_blocked"
            route.abort("blockedbyclient")
            return
        # The controlled Page and a Provider-registered background popup may
        # run same-origin validation requests. Each redirect hop is checked
        # before the next request is sent.
        response = None
        try:
            response = route.fetch(max_redirects=0, timeout=10_000)
            if 300 <= response.status < 400:
                follow_authorized_redirect(route, response, request, {expected}, "managed_public_redirect_blocked")
            else:
                route.fulfill(response=response)
        except Exception:
            PUBLIC_NAVIGATION_DENIED = "managed_interaction_request_blocked"
            route.abort("failed")
        finally:
            if response is not None:
                response.dispose()
    INTERACTION_GUARD = guard
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
    if action not in ("snapshot", "click", "input", "press", "scroll", "wait") or not isinstance(expected,str) or public_origin(expected) != expected or type(generation) is not int or generation < 0 or type(timeout) is not int or not 1 <= timeout <= 10000:
        return refused("managed_interaction_invalid_input")
    try:
        with contextlib.redirect_stdout(sys.stderr):
            provider_ref = request.get("provider_page_ref")
            selected = page_by_provider_ref(provider_ref) if isinstance(provider_ref, str) else page_state_for(PAGE)
            # Legacy fixture providers do not expose a private Page handle;
            # the existing single-Page interaction contract remains valid for
            # them while Camoufox uses the explicit provider binding.
            if isinstance(provider_ref, str) and (selected is None or selected.get("closed") or selected.get("page") is not PAGE):
                return refused("managed_interaction_page_not_active")
            failure = interaction_surface(expected)
            if failure:
                return refused(failure)
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
                    dispatched = True
                    target.fill(value, timeout=timeout)
                elif action == "press":
                    if request.get("key") not in ("Enter","Tab","Escape","ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Home","End","Backspace","Delete","Space"):
                        return refused("managed_interaction_key_refused")
                    dispatched = True
                    target.press(request["key"], timeout=timeout)
                else:
                    dispatched = True
                    target.click(timeout=timeout, no_wait_after=True)
            elif action == "scroll":
                delta = request.get("delta_y")
                if type(delta) is not int or delta == 0 or abs(delta) > 2000:
                    return refused("managed_interaction_scroll_refused")
                if target is not None:
                    if not target.is_visible():
                        return refused("managed_interaction_target_unavailable")
                    dispatched = True
                    target.hover(timeout=timeout)
                else:
                    viewport = PAGE.evaluate("mw:({width:innerWidth,height:innerHeight})")
                    dispatched = True
                    PAGE.mouse.move(viewport["width"]//2, viewport["height"]//2)
                if not state["handle"].evaluate("state => state.valid()"):
                    return refused("managed_interaction_stale_target")
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
            failure = interaction_surface(expected) or PUBLIC_NAVIGATION_DENIED
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
    global PLAYWRIGHT, CONTEXT, PAGE
    try:
        with contextlib.redirect_stdout(sys.stderr):
            try:
                if CONTEXT is not None:
                    CONTEXT.close()
            finally:
                if PLAYWRIGHT is not None:
                    PLAYWRIGHT.stop()
    finally:
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
                if PAGE is None:
                    raise RuntimeError("Camoufox Driver has no active page.")
                # Private pipe command; the expression is fixed by the Harbor adapter,
                # never accepted from the public HTTP API.
                with contextlib.redirect_stdout(sys.stderr):
                    observation = PAGE.evaluate("mw:" + request["expression"])
                send(message_id, "ok", observation=observation)
            elif op == "diagnostics_read":
                send(message_id, "ok", diagnostics=diagnostics_read(request))
            elif op == "environment_read":
                send(message_id, "ok", result=environment_read(request))
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

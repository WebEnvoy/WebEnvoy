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
import importlib.metadata
import hashlib
import json
import os
import platform
import re
import shutil
import sys
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse


PLAYWRIGHT: Any = None
PLAYWRIGHT_TIMEOUT_ERROR: type[BaseException] | None = None
CONTEXT: Any = None
PAGE: Any = None
PROFILE_DIR = ""
EXECUTABLE_PATH = ""
LAUNCH_EXECUTABLE_PATH = ""
LAUNCH_LAYOUT_DIR = ""
PROPERTIES_SOURCE = "adjacent"
PUBLIC_NAVIGATION_GUARD: Any = None
PUBLIC_NAVIGATION_ORIGIN = ""
PUBLIC_NAVIGATION_DENIED: str | None = None
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
    return "/<redacted>" if DIAGNOSTIC_SENSITIVE_PATH_PATTERN.search(decoded) else path or "/"


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


def diagnostic_event(kind: str, **payload: Any) -> None:
    global DIAGNOSTIC_CURSOR
    DIAGNOSTIC_CURSOR += 1
    DIAGNOSTIC_EVENTS.append({"event_ref": f"event:{DIAGNOSTIC_CURSOR}", "kind": kind, "observed_at": diagnostics_now(), "page_ref": DIAGNOSTIC_PAGE_REF, "document_generation": DIAGNOSTIC_DOCUMENT_GENERATION, **payload, "_cursor": DIAGNOSTIC_CURSOR})


def diagnostic_resource_kind(value: Any) -> str:
    return value if value in ("document", "script", "stylesheet", "image", "font", "xhr", "fetch", "websocket") else "other"


def diagnostic_page_origin(page: Any) -> str | None:
    try:
        current = diagnostics_url(str(page.url))
        return current[1] if current else None
    except Exception:
        return None


def diagnostic_cursor(position: int) -> str:
    return f"cursor:{DIAGNOSTIC_INSTANCE_REF}:{DIAGNOSTIC_PAGE_REF}:{DIAGNOSTIC_DOCUMENT_GENERATION}:{position}"


def parse_diagnostic_cursor(value: Any) -> int | None:
    if not isinstance(value, str):
        return None
    parts = value.split(":")
    if len(parts) != 5 or parts[0] != "cursor" or parts[1] != DIAGNOSTIC_INSTANCE_REF or parts[2] != DIAGNOSTIC_PAGE_REF or parts[3] != str(DIAGNOSTIC_DOCUMENT_GENERATION):
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
    DIAGNOSTIC_PAGE_REF = f"page_{uuid.uuid4().hex}"
    DIAGNOSTIC_DOCUMENT_GENERATION = 1
    pending_navigation: int | None = None

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
                if is_main_navigation(request):
                    pending_navigation = id(request)
                diagnostic_event("request", method=str(request.method)[:16].upper(), url=safe[0], origin=safe[1], resource_kind=diagnostic_resource_kind(request.resource_type))
                DIAGNOSTIC_REQUESTS[id(request)] = (DIAGNOSTIC_EVENTS[-1], time.monotonic())
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
                diagnostic_event("response", request_ref=event["event_ref"], page_ref=event["page_ref"], document_generation=event["document_generation"], method=str(response.request.method)[:16].upper(), url=safe[0], origin=safe[1], resource_kind=diagnostic_resource_kind(response.request.resource_type), status=int(response.status), duration_ms=round((time.monotonic() - started) * 1000), redirected=redirected)
        except Exception:
            pass

    def failed_event(request: Any) -> None:
        nonlocal pending_navigation
        try:
            safe = diagnostics_url(request.url)
            if safe:
                error_text = str(request.failure or "unknown").lower()
                failure = "timeout" if "timeout" in error_text else "aborted" if "abort" in error_text else "connection"
                if pending_navigation == id(request):
                    pending_navigation = None
                state = DIAGNOSTIC_REQUESTS.pop(id(request), None)
                if state is None:
                    return
                event, started = state
                diagnostic_event("failure", request_ref=event["event_ref"], page_ref=event["page_ref"], document_generation=event["document_generation"], method=str(request.method)[:16].upper(), url=safe[0], origin=safe[1], resource_kind=diagnostic_resource_kind(request.resource_type), failure_class=failure, duration_ms=round((time.monotonic() - started) * 1000), redirected=getattr(request, "redirected_from", None) is not None)
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
            diagnostic_event("console", _origin=event_origin, level="warn" if level == "warning" else "error", text=text, truncated=truncated, **({"source": {"url": source[0], "line": location.get("lineNumber", 0), "column": location.get("columnNumber", 0)}} if source else {}))
        except Exception:
            pass

    def page_error(error: Any) -> None:
        try:
            text, truncated = diagnostic_text(error)
            diagnostic_event("console", _origin=diagnostic_page_origin(page), level="pageerror", text=text, truncated=truncated)
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
                navigation = DIAGNOSTIC_REQUESTS.get(pending_navigation)
                rotate_diagnostic_page()
                if navigation is not None:
                    request_event_ref = navigation[0]["event_ref"]
                    for event in DIAGNOSTIC_EVENTS:
                        if event["event_ref"] == request_event_ref or event.get("request_ref") == request_event_ref:
                            event["page_ref"] = DIAGNOSTIC_PAGE_REF
                            event["document_generation"] = DIAGNOSTIC_DOCUMENT_GENERATION
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
    try:
        title = safe_text(str(PAGE.title()))[:256]
    except Exception:
        title = None
    origin = request.get("origin")
    current = diagnostics_url(str(PAGE.url))
    if not isinstance(origin, str) or not current or current[1] != origin:
        return {"status": "unavailable", "failure_class": "wrong_page", "message": "The active page origin does not match the requested origin.", "retryable": False}
    if request.get("page_ref") is not None and request.get("page_ref") != DIAGNOSTIC_PAGE_REF:
        return {"status": "unavailable", "failure_class": "stale_page", "message": "The requested Page binding is stale.", "retryable": False}
    cursor = request.get("cursor")
    after = parse_diagnostic_cursor(cursor) if cursor is not None else None
    oldest = DIAGNOSTIC_EVENTS[0]["_cursor"] if DIAGNOSTIC_EVENTS else DIAGNOSTIC_CURSOR + 1
    if cursor is not None and (after is None or after > DIAGNOSTIC_CURSOR or after < oldest - 1):
        return {"status": "unavailable", "failure_class": "cursor_stale", "message": "The diagnostics cursor is invalid or no longer retained for this Instance Page generation.", "retryable": True}
    if after is None:
        after = oldest - 1
    limit = request.get("limit", 64)
    high_watermark = DIAGNOSTIC_CURSOR
    retained = [event for event in DIAGNOSTIC_EVENTS if event["_cursor"] > after and event["_cursor"] <= high_watermark and event.get("page_ref") == DIAGNOSTIC_PAGE_REF and event.get("document_generation") == DIAGNOSTIC_DOCUMENT_GENERATION and event.get("origin", event.get("_origin")) == current[1]]
    events = retained[:max(1, min(64, int(limit)))]
    network, console = [], []
    for event in events:
        public = {key: value for key, value in event.items() if not key.startswith("_")}
        if event["kind"] == "console":
            console.append(public)
        else:
            network.append(public)
    last = events[-1]["_cursor"] if events else after
    return {"status": "completed", "page_ref": DIAGNOSTIC_PAGE_REF, "document_generation": DIAGNOSTIC_DOCUMENT_GENERATION, "page": {"current_url": current[0], "title": title, "status": "ready"}, "cursor": diagnostic_cursor(after), "next_cursor": diagnostic_cursor(last), "truncated": (oldest > 1 and after == oldest - 1) or len(retained) > len(events), "observed_at": diagnostics_now(), "network": network, "console": console}


def safe_error(error: BaseException) -> str:
    message = str(error).replace(PROFILE_DIR, "<profile>").replace(EXECUTABLE_PATH, "<browser>")
    message = safe_text(" ".join(message.split()))[:240]
    return f"{type(error).__name__}: {message}" if message else type(error).__name__


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


def launch(request: dict[str, Any]) -> dict[str, Any]:
    global PLAYWRIGHT, PLAYWRIGHT_TIMEOUT_ERROR, CONTEXT, PAGE, PROFILE_DIR, EXECUTABLE_PATH, LAUNCH_EXECUTABLE_PATH, PROPERTIES_SOURCE, DIAGNOSTIC_EVENTS, DIAGNOSTIC_CURSOR, DIAGNOSTIC_INSTANCE_REF
    PROFILE_DIR = str(request.get("profile_dir", ""))
    EXECUTABLE_PATH = str(request.get("executable_path", ""))
    if not PROFILE_DIR or not EXECUTABLE_PATH:
        raise ValueError("Camoufox Driver launch requires an executable and managed profile.")
    if sys.version_info[:2] != (3, 12) or importlib.metadata.version("camoufox") != "0.5.6" or importlib.metadata.version("playwright") != "1.60.0":
        raise ValueError("Camoufox Driver runtime does not match the qualified Python/package pins.")
    parser = configparser.ConfigParser()
    parser.read(Path(EXECUTABLE_PATH).parent.parent / "Resources" / "application.ini")
    if parser.get("App", "Version", fallback="") != "152.0.4-beta.30":
        raise ValueError("Camoufox browser does not match the qualified version pin.")
    properties = Path(EXECUTABLE_PATH).parent.parent / "Resources" / "properties.json"
    if hashlib.sha256(properties.read_bytes()).hexdigest() != "10d5cfb6c8eb3824485734362a3920e07b36c3801770fffcc14a3546e56f81f4":
        raise ValueError("Camoufox properties.json does not match the qualified browser schema pin.")
    LAUNCH_EXECUTABLE_PATH, PROPERTIES_SOURCE = prepare_properties(EXECUTABLE_PATH)
    from camoufox import NewBrowser, launch_options
    from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, sync_playwright
    PLAYWRIGHT_TIMEOUT_ERROR = PlaywrightTimeoutError

    locale = request.get("locale")
    timezone = request.get("timezone")
    viewport = request.get("viewport")
    proxy_server = request.get("proxy_server")
    config = {"timezone": timezone} if isinstance(timezone, str) and timezone else {}
    proxy = {"server": proxy_server} if isinstance(proxy_server, str) and proxy_server else None
    window = None
    if isinstance(viewport, dict) and isinstance(viewport.get("width"), int) and isinstance(viewport.get("height"), int):
        window = (viewport["width"], viewport["height"])

    target_os = {"darwin": "macos", "win32": "windows", "linux": "linux"}.get(sys.platform, "linux")
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
            proxy=proxy,
            enable_cache=True,
            main_world_eval=True,
            i_know_what_im_doing=True,
        )
        PLAYWRIGHT = sync_playwright().start()
        # NewBrowser is the package's public persistent-context entrypoint. It
        # also applies Camoufox's no_viewport rule when a spoofed window is
        # configured, which avoids the known Juggler viewport handshake hang.
        CONTEXT = NewBrowser(PLAYWRIGHT, from_options=options, persistent_context=True)
        PAGE = CONTEXT.pages[0] if CONTEXT.pages else CONTEXT.new_page()
        DIAGNOSTIC_EVENTS.clear()
        DIAGNOSTIC_REQUESTS.clear()
        DIAGNOSTIC_CURSOR = 0
        DIAGNOSTIC_INSTANCE_REF = uuid.uuid4().hex
        attach_diagnostics(PAGE)
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
      (el.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => doc.getElementById(id)?.innerText || '').join(' ').trim() ||
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
            if request.frame.page != PAGE:
                PUBLIC_NAVIGATION_DENIED = "managed_interaction_window_unsupported"
                route.abort("blockedbyclient")
                return
        except Exception:
            PUBLIC_NAVIGATION_DENIED = "managed_interaction_request_blocked"
            route.abort("blockedbyclient")
            return
        # The controlled page may run same-origin validation requests, but no
        # redirect is followed, including redirects from XHR and subresources.
        response = None
        try:
            response = route.fetch(max_redirects=0, timeout=10_000)
            if 300 <= response.status < 400:
                PUBLIC_NAVIGATION_DENIED = "managed_public_redirect_blocked"
                route.abort("blockedbyclient")
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
    if parsed.query or parsed.fragment or parsed.username or parsed.password:
        return "managed_interaction_url_unsupported"
    if len(CONTEXT.pages) != 1 or len(PAGE.frames) != 1:
        return "managed_interaction_window_unsupported"
    return None


class InteractionSnapshotError(Exception):
    pass


def interaction_snapshot(generation: int) -> dict[str, Any]:
    global INTERACTION_STATE
    page_ref = DIAGNOSTIC_PAGE_REF or "page_" + uuid.uuid4().hex
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

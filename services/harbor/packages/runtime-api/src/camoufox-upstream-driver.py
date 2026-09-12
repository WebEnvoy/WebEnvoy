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

from camoufox.utils import launch_options
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


def write_bundle(profile_dir: str, options: dict[str, Any], context_options: dict[str, Any]) -> dict[str, Any]:
    config = dict(options.get("env") or {})
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


def load_bundle(profile_dir: str) -> dict[str, Any]:
    path = bundle_path(profile_dir)
    if path.is_symlink() or not path.is_file() or path.stat().st_mode & 0o077:
        raise ValueError("Camoufox environment bundle is unsafe.")
    bundle = json.loads(path.read_text(encoding="utf-8"))
    validate_environment_bundle(bundle)
    options = bundle.get("launch_options")
    if not isinstance(options, dict):
        raise ValueError("Camoufox environment bundle has no complete launch options.")
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
    locale = environment.get("language") if isinstance(environment.get("language"), str) and environment["language"] else None
    proxy = {"server": environment["proxy_server"]} if isinstance(environment.get("proxy_server"), str) and environment["proxy_server"] else None
    context_options = {"viewport": viewport} if (viewport := parse_viewport(environment.get("viewport"))) else {}
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
    bundle = write_bundle(profile_dir, options, context_options)
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
        self.controls: dict[str, tuple[str, str]] = {}
        self.events: list[dict[str, Any]] = []
        self.last_url = page.url

    def facts(self, active: bool = False) -> dict[str, Any]:
        current = safe_url(self.page.url)
        return {
            "provider_page_ref": self.ref,
            "current_url": current,
            "title": safe_text(self.page.title() if not self.page.is_closed() else "", 256),
            "status": "closed" if self.page.is_closed() else "ready" if current else "unknown",
            "origin": origin_of(current or "") if current else None,
            "active": active,
            "document_generation": self.generation,
            **({"opener_provider_page_ref": self.opener} if self.opener else {}),
            "facts": [],
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
        self.playwright = sync_playwright().start()
        launch = dict(self.options)
        launch.update(self.context_options)
        launch["user_data_dir"] = profile_dir
        self.context = self.playwright.firefox.launch_persistent_context(**launch)
        self.pages: dict[str, PageState] = {}
        self.next_ref = 1
        self.current: str | None = None
        self.context.on("page", self.on_page)
        self.context.route("**/*", self.route)
        page = self.context.pages[0] if self.context.pages else self.context.new_page()
        initial_origin = origin_of(str(request.get("url", "")))
        state = next((item for item in self.pages.values() if item.page == page), None)
        if state is None:
            state = self.register(page, [initial_origin] if initial_origin else [])
        else:
            state.origins.update([initial_origin] if initial_origin else [])
        self.current = state.ref
        self.navigate(state, str(request.get("url", "about:blank")), [initial_origin] if initial_origin else [])

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
        if any(item.page == page for item in self.pages.values()):
            return
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
        # The first popup request was already handled by route(). Registering
        # this later Page event only records the real object; it never replays
        # or continues the rejected navigation.
        self.register(page, opener_origins, opener_ref)

    def route(self, route: Route) -> None:
        request = route.request
        try:
            page = request.frame.page
        except PlaywrightError:
            route.abort("blockedbyclient")
            return
        state = next((item for item in self.pages.values() if item.page == page), None)
        request_origin = origin_of(request.url)
        # This check is deliberately before continue/fetch: an unowned popup
        # cannot acquire a Page by racing its first navigation request.
        if state is None:
            route.abort("blockedbyclient")
            return
        if request_origin is None or request_origin not in state.origins:
            route.abort("blockedbyclient")
            return
        route.continue_()

    def navigate(self, state: PageState, url: str, origins: list[str]) -> dict[str, Any]:
        target_origin = origin_of(url)
        if not target_origin or target_origin not in set(origins or state.origins):
            raise ValueError("Page navigation origin is not authorized.")
        state.origins.update(origins)
        state.page.goto(url, wait_until="domcontentloaded", timeout=int(self.request.get("timeout_ms", 60_000)))
        return state.facts(state.ref == self.current)

    def on_navigate(self, state: PageState, frame: Any) -> None:
        if frame != state.page.main_frame:
            return
        if state.page.url != state.last_url:
            state.generation += 1
            state.last_url = state.page.url

    def list_pages(self) -> list[dict[str, Any]]:
        return [state.facts(state.ref == self.current) for state in self.pages.values() if not state.page.is_closed()]

    def interact(self, request: dict[str, Any]) -> dict[str, Any]:
        state = self.state(request)
        action = request.get("action")
        expected = request.get("expected_origin")
        if not isinstance(expected, str) or expected not in state.origins or origin_of(state.page.url) != expected:
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
            if (e.tagName === 'TEXTAREA' || (e.tagName === 'INPUT' && !['checkbox','radio','file','hidden','button','submit','reset'].includes(e.type))) return 'textbox';
            if (e.tagName === 'INPUT' && e.type === 'checkbox') return 'checkbox';
            if (e.tagName === 'INPUT' && e.type === 'radio') return 'radio';
            if (e.tagName === 'SELECT') return 'combobox';
            return null;
          };
          const nodes = [...document.querySelectorAll('button,a,input,textarea,select,[role]')].filter(visible).map(e => ({ e, role: implicitRole(e) })).filter(item => item.role).slice(0,128);
          return { text: (document.body?.innerText || '').slice(0,65536), controls: nodes.map((item,i) => ({ i, role: item.role, name: (item.e.getAttribute('aria-label') || item.e.innerText || item.e.value || '').trim().slice(0,256), enabled: !item.e.disabled })) };
        }""")
        controls = []
        state.controls.clear()
        for item in (raw.get("controls", []) if isinstance(raw, dict) else []):
            if not isinstance(item, dict) or not isinstance(item.get("i"), int) or not isinstance(item.get("role"), str) or not isinstance(item.get("name"), str):
                continue
            ref = f"control:{item['i']}"
            state.controls[ref] = (item["role"], item["name"])
            controls.append({"target_ref": ref, "role": safe_text(item["role"], 64), "name": safe_text(item["name"], 256), "enabled": item.get("enabled") is True})
        text = safe_text(raw.get("text", "") if isinstance(raw, dict) else "")
        return {"page_ref": state.ref, "observation_ref": f"observation:{state.ref}:{state.generation}", "controls": controls, "text": text, "truncated": len(text) >= MAX_TEXT}

    def locator(self, state: PageState, request: dict[str, Any]):
        ref = request.get("target_ref")
        if not isinstance(ref, str) or ref not in state.controls:
            raise ValueError("Target ref is not from the current Page observation.")
        role, name = state.controls[ref]
        return state.page.get_by_role(role, name=name, exact=True)

    def observe(self, request: dict[str, Any]) -> dict[str, Any]:
        state = self.state(request)
        raw = state.page.evaluate("""() => ({ current_url: location.origin + location.pathname, title: document.title.slice(0,256), ready_state: document.readyState, stable_id: null })""")
        raw["document_generation"] = state.generation
        return {**state.facts(state.ref == self.current), "observation": raw}

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
        bundle_hash = hashlib.sha256(canonical_json(self.bundle)).hexdigest()
        return {"status": "completed", "observed_at": now(), "provider": {"camoufox_version": CAMOUFOX_VERSION_PIN, "browser_version": BROWSER_VERSION_PIN, "properties_sha256": PROPERTIES_SHA256_PIN}, "bundle_hash": bundle_hash, "observed": observed, "continuity": {"state": "unknown", "checked_fields": [], "changed_fields": [], "unknown_fields": ["screen", "hardware_concurrency", "webgl_vendor", "webgl_renderer", "canvas_hash", "audio_hash"]}}

    def screenshot(self, request: dict[str, Any]) -> dict[str, Any]:
        state = self.state(request)
        path = Path(self.profile_dir, f".webenvoy-screenshot-{time.time_ns()}.png")
        state.page.screenshot(path=str(path), type="png")
        data = path.read_bytes()
        return {"status": "completed", "screenshot_ref": "screenshot:" + hashlib.sha256(data).hexdigest(), "mime_type": "image/png", "byte_length": len(data), "sha256": hashlib.sha256(data).hexdigest(), "captured_at": now()}

    def state(self, request: dict[str, Any]) -> PageState:
        ref = request.get("provider_page_ref")
        if not isinstance(ref, str) or ref not in self.pages:
            raise ValueError("Page relation is unavailable.")
        return self.pages[ref]

    def close(self) -> None:
        self.context.close()
        self.playwright.stop()

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


def dispatch(driver: Driver, request: dict[str, Any]) -> Any:
    op = request.get("op")
    if op == "page_list": return driver.list_pages()
    if op == "page_open":
        origins = [item for item in request.get("authorized_origins", []) if isinstance(item, str)]
        page = driver.context.new_page()
        state = next((item for item in driver.pages.values() if item.page == page), None) or driver.register(page, origins)
        state.origins.update(origins)
        driver.current = state.ref
        if request.get("url"):
            driver.navigate(state, request["url"], origins)
        return state.facts(True)
    if op == "page_activate":
        state = driver.state(request)
        driver.current = state.ref
        return state.facts(True)
    if op == "page_close":
        state = driver.state(request)
        state.page.close()
        driver.pages.pop(state.ref, None)
        target = request.get("safe_return_provider_page_ref")
        if isinstance(target, str) and target in driver.pages:
            driver.current = target
        elif driver.pages:
            driver.current = next(iter(driver.pages))
        return driver.list_pages()
    if op == "page_navigate":
        state = driver.state(request)
        if request.get("action") == "reload": state.page.reload()
        elif request.get("action") == "back": state.page.go_back()
        elif request.get("action") == "forward": state.page.go_forward()
        else: driver.navigate(state, str(request.get("url", "")), [item for item in request.get("authorized_origins", []) if isinstance(item, str)])
        return state.facts(state.ref == driver.current)
    if op == "observe": return driver.observe(request)
    if op == "observe_identity": return driver.observe(request).get("observation", {})
    if op == "interact": return driver.interact(request)
    if op == "read_public_page": return driver.public_page(request)
    if op == "diagnostics": return driver.diagnostics(request)
    if op == "environment": return driver.environment(request)
    if op == "screenshot": return driver.screenshot(request)
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
                result = {"status": "ready", "driver_ref": "camoufox-upstream-jsonl", "page": driver.pages[driver.current].facts(True), "pages": driver.list_pages(), "viewer_entry": {"availability": "available", "access_mode": "native_window", "transport": "native", "input_capabilities": ["mouse", "keyboard"]}, "facts": [{"key": "driver.api", "source": "observed", "value": "playwright_public"}, {"key": "launch_options.replay", "source": "observed", "value": "exact" if driver.replay else "created"}, {"key": "provider.camoufox.properties_sha256", "source": "validation_evidence", "value": driver.properties_sha256}]}
            elif driver is None:
                raise ValueError("Driver has not launched.")
            else:
                result = dispatch(driver, request)
            print(json.dumps({"id": message_id, "status": "ok", "result": result}, ensure_ascii=False, separators=(",", ":")), flush=True)
        except BaseException as error:
            print(json.dumps({"id": message_id, "status": "error", "message": f"{type(error).__name__}: {safe_text(error, 240)}"}, ensure_ascii=False, separators=(",", ":")), flush=True)


if __name__ == "__main__":
    main()

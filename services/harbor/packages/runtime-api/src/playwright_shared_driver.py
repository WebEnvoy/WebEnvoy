#!/usr/bin/env python3
"""Shared JSONL bridge for public Playwright Provider execution.

Provider adapters own source/version validation and launch options. This file
owns the one event loop, Context/Page set, request guard, files, diagnostics,
and lifecycle shared by every adapter.
"""

from __future__ import annotations

import hashlib
import asyncio
import inspect
import json
import os
import re
import shutil
import sys
import tempfile
import time
from pathlib import Path
from typing import Any
from urllib.parse import urljoin
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from playwright.async_api import Error as PlaywrightError
from playwright.async_api import Page, Route, TimeoutError, async_playwright


MAX_EVENTS = 64
MAX_PENDING_COMMANDS = 64
MAX_TEXT = 64 * 1024
MAX_LINE = 2 * 1024 * 1024
MAX_REDIRECT_HOPS = 10
REDIRECT_STATUSES = frozenset({300, 301, 302, 303, 307, 308})
MAX_WAIT_MS = 10_000
WAIT_POLL_MS = 50
MAX_SNAPSHOT_LIMIT = 128
MAX_OBSERVATION_ELEMENTS = 20_000
MAX_OBSERVATION_CONTROLS = 2_048
# Keep the browser operation comfortably inside the managed-task request
# deadline. Control coverage reports scan_limit_reached when this budget ends;
# the independent page-text observation can still complete.
MAX_OBSERVATION_CAPTURE_MS = 18_000
SNAPSHOT_DIAGNOSTIC_SAMPLE_INTERVAL = 32
MAX_OBSERVATION_METADATA_BYTES = 2 * 1024 * 1024
MAX_OBSERVATION_RESPONSE_BYTES = 256 * 1024
MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024
MAX_DOWNLOAD_TEMP_BYTES = MAX_DOWNLOAD_BYTES * 2
MAX_DOWNLOAD_TIMEOUT_MS = 120_000
DOWNLOAD_MONITOR_INTERVAL_S = 0.05
DOWNLOAD_CANCEL_GRACE_S = 0.25
DOWNLOAD_SETTLE_GRACE_S = 5.0
REF = re.compile(r"^[A-Za-z0-9:_./-]{1,256}$")
SENSITIVE = re.compile(r"(?:bearer\s+\S+|(?:token|cookie|password|secret|authorization)\s*[:=]\s*[^\s,}]+)", re.I)
OBSERVATION_ROLES = frozenset({
    "button", "link", "textbox", "searchbox", "checkbox", "radio", "switch", "combobox",
    "listbox", "option", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "slider",
    "spinbutton", "treeitem", "file"
})
OBSERVATION_SELECTOR = 'button,a[href],input,textarea,select,[role],[contenteditable="true"],[contenteditable=""]'
ARIA_SNAPSHOT_ROOT = re.compile(r'^-\s+([A-Za-z][A-Za-z0-9_-]*)(?:\s+"((?:[^"\\]|\\.)*)")?(?::.*)?$')


class ObservationFailure(Exception):
    def __init__(self, failure_class: str):
        super().__init__(failure_class)
        self.failure_class = failure_class


class TargetFailure(Exception):
    def __init__(self, failure_class: str):
        super().__init__(failure_class)
        self.failure_class = failure_class


class DownloadTimeout(Exception):
    def __init__(self, *args: Any, pending_tasks: tuple[asyncio.Task[Any], ...] = ()) -> None:
        super().__init__(*args)
        self.pending_tasks = pending_tasks


class DownloadLimitExceeded(Exception):
    pass


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


SCOPE_SEMANTICS = frozenset({"legacy_request_guard_v1", "agent_operations_v2"})


def validated_scope_semantics(value: Any, default: str = "legacy_request_guard_v1") -> str:
    if value is None:
        value = default
    if not isinstance(value, str) or value not in SCOPE_SEMANTICS:
        raise ValueError("Managed scope semantics are invalid.")
    return value


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
        raise ValueError("Provider timezone is invalid.")
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError) as error:
        raise ValueError("Provider timezone is not a valid IANA timezone.") from error
    return value


def safe_text(value: Any, limit: int = MAX_TEXT) -> str:
    text = value if isinstance(value, str) else str(value or "")
    text = re.sub(r"[\x00-\x1f\x7f]", " ", text)
    if SENSITIVE.search(text):
        return "[redacted]"
    text = re.sub(r"([?&][^=\s&]+)=([^\s&#]*)", r"\1=<redacted>", text)
    return " ".join(text.split())[:limit]


def safe_text_bytes(value: Any, limit: int = MAX_TEXT) -> tuple[str, bool]:
    """Return sanitized text bounded by UTF-8 bytes, at a codepoint boundary."""
    text = value if isinstance(value, str) else str(value or "")
    text = re.sub(r"[\x00-\x1f\x7f]", " ", text)
    if SENSITIVE.search(text):
        text = "[redacted]"
    else:
        text = re.sub(r"([?&][^=\s&]+)=([^\s&#]*)", r"\1=<redacted>", text)
    text = " ".join(text.split())
    encoded = text.encode("utf-8")
    if len(encoded) <= limit:
        return text, False
    return encoded[:limit].decode("utf-8", "ignore"), True


def private_fingerprint(value: Any) -> str:
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


# This is deliberately a small DOM projection, not an accessible-name engine.
# It reads only the element being retained and its bounded label/description
# references.  The original ElementHandle remains the action identity.
CONTROL_SEMANTICS_SCRIPT = r"""e => {
  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const bounded = (value, limit) => clean(String(value ?? '').slice(0, limit + 1));
  const idsText = value => clean(String(value ?? '').split(/\s+/).filter(Boolean).map(id => {
    const node = document.getElementById(id);
    return node ? bounded(node.textContent, 513) : '';
  }).filter(Boolean).join(' '));
  const attrName = node => {
    const labelledby = node.getAttribute('aria-labelledby');
    if (labelledby && idsText(labelledby)) return ['aria_labelledby', idsText(labelledby)];
    const aria = node.getAttribute('aria-label');
    if (aria && clean(aria)) return ['aria_label', clean(aria)];
    const labels = node.labels ? Array.from(node.labels).map(label => clean(label.textContent)).filter(Boolean).join(' ') : '';
    if (labels) return ['html_label', labels];
    const tag = node.tagName.toLowerCase();
    const role = (node.getAttribute('role') || '').trim().split(/\s+/)[0].toLowerCase();
    const contentRoles = new Set(['button', 'link', 'option', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio']);
    const content = tag === 'button' || contentRoles.has(role) || (tag === 'input' && ['button', 'submit', 'reset', 'image'].includes(node.type))
      ? clean(node.innerText || node.textContent || node.value || '') : '';
    if (content) return ['content', content];
    const image = node.querySelector ? node.querySelector('img[alt], [role="img"][aria-label]') : null;
    const alt = image ? clean(image.getAttribute('alt') || image.getAttribute('aria-label')) : clean(node.getAttribute('alt'));
    if (alt) return ['alt', alt];
    const title = clean(node.getAttribute('title'));
    if (title) return ['title', title];
    return ['none', ''];
  };
  const named = node => attrName(node)[1];
  const contextName = node => {
    const direct = attrName(node)[1];
    if (direct) return direct;
    const legend = node.tagName.toLowerCase() === 'fieldset' ? node.querySelector('legend') : null;
    if (legend) return clean(legend.textContent);
    if (node.tagName.toLowerCase() === 'form') return clean(node.getAttribute('name'));
    const heading = node.querySelector ? node.querySelector(':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6') : null;
    return heading ? clean(heading.textContent) : '';
  };
  const context = [];
  const seen = new Set();
  const ancestors = [];
  for (let node = e.parentElement; node; node = node.parentElement) ancestors.push(node);
  for (const node of ancestors.reverse()) {
    const tag = node.tagName.toLowerCase();
    const role = (node.getAttribute('role') || '').trim().split(/\s+/)[0].toLowerCase();
    let kind = null;
    if (tag === 'form') kind = 'form';
    else if (tag === 'fieldset') kind = 'group';
    else if (['group', 'dialog', 'region'].includes(role)) kind = role;
    else if (/^h[1-6]$/.test(tag)) kind = 'heading';
    if (!kind) continue;
    const name = contextName(node);
    if (!name || seen.has(`${kind}:${name}`)) continue;
    seen.add(`${kind}:${name}`);
    context.push({kind, name: bounded(name, 129)});
    if (context.length === 2) break;
  }
  const explicitRole = (e.getAttribute('role') || '').trim().split(/\s+/)[0].toLowerCase();
  const tag = e.tagName.toLowerCase();
  const inputType = tag === 'input' ? String(e.type || 'text').toLowerCase() : null;
  let role = explicitRole;
  if (!role) {
    if (tag === 'button' || (tag === 'input' && ['button', 'submit', 'reset', 'image'].includes(inputType))) role = 'button';
    else if (tag === 'a' && e.hasAttribute('href')) role = 'link';
    else if (tag === 'input' && inputType === 'file') role = 'file';
    else if (tag === 'textarea' || (tag === 'input' && !['checkbox', 'radio', 'file', 'hidden', 'button', 'submit', 'reset', 'image'].includes(inputType))) role = 'textbox';
    else if (tag === 'input' && inputType === 'checkbox') role = 'checkbox';
    else if (tag === 'input' && inputType === 'radio') role = 'radio';
    else if (tag === 'select') role = 'combobox';
    else if (e.isContentEditable) role = 'textbox';
  }
  const allowed = new Set(['button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio', 'switch', 'combobox', 'listbox', 'option', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'slider', 'spinbutton', 'treeitem', 'file']);
  if (!allowed.has(role)) return null;
  for (let node = e; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (node.hidden || node.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden') return null;
  }
  const rect = e.getBoundingClientRect();
  if (!(rect.width > 0 && rect.height > 0)) return null;
  const [nameSource, rawName] = attrName(e);
  const description = idsText(e.getAttribute('aria-describedby'));
  const placeholder = e.getAttribute('placeholder');
  const editable = tag === 'textarea' || (tag === 'input' && !['button', 'submit', 'reset', 'image', 'checkbox', 'radio', 'file', 'hidden'].includes(inputType)) || e.isContentEditable === true;
  const hints = {
    placeholder: placeholder === null ? null : bounded(placeholder, 129),
    input_type: inputType,
    multiline: tag === 'textarea' || (e.isContentEditable === true && e.getAttribute('aria-multiline') === 'true') || (e.getAttribute('aria-multiline') === 'true'),
    editable: editable ? true : (['input', 'textarea', 'select'].includes(tag) || e.isContentEditable === false ? false : null)
  };
  const href = tag === 'a' ? e.getAttribute('href') : null;
  const form = e.form || (e.closest ? e.closest('form') : null);
  const submitType = tag === 'button' ? String(e.type || 'submit').toLowerCase() : inputType;
  const submitControl = form !== null && ((tag === 'button' && submitType === 'submit') || (tag === 'input' && ['submit', 'image'].includes(submitType)));
  const formaction = submitControl ? e.getAttribute('formaction') : null;
  const formmethod = submitControl ? e.getAttribute('formmethod') : null;
  const action = {
    href,
    download: e.hasAttribute('download') ? e.getAttribute('download') : null,
    target: e.getAttribute('target'),
    form: form ? {
      action: submitControl && formaction !== null && typeof e.formAction === 'string' ? e.formAction : form.action,
      method: submitControl && formmethod !== null && typeof e.formMethod === 'string' ? String(e.formMethod).toLowerCase() : String(form.method || 'get').toLowerCase(),
      formaction,
      formmethod
    } : null
  };
  return {
    role, name: bounded(rawName, 257), name_source: nameSource,
    description: description ? bounded(description, 257) : null,
    context, hints, href, action,
    enabled: !e.disabled && e.getAttribute('aria-disabled') !== 'true',
    semantic: {role, name: bounded(rawName, 257), description: description ? bounded(description, 257) : null, context, hints, action: {...action, form: form ? {action: form.getAttribute('action'), method: (form.getAttribute('method') || 'get').toLowerCase()} : null}}
  };
}"""


def parse_viewport(value: Any) -> dict[str, int] | None:
    if value is None or value == "系统默认":
        return None
    if isinstance(value, dict):
        if set(value) != {"width", "height"} or type(value.get("width")) is not int or type(value.get("height")) is not int:
            raise ValueError("Provider viewport is invalid.")
        if not 200 <= value["width"] <= 16384 or not 200 <= value["height"] <= 16384:
            raise ValueError("Provider viewport is invalid.")
        return {"width": value["width"], "height": value["height"]}
    if not isinstance(value, str):
        raise ValueError("Provider viewport is invalid.")
    match = re.fullmatch(r"(\d{2,5})x(\d{2,5})", value)
    if not match or not 200 <= int(match[1]) <= 16384 or not 200 <= int(match[2]) <= 16384:
        raise ValueError("Provider viewport is invalid.")
    return {"width": int(match[1]), "height": int(match[2])}


def canonical_executable_path(value: Any) -> str:
    if not isinstance(value, str) or not value or "\x00" in value:
        raise ValueError("Provider browser executable is missing.")
    try:
        path = Path(value).resolve(strict=True)
    except (OSError, RuntimeError, ValueError) as error:
        raise ValueError("Provider browser executable is unavailable.") from error
    if not path.is_file():
        raise ValueError("Provider browser executable is not a file.")
    return str(path)


class PageState:
    def __init__(self, ref: str, page: Page, origins: list[str], opener: str | None = None, scope_semantics: str = "legacy_request_guard_v1"):
        self.ref = ref
        self.page = page
        self.origins = set(origins)
        self.opener = opener
        self.scope_semantics = validated_scope_semantics(scope_semantics)
        self.generation = 1
        # The optional fifth tuple member is the exact ElementHandle captured
        # by snapshot.  Four-member tuples remain accepted for old generic
        # interaction fixtures, but file operations fail closed without the
        # identity-bound handle.
        self.controls: dict[str, tuple[Any, ...]] = {}
        # Metadata is kept beside the historical tuple shape so older fixture
        # callers remain compatible while new targets retain their exact
        # semantics and exposure state.
        self.control_metadata: dict[str, dict[str, Any]] = {}
        self.snapshot_batch: dict[str, Any] | None = None
        self.snapshot_serial = 0
        self.events: list[dict[str, Any]] = []
        self.request_chains: list[tuple[Any, tuple[str, ...]]] = []
        self.last_url = page.url
        self.relation_pending = False
        self.relation_rejection = False
        self.relation_rejection_count = 0

    async def facts(self, task_selected: bool = False) -> dict[str, Any]:
        # A user may close a Page between any two public Playwright reads.
        # Treat a target-closed read as a trusted tombstone so one stale Page
        # cannot make the whole Page list unavailable while other Pages live.
        closed: bool | None = False
        try:
            closed = self.page.is_closed()
        except PlaywrightError:
            closed = None
        generation = self.generation
        try:
            current = safe_url(self.page.url)
        except PlaywrightError:
            current = None
            try:
                closed = self.page.is_closed()
            except PlaywrightError:
                closed = None
        title = ""
        if closed is not True and not (
            self.scope_semantics == "agent_operations_v2"
            and current is not None
            and origin_of(current) not in self.origins
        ):
            try:
                title = safe_text(await self.page.title(), 256)
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
                try:
                    current = safe_url(self.page.url)
                except PlaywrightError:
                    current = None
                if self.generation != generation:
                    title = ""
        if self.scope_semantics == "agent_operations_v2" and current is not None and origin_of(current) not in self.origins:
            # A natural click may leave the authorized origin. Keep the
            # boundary observable without exposing path/query/title content.
            current_origin = origin_of(current)
            current = current_origin if current_origin is not None else "unknown"
            title = ""
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

    def add_request_chain(self, request: Any, urls: list[str]) -> None:
        self.request_chains.append((request, tuple(urls)))
        del self.request_chains[:-MAX_EVENTS]

    def request_chain(self, request: Any) -> tuple[str, ...] | None:
        for candidate, urls in reversed(self.request_chains):
            if candidate is request:
                return urls
        return None

    async def clear_controls(self) -> None:
        for ref, control in self.controls.items():
            handle = control[4] if len(control) > 4 else None
            metadata = self.control_metadata.get(ref, {})
            form_handle = metadata.get("form_handle") if isinstance(metadata, dict) else None
            if handle is not None:
                try:
                    dispose = getattr(handle, "dispose", None)
                    if callable(dispose):
                        await dispose()
                except Exception:
                    pass
            if form_handle is not None and form_handle is not handle:
                try:
                    dispose = getattr(form_handle, "dispose", None)
                    if callable(dispose):
                        await dispose()
                except Exception:
                    pass
        self.controls.clear()
        self.control_metadata.clear()
        self.snapshot_batch = None


_DEFAULT_ADAPTER: Any | None = None


def set_default_adapter(adapter: Any) -> None:
    global _DEFAULT_ADAPTER
    _DEFAULT_ADAPTER = adapter


class Driver:
    def __init__(self, request: dict[str, Any], adapter: Any):
        profile_dir = request.get("profile_dir")
        if not isinstance(profile_dir, str) or not profile_dir:
            raise ValueError("Managed Profile is required.")
        self.adapter = adapter
        verify = getattr(adapter, "verify", None)
        if not callable(verify):
            raise ValueError("Provider adapter is unavailable.")
        self.provider_facts = list(verify(request))
        self.request = request
        self.scope_semantics = validated_scope_semantics(request.get("scope_semantics"))
        self.profile_dir = profile_dir
        prepare = getattr(adapter, "prepare", None)
        if not callable(prepare):
            raise ValueError("Provider adapter launch options are unavailable.")
        self.options, self.provider_state, self.replay, self.context_options = prepare(request, profile_dir)
        # Keep the historical opaque state alias available to callers that
        # inspect a Driver directly; adapters still own its meaning.
        self.bundle = self.provider_state
        self.unattributed_rejection_count = 0
        self.pages: dict[str, PageState] = {}
        self.next_ref = 1
        self.current: str | None = None
        self.playwright: Any = None
        self.context: Any = None
        self.downloads_root: Path | None = None
        # Every Playwright object is owned by the asyncio loop that calls
        # ``start``. The lock serializes ordinary commands; close first sets
        # ``close_requested`` so a pending passive wait can return and release
        # the lock before the public Context.close call begins.
        self.operation_lock = asyncio.Lock()
        self.close_requested = asyncio.Event()
        self.close_lock = asyncio.Lock()
        self._closing_context: Any = None
        self._closing_playwright: Any = None
        self._close_error: BaseException | None = None
        self._close_finalized = False
        self._close_completed = False
        self._close_in_progress: asyncio.Task[Any] | None = None
        # An adapter may own a browser process outside Playwright's Context
        # (the official Chrome public-connection path).  Keep its shutdown
        # behind one idempotent seam so Context.close, EOF and owner close all
        # converge on the same resource boundary.
        self._owned_resources_closed = False
        self._owned_resources_close_error: BaseException | None = None
        # A Provider Download can outlive its public cancel call. Keep the
        # complete cleanup coroutine here so no later command can touch the
        # Page or temporary tree until the public objects have settled.
        self.download_settling: set[asyncio.Task[Any]] = set()
        # A file operation is registered before its first Provider await. A
        # concurrent owner close waits for that task to classify its outcome
        # and install the cleanup barrier, avoiding a close/timeout race that
        # could otherwise stop Playwright before the barrier is visible.
        self.download_operations: set[asyncio.Task[Any]] = set()

    @classmethod
    async def create(cls, request: dict[str, Any], adapter: Any | None = None) -> "Driver":
        selected_adapter = adapter if adapter is not None else _DEFAULT_ADAPTER
        if selected_adapter is None:
            raise ValueError("Provider adapter is unavailable.")
        driver = cls(request, selected_adapter)
        try:
            await driver.start()
            return driver
        except BaseException:
            await driver.close()
            raise

    async def start(self) -> None:
        playwright_factory = getattr(self.adapter, "playwright_factory", async_playwright)
        self.playwright = await playwright_factory().start()
        create_context = getattr(self.adapter, "create_context", None)
        if callable(create_context):
            # Public connect_over_cdp attaches to a browser-owned default
            # Context; it cannot accept launch_persistent_context's
            # downloads_path.  The shared file operation still stages and
            # hashes the public Download, but does not scan an ambient
            # Downloads directory as a replacement for that relationship.
            self.downloads_root = None
            self.context = await create_context(self.playwright, self.request, self.profile_dir)
        else:
            self.downloads_root = Path(tempfile.mkdtemp(prefix=".webenvoy-downloads-", dir=self.profile_dir))
            launch = dict(self.options)
            launch.update(self.context_options)
            launch["user_data_dir"] = self.profile_dir
            # Keep the browser's original temporary download artifacts in
            # this task-owned directory. The async bounded monitor watches it
            # together with Harbor staging during the complete Download
            # lifecycle.
            launch["downloads_path"] = str(self.downloads_root)
            if self.scope_semantics == "legacy_request_guard_v1":
                launch["offline"] = True
                launch["service_workers"] = "block"
            browser_type = getattr(self.adapter, "browser_type", None)
            browser = getattr(self.playwright, browser_type, None)
            if browser is None:
                raise ValueError("Provider adapter browser type is unavailable.")
            self.context = await browser.launch_persistent_context(**launch)
        self.context.on("page", self.on_page)
        if self.scope_semantics == "legacy_request_guard_v1":
            await self.context.route("**/*", self.route)
        page = self.context.pages[0] if self.context.pages else await self.context.new_page()
        if self.scope_semantics == "legacy_request_guard_v1":
            await self.context.set_offline(False)
        initial_origin = origin_of(str(self.request.get("url", "")))
        state = next((item for item in self.pages.values() if item.page == page), None)
        if state is None:
            state = self.register(page, [initial_origin] if initial_origin else [], scope_semantics=self.scope_semantics)
        else:
            state.origins.update([initial_origin] if initial_origin else [])
            state.scope_semantics = self.scope_semantics
        self.current = state.ref
        await self.navigate(state, str(self.request.get("url", "about:blank")), [initial_origin] if initial_origin else [], self.scope_semantics)

    def register(self, page: Page, origins: list[str], opener: str | None = None, scope_semantics: str | None = None) -> PageState:
        driver_scope = getattr(self, "scope_semantics", "legacy_request_guard_v1")
        state = PageState(f"page:{self.next_ref}", page, [origin for origin in origins if origin], opener, validated_scope_semantics(scope_semantics, driver_scope))
        self.next_ref += 1
        self.pages[state.ref] = state
        page.on("framenavigated", lambda frame: self.on_navigate(state, frame))
        page.on("request", lambda request: self.network_request(state, request))
        page.on("response", lambda response: self.network_response(state, response))
        page.on("requestfailed", lambda request: self.network_failure(state, request))
        page.on("console", lambda message: self.console_event(state, message))
        page.on("pageerror", lambda error: self.page_error(state, error))
        return state

    async def on_page(self, page: Page) -> None:
        existing = next((item for item in self.pages.values() if item.page == page), None)
        if existing is not None:
            if existing.relation_pending:
                await self.resolve_page_opener(existing, page)
            return
        state = self.register(page, [], None, self.scope_semantics)
        await self.resolve_page_opener(state, page)

    async def resolve_page_opener(self, state: PageState, page: Page) -> None:
        opener_ref = None
        opener_origins: list[str] = []
        try:
            opener = await page.opener()
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

    def request_scope(self, state: PageState, request: dict[str, Any]) -> str:
        requested = validated_scope_semantics(request.get("scope_semantics"), state.scope_semantics)
        if requested != state.scope_semantics:
            raise ValueError("Managed scope semantics cannot change after Instance start.")
        return requested

    async def route(self, route: Route) -> None:
        request = route.request
        try:
            page = request.frame.page
        except PlaywrightError:
            self.unattributed_rejection_count = min(self.unattributed_rejection_count + 1, MAX_EVENTS)
            await route.abort("blockedbyclient")
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
            await route.abort("blockedbyclient")
            return
        if request_origin is None or request_origin not in state.origins:
            await route.abort("blockedbyclient")
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
            route_chain = [safe_url(str(request.url))]
            # Playwright routing only invokes this handler for the first URL
            # in a redirect chain. Fetch one hop at a time so Location is
            # checked before the next network request is issued.
            response = await route.fetch(max_redirects=0, timeout=int(self.request.get("timeout_ms", 60_000)))
            for hop in range(MAX_REDIRECT_HOPS + 1):
                status = int(response.status)
                location = next((value for key, value in response.headers.items() if str(key).lower() == "location"), None)
                if status not in REDIRECT_STATUSES or not location:
                    if route_chain[0] is not None:
                        state.add_request_chain(request, [url for url in route_chain if url is not None])
                    await route.fulfill(response=response)
                    response = None
                    return
                target = redirect_target(response.url, status, response.headers)
                if not target or origin_of(target) not in state.origins or hop >= MAX_REDIRECT_HOPS:
                    # Reject before releasing the fetched response so the
                    # blocked target is never dispatched.
                    try:
                        await route.abort("blockedbyclient")
                    finally:
                        await response.dispose()
                        response = None
                    return
                route_chain.append(target)
                next_method = redirect_method(status, method)
                next_post_data = post_data if next_method not in ("GET", "HEAD") else ""
                await response.dispose()
                response = await route.fetch(
                    url=target,
                    method=next_method,
                    post_data=next_post_data,
                    max_redirects=0,
                    timeout=int(self.request.get("timeout_ms", 60_000)),
                )
                method = next_method
            if response is not None:
                await response.dispose()
                response = None
            await route.abort("blockedbyclient")
        except Exception:
            if response is not None:
                try:
                    await response.dispose()
                except Exception:
                    pass
            try:
                await route.abort("blockedbyclient")
            except Exception:
                pass

    async def navigate(self, state: PageState, url: str, origins: list[str], scope_semantics: str | None = None) -> dict[str, Any]:
        scope = self.apply_page_scope(state, origins, require_current=False, scope_semantics=scope_semantics)
        target_origin = origin_of(url)
        if not target_origin or target_origin not in scope:
            raise ValueError("Page navigation origin is not authorized.")
        await state.page.goto(url, wait_until="domcontentloaded", timeout=int(self.request.get("timeout_ms", 60_000)))
        return await state.facts(task_selected=state.ref == self.current)

    def apply_page_scope(self, state: PageState, origins: Any, require_current: bool = True, scope_semantics: str | None = None) -> set[str]:
        if state.relation_rejection and not state.origins:
            raise ValueError("Page relation is unavailable.")
        if scope_semantics is not None:
            requested = validated_scope_semantics(scope_semantics, state.scope_semantics)
            if requested != state.scope_semantics:
                raise ValueError("Managed scope semantics cannot change after Instance start.")
        scope = validated_origins(origins)
        state.origins = scope
        if require_current and origin_of(state.page.url) not in scope:
            raise ValueError("Current Page origin is not authorized.")
        return scope

    async def on_navigate(self, state: PageState, frame: Any) -> None:
        if frame != state.page.main_frame:
            return
        state.generation += 1
        await state.clear_controls()
        state.last_url = state.page.url

    async def list_pages(self) -> list[dict[str, Any]]:
        return [await state.facts(task_selected=state.ref == self.current) for state in self.pages.values()]

    async def interact(self, request: dict[str, Any]) -> dict[str, Any]:
        state = self.state(request)
        scope_semantics = self.request_scope(state, request)
        action = request.get("action")
        expected = request.get("expected_origin")
        scope = validated_origins(request.get("authorized_origins"))
        current_origin = origin_of(state.page.url)
        if action == "snapshot":
            if not isinstance(expected, str) or expected not in scope or current_origin != expected or expected not in state.origins:
                return {"status": "unavailable", "dispatch_state": "not_dispatched", "failure_class": "wrong_page", "page": await state.facts()}
        else:
            try:
                scope = self.apply_page_scope(state, request.get("authorized_origins"), scope_semantics=scope_semantics)
            except ValueError:
                return {"status": "unavailable", "dispatch_state": "not_dispatched", "failure_class": "wrong_page", "page": await state.facts()}
            if not isinstance(expected, str) or expected not in scope or current_origin != expected:
                return {"status": "unavailable", "dispatch_state": "not_dispatched", "failure_class": "wrong_page", "page": await state.facts()}
        try:
            if action == "snapshot":
                return {"status": "completed", "dispatch_state": "not_dispatched", "page": await state.facts(), "snapshot": await self.snapshot(state, request)}
            if action == "click":
                await (await self.locator(state, request)).click(timeout=int(request.get("timeout_ms", 5_000)))
            elif action == "input":
                text = request.get("text")
                if not isinstance(text, str) or len(text) > MAX_TEXT:
                    return {"status": "unavailable", "dispatch_state": "not_dispatched", "failure_class": "invalid_contract", "page": await state.facts()}
                await (await self.locator(state, request)).fill(text, timeout=int(request.get("timeout_ms", 5_000)))
            elif action == "press":
                key = request.get("key")
                if not isinstance(key, str) or not re.fullmatch(r"[A-Za-z0-9_+\- ]{1,32}", key):
                    return {"status": "unavailable", "dispatch_state": "not_dispatched", "failure_class": "invalid_contract", "page": await state.facts()}
                await (await self.locator(state, request)).press(key, timeout=int(request.get("timeout_ms", 5_000)))
            elif action == "scroll":
                delta = request.get("delta_y")
                if not isinstance(delta, (int, float)) or not -100_000 <= delta <= 100_000:
                    return {"status": "unavailable", "dispatch_state": "not_dispatched", "failure_class": "invalid_contract", "page": await state.facts()}
                await state.page.mouse.wheel(0, delta)
            elif action == "wait":
                wait_for = request.get("wait_for")
                if wait_for not in ("page_changed", "text", "enabled"):
                    return {"status": "unavailable", "dispatch_state": "not_dispatched", "failure_class": "invalid_contract", "page": await state.facts()}
                if wait_for == "text" and (not isinstance(request.get("text"), str) or not request["text"]):
                    return {"status": "unavailable", "dispatch_state": "not_dispatched", "failure_class": "invalid_contract", "page": await state.facts()}
                if wait_for == "enabled" and (not isinstance(request.get("target_ref"), str) or request["target_ref"] not in state.controls):
                    return {"status": "unavailable", "dispatch_state": "not_dispatched", "failure_class": "invalid_contract", "page": await state.facts()}
                if wait_for == "enabled":
                    failure = await self.target_failure(state, request["target_ref"])
                    if failure:
                        return {"status": "unavailable", "dispatch_state": "not_dispatched", "failure_class": failure, "page": await state.facts()}
                if not await self.wait_for_condition(state, request):
                    if self.close_requested.is_set():
                        return {"status": "unknown_outcome", "dispatch_state": "dispatched", "failure_class": "control_changed", "page": await state.facts()}
                    # The wait command was issued to the Provider even though
                    # the declared condition was not observed before its
                    # deadline. Project that as a failed dispatched outcome so
                    # callers cannot safely replay an already-issued wait.
                    return {"status": "unavailable", "dispatch_state": "dispatched", "failure_class": "wait_condition_timeout", "page": await state.facts()}
            else:
                return {"status": "unavailable", "dispatch_state": "not_dispatched", "failure_class": "invalid_contract", "page": await state.facts()}
            return {"status": "completed", "dispatch_state": "dispatched", "page": await state.facts()}
        except TargetFailure as error:
            return {"status": "unavailable", "dispatch_state": "not_dispatched", "failure_class": error.failure_class, "page": await state.facts()}
        except ObservationFailure as error:
            return {"status": "unavailable", "dispatch_state": "not_dispatched", "failure_class": error.failure_class, "page": await state.facts()}
        except TimeoutError:
            return {"status": "unknown_outcome", "dispatch_state": "dispatched", "failure_class": "timeout", "page": await state.facts()}
        except Exception as error:
            return {"status": "unknown_outcome", "dispatch_state": "dispatched", "failure_class": safe_text(error, 128), "page": await state.facts()}

    async def wait_for_condition(self, state: PageState, request: dict[str, Any]) -> bool:
        """Wait for one bounded, declared Page condition using public APIs."""
        wait_for = request.get("wait_for")
        timeout_value = request.get("timeout_ms", 250)
        try:
            timeout_ms = min(max(int(timeout_value), 1), MAX_WAIT_MS)
        except (TypeError, ValueError, OverflowError):
            timeout_ms = 250
        deadline = time.monotonic() + timeout_ms / 1000
        initial_generation = state.generation
        body = state.page.locator("body") if wait_for == "text" else None
        target = await self.locator(state, request) if wait_for == "enabled" else None
        expected_text = request.get("text") if wait_for == "text" else None
        while True:
            if self.close_requested.is_set():
                return False
            if wait_for == "page_changed":
                if state.generation != initial_generation:
                    return True
            elif wait_for == "text":
                try:
                    if expected_text in await body.inner_text(timeout=max(1, min(250, int(max(1, (deadline - time.monotonic()) * 1000))))):
                        return True
                except TimeoutError:
                    pass
            elif wait_for == "enabled":
                remaining_ms = max(1, min(250, int(max(1, (deadline - time.monotonic()) * 1000))))
                try:
                    # Recheck the target's identity-bound semantics on every
                    # poll. Enabled is intentionally excluded from that
                    # fingerprint so a disabled control can become enabled.
                    failure = await self.target_failure(state, request["target_ref"])
                    if failure:
                        raise TargetFailure(failure)
                    # Playwright 1.60 ElementHandle visibility methods have no
                    # timeout keyword. The surrounding bounded polling loop
                    # supplies the deadline without relying on a private API.
                    if await target.is_visible() and await target.is_enabled():
                        return True
                except TimeoutError:
                    pass
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return False
            await state.page.wait_for_timeout(min(WAIT_POLL_MS, max(1, int(remaining * 1000))))

    async def _read_control(self, element: Any) -> dict[str, Any] | None:
        try:
            value = await element.evaluate(CONTROL_SEMANTICS_SCRIPT)
        except Exception:
            return None
        if not isinstance(value, dict) or not isinstance(value.get("role"), str):
            return None
        return value

    @staticmethod
    async def _dispose_handle(handle: Any) -> None:
        try:
            dispose = getattr(handle, "dispose", None)
            if callable(dispose):
                await dispose()
        except Exception:
            pass

    @staticmethod
    def _parse_aria_snapshot(snapshot: Any) -> tuple[str, str] | None:
        if not isinstance(snapshot, str):
            return None
        first = next((line.strip() for line in snapshot.splitlines() if line.strip()), "")
        match = ARIA_SNAPSHOT_ROOT.fullmatch(first)
        if match is None:
            return None
        name = match.group(2)
        if name is not None:
            try:
                name = json.loads(f'"{name}"')
            except (TypeError, ValueError, json.JSONDecodeError):
                return None
        return match.group(1).lower(), name or ""

    async def _locator_semantics(self, locator: Any, original: Any, failure_class: str) -> tuple[str, str] | None:
        """Read public role/name only when the Locator still denotes original."""
        try:
            before_matches = await locator.evaluate("(candidate, original) => candidate === original", original)
        except Exception:
            return None
        if before_matches is not True:
            raise ObservationFailure(failure_class)
        snapshot = await locator.aria_snapshot()
        after_matches = await locator.evaluate("(candidate, original) => candidate === original", original)
        if after_matches is not True:
            raise ObservationFailure(failure_class)
        parsed = self._parse_aria_snapshot(snapshot)
        return parsed if parsed is not None and parsed[0] in OBSERVATION_ROLES else None

    async def _indexed_public_semantics(self, state: PageState, index: int, original: Any, failure_class: str) -> tuple[str, str] | None:
        try:
            return await self._locator_semantics(state.page.locator(OBSERVATION_SELECTOR).nth(index), original, failure_class)
        except ObservationFailure:
            raise
        except Exception:
            return None

    async def _target_public_semantics(self, state: PageState, original: Any, role: str, name: str) -> tuple[str, str] | None:
        try:
            root = state.page.get_by_role(role, name=name, exact=True)
            count = min(await root.count(), MAX_OBSERVATION_CONTROLS)
            for index in range(count):
                locator = root.nth(index)
                candidate = await locator.element_handle()
                if candidate is None:
                    continue
                try:
                    if await self._same_element(original, candidate):
                        return await self._locator_semantics(locator, original, "target_semantics_changed")
                finally:
                    if candidate is not original:
                        await self._dispose_handle(candidate)
        except ObservationFailure:
            raise
        except Exception:
            return None
        return None

    def _normalized_control(self, item: dict[str, Any], page_url: str = "") -> dict[str, Any] | None:
        role = str(item.get("role", "")).strip().lower()
        if role not in OBSERVATION_ROLES:
            return None
        source = item.get("name_source") if isinstance(item.get("name_source"), str) else "none"
        if source not in {"provider_accessibility", "html_label", "aria_labelledby", "aria_label", "content", "alt", "title", "none"}:
            source = "none"
        raw_name = item.get("name") if isinstance(item.get("name"), str) else ""
        raw_description = item.get("description") if isinstance(item.get("description"), str) else ""
        truncated_fields: list[str] = []
        if len(raw_name) > 256:
            truncated_fields.append("name")
        if len(raw_description) > 256:
            truncated_fields.append("description")
        name = safe_text(raw_name, 256)
        description = safe_text(raw_description, 256) if raw_description else None
        context: list[dict[str, str]] = []
        raw_context = item.get("context")
        if isinstance(raw_context, list):
            for index, entry in enumerate(raw_context[:2]):
                if not isinstance(entry, dict) or not isinstance(entry.get("kind"), str) or not isinstance(entry.get("name"), str):
                    continue
                context_name = str(entry["name"])
                if len(context_name) > 128:
                    truncated_fields.append(f"context[{index}].name")
                context.append({"kind": safe_text(entry["kind"], 32), "name": safe_text(context_name, 128)})
        raw_hints = item.get("hints") if isinstance(item.get("hints"), dict) else {}
        placeholder = raw_hints.get("placeholder")
        if placeholder is not None and not isinstance(placeholder, str):
            placeholder = None
        if isinstance(placeholder, str) and len(placeholder) > 128:
            truncated_fields.append("hints.placeholder")
        hints = {
            "placeholder": safe_text(placeholder, 128) if isinstance(placeholder, str) else None,
            "input_type": raw_hints.get("input_type") if isinstance(raw_hints.get("input_type"), str) else None,
            "multiline": raw_hints.get("multiline") if isinstance(raw_hints.get("multiline"), bool) else None,
            "editable": raw_hints.get("editable") if isinstance(raw_hints.get("editable"), bool) else None,
        }
        href = item.get("href") if isinstance(item.get("href"), str) else None
        action = item.get("action") if isinstance(item.get("action"), dict) else {}
        raw_form = action.get("form") if isinstance(action.get("form"), dict) else None
        private_action = {
            "href": safe_url(urljoin(page_url, href)) if href and page_url else href,
            "download": action.get("download") if isinstance(action.get("download"), str) else None,
            "target": action.get("target") if isinstance(action.get("target"), str) else None,
            "form": {
                "action": raw_form.get("action") if isinstance(raw_form.get("action"), str) else None,
                "method": str(raw_form.get("method", "get")).lower() if isinstance(raw_form.get("method"), str) else None,
                "formaction": raw_form.get("formaction") if isinstance(raw_form.get("formaction"), str) else None,
                "formmethod": str(raw_form.get("formmethod")).lower() if isinstance(raw_form.get("formmethod"), str) else None,
            } if raw_form is not None else None,
        }
        action_fingerprint = private_fingerprint(private_action)
        action_facts = {
            "href": safe_url(urljoin(page_url, href)) if href and page_url else href,
            "download": safe_text(action.get("download"), 256) if isinstance(action.get("download"), str) else None,
            "target": safe_text(action.get("target"), 128) if isinstance(action.get("target"), str) else None,
            "form": {
                "action": safe_text(action.get("form", {}).get("action"), 512) if isinstance(action.get("form"), dict) and isinstance(action.get("form", {}).get("action"), str) else None,
                "method": str(action.get("form", {}).get("method", "get")).lower() if isinstance(action.get("form"), dict) else None,
                "formaction": safe_text(action.get("form", {}).get("formaction"), 512) if isinstance(action.get("form"), dict) and isinstance(action.get("form", {}).get("formaction"), str) else None,
                "formmethod": str(action.get("form", {}).get("formmethod")).lower() if isinstance(action.get("form"), dict) and isinstance(action.get("form", {}).get("formmethod"), str) else None,
            } if isinstance(action.get("form"), dict) else None,
        }
        enabled = item.get("enabled") is True
        semantic = {
            "role": role,
            "name": name,
            "name_source": source,
            "description": description,
            "context": context,
            "hints": hints,
            "action": action_facts,
            "action_fingerprint": action_fingerprint,
        }
        return {
            "role": role,
            "name": name,
            "name_source": source,
            "description": description,
            "context": context,
            "hints": hints,
            "href": href,
            "action": action_facts,
            "enabled": enabled,
            "semantic": json.dumps(semantic, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
            "action_fingerprint": action_fingerprint,
            "truncated_fields": sorted(set(truncated_fields)),
        }

    @staticmethod
    def _public_control(normalized: dict[str, Any]) -> dict[str, Any]:
        return {
            "role": safe_text(normalized["role"], 64),
            "name": safe_text(normalized["name"], 256),
            "name_source": normalized["name_source"],
            "description": normalized["description"],
            "context": normalized["context"],
            "hints": normalized["hints"],
            "enabled": normalized["enabled"],
            "disambiguation": "ambiguous",
            "truncated_fields": normalized["truncated_fields"],
        }

    async def _capture_candidate_records(self, state: PageState) -> tuple[list[dict[str, Any]], bool, bool, list[str]]:
        selector = OBSERVATION_SELECTOR
        start_generation = state.generation
        start_url = safe_url(state.page.url)
        capture_deadline_ns = time.monotonic_ns() + MAX_OBSERVATION_CAPTURE_MS * 1_000_000
        phase_started = self._record_snapshot_phase("candidate_query", "started")
        try:
            element_handles = await state.page.query_selector_all(selector)
        except Exception as error:
            self._record_snapshot_phase("candidate_query", "error", phase_started)
            raise ObservationFailure("observation_changed") from error
        self._record_snapshot_phase("candidate_query", "completed", phase_started)
        records: list[dict[str, Any]] = []
        reasons: list[str] = []
        semantic_complete = True
        metadata_bytes = 0
        candidate_limit_hit = False
        capture_budget_exhausted = False
        for index, element in enumerate(element_handles):
            if index >= MAX_OBSERVATION_ELEMENTS:
                reasons.append("scan_limit_reached")
                await self._dispose_handle(element)
                continue
            if time.monotonic_ns() >= capture_deadline_ns:
                reasons.append("scan_limit_reached")
                capture_budget_exhausted = True
                for remaining in element_handles[index:]:
                    await self._dispose_handle(remaining)
                break
            if len(records) >= MAX_OBSERVATION_CONTROLS:
                candidate_limit_hit = True
                await self._dispose_handle(element)
                continue
            try:
                sampled = index % SNAPSHOT_DIAGNOSTIC_SAMPLE_INTERVAL == 0
                phase_code = f"control_index_{index}" if sampled else None
                phase_started = self._record_snapshot_phase("control_read", "started", code=phase_code) if sampled else None
                try:
                    item = await self._read_control(element)
                except Exception:
                    if sampled:
                        self._record_snapshot_phase("control_read", "error", phase_started, phase_code)
                    raise
                if sampled:
                    self._record_snapshot_phase("control_read", "completed", phase_started, phase_code)
                if item is None:
                    await self._dispose_handle(element)
                    continue

                phase_started = self._record_snapshot_phase("accessibility_semantics", "started", code=phase_code) if sampled else None
                try:
                    provider = await self._indexed_public_semantics(state, index, element, "observation_changed")
                except Exception:
                    if sampled:
                        self._record_snapshot_phase("accessibility_semantics", "error", phase_started, phase_code)
                    raise
                if sampled:
                    self._record_snapshot_phase("accessibility_semantics", "completed", phase_started, phase_code)
            except Exception:
                for record in records:
                    await self._dispose_handle(record["handle"])
                    if record.get("form_handle") is not None:
                        await self._dispose_handle(record["form_handle"])
                for remaining in element_handles[index:]:
                    await self._dispose_handle(remaining)
                raise
            if provider is not None:
                item = {**item, "role": provider[0], "name": provider[1], "name_source": "provider_accessibility"}
            normalized = self._normalized_control(item, start_url or "")
            if normalized is None:
                await self._dispose_handle(element)
                continue
            public = self._public_control(normalized)
            encoded_size = len(json.dumps(public, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
            if metadata_bytes + encoded_size > MAX_OBSERVATION_METADATA_BYTES:
                reasons.append("metadata_truncated")
                semantic_complete = False
                await self._dispose_handle(element)
                continue
            metadata_bytes += encoded_size
            form_handle = None
            if isinstance(normalized.get("action"), dict) and normalized["action"].get("form") is not None:
                try:
                    form_handle = await element.evaluate_handle("e => e.form")
                except Exception:
                    semantic_complete = False
                    if "semantic_unavailable" not in reasons:
                        reasons.append("semantic_unavailable")
            ref = f"control:{state.generation}:{state.snapshot_serial}:{len(records)}"
            records.append({
                "target_ref": ref,
                "handle": element,
                "public": public,
                "semantic": normalized["semantic"],
                "action": normalized["action"],
                "action_fingerprint": normalized["action_fingerprint"],
                "form_handle": form_handle,
                "provider_accessibility": provider is not None,
            })
            if public["truncated_fields"]:
                semantic_complete = False
        if capture_budget_exhausted:
            # Do not publish a prefix whose unscanned remainder could change
            # identity or target disambiguation. The text observation is
            # independent; retain it with explicit incomplete control
            # coverage instead of holding the Provider until request timeout.
            for record in records:
                await self._dispose_handle(record["handle"])
                if record.get("form_handle") is not None:
                    await self._dispose_handle(record["form_handle"])
            records.clear()
        if len(element_handles) > MAX_OBSERVATION_ELEMENTS and "scan_limit_reached" not in reasons:
            reasons.append("scan_limit_reached")
        if candidate_limit_hit and "capture_limit_reached" not in reasons:
            reasons.append("capture_limit_reached")
        if state.generation != start_generation or safe_url(state.page.url) != start_url:
            for record in records:
                await self._dispose_handle(record["handle"])
                if record.get("form_handle") is not None:
                    await self._dispose_handle(record["form_handle"])
            raise ObservationFailure("observation_changed")
        enumeration_complete = not any(reason in reasons for reason in ("scan_limit_reached", "capture_limit_reached", "metadata_truncated"))
        return records, enumeration_complete, semantic_complete, sorted(set(reasons))

    @staticmethod
    def _disambiguate(records: list[dict[str, Any]], enumeration_complete: bool) -> None:
        name_groups: dict[tuple[str, str], list[dict[str, Any]]] = {}
        for record in records:
            public = record["public"]
            name_groups.setdefault((public["role"], public["name"]), []).append(record)
        for group in name_groups.values():
            if not enumeration_complete:
                for record in group:
                    record["public"]["disambiguation"] = "ambiguous"
                continue
            variants: dict[str, int] = {}
            for record in group:
                public = record["public"]
                variant = json.dumps({"description": public["description"], "context": public["context"], "hints": public["hints"]}, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
                variants[variant] = variants.get(variant, 0) + 1
            for record in group:
                public = record["public"]
                variant = json.dumps({"description": public["description"], "context": public["context"], "hints": public["hints"]}, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
                if len(group) == 1:
                    public["disambiguation"] = "unique"
                elif variants.get(variant) == 1:
                    public["disambiguation"] = "contextual"
                else:
                    public["disambiguation"] = "ambiguous"

    @staticmethod
    def _action_semantic(public: dict[str, Any], action: dict[str, Any], action_fingerprint: str | None = None) -> str:
        hints = public["hints"]
        identity = {
            "role": public["role"],
            "name": public["name"],
            "editing": {"input_type": hints["input_type"], "multiline": hints["multiline"], "editable": hints["editable"]},
            "action": action,
            "action_fingerprint": action_fingerprint,
        }
        if public["disambiguation"] == "contextual":
            identity["distinguishing"] = {"description": public["description"], "context": public["context"], "hints": hints}
        return json.dumps(identity, ensure_ascii=False, sort_keys=True, separators=(",", ":"))

    def _cursor(self, state: PageState, batch: dict[str, Any], offset: int) -> str:
        seed = f"{state.ref}:{batch['observation_ref']}:{offset}:{time.time_ns()}"
        cursor = f"cursor:{hashlib.sha256(seed.encode()).hexdigest()[:40]}"
        batch.setdefault("cursors", {})[cursor] = offset
        return cursor

    async def _verify_snapshot_batch(self, state: PageState, batch: dict[str, Any], failure_class: str = "observation_cursor_stale") -> None:
        if not batch["enumeration_complete"] and not batch["records"]:
            if state.generation != batch["generation"] or safe_url(state.page.url) != batch["page_url"]:
                raise ObservationFailure(failure_class)
            return
        selector = OBSERVATION_SELECTOR
        try:
            handles = await state.page.query_selector_all(selector)
        except Exception as error:
            raise ObservationFailure(failure_class) from error
        current: list[tuple[Any, dict[str, Any]]] = []
        metadata_bytes = 0
        try:
            for index, handle in enumerate(handles):
                if index >= MAX_OBSERVATION_ELEMENTS:
                    break
                if len(current) >= MAX_OBSERVATION_CONTROLS:
                    continue
                item = await self._read_control(handle)
                if item is None:
                    continue
                provider = await self._indexed_public_semantics(state, index, handle, failure_class)
                if provider is not None:
                    item = {**item, "role": provider[0], "name": provider[1], "name_source": "provider_accessibility"}
                normalized = self._normalized_control(item, safe_url(state.page.url) or "")
                if normalized is not None:
                    public = self._public_control(normalized)
                    encoded_size = len(json.dumps(public, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
                    if metadata_bytes + encoded_size > MAX_OBSERVATION_METADATA_BYTES:
                        continue
                    metadata_bytes += encoded_size
                    current.append((handle, normalized))
            records = batch["records"]
            if len(current) != len(records):
                raise ObservationFailure(failure_class)
            for (fresh, normalized), record in zip(current, records):
                if (not await self._same_element(record["handle"], fresh) or
                    normalized["semantic"] != record["semantic"] or
                    normalized["enabled"] != record["public"]["enabled"]):
                    raise ObservationFailure(failure_class)
            if state.generation != batch["generation"] or safe_url(state.page.url) != batch["page_url"]:
                raise ObservationFailure(failure_class)
        finally:
            old_handles = {id(record["handle"]) for record in batch["records"]}
            for handle, _ in current:
                if id(handle) not in old_handles:
                    await self._dispose_handle(handle)
            for handle in handles:
                if all(handle is not current_handle for current_handle, _ in current) and id(handle) not in old_handles:
                    await self._dispose_handle(handle)

    @staticmethod
    async def _same_element(first: Any, second: Any) -> bool:
        if first is second:
            return True
        try:
            return await first.evaluate("(e, other) => e === other", second) is True
        except AssertionError:
            return first is second
        except Exception:
            return False

    async def _snapshot_result(self, state: PageState, batch: dict[str, Any], offset: int, limit: int, continuation: bool) -> dict[str, Any]:
        records = batch["records"]
        selected = records[offset:offset + limit]
        text_state = "omitted_on_continuation" if continuation else batch["text_state"]
        text = "" if continuation else batch["text"]
        response: dict[str, Any] | None = None
        while selected or offset == len(records):
            controls = [{**record["public"], "target_ref": record["target_ref"]} for record in selected]
            returned_count = len(controls)
            returned_through = offset + returned_count
            has_more = returned_through < len(records)
            response = {
                "schema_version": "harbor-observation-targets/v1",
                "page_ref": state.ref,
                "observation_ref": batch["observation_ref"],
                "captured_at": batch["captured_at"],
                "controls": controls,
                "text": text,
                "truncated": batch["truncated"],
                "coverage": {
                    "scope": "main_document_light_dom",
                    "excluded": ["child_frames", "shadow_roots", "virtualized_not_in_dom"],
                    "controls": {
                        "enumeration_complete": batch["enumeration_complete"],
                        "captured_count": len(records),
                        "total": len(records) if batch["enumeration_complete"] else None,
                        "returned_through": returned_through,
                        "complete": batch["enumeration_complete"] and returned_through == len(records),
                        "reason_codes": batch["reason_codes"],
                    },
                    "text": {"state": text_state, "returned_bytes": len(text.encode("utf-8"))},
                    "semantics": {"complete": batch["semantic_complete"], "reason_codes": batch["semantic_reason_codes"]},
                },
                "continuation": {"offset": offset, "returned_count": returned_count, "has_more": has_more, "next_cursor": "cursor:" + "0" * 40 if has_more else None},
            }
            if len(json.dumps(response, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) <= MAX_OBSERVATION_RESPONSE_BYTES:
                break
            selected.pop()
        if response is None or not selected and offset < len(records):
            raise ObservationFailure("observation_limit_exceeded")
        if response["continuation"]["has_more"]:
            response["continuation"]["next_cursor"] = self._cursor(state, batch, response["coverage"]["controls"]["returned_through"])
        for record in selected:
            state.control_metadata[record["target_ref"]]["exposed"] = True
        return response

    @staticmethod
    def _record_snapshot_phase(phase: str, outcome: str, started_ns: int | None = None, code: str | None = None) -> int:
        phases = {
            "candidate_capture", "candidate_query", "control_read", "accessibility_semantics",
            "page_text", "batch_verification", "control_cleanup", "response_projection"
        }
        outcomes = {"started", "completed", "error", "unavailable"}
        if phase not in phases or outcome not in outcomes:
            return time.monotonic_ns()
        now_ns = time.monotonic_ns()
        duration_ms = 0 if outcome == "started" or started_ns is None else max(0, min(120_000, (now_ns - started_ns) // 1_000_000))
        diagnostic = {
            "stage": "provider_snapshot", "phase": phase, "outcome": outcome,
            "duration_ms": duration_ms, "observed_at": now()
        }
        if isinstance(code, str) and re.fullmatch(r"[a-z][a-z0-9_]{0,63}", code):
            diagnostic["code"] = code
        print(json.dumps({"id": 0, "event": "provider_snapshot_phase", **diagnostic}, separators=(",", ":")), flush=True)
        return now_ns

    async def snapshot(self, state: PageState, request: dict[str, Any] | None = None) -> dict[str, Any]:
        request = request or {}
        cursor = request.get("cursor")
        try:
            limit = request.get("limit")
            if limit is None:
                limit = state.snapshot_batch.get("initial_limit", MAX_SNAPSHOT_LIMIT) if isinstance(state.snapshot_batch, dict) and cursor else MAX_SNAPSHOT_LIMIT
            if type(limit) is not int or not 1 <= limit <= MAX_SNAPSHOT_LIMIT:
                raise ObservationFailure("observation_limit_exceeded")
        except ObservationFailure:
            raise
        if cursor is not None:
            if not isinstance(cursor, str) or not REF.fullmatch(cursor):
                raise ObservationFailure("observation_cursor_stale")
            batch = state.snapshot_batch
            if not isinstance(batch, dict) or request.get("observation_ref") != batch["observation_ref"]:
                raise ObservationFailure("observation_cursor_stale")
            offset = batch.get("cursors", {}).get(cursor)
            if not isinstance(offset, int) or offset < 0 or offset >= len(batch["records"]):
                raise ObservationFailure("observation_cursor_stale")
            await self._verify_snapshot_batch(state, batch)
            return await self._snapshot_result(state, batch, offset, limit, True)
        if request.get("observation_ref") is not None:
            raise ObservationFailure("observation_cursor_stale")
        state.snapshot_serial += 1
        phase_started = self._record_snapshot_phase("candidate_capture", "started")
        try:
            records, enumeration_complete, semantic_complete, reasons = await self._capture_candidate_records(state)
        except Exception:
            self._record_snapshot_phase("candidate_capture", "error", phase_started)
            raise
        self._record_snapshot_phase(
            "candidate_capture", "completed", phase_started,
            "scan_limit_reached" if "scan_limit_reached" in reasons else None,
        )
        observation_ref = f"observation:{state.ref}:{state.generation}:{state.snapshot_serial}"
        self._disambiguate(records, enumeration_complete)
        text_raw: Any
        text_unavailable = False
        phase_started = self._record_snapshot_phase("page_text", "started")
        try:
            text_raw = await state.page.evaluate("""() => { const text = document.body?.innerText || ''; return { text: text.slice(0, 65536), length: text.length }; }""")
        except Exception:
            text_raw = {"text": "", "length": 0}
            text_unavailable = True
            self._record_snapshot_phase("page_text", "unavailable", phase_started)
        else:
            self._record_snapshot_phase("page_text", "completed", phase_started)
        if isinstance(text_raw, dict):
            raw_text = text_raw.get("text", "") if isinstance(text_raw.get("text"), str) else ""
            text_length = int(text_raw.get("length", len(raw_text))) if isinstance(text_raw.get("length"), (int, float)) else len(raw_text)
        else:
            raw_text = text_raw if isinstance(text_raw, str) else ""
            text_length = len(raw_text)
        text, text_byte_truncated = safe_text_bytes(raw_text, MAX_TEXT)
        text_truncated = not text_unavailable and (text_byte_truncated or text_length > len(raw_text))
        if text_unavailable:
            reasons = sorted(set([*reasons, "text_unavailable"]))
        batch = {
            "observation_ref": observation_ref,
            "captured_at": now(),
            "generation": state.generation,
            "page_url": safe_url(state.page.url),
            "records": records,
            "enumeration_complete": enumeration_complete,
            "semantic_complete": semantic_complete,
            "semantic_reason_codes": [reason for reason in reasons if reason in {"semantic_unavailable", "metadata_truncated"}],
            "reason_codes": reasons,
            "text": text,
            "text_state": "unavailable" if text_unavailable else "truncated" if text_truncated else "complete",
            "truncated": text_truncated,
            "initial_limit": limit,
            "cursors": {},
        }
        phase_started = self._record_snapshot_phase("batch_verification", "started")
        try:
            await self._verify_snapshot_batch(state, batch, "observation_changed")
        except Exception:
            self._record_snapshot_phase("batch_verification", "error", phase_started)
            for record in records:
                await self._dispose_handle(record["handle"])
                if record.get("form_handle") is not None:
                    await self._dispose_handle(record["form_handle"])
            raise
        self._record_snapshot_phase("batch_verification", "completed", phase_started)
        phase_started = self._record_snapshot_phase("control_cleanup", "started")
        await state.clear_controls()
        for record in records:
            state.controls[record["target_ref"]] = (record["public"]["role"], record["public"]["name"], record["action"].get("href"), None, record["handle"])
            state.control_metadata[record["target_ref"]] = {
                "semantic": record["semantic"],
                "action_semantic": self._action_semantic(record["public"], record["action"], record["action_fingerprint"]),
                "action": record["action"],
                "action_fingerprint": record["action_fingerprint"],
                "form_handle": record.get("form_handle"),
                "provider_accessibility": record.get("provider_accessibility") is True,
                "disambiguation": record["public"]["disambiguation"],
                "exposed": False,
            }
        self._record_snapshot_phase("control_cleanup", "completed", phase_started)
        state.snapshot_batch = batch
        phase_started = self._record_snapshot_phase("response_projection", "started")
        result = await self._snapshot_result(state, batch, 0, limit, False)
        self._record_snapshot_phase("response_projection", "completed", phase_started)
        return result

    async def target_failure(self, state: PageState, target: str, role: str | None = None) -> str | None:
        control = state.controls.get(target)
        if control is None:
            return "target_stale"
        if role is not None and control[0] != role:
            return "target_semantics_changed"
        metadata = state.control_metadata.get(target)
        if metadata is not None:
            if metadata.get("exposed") is not True:
                return "target_stale"
            if metadata.get("disambiguation") == "ambiguous":
                return "target_ambiguous"
        if len(control) < 5 or control[4] is None:
            return None
        handle = control[4]
        try:
            if await handle.evaluate("e => Boolean(e.isConnected)") is not True:
                return "target_stale"
        except Exception:
            return "target_stale"
        if metadata is not None:
            form_handle = metadata.get("form_handle")
            if form_handle is not None:
                try:
                    if await handle.evaluate("(e, form) => e.form === form", form_handle) is not True:
                        return "target_semantics_changed"
                except Exception:
                    return "target_semantics_changed"
            current = await self._read_control(handle)
            if metadata.get("provider_accessibility") is True:
                provider = await self._target_public_semantics(state, handle, control[0], control[1])
                if provider is None:
                    return "target_semantics_changed"
                if current is not None:
                    current = {**current, "role": provider[0], "name": provider[1], "name_source": "provider_accessibility"}
            normalized = self._normalized_control(current, safe_url(state.page.url) or "") if current is not None else None
            if normalized is None:
                return "target_semantics_changed"
            current_public = {**normalized, "disambiguation": metadata.get("disambiguation")}
            if self._action_semantic(current_public, normalized["action"], normalized["action_fingerprint"]) != metadata.get("action_semantic"):
                return "target_semantics_changed"
        return None

    async def control_handle(self, state: PageState, target: str, role: str | None = None):
        if await self.target_failure(state, target, role):
            return None
        control = state.controls.get(target)
        return control[4] if control is not None and len(control) >= 5 else None

    async def locator(self, state: PageState, request: dict[str, Any]):
        ref = request.get("target_ref")
        if not isinstance(ref, str) or ref not in state.controls:
            raise TargetFailure("target_stale")
        control = state.controls[ref]
        role, name = control[0], control[1]
        failure = await self.target_failure(state, ref)
        if failure:
            raise TargetFailure(failure)
        if len(control) >= 5:
            return control[4]
        return state.page.get_by_role(role, name=name, exact=True)

    async def observe(self, request: dict[str, Any]) -> dict[str, Any]:
        state = self.state(request)
        self.request_scope(state, request)
        generation = state.generation
        current = safe_url(state.page.url)
        if state.scope_semantics == "agent_operations_v2" and origin_of(current or "") not in state.origins:
            raw = {"current_url": origin_of(current or "") or "unknown", "title": "", "ready_state": "loading", "stable_id": None}
        else:
            raw = await state.page.evaluate("""() => ({ current_url: location.origin + location.pathname, title: document.title.slice(0,256), ready_state: document.readyState, stable_id: null })""")
        if state.generation != generation:
            current = safe_url(state.page.url)
            raw = {"current_url": current, "title": "", "ready_state": "loading", "stable_id": None}
        if state.scope_semantics == "agent_operations_v2" and isinstance(raw.get("current_url"), str) and origin_of(raw["current_url"]) not in state.origins:
            current_origin = origin_of(raw["current_url"])
            raw = {**raw, "current_url": current_origin if current_origin is not None else "unknown", "title": ""}
        page_facts = await state.facts(task_selected=state.ref == self.current)
        if state.generation != generation or page_facts["document_generation"] != generation:
            raw = {"current_url": page_facts["current_url"] or "unknown", "title": "", "ready_state": "loading", "stable_id": None}
        raw["document_generation"] = page_facts["document_generation"]
        return {**page_facts, "observation": raw}

    async def public_page(self, request: dict[str, Any]) -> dict[str, Any]:
        state = self.state(request)
        self.request_scope(state, request)
        expected = request.get("expected_origin")
        if not isinstance(expected, str) or expected not in state.origins or origin_of(state.page.url) != expected:
            return {"status": "unavailable", "failure_class": "wrong_page", "retryable": False, "page": await state.facts()}
        generation = state.generation
        text = safe_text(await state.page.locator("body").inner_text(timeout=5_000))
        page_facts = await state.facts()
        if state.generation != generation or page_facts["document_generation"] != generation or page_facts["origin"] != expected:
            return {"status": "unavailable", "failure_class": "wrong_page", "retryable": False, "page": page_facts}
        return {"status": "completed", "page": page_facts, "text": text, "truncated": len(text) >= MAX_TEXT}

    async def diagnostics(self, request: dict[str, Any]) -> dict[str, Any]:
        state = self.state(request)
        self.request_scope(state, request)
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
        return {"status": "completed", "page_ref": state.ref, "document_generation": state.generation, "page": await state.facts(), "cursor": str(start), "next_cursor": str(start + len(events)), "truncated": start + len(events) < len(state.events), "observed_at": now(), "network": network, "console": console}

    async def environment(self, request: dict[str, Any]) -> dict[str, Any]:
        state = self.state(request)
        observed = await state.page.evaluate("""() => ({ language: navigator.language || null, languages: navigator.languages || [], timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || null, viewport: { width: innerWidth, height: innerHeight }, screen: { width: screen.width, height: screen.height }, hardware_concurrency: navigator.hardwareConcurrency || null, device_memory: navigator.deviceMemory || null, webgl_vendor: null, webgl_renderer: null, fonts_hash: null, voices_hash: null, canvas_hash: null, audio_hash: null })""")
        provider_state = getattr(self, "provider_state", getattr(self, "bundle", None))
        state_hash = provider_state.get("identity_hash") if isinstance(provider_state, dict) else None
        adapter = getattr(self, "adapter", None)
        provider_facts = getattr(adapter, "environment", lambda _state: {})(provider_state)
        return {"status": "completed", "observed_at": now(), "provider": provider_facts, "bundle_hash": state_hash, "provider_state_hash": state_hash, "observed": observed, "continuity": {"state": "unknown", "checked_fields": [], "changed_fields": [], "unknown_fields": ["screen", "hardware_concurrency", "webgl_vendor", "webgl_renderer", "canvas_hash", "audio_hash"]}}

    async def screenshot(self, request: dict[str, Any]) -> dict[str, Any]:
        state = self.state(request)
        path = Path(self.profile_dir, f".webenvoy-screenshot-{time.time_ns()}.png")
        await state.page.screenshot(path=str(path), type="png")
        data = path.read_bytes()
        return {"status": "completed", "screenshot_ref": "screenshot:" + hashlib.sha256(data).hexdigest(), "mime_type": "image/png", "byte_length": len(data), "sha256": hashlib.sha256(data).hexdigest(), "captured_at": now()}

    @staticmethod
    def download_path_size(path: Path) -> int:
        if path.is_symlink():
            raise DownloadLimitExceeded()
        try:
            if path.is_file():
                return path.stat().st_size
            if not path.is_dir():
                return 0
            total = 0
            for child in path.iterdir():
                total += Driver.download_path_size(child)
                if total > MAX_DOWNLOAD_TEMP_BYTES:
                    return total
            return total
        except FileNotFoundError:
            return 0

    @classmethod
    def monitor_download_paths(cls, paths: list[str]) -> None:
        total = 0
        seen: set[str] = set()
        for raw in paths:
            if not isinstance(raw, str) or not raw:
                continue
            key = os.path.normcase(os.path.abspath(raw))
            if key in seen:
                continue
            seen.add(key)
            size = cls.download_path_size(Path(raw))
            if size > MAX_DOWNLOAD_BYTES:
                raise DownloadLimitExceeded()
            total += size
        if total > MAX_DOWNLOAD_TEMP_BYTES:
            raise DownloadLimitExceeded()

    def clear_downloads_root(self) -> bool:
        root = getattr(self, "downloads_root", None)
        if root is None:
            return True
        try:
            if root.is_symlink() or not root.is_dir():
                return False
            for child in root.iterdir():
                if child.is_symlink() or child.is_file():
                    child.unlink()
                elif child.is_dir():
                    shutil.rmtree(child)
            return True
        except FileNotFoundError:
            return True
        except OSError:
            return False

    def remove_downloads_root(self) -> None:
        root = getattr(self, "downloads_root", None)
        self.downloads_root = None
        if root is None:
            return
        try:
            if not root.is_symlink() and root.exists():
                shutil.rmtree(root)
        except OSError:
            pass

    async def close_owned_resources(self) -> None:
        """Close resources owned by an adapter outside Playwright Context."""
        if not hasattr(self, "_owned_resources_closed"):
            self._owned_resources_closed = False
        if not hasattr(self, "_owned_resources_close_error"):
            self._owned_resources_close_error = None
        if self._owned_resources_close_error is not None:
            raise self._owned_resources_close_error
        if self._owned_resources_closed:
            return
        # Mark the boundary before invoking the adapter.  A failed or
        # cancelled close is still an attempted close: retrying an external
        # process teardown can race the first attempt and obscure its error.
        self._owned_resources_closed = True
        close = getattr(getattr(self, "adapter", None), "close_owned_resources", None)
        try:
            if callable(close):
                result = close()
                if inspect.isawaitable(result):
                    await result
        except BaseException as error:
            self._owned_resources_close_error = error
            raise

    async def close_context_for_download(self) -> None:
        """Use public Context.close and the adapter close seam as one barrier."""
        self.close_requested.set()
        if not hasattr(self, "_close_error"):
            self._close_error = None
        if not hasattr(self, "_close_completed"):
            self._close_completed = False
        if not hasattr(self, "_close_finalized"):
            self._close_finalized = False
        if self._close_completed:
            return
        if self._close_error is not None:
            raise self._close_error
        async with self.close_lock:
            if self._close_completed:
                return
            if self._close_error is not None:
                raise self._close_error
            context = getattr(self, "_closing_context", None) or getattr(self, "context", None)
            self.context = None
            self._closing_context = context
            context_error: BaseException | None = None
            try:
                if context is not None:
                    await context.close()
            except BaseException as error:
                # Keep the failed Context isolated from reusable state. The
                # download caller may continue bounded settling, but the
                # owning Driver.close must surface this same sticky error.
                self._close_error = error
                context_error = error
            else:
                self._closing_context = None
            try:
                await self.close_owned_resources()
            except BaseException as error:
                if self._close_error is None:
                    self._close_error = error
                if context_error is None:
                    raise
            if context_error is not None:
                raise context_error

    async def settle_download_call(self, action_task: asyncio.Task[Any], cancel: Any) -> tuple[asyncio.Task[Any], ...]:
        """Request public cancellation and converge both awaitables.

        ``asyncio.wait`` is deliberate: unlike ``wait_for`` it does not
        cancel an in-flight Playwright coroutine when a grace period expires.
        If the public cancel call or its action remains pending, close the
        public Context and return the still-pending tasks to the lifecycle
        cleanup barrier rather than letting them write behind the caller.
        """
        tasks: set[asyncio.Task[Any]] = {action_task}
        if callable(cancel):
            try:
                result = cancel()
                if inspect.isawaitable(result):
                    tasks.add(asyncio.ensure_future(result))
            except Exception:
                pass
        done, pending = await asyncio.wait(tasks, timeout=DOWNLOAD_CANCEL_GRACE_S)
        completed = set(done)
        if pending:
            try:
                await self.close_context_for_download()
            except BaseException:
                # close_context_for_download records a sticky lifecycle error
                # before raising; continue the bounded task wait so any
                # non-converged Download remains isolated for cleanup.
                pass
            done, pending = await asyncio.wait(pending, timeout=DOWNLOAD_SETTLE_GRACE_S)
            completed.update(done)
        if completed:
            await asyncio.gather(*completed, return_exceptions=True)
        return tuple(pending)

    def defer_download_cleanup(
        self,
        pending_tasks: tuple[asyncio.Task[Any], ...],
        page: Any,
        request_listener: Any,
        download_listener: Any,
        downloads: list[Any],
        primary: Any,
        staging: str,
        cancelled: set[int],
    ) -> None:
        """Keep a non-converged Download isolated until public cleanup is safe."""
        # The public Context was closed by ``settle_download_call`` before a
        # non-converged task reaches this method. Keep this fence explicit for
        # deterministic fakes and for any future public cancellation path.
        self.close_requested.set()

        async def finish() -> None:
            await asyncio.gather(*pending_tasks, return_exceptions=True)
            candidates: list[Any] = []
            for candidate in (*downloads, primary):
                if candidate is not None and all(existing is not candidate for existing in candidates):
                    candidates.append(candidate)
            for candidate in candidates:
                await self.cleanup_download(candidate, cancel=id(candidate) not in cancelled)
            self.remove_listener(page, "request", request_listener)
            self.remove_listener(page, "download", download_listener)
            self.clear_downloads_root()
            try:
                Path(staging).unlink()
            except FileNotFoundError:
                pass

        cleanup = asyncio.create_task(finish())
        self.download_settling.add(cleanup)
        cleanup.add_done_callback(self.download_settling.discard)

    async def wait_download_cleanup(self) -> None:
        pending = tuple(task for task in self.download_settling if not task.done())
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)

    async def bounded_download_call(self, staging: str, deadline: float, action: Any, monitor_paths: list[str] | None = None, cancel: Any = None) -> Any:
        """Run one public Download operation under one bounded deadline.

        Async Playwright exposes no byte cap on ``save_as``.  Keep the action
        on the owning event loop, monitor both Harbor staging and the public
        ``downloads_path`` tree while it is pending, and ask the public
        Download to cancel on deadline, quota breach, or owner close. Await
        the protected action briefly for Playwright to converge; never cancel
        an in-flight Playwright task or use a private protocol.
        """
        if time.monotonic() >= deadline:
            raise DownloadTimeout()
        paths = [staging, *(monitor_paths or [])]
        self.monitor_download_paths(paths)
        task = asyncio.create_task(action())
        try:
            while not task.done():
                self.monitor_download_paths(paths)
                if self.close_requested.is_set() or time.monotonic() >= deadline:
                    raise DownloadTimeout()
                remaining = max(0.001, deadline - time.monotonic())
                try:
                    await asyncio.wait_for(asyncio.shield(task), timeout=min(DOWNLOAD_MONITOR_INTERVAL_S, remaining))
                except asyncio.TimeoutError:
                    continue
            result = await task
            self.monitor_download_paths(paths)
            return result
        except BaseException as error:
            if not task.done():
                pending = await self.settle_download_call(task, cancel)
                if pending:
                    raise DownloadTimeout(pending_tasks=pending) from error
            raise

    @staticmethod
    def remove_listener(page: Any, event: str, listener: Any) -> None:
        try:
            remove = getattr(page, "remove_listener", None)
            if callable(remove):
                remove(event, listener)
        except Exception:
            pass

    @staticmethod
    async def cleanup_download(download: Any, cancel: bool = True) -> None:
        for name in (("cancel", "delete") if cancel else ("delete",)):
            try:
                operation = getattr(download, name, None)
                if callable(operation):
                    result = operation()
                    if inspect.isawaitable(result):
                        await result
            except Exception:
                pass

    @staticmethod
    def request_page(request: Any) -> Any:
        try:
            frame = getattr(request, "frame")
            if callable(frame):
                frame = frame()
            page = getattr(frame, "page")
            if callable(page):
                page = page()
            return page
        except Exception:
            return None

    @staticmethod
    def request_url(request: Any) -> str | None:
        try:
            value = getattr(request, "url")
            if callable(value):
                value = value()
            return safe_url(value) if isinstance(value, str) else None
        except Exception:
            return None

    @staticmethod
    def request_redirected_from(request: Any) -> Any:
        try:
            previous = getattr(request, "redirected_from", None)
            if callable(previous):
                previous = previous()
            return previous
        except Exception:
            return None

    def request_chain(self, request: Any) -> list[Any]:
        chain: list[Any] = []
        seen: set[int] = set()
        current = request
        while current is not None:
            identity = id(current)
            if identity in seen:
                return []
            seen.add(identity)
            chain.append(current)
            current = self.request_redirected_from(current)
        chain.reverse()
        return chain

    def matching_download_chain(self, state: PageState, requests: list[Any], observed_href: str, download_url: str, scope: set[str], download: Any, scope_semantics: str) -> bool:
        observed_ids = {id(item) for item in requests}
        matches: list[tuple[tuple[str, ...], Any]] = []
        for candidate in requests:
            chain = self.request_chain(candidate)
            if not chain or chain[-1] is not candidate or any(id(item) not in observed_ids for item in chain):
                continue
            object_urls = [self.request_url(item) for item in chain]
            if any(url is None for url in object_urls):
                continue
            route_urls = state.request_chain(candidate)
            urls = list(route_urls) if route_urls is not None else [url for url in object_urls if url is not None]
            if not urls or urls[0] != observed_href or urls[-1] != download_url:
                continue
            if len(urls) > MAX_REDIRECT_HOPS + 1 or origin_of(urls[0]) not in scope or (scope_semantics == "legacy_request_guard_v1" and any(origin_of(url) not in scope for url in urls)):
                continue
            if any(self.request_page(item) is not state.page for item in chain):
                continue
            matches.append((tuple(urls), candidate))
        return len(matches) == 1 and self.request_page(matches[0][1]) is state.page and self._download_page(download) is state.page

    @staticmethod
    def _download_page(download: Any) -> Any:
        try:
            page = getattr(download, "page")
            if callable(page):
                page = page()
            return page
        except Exception:
            return None

    async def file_operation(self, request: dict[str, Any]) -> dict[str, Any]:
        """Deliver one owner-resolved file through a standard Page control.

        Paths in this method are Harbor-private staging paths.  The Agent only
        supplies opaque target/material references to Core; Harbor resolves
        them before this public Playwright boundary is called.
        """
        state = self.state(request)
        expected = request.get("expected_origin")
        try:
            # File operations have their own exact origin intersection. Apply
            # it before any validation or dispatch so a narrower request can
            # never inherit a prior broad route guard scope.
            scope_semantics = self.request_scope(state, request)
            scope = self.apply_page_scope(state, request.get("authorized_origins"), scope_semantics=scope_semantics)
        except ValueError:
            scope = set()
        if not isinstance(expected, str) or expected not in scope or origin_of(state.page.url) != expected:
            return {"status": "unavailable", "dispatch_state": "not_dispatched", "operation": request.get("operation"), "failure_class": "wrong_page", "page": await state.facts()}
        operation = request.get("operation")
        target = request.get("target_ref")
        if operation not in ("upload", "download") or not isinstance(target, str) or not REF.fullmatch(target):
            return {"status": "unavailable", "dispatch_state": "not_dispatched", "operation": operation, "failure_class": "file_operation_invalid", "page": await state.facts()}
        try:
            timeout = min(max(int(request.get("timeout_ms", self.request.get("timeout_ms", 60_000))), 1), MAX_DOWNLOAD_TIMEOUT_MS)
        except (TypeError, ValueError, OverflowError):
            timeout = 60_000
        if operation == "upload":
            source = request.get("source_path")
            if not isinstance(source, str) or not source or "\x00" in source:
                return {"status": "unavailable", "dispatch_state": "not_dispatched", "operation": "upload", "failure_class": "file_source_unavailable", "page": await state.facts()}
            target_failure = await self.target_failure(state, target, "file")
            if target_failure:
                return {"status": "unavailable", "dispatch_state": "not_dispatched", "operation": "upload", "failure_class": target_failure, "page": await state.facts()}
            if await self.control_handle(state, target, "file") is None:
                return {"status": "unavailable", "dispatch_state": "not_dispatched", "operation": "upload", "failure_class": "file_input_unavailable", "page": await state.facts()}
            try:
                source_path = Path(source)
                with source_path.open("rb", buffering=0) as handle:
                    source_size = os.fstat(handle.fileno()).st_size
                if source_size < 1 or source_size > MAX_DOWNLOAD_BYTES:
                    return {"status": "unavailable", "dispatch_state": "not_dispatched", "operation": "upload", "failure_class": "file_limit_exceeded", "page": await state.facts()}
                inputs = await self.control_handle(state, target, "file")
                if inputs is None:
                    return {"status": "unavailable", "dispatch_state": "not_dispatched", "operation": "upload", "failure_class": "file_input_unavailable", "page": await state.facts()}
                # ElementHandle.is_visible() is a zero-argument public API in
                # the selected public Playwright provider.
                if not await inputs.is_visible():
                    return {"status": "unavailable", "dispatch_state": "not_dispatched", "operation": "upload", "failure_class": "file_input_unavailable", "page": await state.facts()}
                existing = await inputs.evaluate("e => e.files ? e.files.length : 0")
                if existing:
                    return {"status": "unavailable", "dispatch_state": "not_dispatched", "operation": "upload", "failure_class": "file_input_not_empty", "page": await state.facts()}
                await inputs.set_input_files(str(source_path), timeout=timeout)
                return {"status": "completed", "dispatch_state": "dispatched", "operation": "upload", "page": await state.facts(), "browser_delivery": "completed", "page_receipt": "unknown", "page_processing": "unknown", "business_commit": "not_observed"}
            except TimeoutError:
                return {"status": "unknown_outcome", "dispatch_state": "dispatched", "operation": "upload", "failure_class": "timeout", "page": await state.facts()}
            except Exception as error:
                return {"status": "unknown_outcome", "dispatch_state": "dispatched", "operation": "upload", "failure_class": safe_text(error, 128), "page": await state.facts()}

        if target not in state.controls:
            return {"status": "unavailable", "dispatch_state": "not_dispatched", "operation": "download", "failure_class": "download_target_unsupported", "page": await state.facts()}
        role, _name, *metadata = state.controls[target]
        observed_href = metadata[0] if metadata else None
        target_failure = await self.target_failure(state, target, "link")
        if target_failure:
            return {"status": "unavailable", "dispatch_state": "not_dispatched", "operation": "download", "failure_class": target_failure, "page": await state.facts()}
        if role != "link" or await self.control_handle(state, target, "link") is None:
            return {"status": "unavailable", "dispatch_state": "not_dispatched", "operation": "download", "failure_class": "download_target_unsupported", "page": await state.facts()}
        staging = request.get("staging_path")
        if not isinstance(staging, str) or not staging or "\x00" in staging:
            return {"status": "unavailable", "dispatch_state": "not_dispatched", "operation": "download", "failure_class": "download_staging_unavailable", "page": await state.facts()}
        if not self.clear_downloads_root():
            return {"status": "unavailable", "dispatch_state": "not_dispatched", "operation": "download", "failure_class": "download_temp_unavailable", "page": await state.facts()}
        deadline = time.monotonic() + timeout / 1000
        download: Any = None
        request_events: list[Any] = []
        download_events: list[Any] = []
        cancelled_downloads: set[int] = set()
        successful = False
        listeners_installed = False
        deferred_pending_tasks: tuple[asyncio.Task[Any], ...] = ()
        operation_task = asyncio.current_task()
        if not hasattr(self, "download_operations"):
            self.download_operations = set()
        if operation_task is not None:
            self.download_operations.add(operation_task)
        browser_temp_root = getattr(self, "downloads_root", None)
        monitor_paths = [str(browser_temp_root)] if isinstance(browser_temp_root, Path) else []

        def on_request(item: Any) -> None:
            request_events.append(item)

        def on_download(item: Any) -> None:
            if all(candidate is not item for candidate in download_events):
                download_events.append(item)

        async def failure_result(failure_class: str) -> dict[str, Any]:
            return {"status": "unknown_outcome", "dispatch_state": "dispatched", "operation": "download", "failure_class": failure_class, "page": await state.facts()}

        def cancel_download(item: Any) -> Any:
            """Request public cancellation once; cleanup still deletes."""
            identity = id(item)
            if identity in cancelled_downloads:
                return None
            cancelled_downloads.add(identity)
            return item.cancel()

        try:
            link = await self.control_handle(state, target, "link")
            if link is None:
                return {"status": "unavailable", "dispatch_state": "not_dispatched", "operation": "download", "failure_class": "download_target_unsupported", "page": await state.facts()}
            href = await link.get_attribute("href")
            resolved = safe_url(urljoin(state.page.url, href or "")) if isinstance(href, str) else None
            observed_resolved = safe_url(urljoin(state.page.url, observed_href or "")) if observed_href else None
            if not resolved or not observed_resolved or resolved != observed_resolved or origin_of(resolved) != expected:
                return {"status": "unavailable", "dispatch_state": "not_dispatched", "operation": "download", "failure_class": "download_target_unsupported", "page": await state.facts()}
            state.page.on("request", on_request)
            state.page.on("download", on_download)
            listeners_installed = True
            remaining = max(1, min(timeout, int(max(0.001, deadline - time.monotonic()) * 1000)))
            async with state.page.expect_download(timeout=remaining) as download_info:
                await link.click(timeout=remaining)
            download = await download_info.value
            if all(candidate is not download for candidate in download_events):
                download_events.insert(0, download)
            # Exactly one observed Download event must be the value returned by
            # expect_download. Keep the listener installed until the complete
            # save/failure lifecycle so a second event cannot be missed.
            if len(download_events) != 1 or download_events[0] is not download:
                return await failure_result("download_relation_unavailable")
            download_url = safe_url(download.url)
            if not download_url or (scope_semantics == "legacy_request_guard_v1" and origin_of(download_url) not in scope) or not self.matching_download_chain(state, request_events, observed_resolved, download_url, scope, download, scope_semantics):
                return await failure_result("download_relation_unavailable")
            # save_as may wait for Playwright's original browser artifact before
            # copying it to staging. Monitor both public download storage and
            # staging for the whole save/failure lifecycle.
            await self.bounded_download_call(staging, deadline, lambda: download.save_as(staging), monitor_paths, lambda: cancel_download(download))
            browser_temp_path: str | None = None
            path_reader = getattr(download, "path", None)
            if callable(path_reader):
                candidate_path = await self.bounded_download_call(staging, deadline, path_reader, monitor_paths, lambda: cancel_download(download))
                if isinstance(candidate_path, (str, os.PathLike)) and candidate_path:
                    browser_temp_path = os.fspath(candidate_path)
                    if isinstance(browser_temp_root, Path):
                        try:
                            Path(browser_temp_path).absolute().relative_to(browser_temp_root.absolute())
                        except ValueError:
                            return await failure_result("download_temp_unavailable")
            failure = await self.bounded_download_call(staging, deadline, download.failure, monitor_paths, lambda: cancel_download(download))
            if failure:
                return await failure_result(safe_text(failure, 128))
            if len(download_events) != 1 or download_events[0] is not download:
                return await failure_result("download_relation_unavailable")
            if not self.matching_download_chain(state, request_events, observed_resolved, download_url, scope, download, scope_semantics):
                return await failure_result("download_relation_unavailable")
            staged = Path(staging)
            size = staged.stat().st_size
            if time.monotonic() >= deadline:
                return await failure_result("timeout")
            if size > MAX_DOWNLOAD_BYTES:
                return await failure_result("file_limit_exceeded")
            digest = hashlib.sha256()
            with staged.open("rb", buffering=0) as handle:
                while True:
                    if time.monotonic() >= deadline:
                        raise DownloadTimeout()
                    chunk = handle.read(1024 * 1024)
                    if not chunk:
                        break
                    digest.update(chunk)
            suggested = safe_text(download.suggested_filename, 128)
            if not suggested or "/" in suggested or "\\" in suggested:
                return await failure_result("download_name_invalid")
            await self.cleanup_download(download, cancel=False)
            if not self.clear_downloads_root():
                return await failure_result("download_cleanup_failed")
            successful = True
            return {"status": "completed", "dispatch_state": "dispatched", "operation": "download", "page": await state.facts(), "browser_delivery": "completed", "page_receipt": "observed", "page_processing": "unknown", "business_commit": "not_observed", "download": {"page_url": safe_url(state.page.url), "url": download_url, "suggested_filename": suggested, "byte_length": size, "sha256": digest.hexdigest(), "staging_path": staging}}
        except DownloadLimitExceeded:
            return await failure_result("file_limit_exceeded")
        except DownloadTimeout as error:
            deferred_pending_tasks = error.pending_tasks
            return await failure_result("timeout")
        except TimeoutError:
            return await failure_result("timeout")
        except Exception as error:
            return await failure_result(safe_text(error, 128))
        finally:
            pending_cleanup = bool(deferred_pending_tasks and any(not task.done() for task in deferred_pending_tasks))
            if pending_cleanup:
                self.defer_download_cleanup(deferred_pending_tasks, state.page, on_request, on_download, download_events, download, staging, cancelled_downloads)
            elif listeners_installed:
                self.remove_listener(state.page, "request", on_request)
                self.remove_listener(state.page, "download", on_download)
            if not successful and not pending_cleanup:
                for candidate in download_events:
                    await self.cleanup_download(candidate, cancel=id(candidate) not in cancelled_downloads)
                if download is not None and all(candidate is not download for candidate in download_events):
                    await self.cleanup_download(download, cancel=id(download) not in cancelled_downloads)
                self.clear_downloads_root()
                try:
                    Path(staging).unlink()
                except FileNotFoundError:
                    pass
            if operation_task is not None:
                self.download_operations.discard(operation_task)

    def state(self, request: dict[str, Any]) -> PageState:
        ref = request.get("provider_page_ref")
        if not isinstance(ref, str) or ref not in self.pages:
            raise ValueError("Page relation is unavailable.")
        state = self.pages[ref]
        if state.page.is_closed():
            raise ValueError("Page is closed.")
        return state

    async def close(self) -> None:
        # This method intentionally does not acquire ``command_lock``.  The
        # reader dispatches close on the same asyncio loop as ordinary
        # commands, but close must be able to reach the public Context while
        # a pending wait/save operation is still settling.  Playwright then
        # owns the interruption; no task cancellation or second loop is used.
        self.close_requested.set()
        # Keep the lifecycle state explicit even for the small object fakes
        # used by the deterministic driver tests (which bypass ``__init__``).
        if not hasattr(self, "_close_completed"):
            self._close_completed = False
        if not hasattr(self, "_close_error"):
            self._close_error = None
        if not hasattr(self, "_close_finalized"):
            self._close_finalized = False
        if getattr(self, "_close_completed", False):
            return
        # A failed lifecycle is sticky: retrying a half-closed Provider could
        # duplicate cleanup or turn the original failure into a false success.
        # Keep the failed resources isolated and surface the same error to
        # every later owner call.
        if self._close_finalized and self._close_error is not None:
            raise self._close_error
        current = asyncio.current_task()
        existing = getattr(self, "_close_in_progress", None)
        if existing is not None and existing is not current:
            # EOF and an explicit close can be observed together. Join the
            # first lifecycle attempt so stop/root cleanup cannot race it or
            # turn its Provider error into a second successful close.
            await asyncio.shield(existing)
            return
        if current is not None:
            self._close_in_progress = current
        close_errors: list[BaseException] = []
        async with self.close_lock:
            if getattr(self, "_close_completed", False):
                return
            # Keep failed resources in private closing slots for isolation,
            # while removing reusable references immediately. Every
            # subsequent dispatch remains fenced by close_requested.
            context = getattr(self, "_closing_context", None) or getattr(self, "context", None)
            playwright = getattr(self, "_closing_playwright", None) or getattr(self, "playwright", None)
            self.context = None
            self.playwright = None
            self._closing_context = context
            self._closing_playwright = playwright
            # A download cancellation may already have attempted Context.close
            # and stored its failure. Do not invoke that failed public object a
            # second time, but still make the remaining stop attempt below.
            if context is not None and self._close_error is None:
                try:
                    await context.close()
                except BaseException as error:
                    close_errors.append(error)
                else:
                    self._closing_context = None
        # Do not hold close_lock while waiting: a timed-out file operation may
        # need the same lock for its final public Context.close call. The
        # operation was registered before any Provider await, so waiting here
        # closes the race between its timeout and this owner close.
        current = asyncio.current_task()
        pending_operations = tuple(
            task for task in getattr(self, "download_operations", set())
            if task is not current and not task.done()
        )
        if pending_operations:
            await asyncio.gather(*pending_operations, return_exceptions=True)
        await self.wait_download_cleanup()
        # An adapter that owns an externally launched browser must close that
        # browser while the Playwright transport is still usable. Existing
        # persistent-context adapters have no external resource here, so this preserves their
        # existing lifecycle while making the Chrome public connection
        # graceful rather than a disconnect followed by SIGTERM.
        try:
            await self.close_owned_resources()
        except BaseException as error:
            close_errors.append(error)
        if playwright is not None:
            try:
                await playwright.stop()
            except BaseException as error:
                close_errors.append(error)
            else:
                self._closing_playwright = None
        if close_errors:
            # Do not remove task-owned temporary state after an incomplete
            # close. The driver is permanently fenced, and the original
            # Provider error is surfaced to the JSONL caller instead of being
            # reported as a successful close.
            if self._close_error is None:
                self._close_error = close_errors[0]
            self._close_finalized = True
            raise self._close_error
        if self._close_error is not None:
            self._close_finalized = True
            raise self._close_error
        self._close_completed = True
        self._close_finalized = True
        self.remove_downloads_root()

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


async def dispatch(driver: Driver, request: dict[str, Any]) -> Any:
    op = request.get("op")
    if op != "close" and (driver.close_requested.is_set() or driver.download_settling):
        return {"status": "unavailable", "dispatch_state": "not_dispatched", "failure_class": "driver_closing" if driver.close_requested.is_set() else "download_cleanup_pending"}
    if op == "page_list": return {"pages": await driver.list_pages(), "rejected_unattributed_count": driver.unattributed_rejection_count}
    if op == "page_open":
        origins = list(validated_origins(request.get("authorized_origins")))
        scope_semantics = validated_scope_semantics(request.get("scope_semantics"), driver.scope_semantics)
        if scope_semantics != driver.scope_semantics:
            raise ValueError("Managed scope semantics cannot change after Instance start.")
        page = await driver.context.new_page()
        state = next((item for item in driver.pages.values() if item.page == page), None) or driver.register(page, origins, scope_semantics=scope_semantics)
        state.origins = set(origins)
        driver.current = state.ref
        if request.get("url"):
            await driver.navigate(state, request["url"], origins, scope_semantics)
        return await state.facts(task_selected=True)
    if op == "page_activate":
        state = driver.state(request)
        driver.current = state.ref
        return await state.facts(task_selected=True)
    if op == "page_close":
        state = driver.state(request)
        await state.page.close()
        target = request.get("safe_return_provider_page_ref")
        if isinstance(target, str) and target in driver.pages and not driver.pages[target].page.is_closed():
            driver.current = target
        elif driver.current == state.ref:
            fallback = next((item.ref for item in driver.pages.values() if not item.page.is_closed()), None)
            driver.current = fallback
        return await driver.list_pages()
    if op == "page_navigate":
        state = driver.state(request)
        origins = list(validated_origins(request.get("authorized_origins")))
        scope_semantics = driver.request_scope(state, request)
        if request.get("action") == "reload":
            driver.apply_page_scope(state, origins, scope_semantics=scope_semantics)
            await state.page.reload()
        elif request.get("action") == "back":
            driver.apply_page_scope(state, origins, scope_semantics=scope_semantics)
            await state.page.go_back()
        elif request.get("action") == "forward":
            driver.apply_page_scope(state, origins, scope_semantics=scope_semantics)
            await state.page.go_forward()
        else: await driver.navigate(state, str(request.get("url", "")), origins, scope_semantics)
        return await state.facts(task_selected=state.ref == driver.current)
    if op == "observe": return await driver.observe(request)
    if op == "observe_identity": return (await driver.observe(request)).get("observation", {})
    if op == "interact": return await driver.interact(request)
    if op == "read_public_page": return await driver.public_page(request)
    if op == "diagnostics": return await driver.diagnostics(request)
    if op == "environment": return await driver.environment(request)
    if op == "screenshot": return await driver.screenshot(request)
    if op == "file_operation": return await driver.file_operation(request)
    if op == "close": await driver.close(); return {"closed": True}
    raise ValueError("Driver operation is not allowlisted.")


async def main_async(adapter: Any) -> None:
    set_default_adapter(adapter)
    sys.stdout.reconfigure(line_buffering=True)
    driver: Driver | None = None
    driver_holder: dict[str, Driver | None] = {"value": None}
    launch_in_progress = False
    launch_ready = asyncio.Event()
    launch_ready.set()
    command_lock = asyncio.Lock()
    # One ordinary command is processed by the consumer at a time.  Keep the
    # buffered portion one slot below the lifecycle budget so buffered + in
    # flight ordinary work is always <= MAX_PENDING_COMMANDS (64).
    input_queue: asyncio.Queue[str | None] = asyncio.Queue(maxsize=MAX_PENDING_COMMANDS - 1)
    close_queue: asyncio.Queue[str | None] = asyncio.Queue(maxsize=1)
    eof_seen = asyncio.Event()

    def is_close_line(raw: str) -> bool:
        if len(raw.encode("utf-8")) > MAX_LINE:
            return False
        try:
            value = json.loads(raw)
        except (TypeError, ValueError):
            return False
        return isinstance(value, dict) and value.get("op") == "close"

    def line_operation(raw: str) -> str | None:
        if len(raw.encode("utf-8")) > MAX_LINE:
            return None
        try:
            value = json.loads(raw)
        except (TypeError, ValueError):
            return None
        operation = value.get("op") if isinstance(value, dict) else None
        return operation if isinstance(operation, str) else None

    def input_message_id(raw: str) -> int:
        if len(raw.encode("utf-8")) > MAX_LINE:
            return 0
        try:
            value = json.loads(raw)
        except (TypeError, ValueError):
            return 0
        return value.get("id") if isinstance(value, dict) and isinstance(value.get("id"), int) else 0

    def reject_full_input_queue(raw: str) -> None:
        print(json.dumps({"id": input_message_id(raw), "status": "error", "message": "Driver ordinary queue is full."}, separators=(",", ":")), flush=True)

    async def read_input() -> None:
        while True:
            raw = await asyncio.to_thread(sys.stdin.readline)
            if raw == "":
                eof_seen.set()
                await input_queue.put(None)
                return
            # Keep close out of the bounded ordinary queue so a producer can
            # always reach the independent lifecycle path behind busy work.
            if is_close_line(raw):
                try:
                    close_queue.put_nowait(raw)
                except asyncio.QueueFull:
                    pass
            else:
                # Never block the reader on ordinary admission: doing so
                # would hide a later EOF/close line behind a full queue. The
                # bounded queue is an explicit overload boundary; rejected
                # lines receive a correlated response and are never started.
                try:
                    input_queue.put_nowait(raw)
                except asyncio.QueueFull:
                    reject_full_input_queue(raw)

    async def process(raw: str) -> None:
        nonlocal driver, launch_in_progress
        if len(raw.encode("utf-8")) > MAX_LINE:
            print(json.dumps({"id": 0, "status": "error", "message": "Driver request is too large."}, separators=(",", ":")), flush=True)
            return
        message_id = 0
        try:
            request = json.loads(raw)
            if not isinstance(request, dict): raise ValueError("Driver request must be an object.")
            message_id = request.get("id") if isinstance(request.get("id"), int) else 0
            if request.get("op") == "close":
                # Close is the one lifecycle command that deliberately
                # bypasses the ordinary-operation lock. All calls remain on
                # this owner loop, while Context.close can interrupt a
                # pending Playwright operation and make its outcome explicit.
                active_driver = driver_holder["value"]
                if active_driver is None and launch_in_progress:
                    await launch_ready.wait()
                    # Let an already queued ordinary command enter its
                    # serialized Provider section before close interrupts it.
                    await asyncio.sleep(0)
                    active_driver = driver_holder["value"]
                if active_driver is None:
                    raise ValueError("Driver has not launched.")
                active_driver.close_requested.set()
                result = await dispatch(active_driver, request)
                if driver is active_driver:
                    driver = None
                driver_holder["value"] = None
                print(json.dumps({"id": message_id, "status": "ok", "result": result}, ensure_ascii=False, separators=(",", ":")), flush=True)
                return
            async with command_lock:
                if request.get("op") == "launch":
                    if driver is not None: raise ValueError("Driver is already launched.")
                    if not launch_in_progress:
                        launch_in_progress = True
                        launch_ready.clear()
                    try:
                        driver = await Driver.create(request)
                        driver_holder["value"] = driver
                        page = await driver.pages[driver.current].facts(task_selected=True)
                        provider_id = str(getattr(adapter, "provider_id", "provider"))
                        driver_ref = str(getattr(adapter, "driver_ref", f"{provider_id}-playwright-jsonl"))
                        result = {"status": "ready", "driver_ref": driver_ref, "page": page, "pages": await driver.list_pages(), "viewer_entry": viewer_entry(bool(driver.request.get("headless", False))), "facts": [{"key": "driver.api", "source": "observed", "value": "playwright_public"}, {"key": "launch_options.replay", "source": "observed", "value": "exact" if driver.replay else "created"}, *driver.provider_facts]}
                    finally:
                        launch_in_progress = False
                elif driver is None:
                    raise ValueError("Driver has not launched.")
                else:
                    result = await dispatch(driver, request)
            print(json.dumps({"id": message_id, "status": "ok", "result": result}, ensure_ascii=False, separators=(",", ":")), flush=True)
        except BaseException as error:
            print(json.dumps({"id": message_id, "status": "error", "message": f"{type(error).__name__}: {safe_text(error, 240)}"}, ensure_ascii=False, separators=(",", ":")), flush=True)

    reader = asyncio.create_task(read_input())

    async def consume_ordinary() -> None:
        nonlocal launch_in_progress
        while True:
            raw = await input_queue.get()
            if raw is None:
                return
            operation = line_operation(raw)
            # Mark launch before entering its process so a close consumer can
            # wait for setup without taking the ordinary lock.  This consumer
            # deliberately awaits each ordinary command instead of creating
            # one task per admitted line: buffered + in-flight work remains
            # bounded by MAX_PENDING_COMMANDS.
            if operation == "launch" and driver is None and not launch_in_progress:
                launch_in_progress = True
                launch_ready.clear()
            await process(raw)
            if operation == "launch":
                launch_ready.set()

    async def consume_close() -> None:
        while True:
            raw = await close_queue.get()
            if raw is None:
                return
            task = asyncio.create_task(process(raw))
            await task

    ordinary_consumer = asyncio.create_task(consume_ordinary())
    close_consumer = asyncio.create_task(consume_close())
    try:
        # EOF is independent from the bounded ordinary consumer. It may be
        # processing one ordinary command while close still needs to
        # interrupt a pending Provider operation.
        await eof_seen.wait()
    finally:
        # EOF is a lifecycle boundary: close the public Context first so
        # pending Provider commands can settle, then retain their real JSONL
        # outcomes while the bounded ordinary consumer drains.
        if launch_in_progress:
            await launch_ready.wait()
        active_driver = driver_holder["value"]
        if active_driver is not None:
            active_driver.close_requested.set()
            await active_driver.close()
            if driver is active_driver:
                driver = None
            driver_holder["value"] = None
        # Let the independent close consumer finish any close request already
        # read before EOF, then stop it with a bounded queue sentinel.
        await close_queue.put(None)
        await asyncio.gather(close_consumer, return_exceptions=True)
        await asyncio.gather(ordinary_consumer, return_exceptions=True)
        # The reader publishes its EOF sentinel through the bounded queue. Do
        # not cancel it before that put completes: cancellation at the
        # boundary would strand the ordinary consumer forever on an empty
        # queue after it drained the final command.
        await asyncio.gather(reader, return_exceptions=True)


def main(adapter: Any) -> None:
    asyncio.run(main_async(adapter))

#!/usr/bin/env python3
"""Small private JSON-lines bridge for the Harbor Camoufox driver.

The bridge deliberately exposes only page facts and bounded readiness facts.  It
does not print DOM, storage, cookies, network bodies, or a Playwright endpoint.
"""

from __future__ import annotations

import contextlib
import configparser
import importlib.metadata
import hashlib
import json
import os
import platform
import re
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse


PLAYWRIGHT: Any = None
PLAYWRIGHT_TIMEOUT_ERROR: type[BaseException] | None = None
CONTEXT: Any = None
PAGE: Any = None
PROFILE_DIR = ""
EXECUTABLE_PATH = ""
LAUNCH_EXECUTABLE_PATH = ""
LAUNCH_LAYOUT_DIR = ""
PROPERTIES_SOURCE = "adjacent"


def send(message_id: int, status: str, **payload: Any) -> None:
    result = {"id": message_id, "status": status, **payload}
    sys.stdout.write(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def safe_text(value: str) -> str:
    return re.sub(r"([?&][^=\s&]+)=([^\s&#]*)", r"\1=<redacted>", value)


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
    global PLAYWRIGHT, PLAYWRIGHT_TIMEOUT_ERROR, CONTEXT, PAGE, PROFILE_DIR, EXECUTABLE_PATH, LAUNCH_EXECUTABLE_PATH, PROPERTIES_SOURCE
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
        url = request.get("url")
        if isinstance(url, str) and url:
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
        PAGE.goto(url, wait_until="domcontentloaded", timeout=int(request.get("timeout_ms", 5_000)))
    return {"page": page_facts()}


def managed_public_page(request: dict[str, Any]) -> dict[str, Any]:
    if PAGE is None:
        raise RuntimeError("Camoufox Driver has no active page.")
    expected = request.get("expected_origin")
    def origin(value: str) -> str:
        parsed = urlparse(value)
        return f"{parsed.scheme}://{parsed.netloc}"
    if not isinstance(expected, str) or origin(expected) != expected:
        return {"failure_class": "managed_public_origin_denied"}
    target = request.get("url")
    with contextlib.redirect_stdout(sys.stderr):
        if target is not None:
            if not isinstance(target, str) or origin(target) != expected:
                return {"failure_class": "managed_public_origin_denied"}
            # Native navigation may follow redirects. A refusal below means the
            # navigation may have happened; it never means external effects were undone.
            PAGE.goto(target, wait_until="domcontentloaded", timeout=15_000)
        if origin(str(PAGE.url)) != expected:
            return {"failure_class": "managed_public_navigation_redirected" if target is not None else "managed_public_origin_denied", "page": page_facts()}
        if target is not None:
            return {"page": page_facts()}
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
        if origin(str(PAGE.url)) != expected or not isinstance(observed, dict):
            return {"failure_class": "managed_public_origin_denied"}
        text = public_text(observed.get("text"), 4096)
        if not text:
            return {"failure_class": "managed_public_content_unavailable"}
        return {"page": page_facts(), "text": text, "truncated": observed.get("truncated") is True}


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
            elif op == "managed_public_page":
                send(message_id, "ok", **managed_public_page(request))
            elif op == "managed_observe":
                if PAGE is None:
                    raise RuntimeError("Camoufox Driver has no active page.")
                # Private pipe command; the expression is fixed by the Harbor adapter,
                # never accepted from the public HTTP API.
                with contextlib.redirect_stdout(sys.stderr):
                    observation = PAGE.evaluate("mw:" + request["expression"])
                send(message_id, "ok", observation=observation)
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

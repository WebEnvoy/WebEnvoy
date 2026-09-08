#!/usr/bin/env python3
"""Small private JSON-lines bridge for the Harbor Camoufox driver.

The bridge deliberately exposes only page facts and bounded readiness facts.  It
does not print DOM, storage, cookies, network bodies, or a Playwright endpoint.
"""

from __future__ import annotations

import contextlib
import configparser
import importlib.metadata
import json
import os
import platform
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Any


PLAYWRIGHT: Any = None
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


def safe_error(error: BaseException) -> str:
    message = str(error).replace(PROFILE_DIR, "<profile>").replace(EXECUTABLE_PATH, "<browser>")
    message = " ".join(message.split())[:240]
    return f"{type(error).__name__}: {message}" if message else type(error).__name__


def prepare_properties(executable_path: str) -> tuple[str, str]:
    """Return a Camoufox-compatible executable path without mutating the install.

    Camoufox 0.5.6 resolves properties.json beside the executable it receives,
    while the official macOS bundle keeps that public file in Contents/Resources.
    When those paths differ, stage only symlinks and the public properties file in
    a Driver-owned temporary layout. The binary and Resources remain read-only at
    their original install path.
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

            def link_or_copy(source: str, destination: str) -> str:
                try:
                    os.link(source, destination)
                    return destination
                except OSError:
                    return shutil.copy2(source, destination)

            # Juggler content processes require a real macOS bundle layout. A
            # symlinked launcher or Resources directory makes those processes
            # crash, so clone the directory tree with hardlinks where possible.
            shutil.copytree(source_app, staged_app, copy_function=link_or_copy, symlinks=True)
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
    if PAGE is None:
        return {"current_url": None, "title": None, "status": "unavailable"}
    current_url: str | None
    try:
        current_url = str(PAGE.url) if PAGE.url else None
    except Exception:
        current_url = None
    try:
        title = str(PAGE.title())[:512]
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
    global PLAYWRIGHT, CONTEXT, PAGE, PROFILE_DIR, EXECUTABLE_PATH, LAUNCH_EXECUTABLE_PATH, PROPERTIES_SOURCE
    PROFILE_DIR = str(request.get("profile_dir", ""))
    EXECUTABLE_PATH = str(request.get("executable_path", ""))
    if not PROFILE_DIR or not EXECUTABLE_PATH:
        raise ValueError("Camoufox Driver launch requires an executable and managed profile.")
    LAUNCH_EXECUTABLE_PATH, PROPERTIES_SOURCE = prepare_properties(EXECUTABLE_PATH)
    from camoufox import NewBrowser, launch_options
    from playwright.sync_api import sync_playwright

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


def site_resource_probe(request: dict[str, Any]) -> dict[str, Any]:
    if PAGE is None:
        raise RuntimeError("Camoufox Driver has no active page.")
    site_id = request.get("site_id")
    if site_id not in ("xiaohongshu", "boss"):
        raise ValueError("Camoufox Driver site probe is not allowlisted.")
    expression = xhs_probe_expression() if site_id == "xiaohongshu" else boss_probe_expression()
    with contextlib.redirect_stdout(sys.stderr):
        observation = PAGE.evaluate(expression)
    if not isinstance(observation, dict):
        raise RuntimeError("Camoufox Driver returned no public site observation.")
    return {"observation": observation}


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
            elif op == "site_resource_probe":
                send(message_id, "ok", **site_resource_probe(request))
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

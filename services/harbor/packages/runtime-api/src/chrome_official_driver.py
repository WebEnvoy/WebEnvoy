#!/usr/bin/env python3
"""Official Chrome adapter for the shared public Playwright driver.

The adapter owns only the official Chrome process and its public connection.
Page, file, diagnostics, JSONL and lifecycle semantics remain in
``playwright_shared_driver``.  This module deliberately has no Camoufox
dependency and never falls back to another browser or transport.
"""

from __future__ import annotations

import asyncio
import hashlib
import importlib.metadata
import os
import re
import signal
import socket
import subprocess
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from playwright_shared_driver import async_playwright, canonical_executable_path, main


PLAYWRIGHT_VERSION = "1.60.0"
BROWSER_VERSION = "153.0.8010.37"
SOURCE = "official_release"
SIGNATURE_STATUS = "apple_codesign_verified"
SOURCE_SHA256 = "6b6cf06fc357a647d26a32453780f020d9d36978ebe30d69ba8a233b538373e3"
EXECUTABLE_SHA256 = "83dfc7d9e4fde4272ced1c0cc8d3584d3b5d3d3bdac46978ee05031e8c2ae3c2"
CONNECTION = "public_connect_over_cdp"
LOOPBACK_HOST = "127.0.0.1"
PROCESS_WAIT_TIMEOUT_S = 5.0
ENDPOINT_WAIT_TIMEOUT_S = 2.0
ACTIVE_PORT_FILENAME = "DevToolsActivePort"
LANGUAGE = re.compile(r"^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$")


def _sha256_file(path: str) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb", buffering=0) as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def _validate_pairing(value: Any) -> dict[str, str]:
    expected = {
        "source": SOURCE,
        "signature_status": SIGNATURE_STATUS,
        "source_sha256": SOURCE_SHA256,
        "executable_sha256": EXECUTABLE_SHA256,
        "browser_version": BROWSER_VERSION,
        "playwright_version": PLAYWRIGHT_VERSION,
    }
    if not isinstance(value, dict) or set(value) != set(expected) or value != expected:
        raise ValueError("Official Chrome source/version/hash pairing is not trusted.")
    return expected


def _require_v2_scope(request: dict[str, Any]) -> None:
    if request.get("scope_semantics") != "agent_operations_v2":
        raise ValueError("Official Chrome shared execution requires agent_operations_v2 scope semantics.")


def _validate_language(value: Any) -> str:
    if not isinstance(value, str) or not LANGUAGE.fullmatch(value):
        raise ValueError("Official Chrome language configuration is unsupported.")
    return value


def _validate_proxy(value: Any) -> str:
    if not isinstance(value, str) or not value or len(value) > 2048 or any(ord(char) < 0x20 for char in value):
        raise ValueError("Official Chrome proxy configuration is unsupported.")
    try:
        parsed = urlsplit(value)
    except ValueError as error:
        raise ValueError("Official Chrome proxy configuration is unsupported.") from error
    if parsed.scheme not in {"http", "https", "socks4", "socks5"} or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Official Chrome proxy configuration is unsupported.")
    if parsed.path not in ("", "/") or parsed.query or parsed.fragment:
        raise ValueError("Official Chrome proxy configuration is unsupported.")
    return value


def _timezone_from_path(path: Path) -> str | None:
    try:
        resolved = path.resolve(strict=True).as_posix()
    except OSError:
        return None
    marker = "/zoneinfo/"
    if marker not in resolved:
        return None
    value = resolved.split(marker, 1)[1].removeprefix("posix/").removeprefix("right/")
    if value in {"Etc/UTC", "Etc/GMT", "GMT"}:
        value = "UTC"
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError):
        return None
    return value


def _host_timezone() -> str | None:
    configured = os.environ.get("TZ")
    if configured:
        value = configured.removeprefix(":")
        value = _timezone_from_path(Path(value)) if value.startswith("/") else value
        if value in {"Etc/UTC", "Etc/GMT", "GMT"}:
            value = "UTC"
        if value:
            try:
                ZoneInfo(value)
                return value
            except (ZoneInfoNotFoundError, ValueError):
                return None
    return _timezone_from_path(Path("/etc/localtime"))


def _validate_timezone(value: Any) -> str:
    if not isinstance(value, str) or not value or len(value) > 128 or any(ord(char) < 0x20 or ord(char) == 0x7f for char in value):
        raise ValueError("Official Chrome timezone configuration is unsupported.")
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError) as error:
        raise ValueError("Official Chrome timezone configuration is unsupported.") from error
    return value


async def verify_timezone_readback(context: Any, timezone: str | None) -> None:
    if timezone is None:
        return
    pages = getattr(context, "pages", None)
    if not isinstance(pages, (list, tuple)) or not pages:
        raise ValueError("Official Chrome timezone readback has no Page.")
    try:
        matched = await pages[0].evaluate(
            """expected => {
                const canonical = value => {
                    try { return value ? new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone || null : null; }
                    catch (_) { return null; }
                };
                const observed = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
                return canonical(expected) !== null && canonical(expected) === canonical(observed);
            }""",
            timezone,
        )
    except BaseException as error:
        raise ValueError("Official Chrome timezone readback is unavailable.") from error
    if matched is not True:
        raise ValueError("Official Chrome timezone readback did not match the configured host timezone.")


def chrome_launch_flags(request: dict[str, Any]) -> list[str]:
    """Build the small set of managed Chrome launch flags.

    Timezone is accepted only when it is the host's actual IANA timezone;
    viewport remains unsupported for a public CDP attach.
    """
    environment = request.get("environment")
    if environment is None:
        environment = {}
    if not isinstance(environment, dict) or set(environment) - {"language", "timezone", "viewport", "proxy_server"}:
        raise ValueError("Official Chrome environment configuration is unsupported.")

    flags: list[str] = []
    language = environment.get("language")
    if language is not None:
        flags.append(f"--lang={_validate_language(language)}")
    timezone = environment.get("timezone")
    if timezone is not None:
        timezone = _validate_timezone(timezone)
        if timezone != _host_timezone():
            raise ValueError("Official Chrome public connection only supports the host's actual IANA timezone.")
    viewport = environment.get("viewport")
    if viewport is not None:
        raise ValueError("Official Chrome public connection cannot apply viewport configuration.")
    proxy = environment.get("proxy_server")
    if proxy is not None:
        flags.append(f"--proxy-server={_validate_proxy(proxy)}")
    return flags


def build_chrome_launch_args(executable: str, profile_dir: str, request: dict[str, Any]) -> list[str]:
    if not executable or not profile_dir:
        raise ValueError("Official Chrome launch identity is invalid.")
    if type(request.get("headless")) is not bool:
        raise ValueError("Official Chrome headless setting is invalid.")
    args = [
        executable,
        f"--user-data-dir={profile_dir}",
        f"--remote-debugging-address={LOOPBACK_HOST}",
        "--remote-debugging-port=0",
        "--no-first-run",
        "--no-default-browser-check",
    ]
    if request["headless"]:
        args.append("--headless=new")
    args.extend(chrome_launch_flags(request))
    url = request.get("url")
    if url is not None:
        if not isinstance(url, str) or not url:
            raise ValueError("Official Chrome initial URL is invalid.")
        args.append(url)
    return args


def remove_stale_devtools_active_port(profile: Path) -> None:
    active_port = profile / ACTIVE_PORT_FILENAME
    try:
        if active_port.is_symlink():
            raise ValueError("Official Chrome DevToolsActivePort must not be a symlink.")
        if not active_port.exists():
            return
        if not active_port.is_file():
            raise ValueError("Official Chrome DevToolsActivePort is not a regular file.")
        active_port.unlink()
    except FileNotFoundError:
        return


def read_devtools_active_port(profile: Path) -> dict[str, str | int]:
    active_port = profile / ACTIVE_PORT_FILENAME
    if active_port.is_symlink():
        raise ValueError("Official Chrome DevToolsActivePort must not be a symlink.")
    with active_port.open("r", encoding="ascii", errors="strict") as handle:
        value = handle.read(4096)
        if handle.read(1):
            raise ValueError("Official Chrome DevToolsActivePort is too large.")
    lines = value.splitlines()
    if len(lines) != 2 or any(not line or "\x00" in line for line in lines):
        raise ValueError("Official Chrome DevToolsActivePort is malformed.")
    try:
        port = int(lines[0], 10)
    except ValueError as error:
        raise ValueError("Official Chrome DevToolsActivePort has an invalid port.") from error
    browser_path = lines[1]
    if not 1 <= port <= 65_535 or not browser_path.startswith("/devtools/browser/"):
        raise ValueError("Official Chrome DevToolsActivePort has an invalid browser identifier.")
    return {"port": port, "browser_path": browser_path}


def endpoint_is_open(endpoint: str) -> bool:
    parsed = urlsplit(endpoint)
    if parsed.scheme != "http" or parsed.hostname != LOOPBACK_HOST or parsed.port is None:
        return False
    try:
        with socket.create_connection((LOOPBACK_HOST, parsed.port), timeout=0.2):
            return True
    except OSError:
        return False


def process_identity(process: Any, executable: str, profile_dir: str) -> dict[str, str | int]:
    pid = getattr(process, "pid", None)
    if type(pid) is not int or pid < 1:
        raise ValueError("Official Chrome process identity is unavailable.")
    try:
        start = subprocess.run(["ps", "-p", str(pid), "-o", "lstart="], check=True, capture_output=True, text=True).stdout.strip()
        command = subprocess.run(["ps", "-p", str(pid), "-o", "command="], check=True, capture_output=True, text=True).stdout.strip()
    except (OSError, subprocess.SubprocessError) as error:
        raise ValueError("Official Chrome process identity could not be read.") from error
    if not start or not (command == executable or command.startswith(executable + " ")):
        raise ValueError("Official Chrome process executable does not match the owner binding.")
    # Match argument boundaries, not substrings: `/profiles/a` must not accept
    # a process using `/profiles/a-other`.  The value is escaped as a whole
    # path so spaces in a managed directory remain part of that argument even
    # when `ps` prints the command without shell quoting.
    required_args = (
        f"--user-data-dir={profile_dir}",
        f"--remote-debugging-address={LOOPBACK_HOST}",
        "--remote-debugging-port=0",
    )
    if any(re.search(rf"(?<!\S){re.escape(argument)}(?=\s|$)", command) is None for argument in required_args):
        raise ValueError("Official Chrome process arguments do not match the owner binding.")
    return {"pid": pid, "started_at": start}


def listener_identity(process: Any, port: int) -> dict[str, str | int] | None:
    """Read the macOS listener table and require this PID on loopback only."""
    pid = getattr(process, "pid", None)
    if type(pid) is not int or pid < 1 or not 1 <= port <= 65_535:
        raise ValueError("Official Chrome listener identity is invalid.")
    try:
        result = subprocess.run(
            ["/usr/sbin/lsof", "-nP", "-a", "-p", str(pid), f"-iTCP:{port}", "-sTCP:LISTEN", "-Fpcn"],
            check=False,
            capture_output=True,
            text=True,
        )
    except OSError as error:
        raise ValueError("Official Chrome listener identity could not be read.") from error
    if result.returncode not in (0, 1):
        raise ValueError("Official Chrome listener identity could not be read.")
    pids = [line[1:] for line in result.stdout.splitlines() if line.startswith("p")]
    addresses = [line[1:] for line in result.stdout.splitlines() if line.startswith("n")]
    if not addresses:
        return None
    if not pids or any(value != str(pid) for value in pids):
        raise ValueError("Official Chrome listener PID does not match the owned process.")
    expected = f"{LOOPBACK_HOST}:{port}"
    if any(address != expected for address in addresses):
        raise ValueError("Official Chrome private connection is not bound to its exact loopback listener.")
    return {"pid": pid, "address": expected}


async def wait_for_listener(process: Any, port: int, deadline: float) -> dict[str, str | int]:
    while time.monotonic() < deadline:
        if getattr(process, "returncode", None) is not None:
            raise ValueError("Official Chrome exited before its exact loopback listener became ready.")
        listener = listener_identity(process, port)
        if listener is not None:
            return listener
        await asyncio.sleep(0.05)
    raise TimeoutError("Official Chrome exact loopback listener timed out.")


async def wait_for_devtools_active_port(profile: Path, process: Any, deadline: float) -> dict[str, str | int]:
    while time.monotonic() < deadline:
        if getattr(process, "returncode", None) is not None:
            raise ValueError("Official Chrome exited before its private connection became ready.")
        try:
            return read_devtools_active_port(profile)
        except FileNotFoundError:
            pass
        await asyncio.sleep(0.05)
    raise TimeoutError("Official Chrome DevToolsActivePort timed out.")


async def wait_for_process(process: Any) -> None:
    """Request and verify shutdown of the exact process owned by this adapter."""
    preexisting_returncode = getattr(process, "returncode", None)
    terminate_error: BaseException | None = None
    termination_requested = False
    if preexisting_returncode is None:
        try:
            process.terminate()
            termination_requested = True
        except BaseException as error:
            terminate_error = error

    wait_error: BaseException | None = None
    try:
        await asyncio.wait_for(process.wait(), timeout=PROCESS_WAIT_TIMEOUT_S)
    except BaseException as error:
        wait_error = error

    if getattr(process, "returncode", None) is None:
        kill_error: BaseException | None = None
        try:
            process.kill()
        except BaseException as error:
            kill_error = error
        if kill_error is None:
            try:
                await asyncio.wait_for(process.wait(), timeout=PROCESS_WAIT_TIMEOUT_S)
            except BaseException as error:
                kill_error = error
        if terminate_error is not None:
            raise terminate_error
        if wait_error is not None and not isinstance(wait_error, asyncio.TimeoutError):
            raise wait_error
        if kill_error is not None:
            raise kill_error
        raise RuntimeError("Official Chrome process required forced termination after normal stop.") from wait_error

    if terminate_error is not None:
        raise terminate_error
    if wait_error is not None:
        raise RuntimeError("Official Chrome process wait failed.") from wait_error
    returncode = getattr(process, "returncode", None)
    allowed_returncodes = {0}
    if termination_requested:
        allowed_returncodes.add(-int(signal.SIGTERM))
    if returncode not in allowed_returncodes:
        raise RuntimeError(f"Official Chrome exited unexpectedly with return code {returncode}.")


async def wait_for_endpoint_closed(endpoint: str) -> None:
    deadline = time.monotonic() + ENDPOINT_WAIT_TIMEOUT_S
    while endpoint_is_open(endpoint):
        if time.monotonic() >= deadline:
            raise RuntimeError("Official Chrome private connection remained open after close.")
        await asyncio.sleep(0.05)


class ChromeOfficialAdapter:
    provider_id = "chrome_official"
    browser_type = "chromium"
    driver_ref = "chrome-official-playwright-jsonl"

    def __init__(self) -> None:
        self.browser: Any = None
        self.process: Any = None
        self.endpoint: str | None = None
        self.process_facts: dict[str, str | int] | None = None
        self._owned_resources_attempted = False
        self._owned_resources_close_error: BaseException | None = None

    @staticmethod
    def verify(request: dict[str, Any]) -> list[dict[str, str]]:
        _require_v2_scope(request)
        pairing = _validate_pairing(request.get("chrome_pairing"))
        try:
            playwright_version = importlib.metadata.version("playwright")
        except importlib.metadata.PackageNotFoundError as error:
            raise ValueError("Official Chrome Playwright package is not installed.") from error
        if playwright_version != PLAYWRIGHT_VERSION or pairing["playwright_version"] != playwright_version:
            raise ValueError("Official Chrome Python/Playwright pairing does not match the owner binding.")
        executable = canonical_executable_path(request.get("browser_path"))
        if _sha256_file(executable) != pairing["executable_sha256"]:
            raise ValueError("Official Chrome executable hash does not match the owner binding.")
        return [
            {"key": "provider.chrome_official.source", "source": "observed", "value": pairing["source"]},
            {"key": "provider.chrome_official.source_sha256", "source": "validation_evidence", "value": pairing["source_sha256"]},
            {"key": "provider.chrome_official.executable", "source": "observed", "value": executable},
            {"key": "provider.chrome_official.executable_sha256", "source": "validation_evidence", "value": pairing["executable_sha256"]},
            {"key": "provider.chrome_official.browser_version", "source": "observed", "value": pairing["browser_version"]},
            {"key": "provider.chrome_official.playwright_version", "source": "validation_evidence", "value": pairing["playwright_version"]},
            {"key": "provider.chrome_official.connection", "source": "configured", "value": CONNECTION},
        ]

    @staticmethod
    def prepare(request: dict[str, Any], _profile_dir: str) -> tuple[dict[str, Any], dict[str, Any], bool, dict[str, Any]]:
        _require_v2_scope(request)
        pairing = _validate_pairing(request.get("chrome_pairing"))
        chrome_launch_flags(request)
        return {}, {"pairing": pairing, "connection": CONNECTION}, False, {}

    @staticmethod
    def environment(_bundle: dict[str, Any] | None) -> dict[str, Any]:
        return {"provider_id": "chrome_official", "browser_version": BROWSER_VERSION, "playwright_version": PLAYWRIGHT_VERSION}

    @staticmethod
    def playwright_factory() -> Any:
        return async_playwright()

    async def create_context(self, playwright: Any, request: dict[str, Any], profile_dir: str) -> Any:
        if self.process is not None or self._owned_resources_attempted:
            raise ValueError("Official Chrome adapter instance is already used.")
        raw_profile = Path(profile_dir)
        if raw_profile.is_symlink() or not raw_profile.is_dir():
            raise ValueError("Official Chrome managed Profile directory is unavailable.")
        profile = raw_profile.resolve()
        executable = canonical_executable_path(request.get("browser_path"))
        timeout_ms = request.get("timeout_ms", 60_000)
        if type(timeout_ms) is not int or timeout_ms < 1:
            raise ValueError("Official Chrome launch timeout is invalid.")
        remove_stale_devtools_active_port(profile)
        args = build_chrome_launch_args(executable, str(profile), request)
        try:
            self.process = await asyncio.create_subprocess_exec(
                *args,
                stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
                start_new_session=True,
            )
            self.process_facts = process_identity(self.process, executable, str(profile))
            deadline = time.monotonic() + timeout_ms / 1000
            active_port = await wait_for_devtools_active_port(profile, self.process, deadline)
            port = int(active_port["port"])
            listener = await wait_for_listener(self.process, port, deadline)
            if int(listener.get("pid", -1)) != int(self.process_facts["pid"]) or listener.get("address") != f"{LOOPBACK_HOST}:{port}":
                raise ValueError("Official Chrome listener identity does not match the owned process and loopback endpoint.")
            self.endpoint = f"http://{LOOPBACK_HOST}:{port}"
            self.process_facts.update({
                "devtools_port": port,
                "devtools_browser_path": str(active_port["browser_path"]),
                "listener_pid": int(listener["pid"]),
                "listener_address": str(listener["address"]),
            })
            remaining = max(0.001, deadline - time.monotonic())
            self.browser = await asyncio.wait_for(
                playwright.chromium.connect_over_cdp(self.endpoint),
                timeout=remaining,
            )
            contexts = getattr(self.browser, "contexts", None)
            if not isinstance(contexts, (list, tuple)) or len(contexts) != 1:
                raise ValueError("Official Chrome did not expose exactly one default Context.")
            context = contexts[0]
            timezone = request.get("environment", {}).get("timezone")
            await verify_timezone_readback(context, timezone)
            return context
        except BaseException as error:
            try:
                await self.close_owned_resources()
            except BaseException as cleanup_error:
                error.add_note(f"Official Chrome cleanup failed: {cleanup_error}")
            raise

    async def close_owned_resources(self) -> None:
        if self._owned_resources_close_error is not None:
            raise self._owned_resources_close_error
        if self._owned_resources_attempted:
            return
        self._owned_resources_attempted = True
        errors: list[BaseException] = []
        browser = self.browser
        process = self.process
        endpoint = self.endpoint
        if browser is not None:
            try:
                # A connected Browser is still backed by the live Playwright
                # transport here. Close it first, then request normal
                # termination of the exact externally owned Chrome process.
                await browser.close()
            except BaseException as error:
                errors.append(error)
            else:
                self.browser = None
        if process is not None:
            try:
                await wait_for_process(process)
            except BaseException as error:
                errors.append(error)
        if endpoint is not None:
            try:
                await wait_for_endpoint_closed(endpoint)
            except BaseException as error:
                errors.append(error)
        if errors:
            self._owned_resources_close_error = errors[0]
            raise self._owned_resources_close_error


if __name__ == "__main__":
    main(ChromeOfficialAdapter())

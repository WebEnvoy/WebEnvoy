#!/usr/bin/env python3
"""One-process, one-launch persistent Chrome download compatibility probe.

This is deliberately a probe, not a profile migration tool.  It never copies,
sanitizes, or edits Chrome History/Preferences.  Each invocation receives an
explicit executable, profile, marker, port, and result path; invoke it again
with a new case id to test the same profile across process boundaries.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import importlib.metadata
import json
import os
import re
import subprocess
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.async_api import BrowserContext, async_playwright


MARKER_KEY = "webenvoy-chrome-persistent-download-marker-v1"
EXIT_POLL_SECONDS = 5.0


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path == "/":
            body = b'<a href="/file.csv">Download CSV</a>'
            self.send_response(200)
            self.send_header("content-type", "text/html; charset=utf-8")
        elif self.path == "/file.csv":
            server = self.server
            body = server.download_body  # type: ignore[attr-defined]
            self.send_response(200)
            self.send_header("content-type", "text/csv")
            self.send_header(
                "content-disposition",
                f'attachment; filename="{server.download_filename}"',  # type: ignore[attr-defined]
            )
        else:
            body = b"not found"
            self.send_response(404)
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, _format: str, *_args: object) -> None:
        pass


class DownloadServer(ThreadingHTTPServer):
    def __init__(self, address: tuple[str, int], body: bytes, filename: str) -> None:
        super().__init__(address, Handler)
        self.download_body = body
        self.download_filename = filename


def crash_files(directory: Path) -> set[str]:
    if not directory.is_dir():
        return set()
    return {item.name for item in directory.glob("*.dmp") if item.is_file()}


def browser_processes(executable: Path, profile: Path) -> list[dict[str, object]]:
    """Sample only the browser process bound to this explicit profile."""
    try:
        completed = subprocess.run(
            ["ps", "-axo", "pid=,command="],
            check=False,
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return []
    executable_text = str(executable)
    user_data_dir = f"--user-data-dir={profile}"
    processes: list[dict[str, object]] = []
    for line in completed.stdout.splitlines():
        pid_text, separator, command = line.strip().partition(" ")
        if not separator or not pid_text.isdigit() or not command.startswith(executable_text):
            continue
        if user_data_dir not in command or re.search(r"(?:^|\s)--type=", command):
            continue
        processes.append({"pid": int(pid_text), "path": executable_text, "command": command})
    return processes


async def wait_for_browser_exit(executable: Path, profile: Path) -> list[dict[str, object]]:
    deadline = time.monotonic() + EXIT_POLL_SECONDS
    processes = browser_processes(executable, profile)
    while processes and time.monotonic() < deadline:
        await asyncio.sleep(0.1)
        processes = browser_processes(executable, profile)
    return processes


def safe_id(value: str, flag: str) -> str:
    normalized = re.sub(r"[^A-Za-z0-9_.-]+", "_", value).strip("._-")
    if not normalized:
        raise ValueError(f"{flag} must contain at least one filename-safe character")
    return normalized


def write_result_atomically(path: Path, result: dict[str, object]) -> None:
    if path.exists():
        raise FileExistsError(f"refusing to overwrite existing result: {path}")
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
        # Hard-link publication is atomic and does not replace an existing file.
        os.link(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--executable", type=Path, required=True)
    parser.add_argument("--profile", type=Path, required=True)
    parser.add_argument("--case-id", required=True)
    parser.add_argument("--marker-id", required=True)
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--crashpad-dir", type=Path, required=True)
    parser.add_argument("--result", type=Path, required=True)
    args = parser.parse_args()
    args.case_id = safe_id(args.case_id, "--case-id")
    if not args.marker_id:
        parser.error("--marker-id must not be empty")
    if args.port < 1 or args.port > 65535:
        parser.error("--port must be between 1 and 65535 so the origin can persist across invocations")
    if not args.executable.is_file() or not os.access(args.executable, os.X_OK):
        parser.error(f"--executable is not a regular executable file: {args.executable}")
    if not args.result.parent.is_dir():
        parser.error(f"--result parent directory does not exist: {args.result.parent}")
    return args


async def run(args: argparse.Namespace) -> dict[str, object]:
    marker_id = str(args.marker_id)
    result_path: Path = args.result
    output_path = result_path.with_name(f"{args.case_id}.csv")
    if output_path.exists():
        raise FileExistsError(f"refusing to overwrite existing output: {output_path}")
    csv_body = f"name,value\ncase,{args.case_id}\n".encode("utf-8")
    csv_sha256 = hashlib.sha256(csv_body).hexdigest()
    csv_filename = f"minimal-{args.case_id}.csv"

    before_crash = crash_files(args.crashpad_dir)
    before_processes = browser_processes(args.executable, args.profile)
    result: dict[str, object] = {
        "schema_version": "webenvoy.chrome-persistent-download-repro/v1",
        "case_id": args.case_id,
        "marker_id": marker_id,
        "executable": str(args.executable),
        "profile": str(args.profile),
        "port": args.port,
        "origin": f"http://127.0.0.1:{args.port}",
        "result_path": str(result_path),
        "output_path": str(output_path),
        "crashpad_before": sorted(before_crash),
        "browser_processes_before_launch": before_processes,
        "launch_count": 0,
        "close_requested": False,
        "close_observed": False,
        "context_close_event": False,
        "unexpected_close": False,
        "browser_processes_after_close": [],
        "new_crash_dumps": [],
        "status": "failed",
    }
    if before_processes:
        result["error"] = "profile already has a matching browser process"
        return result

    server = DownloadServer(("127.0.0.1", args.port), csv_body, csv_filename)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    context: BrowserContext | None = None
    close_requested = False
    try:
        async with async_playwright() as playwright:
            result["playwright_version"] = importlib.metadata.version("playwright")
            try:
                context = await playwright.chromium.launch_persistent_context(
                    user_data_dir=str(args.profile),
                    executable_path=str(args.executable),
                    headless=False,
                    accept_downloads=True,
                )
                result["launch_count"] = 1
                result["browser_version"] = context.browser.version if context.browser else None

                def on_context_close(*_args: object) -> None:
                    result["context_close_event"] = True
                    if not close_requested:
                        result["unexpected_close"] = True

                context.on("close", on_context_close)
                after_launch = browser_processes(args.executable, args.profile)
                result["browser_processes_after_launch"] = after_launch
                if len(after_launch) != 1:
                    raise RuntimeError(f"expected exactly one matching browser PID after launch, got {after_launch!r}")
                result["browser_pid"] = after_launch[0]["pid"]
                result["browser_path"] = after_launch[0]["path"]

                page = context.pages[0] if context.pages else await context.new_page()
                await page.goto(result["origin"] + "/", wait_until="domcontentloaded")
                marker_before = await page.evaluate("key => window.localStorage.getItem(key)", MARKER_KEY)
                result["local_storage_marker_before"] = marker_before
                if marker_before not in (None, marker_id):
                    raise RuntimeError(f"localStorage marker mismatch: {marker_before!r} != {marker_id!r}")
                if marker_before is None:
                    await page.evaluate(
                        "({key, value}) => window.localStorage.setItem(key, value)",
                        {"key": MARKER_KEY, "value": marker_id},
                    )
                    result["local_storage_marker_state"] = "created"
                else:
                    result["local_storage_marker_state"] = "persisted"
                marker_after = await page.evaluate("key => window.localStorage.getItem(key)", MARKER_KEY)
                result["local_storage_marker_after"] = marker_after
                if marker_after != marker_id:
                    raise RuntimeError(f"localStorage marker did not persist: {marker_after!r}")

                async with page.expect_download(timeout=60_000) as event:
                    await page.get_by_role("link", name="Download CSV", exact=True).click()
                download = await event.value
                await download.save_as(output_path)
                payload = output_path.read_bytes()
                result.update(
                    expected_sha256=csv_sha256,
                    actual_sha256=hashlib.sha256(payload).hexdigest(),
                    byte_length=len(payload),
                    suggested_filename=download.suggested_filename,
                )
                if payload != csv_body or result["actual_sha256"] != csv_sha256:
                    raise AssertionError("download bytes/hash do not match the known CSV")
            except BaseException as error:
                result["error"] = f"{type(error).__name__}: {error}"
            finally:
                if context is not None:
                    close_requested = True
                    result["close_requested"] = True
                    try:
                        await context.close()
                        result["close_observed"] = True
                    except BaseException as error:
                        result["close_error"] = f"{type(error).__name__}: {error}"
                    result["browser_processes_after_close"] = await wait_for_browser_exit(args.executable, args.profile)
                    context = None
    except BaseException as error:
        result["error"] = f"{type(error).__name__}: {error}"
    finally:
        server.shutdown()
        thread.join()
        await asyncio.sleep(0.5)

    after_crash = crash_files(args.crashpad_dir)
    result["crashpad_after"] = sorted(after_crash)
    result["new_crash_dumps"] = sorted(after_crash - before_crash)
    if result.get("error") is None:
        if result.get("unexpected_close"):
            result["error"] = "context closed before explicit close request"
        elif result.get("new_crash_dumps"):
            result["error"] = "new Crashpad dump detected"
        elif result.get("browser_processes_after_close"):
            result["error"] = "matching browser PID remained after close"
        elif not result.get("close_observed"):
            result["error"] = "explicit context close was not observed"
        else:
            result["status"] = "passed"
    return result


async def main() -> None:
    args = parse_args()
    result = await run(args)
    write_result_atomically(args.result, result)
    print(json.dumps(result, ensure_ascii=False), flush=True)
    if result["status"] != "passed":
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())

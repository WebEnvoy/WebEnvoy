#!/usr/bin/env python3
"""Run a bounded live check against an explicitly named Camoufox test artifact/Profile.

There is no browser default, application-name lookup, URL argument, or profile
discovery. The script verifies a builder manifest, launches only the adjacent
Harbor JSONL bridge with the supplied executable/Profile, performs
about:blank launch/list/close, and reports bounded process facts. Profile
contents, environment values, endpoints, and browser stderr are never printed.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import os
import plistlib
import re
import selectors
import subprocess
import sys
import time
from typing import Any

CAMOUFOX_VERSION_PIN = "0.5.6"
BROWSER_VERSION_PIN = "152.0.4-beta.30"
PROPERTIES_SHA256_PIN = "10d5cfb6c8eb3824485734362a3920e07b36c3801770fffcc14a3546e56f81f4"
MANIFEST_SCHEMA = "webenvoy.camoufox-native/v1"
ARTIFACT_BUNDLE_IDENTIFIER = "com.webenvoy.camoufox.native504"
ARTIFACT_BUNDLE_NAME = "WebEnvoy Camoufox Native Test"
MAX_RESPONSE_BYTES = 256 * 1024


class ValidationError(RuntimeError):
    pass


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def path_ref(path: Path) -> str:
    return "path:" + hashlib.sha256(str(path.resolve()).encode("utf-8")).hexdigest()[:24]


def regular(path: Path, label: str) -> None:
    if not path.is_file() or path.is_symlink():
        raise ValidationError(f"{label} is not a regular file")


def real_directory(path: Path, label: str) -> None:
    if not path.is_dir() or path.is_symlink():
        raise ValidationError(f"{label} is not a real directory")


def app_executable(app: Path) -> Path:
    info_path = app / "Contents" / "Info.plist"
    regular(info_path, "artifact Info.plist")
    try:
        info = plistlib.loads(info_path.read_bytes())
        name = info["CFBundleExecutable"]
    except (KeyError, TypeError, ValueError, plistlib.InvalidFileException) as error:
        raise ValidationError("artifact Info.plist has no valid executable") from error
    if not isinstance(name, str) or not name or "/" in name:
        raise ValidationError("artifact executable name is invalid")
    executable = app / "Contents" / "MacOS" / name
    regular(executable, "artifact executable")
    if not os.access(executable, os.X_OK):
        raise ValidationError("artifact executable is not executable")
    return executable


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_artifact(app: Path) -> tuple[Path, Path, str]:
    real_directory(app, "artifact")
    original = Path("/Applications/Camoufox.app").absolute()
    if app == original:
        raise ValidationError("the original installed Camoufox app is not an eligible artifact")
    executable = app_executable(app)
    resources = app / "Contents" / "Resources"
    manifest_path = resources / "webenvoy-native-manifest.json"
    regular(manifest_path, "native artifact manifest")
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValidationError("native artifact manifest is unreadable") from error
    if (
        not isinstance(manifest, dict)
        or manifest.get("schema") != MANIFEST_SCHEMA
        or manifest.get("test_only") is not True
        or manifest.get("distribution_or_production_use_authorized") is not False
        or manifest.get("patch_id") != "managed-native-snapshot"
    ):
        raise ValidationError("native artifact manifest is not an eligible test artifact")
    provider = manifest.get("provider")
    if not isinstance(provider, dict) or provider.get("camoufox_version") != CAMOUFOX_VERSION_PIN or provider.get("browser_version") != BROWSER_VERSION_PIN:
        raise ValidationError("native artifact provider pins do not match")
    identity = manifest.get("identity")
    if not isinstance(identity, dict) or identity.get("bundle_identifier") != ARTIFACT_BUNDLE_IDENTIFIER or identity.get("bundle_name") != ARTIFACT_BUNDLE_NAME:
        raise ValidationError("native artifact app identity is not fixed")
    try:
        info = plistlib.loads((app / "Contents" / "Info.plist").read_bytes())
    except (OSError, ValueError, plistlib.InvalidFileException) as error:
        raise ValidationError("native artifact Info.plist is unreadable") from error
    if info.get("CFBundleIdentifier") != ARTIFACT_BUNDLE_IDENTIFIER or info.get("CFBundleName") != ARTIFACT_BUNDLE_NAME:
        raise ValidationError("native artifact Info.plist identity does not match")
    output = manifest.get("output")
    if not isinstance(output, dict) or output.get("executable") != str(executable):
        raise ValidationError("native artifact executable identity does not match its manifest")
    omni = resources / "omni.ja"
    properties = resources / "properties.json"
    adjacent_properties = app / "Contents" / "MacOS" / "properties.json"
    regular(omni, "artifact omni.ja")
    regular(properties, "artifact properties.json")
    regular(adjacent_properties, "artifact adjacent properties.json")
    application_ini = resources / "application.ini"
    regular(application_ini, "artifact application.ini")
    if output.get("omni_sha256") != sha256(omni) or output.get("properties_sha256") != sha256(properties) or output.get("properties_sha256") != PROPERTIES_SHA256_PIN or output.get("adjacent_properties_sha256") != sha256(adjacent_properties) or adjacent_properties.read_bytes() != properties.read_bytes() or output.get("executable_sha256") != sha256(executable) or output.get("info_plist_sha256") != sha256(app / "Contents" / "Info.plist") or output.get("application_ini_sha256") != sha256(application_ini):
        raise ValidationError("native artifact output integrity does not match its manifest")
    if not any(line.strip() == f"Version={BROWSER_VERSION_PIN}" for line in application_ini.read_text(encoding="utf-8").splitlines()):
        raise ValidationError("native artifact application version does not match")
    return executable, manifest_path, sha256(manifest_path)


def verify_profile(profile: Path) -> str:
    real_directory(profile, "explicit Profile")
    resolved = profile.resolve()
    temporary_roots = {Path("/tmp").resolve()}
    tmpdir = os.getenv("TMPDIR")
    if tmpdir:
        temporary_roots.add(Path(tmpdir).resolve())
    if not any(resolved == root or root in resolved.parents for root in temporary_roots):
        raise ValidationError("explicit Profile must be under a temporary test root")
    if resolved == Path("/") or resolved == Path.home():
        raise ValidationError("explicit Profile is too broad")
    return path_ref(resolved)


def safe_message(error: BaseException) -> str:
    message = str(error)
    message = re.sub(r"(?i)(bearer\s+)[^\s]+", r"\1<redacted>", message)
    message = re.sub(r"(?i)(token|secret|password|cookie|authorization|credential)[^:=\s]*\s*[:=]\s*\S+", r"\1=<redacted>", message)
    message = re.sub(r"/(?:private|Users|home|var/folders|tmp)/[^\s'\" ]+", "<redacted-path>", message)
    return " ".join(message.split())[:256] or type(error).__name__


def scrubbed_environment() -> dict[str, str]:
    blocked_fragments = ("TOKEN", "SECRET", "PASSWORD", "COOKIE", "AUTHORIZATION", "CREDENTIAL")
    blocked_prefixes = ("CAMOU_CONFIG_", "CAMOUFOX_", "HARBOR_", "WEBENVOY_")
    result: dict[str, str] = {}
    for key, value in os.environ.items():
        upper = key.upper()
        if upper.startswith(blocked_prefixes) or any(fragment in upper for fragment in blocked_fragments):
            continue
        result[key] = value
    result["PYTHONDONTWRITEBYTECODE"] = "1"
    return result


def process_rows() -> list[dict[str, Any]]:
    result = subprocess.run(
        ["ps", "-ax", "-o", "pid=,ppid=,comm="],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        check=False,
        timeout=5,
    )
    rows = []
    for line in result.stdout.splitlines():
        fields = line.strip().split(None, 2)
        if len(fields) != 3:
            continue
        try:
            pid, ppid = int(fields[0]), int(fields[1])
        except ValueError:
            continue
        rows.append({"pid": pid, "ppid": ppid, "comm": fields[2]})
    return rows


def process_start(pid: int) -> str | None:
    result = subprocess.run(
        ["ps", "-p", str(pid), "-o", "lstart="],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        check=False,
        timeout=5,
    )
    value = " ".join(result.stdout.split())
    return value[:64] if value else None


def browser_processes(executable: Path, bridge_pid: int) -> list[dict[str, Any]]:
    return [
        {"pid": row["pid"], "started_at": process_start(row["pid"]), "executable": str(executable)}
        for row in process_rows()
        if row["pid"] != bridge_pid and row["comm"] == str(executable)
    ]


class Bridge:
    def __init__(self, python: Path, helper: Path, executable: Path, profile: Path, headed: bool, timeout_ms: int) -> None:
        self.process = subprocess.Popen(
            [str(python), str(helper)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            env=scrubbed_environment(),
            text=True,
            bufsize=1,
        )
        self.executable = executable
        self.profile = profile
        self.headed = headed
        self.timeout_ms = timeout_ms
        self.next_id = 1
        self.selector = selectors.DefaultSelector()
        if self.process.stdout is not None:
            self.selector.register(self.process.stdout, selectors.EVENT_READ)

    def request(self, operation: str, **payload: Any) -> dict[str, Any]:
        if self.process.stdin is None or self.process.stdout is None:
            raise ValidationError("bridge pipes are unavailable")
        message_id = self.next_id
        self.next_id += 1
        request = {"id": message_id, "op": operation, **payload}
        if operation == "launch":
            request.update({
                "profile_dir": str(self.profile),
                "executable_path": str(self.executable),
                "headless": not self.headed,
                "url": "about:blank",
                "timeout_ms": self.timeout_ms,
            })
        self.process.stdin.write(json.dumps(request, separators=(",", ":")) + "\n")
        self.process.stdin.flush()
        deadline = time.monotonic() + max(5, self.timeout_ms / 1000 + 5)
        while time.monotonic() < deadline:
            events = self.selector.select(max(0.05, deadline - time.monotonic()))
            if not events:
                break
            line = self.process.stdout.readline()
            if not line:
                break
            if len(line.encode("utf-8")) > MAX_RESPONSE_BYTES:
                raise ValidationError("bridge response exceeded the bounded limit")
            try:
                value = json.loads(line)
            except json.JSONDecodeError as error:
                raise ValidationError("bridge returned a non-JSON response") from error
            if value.get("id") != message_id:
                continue
            return value
        raise ValidationError(f"bridge {operation} timed out")

    def close(self) -> None:
        if self.process.poll() is None:
            try:
                self.request("close")
            except BaseException:
                self.process.terminate()
        try:
            self.process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=5)
        self.selector.close()


def run(args: argparse.Namespace) -> dict[str, Any]:
    artifact = args.artifact.expanduser().absolute()
    profile = args.profile.expanduser().absolute()
    executable, manifest, manifest_hash = verify_artifact(artifact)
    profile_ref = verify_profile(profile)
    helper = Path(__file__).resolve().parents[1] / "packages" / "runtime-api" / "src" / "camoufox-driver.py"
    regular(helper, "Harbor Camoufox driver")
    python = args.python.expanduser().absolute() if args.python else Path(sys.executable)
    python_real = python.resolve(strict=True)
    regular(python_real, "validation Python")
    if not os.access(python_real, os.X_OK):
        raise ValidationError("validation Python is not executable")
    started_at = now()
    bridge = Bridge(python, helper, executable, profile, args.headed, args.timeout_ms)
    launch_response: dict[str, Any] | None = None
    list_response: dict[str, Any] | None = None
    try:
        launch_response = bridge.request("launch")
        list_response = bridge.request("list_pages") if launch_response.get("status") == "ready" else None
        browser = browser_processes(executable, bridge.process.pid)
        launch_error = None
        if launch_response.get("status") != "ready":
            launch_error = {"class": "driver_launch_error", "message": safe_message(RuntimeError(str(launch_response.get("message", "launch failed"))))}
        return {
            "status": "verified" if launch_response.get("status") == "ready" and list_response and list_response.get("status") == "ok" else "failed",
            "diagnostic_only": True,
            "artifact": {
                "manifest_sha256": manifest_hash,
                "manifest_ref": "manifest:" + manifest_hash[:24],
                "artifact_ref": path_ref(artifact),
                "executable": str(executable),
                "browser_version": BROWSER_VERSION_PIN,
                "test_only": True,
            },
            "profile_ref": profile_ref,
            "bridge": {"pid": bridge.process.pid, "started_at": started_at, "executable": str(python)},
            "browser": browser,
            "launch": {"status": launch_response.get("status"), "page_count": len(launch_response.get("pages", [])) if isinstance(launch_response.get("pages"), list) else None},
            **({"launch_error": launch_error} if launch_error else {}),
            "list_pages": {"status": list_response.get("status"), "page_count": len(list_response.get("pages", [])) if list_response and isinstance(list_response.get("pages"), list) else None} if list_response else None,
        }
    finally:
        bridge.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifact", type=Path, required=True, help="explicit test-only Camoufox.app")
    parser.add_argument("--profile", type=Path, required=True, help="explicit disposable Profile directory under a temporary root")
    parser.add_argument("--python", type=Path, help="qualified Python executable; defaults to this interpreter")
    parser.add_argument("--headed", action="store_true", help="run the explicit artifact headed")
    parser.add_argument("--timeout-ms", type=int, default=10000)
    args = parser.parse_args()
    if not 1000 <= args.timeout_ms <= 30000:
        parser.error("--timeout-ms must be between 1000 and 30000")
    try:
        result = run(args)
    except BaseException as error:
        print(json.dumps({"status": "rejected", "error": safe_message(error), "diagnostic_only": True}, ensure_ascii=False, sort_keys=True))
        return 2
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0 if result["status"] == "verified" else 1


if __name__ == "__main__":
    raise SystemExit(main())

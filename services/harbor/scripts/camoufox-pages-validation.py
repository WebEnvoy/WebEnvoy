#!/usr/bin/env python3
"""Run a bounded, diagnostic-only multi-Page check against explicit inputs.

The script never discovers an artifact, Profile, or origin.  It uses the
existing native validation module for artifact/Profile checks, the private
Camoufox Driver JSONL bridge for browser operations, and the fixture's
read-only status endpoint for the S3 no-request assertion.

Example (the live run is intentionally left to the main task):
  python services/harbor/scripts/camoufox-pages-validation.py \
    --artifact /tmp/webenvoy-native-504-artifact-v8.app \
    --profile /tmp/webenvoy-504-integration.hEmBDh/native-smoke-profile \
    --python /Users/claw/.webenvoy/providers/camoufox/venv/bin/python \
    --s1-origin http://127.0.0.1:60557 \
    --s2-origin http://127.0.0.1:60558 \
    --s3-origin http://127.0.0.1:60559 \
    --timeout-ms 15000

The final Page close is deliberately not exercised by this Driver.  The
supplied Profile is retained.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
from typing import Any
from urllib.error import URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

sys.dont_write_bytecode = True


def load_validation_module() -> Any:
    source = Path(__file__).with_name("camoufox-native-validation.py")
    spec = importlib.util.spec_from_file_location("webenvoy_camoufox_native_validation", source)
    if spec is None or spec.loader is None:
        raise RuntimeError("native validation module is unavailable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


validation = load_validation_module()

MAX_SERVICE_RESPONSE_BYTES = 64 * 1024


class CheckFailure(RuntimeError):
    def __init__(self, error_class: str, diagnostic: str | None = None) -> None:
        self.error_class = error_class
        self.diagnostic = diagnostic
        super().__init__(error_class)


def require(condition: Any, error_class: str) -> None:
    if not condition:
        raise CheckFailure(error_class)


def safe_ref(value: Any) -> str | None:
    return "ref:" + hashlib.sha256(value.encode("utf-8")).hexdigest()[:24] if isinstance(value, str) else None


def loopback_origin(value: str, label: str) -> str:
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError as error:
        raise CheckFailure(f"{label}_origin_invalid") from error
    require(
        parsed.scheme == "http"
        and parsed.hostname == "127.0.0.1"
        and port is not None
        and 1 <= port <= 65535
        and not parsed.username
        and not parsed.password
        and parsed.path in ("", "/")
        and not parsed.query
        and not parsed.fragment,
        f"{label}_origin_invalid",
    )
    return f"http://127.0.0.1:{port}"


def pages_of(response: dict[str, Any]) -> list[dict[str, Any]]:
    pages = response.get("pages")
    require(isinstance(pages, list), "driver_pages_unavailable")
    require(all(isinstance(page, dict) for page in pages), "driver_page_fact_invalid")
    return pages


def page_ref(page: dict[str, Any]) -> str:
    value = page.get("provider_page_ref")
    require(isinstance(value, str) and bool(value), "driver_page_ref_unavailable")
    return value


def find_page(pages: list[dict[str, Any]], provider_ref: str) -> dict[str, Any]:
    matches = [page for page in pages if page.get("provider_page_ref") == provider_ref]
    require(len(matches) == 1, "driver_page_ref_not_unique")
    return matches[0]


def page_path(page: dict[str, Any]) -> tuple[str, str, str]:
    current_url = page.get("current_url")
    require(isinstance(current_url, str) and current_url, "driver_page_url_unavailable")
    parsed = urlsplit(current_url)
    return parsed.path, parsed.query, parsed.fragment


def query_fragment_marker(page: dict[str, Any]) -> bool:
    # Test-only evidence: the Driver intentionally redacts query/fragment from
    # current_url, so the fixture exposes only fixed boolean state in its title.
    return page.get("title") == "S2 Phase 1 Page marker-q1-f1"


def query_fragment_observation(page: dict[str, Any], response: dict[str, Any], expected_path: str = "/query") -> str:
    try:
        path_matches = page_path(page)[0] == expected_path
    except CheckFailure:
        path_matches = False
    status = page.get("status")
    title = page.get("title")
    title_marker = {
        "S2 Phase 1 Page marker-q1-f1": "query_fragment_marker",
        "S2 Phase 1 Page": "s2_page",
        "S2 Phase 1 History": "s2_history",
        "Same-name Page": "same_name",
    }.get(title, "other" if isinstance(title, str) else "missing")
    failure = response.get("failure_class")
    failure_class = "none" if failure is None else failure if isinstance(failure, str) and 0 < len(failure) <= 64 and failure.replace("_", "").isalnum() else "other"
    return json.dumps({
        "status": status if status in {"ready", "failed", "closed", "unknown"} else "other",
        "title_marker": title_marker,
        "path_matches": path_matches,
        "failure_class": failure_class if failure_class else "none",
    }, separators=(",", ":"), sort_keys=True)


def require_query_state(response: dict[str, Any], page: dict[str, Any], expected_path: str, error_class: str) -> None:
    try:
        path_matches = page_path(page)[0] == expected_path
    except CheckFailure:
        path_matches = False
    if page.get("status") == "ready" and path_matches and query_fragment_marker(page):
        return
    raise CheckFailure(error_class, query_fragment_observation(page, response, expected_path))


def driver_request(bridge: Any, operation: str, **payload: Any) -> dict[str, Any]:
    response = bridge.request(operation, **payload)
    require(isinstance(response, dict), "driver_response_invalid")
    if response.get("status") == "error":
        detail = response.get("message", response.get("error"))
        diagnostic = validation.safe_message(RuntimeError(detail)) if isinstance(detail, str) else None
        raise CheckFailure("driver_operation_error", diagnostic)
    expected_status = "ready" if operation == "launch" else "ok"
    require(response.get("status") == expected_status, "driver_operation_error")
    return response


def page_operation(bridge: Any, operation: str, provider_ref: str, origins: list[str], **payload: Any) -> dict[str, Any]:
    return driver_request(
        bridge,
        operation,
        provider_page_ref=provider_ref,
        authorized_origins=origins,
        **payload,
    )


def service_counter(origin: str) -> dict[str, int]:
    request = Request(f"{origin}/__phase1/status", headers={"accept": "application/json"})
    try:
        with urlopen(request, timeout=5) as response:
            require(getattr(response, "status", 200) == 200, "service_counter_unavailable")
            body = response.read(MAX_SERVICE_RESPONSE_BYTES + 1)
    except (OSError, URLError, CheckFailure) as error:
        if isinstance(error, CheckFailure):
            raise
        raise CheckFailure("service_counter_unavailable") from error
    require(len(body) <= MAX_SERVICE_RESPONSE_BYTES, "service_counter_unavailable")
    try:
        value = json.loads(body)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise CheckFailure("service_counter_invalid") from error
    require(isinstance(value, dict), "service_counter_invalid")
    result: dict[str, int] = {}
    for key in ("access_count", "action_count", "popup_count"):
        count = value.get(key)
        require(type(count) is int and count >= 0, "service_counter_invalid")
        result[key] = count
    return result


def append_step(steps: list[dict[str, Any]], name: str, status: str, *, count: int | None = None, ref: Any = None, error_class: str | None = None) -> None:
    step: dict[str, Any] = {"step": name, "status": status}
    if count is not None:
        step["count"] = count
    if ref is not None:
        step["ref"] = safe_ref(ref)
    if error_class is not None:
        step["error_class"] = error_class
    steps.append(step)


def failure_class(error: BaseException) -> str:
    if isinstance(error, CheckFailure):
        return error.error_class
    if isinstance(error, validation.ValidationError):
        return "validation_rejected"
    if isinstance(error, (TimeoutError, OSError, URLError)):
        return "transport_or_process_unavailable"
    return "unexpected_failure"


def failure_diagnostic(error: BaseException) -> str:
    if isinstance(error, CheckFailure) and error.diagnostic:
        return error.diagnostic
    return validation.safe_message(error)


def browser_facts(executable: Path, bridge_pid: int) -> list[dict[str, Any]]:
    processes = validation.browser_processes(executable, bridge_pid)
    require(processes, "browser_process_unobserved")
    require(all(item.get("started_at") and item.get("executable") == str(executable) for item in processes), "browser_process_fact_incomplete")
    return processes


def run(args: argparse.Namespace) -> dict[str, Any]:
    steps: list[dict[str, Any]] = []
    bridge: Any = None
    bridge_started_at: str | None = None
    browser: list[dict[str, Any]] = []
    current_step = "configuration"
    profile_ref: str | None = None
    artifact: dict[str, Any] | None = None
    error_detail: str | None = None
    result: dict[str, Any]
    try:
        current_step = "configuration"
        artifact_path = args.artifact.expanduser().absolute()
        profile_path = args.profile.expanduser().absolute()
        executable, _manifest, manifest_hash = validation.verify_artifact(artifact_path)
        profile_ref = validation.verify_profile(profile_path)
        s1 = loopback_origin(args.s1_origin, "s1")
        s2 = loopback_origin(args.s2_origin, "s2")
        s3 = loopback_origin(args.s3_origin, "s3")
        require(len({s1, s2, s3}) == 3, "origins_must_be_distinct")
        authorized = [s1, s2]
        helper = Path(__file__).resolve().parents[1] / "packages" / "runtime-api" / "src" / "camoufox-driver.py"
        validation.regular(helper, "Harbor Camoufox driver")
        python = args.python.expanduser().absolute() if args.python else Path(sys.executable)
        python_real = python.resolve(strict=True)
        validation.regular(python_real, "validation Python")
        require(os.access(python_real, os.X_OK), "validation_python_unavailable")
        artifact = {
            "artifact_ref": validation.path_ref(artifact_path),
            "manifest_ref": "manifest:" + manifest_hash[:24],
            "manifest_sha256": manifest_hash,
            "executable": str(executable),
        }

        current_step = "launch"
        bridge = validation.Bridge(python, helper, executable, profile_path, args.headed, args.timeout_ms)
        bridge_started_at = validation.process_start(bridge.process.pid)
        require(bridge_started_at, "bridge_process_fact_incomplete")
        launch = driver_request(bridge, "launch")
        launch_pages = pages_of(launch)
        require(len(launch_pages) == 1, "launch_page_count_invalid")
        page_a = launch_pages[0]
        a_ref = page_ref(page_a)
        require(page_a.get("active") is True, "launch_page_not_active")
        require(page_a.get("current_url") == "about:blank", "launch_page_not_about_blank")
        append_step(steps, "launch_about_blank_a", "ready", count=len(launch_pages), ref=a_ref)
        browser = browser_facts(executable, bridge.process.pid)

        current_step = "navigate_a_s1"
        navigated_a = page_operation(bridge, "navigate_page", a_ref, authorized, action="navigate", url=f"{s1}/", timeout_ms=args.timeout_ms)
        a_after = find_page(pages_of(navigated_a), a_ref)
        require(a_after.get("status") == "ready" and page_path(a_after)[0] == "/", "navigate_a_s1_failed")
        append_step(steps, "navigate_a_s1", "completed", ref=a_ref)

        current_step = "open_b_s2_background"
        opened_b = driver_request(bridge, "open_page", url=f"{s2}/", authorized_origins=authorized, timeout_ms=args.timeout_ms)
        pages = pages_of(opened_b)
        require(len(pages) == 2, "background_page_count_invalid")
        b_page = opened_b.get("page")
        require(isinstance(b_page, dict), "background_page_fact_invalid")
        b_ref = page_ref(b_page)
        require(b_ref != a_ref and b_page.get("active") is False and page_path(b_page)[0] == "/", "background_page_focus_invalid")
        append_step(steps, "open_b_s2_background", "completed", count=len(pages), ref=b_ref)

        current_step = "list_a_active_two_pages"
        listed = driver_request(bridge, "list_pages")
        pages = pages_of(listed)
        a_listed = find_page(pages, a_ref)
        b_listed = find_page(pages, b_ref)
        require(len(pages) == 2 and a_listed.get("active") is True and b_listed.get("active") is False, "list_active_page_assertion_failed")
        append_step(steps, "list_a_active_two_pages", "passed", count=len(pages), ref=a_ref)

        current_step = "activate_b"
        activated = driver_request(bridge, "activate_page", provider_page_ref=b_ref)
        pages = pages_of(activated)
        require(len(pages) == 2 and find_page(pages, b_ref).get("active") is True and find_page(pages, a_ref).get("active") is False, "activate_b_failed")
        append_step(steps, "activate_b", "passed", count=len(pages), ref=b_ref)

        current_step = "query_fragment"
        query_url = f"{s2}/query?phase=1#s2-fragment"
        queried = page_operation(bridge, "navigate_page", b_ref, authorized, action="navigate", url=query_url, timeout_ms=args.timeout_ms)
        b_query = find_page(pages_of(queried), b_ref)
        require_query_state(queried, b_query, "/query", "query_fragment_navigation_failed")
        append_step(steps, "query_fragment", "completed", ref=b_ref)

        current_step = "reload"
        reloaded = page_operation(bridge, "navigate_page", b_ref, authorized, action="reload", timeout_ms=args.timeout_ms)
        b_reload = find_page(pages_of(reloaded), b_ref)
        require_query_state(reloaded, b_reload, "/query", "reload_failed")
        append_step(steps, "reload", "completed", ref=b_ref)

        current_step = "back"
        backed = page_operation(bridge, "navigate_page", b_ref, authorized, action="back", timeout_ms=args.timeout_ms)
        b_back = find_page(pages_of(backed), b_ref)
        require(b_back.get("status") == "ready" and page_path(b_back)[0] == "/", "back_failed")
        append_step(steps, "back", "completed", ref=b_ref)

        current_step = "forward"
        forwarded = page_operation(bridge, "navigate_page", b_ref, authorized, action="forward", timeout_ms=args.timeout_ms)
        b_forward = find_page(pages_of(forwarded), b_ref)
        require_query_state(forwarded, b_forward, "/query", "forward_failed")
        append_step(steps, "forward", "completed", ref=b_ref)

        current_step = "s3_counter_baseline"
        s3_before = service_counter(s3)
        append_step(steps, "s3_counter_baseline", "observed", count=s3_before["access_count"])

        current_step = "s3_direct_rejected"
        direct = page_operation(bridge, "navigate_page", b_ref, authorized, action="navigate", url=f"{s3}/direct", timeout_ms=args.timeout_ms)
        direct_page = find_page(pages_of(direct), b_ref)
        require(direct.get("failure_class") == "navigation_origin_denied" and direct_page.get("status") == "failed" and page_path(direct_page)[0] == "/query", "s3_direct_denial_unproven")
        s3_after_direct = service_counter(s3)
        require(s3_after_direct == s3_before, "s3_direct_counter_changed")
        append_step(steps, "s3_direct_rejected", "rejected", count=s3_after_direct["access_count"], ref=b_ref, error_class="navigation_origin_denied")

        current_step = "s3_redirect_rejected"
        redirect = page_operation(bridge, "navigate_page", a_ref, authorized, action="navigate", url=f"{s1}/redirect/s3", timeout_ms=args.timeout_ms)
        redirect_page = find_page(pages_of(redirect), a_ref)
        require(redirect.get("failure_class") == "navigation_origin_denied" and redirect_page.get("status") == "failed" and page_path(redirect_page)[0] == "/", "s3_redirect_denial_unproven")
        s3_after_redirect = service_counter(s3)
        require(s3_after_redirect == s3_before, "s3_redirect_counter_changed")
        append_step(steps, "s3_redirect_rejected", "rejected", count=s3_after_redirect["access_count"], ref=a_ref, error_class="navigation_origin_denied")

        current_step = "safe_close_b_return_a"
        closed_b = driver_request(bridge, "close_page", provider_page_ref=b_ref, safe_return_provider_page_ref=a_ref)
        remaining = pages_of(closed_b)
        require(len(remaining) == 1 and page_ref(remaining[0]) == a_ref and remaining[0].get("active") is True, "safe_close_return_failed")
        append_step(steps, "safe_close_b_return_a", "passed", count=len(remaining), ref=a_ref)

        current_step = "final_page_close"
        append_step(steps, "final_page_close", "not_exercised_driver_last_page", count=1, ref=a_ref)
        result = {
            "status": "verified",
            "diagnostic_only": True,
            "artifact": artifact,
            "profile_ref": profile_ref,
            "bridge": {"pid": bridge.process.pid, "started_at": bridge_started_at, "executable": str(python_real)},
            "browser": browser,
            "steps": steps,
        }
    except BaseException as error:
        error_code = failure_class(error)
        error_detail = failure_diagnostic(error)
        if not steps or steps[-1].get("step") != current_step or steps[-1].get("status") == "failed":
            append_step(steps, current_step, "failed", error_class=error_code)
        result = {
            "status": "failed",
            "diagnostic_only": True,
            "error_class": error_code,
            "error_diagnostic": error_detail,
            "steps": steps,
            **({"artifact": artifact} if artifact else {}),
            **({"profile_ref": profile_ref} if profile_ref else {}),
            **({"bridge": {"pid": bridge.process.pid, "started_at": bridge_started_at}} if bridge is not None else {}),
            **({"browser": browser} if browser else {}),
        }
    finally:
        if bridge is not None:
            bridge.close()
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifact", type=Path, required=True, help="explicit test-only Camoufox.app")
    parser.add_argument("--profile", type=Path, required=True, help="explicit retained Profile under a temporary root")
    parser.add_argument("--s1-origin", required=True, help="explicit http://127.0.0.1:<port> S1 origin")
    parser.add_argument("--s2-origin", required=True, help="explicit http://127.0.0.1:<port> S2 origin")
    parser.add_argument("--s3-origin", required=True, help="explicit http://127.0.0.1:<port> S3 origin")
    parser.add_argument("--python", type=Path, help="qualified Python executable; defaults to this interpreter")
    parser.add_argument("--headed", action="store_true", help="run the explicit artifact headed")
    parser.add_argument("--timeout-ms", type=int, default=15000)
    args = parser.parse_args()
    if not 1000 <= args.timeout_ms <= 30000:
        parser.error("--timeout-ms must be between 1000 and 30000")
    result = run(args)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0 if result["status"] == "verified" else 1


if __name__ == "__main__":
    raise SystemExit(main())

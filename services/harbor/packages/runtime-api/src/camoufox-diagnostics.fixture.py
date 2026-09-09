#!/usr/bin/env python3
"""Exercise the real Camoufox Driver diagnostics listeners without a browser."""

from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import Any


DRIVER_PATH = Path(__file__).with_name("camoufox-driver.py")
SPEC = importlib.util.spec_from_file_location("camoufox_driver_fixture", DRIVER_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Camoufox Driver module could not be loaded.")
DRIVER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DRIVER)


class FakeRequest:
    def __init__(self, url: str, resource_type: str = "fetch", navigation: bool = False) -> None:
        self.url = url
        self.method = "GET"
        self.resource_type = resource_type
        self.failure = None
        self.redirected_from = None
        self.frame = None
        self.navigation = navigation

    def is_navigation_request(self) -> bool:
        return self.navigation


class FakeResponse:
    def __init__(self, request: FakeRequest, status: int = 200) -> None:
        self.request = request
        self.url = request.url
        self.status = status


class FakeConsoleMessage:
    def __init__(self, level: str, text: str, source_url: str | None = None) -> None:
        self.type = level
        self.text = text
        self.location = {} if source_url is None else {"url": source_url, "lineNumber": 3, "columnNumber": 5}


class FakeNodes:
    def get_property(self, _: str) -> Any:
        raise AssertionError("The empty fixture snapshot has no target nodes.")

    def dispose(self) -> None:
        return None


class FakeHandle:
    def __init__(self, page: Any) -> None:
        self.page = page
        self.document_generation = page.document_generation

    def evaluate(self, expression: str, *_: Any) -> Any:
        if "sameDocument" in expression:
            return self.document_generation == self.page.document_generation
        if "controls:state.controls" in expression:
            return {"controls": [], "text": "", "truncated": False}
        return None

    def get_property(self, name: str) -> FakeNodes:
        if name != "nodes":
            raise AssertionError("Unexpected interaction snapshot property.")
        return FakeNodes()

    def dispose(self) -> None:
        return None


class FakePage:
    def __init__(self, origin: str) -> None:
        self.url = f"{origin}/start"
        self.main_frame = object()
        self._listeners: dict[str, list[Any]] = {}
        self._pending: list[tuple[str, Any]] = []
        self.title_calls = 0
        self.frame = self.main_frame
        self.document_generation = 1
        self.closed = False

    def on(self, event: str, callback: Any) -> None:
        self._listeners.setdefault(event, []).append(callback)

    def emit(self, event: str, value: Any) -> None:
        if event == "request" and getattr(value, "frame", None) is None:
            value.frame = self.main_frame
        for callback in self._listeners.get(event, []):
            callback(value)

    def queue(self, event: str, value: Any) -> None:
        self._pending.append((event, value))

    def queue_navigation(self, url: str) -> None:
        self._pending.append(("navigate", url))

    def title(self) -> str:
        if self.closed:
            raise RuntimeError("Page has been closed")
        self.title_calls += 1
        while self._pending:
            event, value = self._pending.pop(0)
            if event == "navigate":
                self.url = value
                self.document_generation += 1
                self.emit("framenavigated", self.main_frame)
            else:
                self.emit(event, value)
        return "Fixture page"

    def evaluate_handle(self, _: str) -> FakeHandle:
        return FakeHandle(self)


def reset() -> None:
    DRIVER.PAGE = None
    DRIVER.CONTEXT = None
    DRIVER.INTERACTION_STATE = None
    DRIVER.DIAGNOSTIC_EVENTS.clear()
    DRIVER.DIAGNOSTIC_REQUESTS.clear()
    DRIVER.DIAGNOSTIC_CURSOR = 0
    DRIVER.DIAGNOSTIC_INSTANCE_REF = ""
    DRIVER.DIAGNOSTIC_PAGE_REF = ""
    DRIVER.DIAGNOSTIC_DOCUMENT_GENERATION = 0


def events(result: dict[str, Any]) -> list[dict[str, Any]]:
    return result["network"] + result["console"]


def main() -> None:
    reset()
    origin = "https://fixture.test"
    page = FakePage(origin)
    DRIVER.PAGE = page
    DRIVER.attach_diagnostics(page)

    page_ref = DRIVER.DIAGNOSTIC_PAGE_REF
    snapshot = DRIVER.interaction_snapshot(1)
    assert snapshot["page_ref"] == page_ref
    DRIVER.discard_interaction_snapshot()

    request = FakeRequest(f"{origin}/ok?token=hidden")
    page.queue("request", request)
    page.queue("response", FakeResponse(request, 200))
    page.queue("console", FakeConsoleMessage("warning", "a bounded warning", f"{origin}/app.js?secret=hidden"))
    page.queue("pageerror", "uncaught page error")
    page.queue("console", FakeConsoleMessage("error", "Authorization: Bearer hidden"))
    page.queue("console", FakeConsoleMessage("error", '{"token":"hidden"}'))
    page.queue("console", FakeConsoleMessage("error", "x" * 600))
    result = DRIVER.diagnostics_read({"origin": origin, "page_ref": page_ref, "limit": 64})
    assert result["status"] == "completed"
    assert page.title_calls == 1
    assert any(item["kind"] == "request" for item in result["network"])
    assert any(item["kind"] == "response" and item["status"] == 200 for item in result["network"])
    assert result["console"][0]["source"]["url"] == f"{origin}/app.js"
    assert sum(item["text"] == "[redacted]" for item in result["console"]) == 2
    assert any(item["truncated"] is True for item in result["console"])
    assert any(item["level"] == "pageerror" for item in result["console"])
    assert result["network"][0]["url"] == f"{origin}/ok"
    for path in ("/reset/token=fixture-sentinel", "/reset/token%3Dfixture-sentinel"):
        page.emit("request", FakeRequest(origin + path))
        assert DRIVER.DIAGNOSTIC_EVENTS[-1]["url"] == origin + "/<redacted>"

    cross_origin = FakeRequest("https://third-party.test/private/token/secret")
    page.emit("request", cross_origin)
    cross_result = DRIVER.diagnostics_read({"origin": origin, "limit": 64})
    assert all(item["origin"] == origin for item in cross_result["network"])

    snapshot = DRIVER.interaction_snapshot(2)
    failed_navigation = FakeRequest(f"{origin}/failed", resource_type="document", navigation=True)
    page.emit("request", failed_navigation)
    failed_navigation.failure = "connection aborted"
    page.emit("requestfailed", failed_navigation)
    assert DRIVER.diagnostics_read({"origin": origin})["page_ref"] == snapshot["page_ref"]
    assert DRIVER.interaction_snapshot(3)["page_ref"] == snapshot["page_ref"]
    late_request = FakeRequest(f"{origin}/old-document-fetch")
    page.emit("request", late_request)

    navigation = FakeRequest(f"{origin}/next", resource_type="document", navigation=True)
    page.queue("request", navigation)
    page.queue("response", FakeResponse(navigation, 503))
    page.queue_navigation(f"{origin}/next")
    after_navigation = DRIVER.diagnostics_read({"origin": origin, "limit": 64})
    assert after_navigation["status"] == "completed"
    navigation_events = [item for item in after_navigation["network"] if item["url"] == f"{origin}/next"]
    assert {item["kind"] for item in navigation_events} == {"request", "response"}
    assert all(item["page_ref"] == after_navigation["page_ref"] for item in navigation_events)
    assert after_navigation["document_generation"] > result["document_generation"]
    assert DRIVER.interaction_snapshot(1)["page_ref"] == after_navigation["page_ref"]
    DRIVER.discard_interaction_snapshot()
    page.emit("response", FakeResponse(late_request))
    navigation.failure = "connection aborted after headers"
    page.emit("requestfailed", navigation)
    late_result = DRIVER.diagnostics_read({"origin": origin})
    assert all(item["url"] != late_request.url for item in late_result["network"])
    failure = next(item for item in late_result["network"] if item["kind"] == "failure")
    response = next(item for item in navigation_events if item["kind"] == "response")
    assert failure["request_ref"] == response["request_ref"]
    finished_navigation = FakeRequest(f"{origin}/finished", resource_type="document", navigation=True)
    page.queue("request", finished_navigation)
    page.queue("response", FakeResponse(finished_navigation))
    page.queue("requestfinished", finished_navigation)
    page.queue_navigation(f"{origin}/finished")
    after_navigation = DRIVER.diagnostics_read({"origin": origin})
    assert {item["kind"] for item in after_navigation["network"]} == {"request", "response"}

    for index in range(3):
        item = FakeRequest(f"{origin}/event-{index}")
        page.emit("request", item)
    first_page = DRIVER.diagnostics_read({"origin": origin, "page_ref": after_navigation["page_ref"], "cursor": after_navigation["next_cursor"], "limit": 2})
    assert first_page["status"] == "completed"
    assert len(first_page["network"]) == 2
    assert first_page["truncated"] is True
    assert first_page["cursor"] == after_navigation["next_cursor"]
    second_page = DRIVER.diagnostics_read({"origin": origin, "page_ref": after_navigation["page_ref"], "cursor": first_page["next_cursor"], "limit": 2})
    assert second_page["status"] == "completed"
    assert len(second_page["network"]) == 1
    assert second_page["truncated"] is False

    stale = DRIVER.diagnostics_read({"origin": origin, "page_ref": page_ref, "cursor": first_page["next_cursor"]})
    assert stale["status"] == "unavailable" and stale["failure_class"] == "stale_page"
    old_cursor = first_page["next_cursor"]
    DRIVER.DIAGNOSTIC_INSTANCE_REF = "different-instance"
    cursor_stale = DRIVER.diagnostics_read({"origin": origin, "cursor": old_cursor})
    assert cursor_stale["status"] == "unavailable" and cursor_stale["failure_class"] == "cursor_stale"
    DRIVER.DIAGNOSTIC_INSTANCE_REF = old_cursor.split(":")[1]

    for index in range(DRIVER.DIAGNOSTIC_REQUEST_LIMIT + 32):
        page.emit("request", FakeRequest(f"{origin}/pending-{index}"))
    assert len(DRIVER.DIAGNOSTIC_REQUESTS) <= DRIVER.DIAGNOSTIC_REQUEST_LIMIT
    assert len(DRIVER.DIAGNOSTIC_EVENTS) <= 128

    page.closed = True
    closed = DRIVER.diagnostics_read({"origin": origin})
    assert closed["status"] == "unavailable" and closed["failure_class"] == "provider_unavailable"
    DRIVER.PAGE = None
    unavailable = DRIVER.diagnostics_read({"origin": origin})
    assert unavailable["status"] == "unavailable" and unavailable["failure_class"] == "provider_unavailable"
    print("camoufox diagnostics fixture ok")


if __name__ == "__main__":
    main()

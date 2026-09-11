"""Deterministic native-navigation boundary regression; no browser/network setup."""
import importlib.util
import sys
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location("driver", sys.argv[1])
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class Page:
    def __init__(self):
        self.url = "https://example.com/"
        self.evaluations = 0
        self.requests = []
        self.main_frame = object()
        self.guard = None

    def title(self):
        return "Public"

    def route(self, pattern, handler):
        self.guard = handler

    def unroute(self, pattern, handler):
        assert self.guard is handler
        self.guard = None

    def goto(self, url, **kwargs):
        if self.guard:
            route = Route(self, url)
            self.guard(route)
            if route.aborted:
                raise RuntimeError("navigation blocked")
        else:
            self.requests.append(url)
            if url.endswith("/redirect"):
                url = "https://denied.example/"
                self.requests.append(url)
            self.url = url

    def evaluate(self, expression, expected):
        assert expression.startswith("mw:") and expected == "https://example.com"
        self.evaluations += 1
        return {"text": "A public paragraph from the original page.", "truncated": False}


class Route:
    def __init__(self, page, url):
        self.page = page
        self.request = SimpleNamespace(url=url, method="GET", frame=page.main_frame, is_navigation_request=lambda: True)
        self.aborted = False

    def fetch(self, **options):
        assert options["max_redirects"] == 0
        self.page.requests.append(self.request.url)
        return SimpleNamespace(status=302 if self.request.url.endswith("/redirect") else 200, dispose=lambda: None)

    def fulfill(self, response):
        self.page.url = self.request.url

    def abort(self, reason):
        self.aborted = True


p = Page()
m.PAGE = p
page_state = m.register_provider_page(p)
page_ref = page_state["provider_page_ref"]
for path in ["one", "two"]:
    result = m.managed_public_page({"expected_origin": "https://example.com", "url": "https://example.com/" + path})
    assert result["page"]["current_url"].endswith(path)
    assert m.PAGE is p and p.evaluations == 0
assert m.managed_public_page({"expected_origin": "https://example.com"})["text"] == "A public paragraph from the original page."
assert p.evaluations == 1
redirected = m.managed_public_page({"expected_origin": "https://example.com", "url": "https://example.com/redirect"})
assert "https://denied.example/" not in p.requests, "redirect target received an unauthorized request"
assert redirected["failure_class"] == "managed_public_redirect_blocked"
assert "text" not in redirected and p.evaluations == 1
# A script may initiate navigation after goto has returned. The same guard remains.
try:
    p.goto("https://denied.example/script")
except RuntimeError:
    pass
assert "https://denied.example/script" not in p.requests, "script navigation escaped the origin guard"
assert m.PUBLIC_NAVIGATION_DENIED[page_ref] == "managed_public_navigation_blocked"
# The guard belongs to this Page, not the other Profile/browser page.
other = Page()
other.goto("https://other.example/")
assert other.url == "https://other.example/" and other.guard is None
m.register_provider_page(other)
m.install_public_navigation_guard("https://other.example", other)
try:
    other.goto("https://example.com/escape")
except RuntimeError:
    pass
assert other.url == "https://other.example/"
assert p.guard is not None and other.guard is not None
assert m.clear_public_navigation_guard()["cleared"]
assert p.guard is None and other.guard is None
p.goto("https://denied.example/human")
assert p.url == "https://denied.example/human"
try:
    m.open_url({"url": "https://example.com/redirect", "operation_scope": "profile_management"})
except RuntimeError:
    pass
assert "https://denied.example/" not in p.requests
assert p.guard is not None
assert m.managed_public_page({"provider_page_ref": page_ref, "expected_origin": "https://example.com", "url": "https://example.com/recovered"})["page"]["current_url"] == "https://example.com/recovered"
assert p.guard is not None
print("public navigation guard passed")

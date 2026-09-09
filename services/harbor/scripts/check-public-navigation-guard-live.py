"""Opt-in fixed-Camoufox regression using two empty temporary Profiles and loopback only."""
import importlib.util
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread

hits = []


class Target(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path in ["/redirect-target", "/script-target", "/human"]:
            hits.append(self.path)
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(b"<main><p>Target receipt.</p></main>")


target = ThreadingHTTPServer(("127.0.0.1", 0), Target)
target_origin = f"http://127.0.0.1:{target.server_port}"


class Public(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path == "/redirect":
            self.send_response(302)
            self.send_header("Location", target_origin + "/redirect-target")
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        script = f"<script>setTimeout(() => location.href = '{target_origin}/script-target', 30)</script>" if self.path == "/script" else ""
        self.wfile.write(("<main><p>A rendered public regression paragraph.</p></main>" + script).encode())


public = ThreadingHTTPServer(("127.0.0.1", 0), Public)
origin = f"http://127.0.0.1:{public.server_port}"
for server in [public, target]:
    Thread(target=server.serve_forever, daemon=True).start()


def load(name):
    spec = importlib.util.spec_from_file_location(name, sys.argv[1])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


modules = []
try:
    with TemporaryDirectory(prefix="webenvoy-public-guard-live-") as directory:
        try:
            from camoufox import NewBrowser, launch_options
            initial = load("initial_guard_driver")
            modules.append(initial)
            try:
                initial.launch({"profile_dir": str(Path(directory) / "initial"), "executable_path": sys.argv[2], "headless": True, "url": origin + "/redirect", "timeout_ms": 15000, "operation_scope": "profile_management"})
            except Exception:
                assert initial.PUBLIC_NAVIGATION_DENIED == "managed_public_redirect_blocked"
            assert not hits, "management initial redirect target received an unauthorized request"
            initial.close()
            modules.remove(initial)
            m = load("guard_driver")
            modules.append(m)
            m.launch({"profile_dir": str(Path(directory) / "first"), "executable_path": sys.argv[2], "headless": True, "url": origin + "/script", "timeout_ms": 15000, "operation_scope": "profile_management"})
            m.PAGE.wait_for_timeout(250)
            assert not hits, "management initial script target received an unauthorized request"
            other_context = NewBrowser(m.PLAYWRIGHT, from_options=launch_options(executable_path=m.LAUNCH_EXECUTABLE_PATH, user_data_dir=str(Path(directory) / "second"), headless=True, ff_version=m.firefox_major(sys.argv[2]), os="macos", main_world_eval=True, i_know_what_im_doing=True), persistent_context=True)
            other_page = other_context.pages[0] if other_context.pages else other_context.new_page()
            other_page.goto(origin + "/start", wait_until="domcontentloaded")
            original_page = m.PAGE
            result = m.managed_public_page({"expected_origin": origin, "url": origin + "/redirect"})
            assert not hits, "redirect target received an unauthorized request"
            assert result["failure_class"] == "managed_public_redirect_blocked", result
            for path in ["one", "two"]:
                result = m.managed_public_page({"expected_origin": origin, "url": origin + "/" + path})
                assert "failure_class" not in result, result
                assert m.PAGE is original_page
                result = m.managed_public_page({"expected_origin": origin})
                assert result["text"] == "A rendered public regression paragraph.", result
            result = m.managed_public_page({"expected_origin": origin, "url": origin + "/script"})
            m.PAGE.wait_for_timeout(250)
            assert not hits, "script target received an unauthorized request"
            assert m.PUBLIC_NAVIGATION_DENIED == "managed_public_navigation_blocked"
            assert other_page.url == origin + "/start"
            m.clear_public_navigation_guard()
            m.open_url({"url": target_origin + "/human", "timeout_ms": 15000})
            assert "/human" in hits
            hits.clear()
            try:
                m.open_url({"url": origin + "/redirect", "operation_scope": "profile_management", "timeout_ms": 15000})
            except Exception:
                assert m.PUBLIC_NAVIGATION_DENIED == "managed_public_redirect_blocked"
            assert not hits, f"management reuse redirect target received an unauthorized request: {hits}"
            m.managed_public_page({"expected_origin": origin, "url": origin + "/recovered"})
            m.managed_public_page({"expected_origin": origin, "url": origin + "/redirect"})
            assert not hits
            print(json.dumps({"provider": "camoufox 0.5.6 / Playwright 1.60.0", "isolated_profiles": 3, "management_initial_redirect_target_requests": 0, "management_reuse_redirect_target_requests": 0, "redirect_target_requests": 0, "script_target_requests": 0, "same_page_navigations_and_rendered_reads": 2, "other_profile_unchanged": True, "human_guard_release_and_reinstall": True}))
        finally:
            if "other_context" in locals():
                other_context.close()
            for module in reversed(modules):
                module.close()
finally:
    for server in [public, target]:
        server.shutdown()
        server.server_close()

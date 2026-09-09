import { execFile } from "node:child_process";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { HarborRuntime, createFixtureLauncher, type LocalProviderLauncher } from "./index.js";
import { normalizeRuntimeDiagnostics, safeDiagnosticsUrl, trustRuntimeDiagnosticsProbe } from "./runtime-diagnostics.js";
import { startHarborRuntimeServer } from "./server.js";

const origin = "https://example.test";
const execFileAsync = promisify(execFile);

test("Camoufox diagnostics fixture exercises the real Python listeners", async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const fixture = [
    join(here, "camoufox-diagnostics.fixture.py"),
    join(here, "../../../../packages/runtime-api/src/camoufox-diagnostics.fixture.py"),
    join(process.cwd(), "packages/runtime-api/src/camoufox-diagnostics.fixture.py")
  ].find(existsSync);
  assert.ok(fixture, "diagnostics fixture is missing");
  const result = await execFileAsync(process.env.HARBOR_CAMOUFOX_PYTHON ?? process.env.PYTHON ?? "python3", ["-B", fixture], { encoding: "utf8" });
  assert.match(String(result.stdout), /camoufox diagnostics fixture ok/);
});

test("diagnostics are bounded, redacted, Page-bound, and do not change ControlLease", async () => {
  const launcher: LocalProviderLauncher = async input => {
    const ready = await createFixtureLauncher("ready")(input);
    if (ready.status !== "ready") throw new Error("fixture launch failed");
    const pageRef = "page:fixture";
    return {
      ...ready,
      execution_surface: "local_provider" as const,
      readDiagnostics: trustRuntimeDiagnosticsProbe(async request => {
        if (request.origin !== origin) return { status: "unavailable", failure_class: "wrong_page", message: "wrong", retryable: false };
        if (request.page_ref && request.page_ref !== pageRef) return { status: "unavailable", failure_class: "stale_page", message: "stale", retryable: false };
        return normalizeRuntimeDiagnostics({
          status: "completed", page_ref: pageRef, document_generation: 1, cursor: "cursor:2", next_cursor: "cursor:2", truncated: false,
          observed_at: "2026-09-10T00:00:00.000Z", page: { current_url: `${origin}/page?token=hidden`, title: "Fixture", status: "ready" },
          network: [{ event_ref: "event:1", kind: "response", observed_at: "2026-09-10T00:00:00.000Z", method: "GET", url: `${origin}/api?authorization=secret`, resource_kind: "fetch", status: 200 }],
          console: [{ event_ref: "event:2", level: "error", observed_at: "2026-09-10T00:00:00.000Z", text: "token=secret", source: { url: `${origin}/app.js?token=secret`, line: 1 } }]
        }, { runtime_session_ref: "unknown", profile_ref: input.profile_ref });
      })
    };
  };
  const runtime = new HarborRuntime(launcher);
  const session = await runtime.createSession({ url: `${origin}/page`, control_owner: "system" });
  const token = Buffer.alloc(32, 7).toString("base64url");
  const server = await startHarborRuntimeServer({ port: 0, runtime, manual_authentication_supervisor_token: token });
  const diagnosticsUrl = `${server.url}/runtime/sessions/${encodeURIComponent(session.runtime_session_ref)}/diagnostics`;
  assert.equal((await fetch(diagnosticsUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ origin }) })).status, 403);
  assert.equal((await fetch(diagnosticsUrl, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ origin }) })).status, 200);
  const result = await runtime.readRuntimeDiagnostics(session.runtime_session_ref, { origin });
  assert.equal(result.status, "completed");
  if (result.status === "completed") {
    assert.equal(result.page.current_url, `${origin}/page`);
    assert.equal(result.network[0]?.url, `${origin}/api`);
    assert.equal(result.console[0]?.text, "[redacted]");
    assert.equal(result.console[0]?.source?.url, `${origin}/app.js`);
    assert.equal(result.console[0]?.truncated, false);
  }
  assert.equal(runtime.getSession(session.runtime_session_ref)?.control_owner, "system");
  const failure = async (input: Parameters<HarborRuntime["readRuntimeDiagnostics"]>[1]) => {
    const value = await runtime.readRuntimeDiagnostics(session.runtime_session_ref, input);
    assert.equal(value.status, "unavailable");
    return value.status === "unavailable" ? value.failure_class : "completed";
  };
  assert.equal(await failure({ origin, page_ref: "page:stale" }), "stale_page");
  assert.equal(await failure({ origin: "https://other.test" }), "wrong_page");
  await runtime.stopSession(session.runtime_session_ref);
  assert.equal(await failure({ origin }), "session_not_ready");
  await server.close();
});

test("normalization preserves event bindings and rejects unsafe cross-origin details", () => {
  const pageRef = "page:current";
  const result = normalizeRuntimeDiagnostics({
    status: "completed",
    page_ref: pageRef,
    document_generation: 2,
    cursor: "cursor:instance:page:current:2:4",
    next_cursor: "cursor:instance:page:current:2:5",
    truncated: false,
    observed_at: "2026-09-10T00:00:00.000Z",
    page: { current_url: `${origin}/current?token=secret`, title: "Fixture", status: "ready" },
    network: [
      { event_ref: "event:old", kind: "request", observed_at: "2026-09-10T00:00:00.000Z", page_ref: "page:old", document_generation: 1, method: "GET", url: `${origin}/api?secret=hidden`, resource_kind: "fetch" },
      { event_ref: "event:current", kind: "request", observed_at: "2026-09-10T00:00:00.000Z", page_ref: pageRef, document_generation: 2, method: "GET", url: `${origin}/api?secret=hidden`, resource_kind: "fetch" },
      { event_ref: "event:cross", kind: "request", observed_at: "2026-09-10T00:00:00.000Z", page_ref: "page:old", document_generation: 1, method: "GET", url: "https://cross.test/leak", resource_kind: "fetch" }
    ],
    console: [
      { event_ref: "event:bearer", level: "error", observed_at: "2026-09-10T00:00:00.000Z", page_ref: pageRef, document_generation: 2, text: "Authorization: Bearer secret" },
      { event_ref: "event:json", level: "error", observed_at: "2026-09-10T00:00:00.000Z", page_ref: pageRef, document_generation: 2, text: '{"token":"secret"}' },
      { event_ref: "event:long", level: "error", observed_at: "2026-09-10T00:00:00.000Z", page_ref: pageRef, document_generation: 2, text: "safe ".repeat(200), truncated: true },
      { event_ref: "event:cross-source", level: "error", observed_at: "2026-09-10T00:00:00.000Z", page_ref: pageRef, document_generation: 2, text: "cross origin", source: { url: "https://cross.test/private/token/secret", line: 1 } }
    ]
  }, { runtime_session_ref: "session:fixture", profile_ref: "profile:fixture" });
  assert.equal(result.status, "completed");
  if (result.status !== "completed") return;
  assert.equal(result.page.current_url, `${origin}/current`);
  assert.equal(result.network.length, 1);
  assert.equal(result.network[0]?.page_ref, pageRef);
  assert.equal(result.network[0]?.document_generation, 2);
  assert.equal(result.console.length, 3);
  assert.equal(result.console[0]?.text, "[redacted]");
  assert.equal(result.console[1]?.text, "[redacted]");
  assert.equal(result.console[2]?.truncated, true);
  assert.deepEqual(result.console[0]?.source, undefined);

  const capped = normalizeRuntimeDiagnostics({
    status: "completed", page_ref: pageRef, document_generation: 2,
    cursor: "cursor:instance:page:current:2:0", next_cursor: "cursor:instance:page:current:2:64", truncated: false,
    observed_at: "2026-09-10T00:00:00.000Z", page: { current_url: `${origin}/current`, title: "Fixture", status: "ready" },
    network: Array.from({ length: 64 }, (_, index) => ({ event_ref: `event:${index}`, kind: "request", observed_at: "2026-09-10T00:00:00.000Z", page_ref: pageRef, document_generation: 2, method: "GET", url: `${origin}/event-${index}`, resource_kind: "fetch" })),
    console: [{ event_ref: "event:console", level: "error", observed_at: "2026-09-10T00:00:00.000Z", page_ref: pageRef, document_generation: 2, text: "console" }]
  }, { runtime_session_ref: "session:fixture", profile_ref: "profile:fixture" });
  assert.equal(capped.status, "completed");
  if (capped.status === "completed") assert.equal(capped.network.length + capped.console.length, 64);

  const malformed = normalizeRuntimeDiagnostics({
    status: "completed", page_ref: pageRef, document_generation: 2,
    cursor: "cursor:instance:page:current:2:0", next_cursor: "cursor:instance:page:current:2:0", truncated: false,
    observed_at: "not-a-timestamp", page: { current_url: `${origin}/current`, title: "Fixture", status: "ready" },
    network: [{ event_ref: "event:bad", kind: "future-kind", observed_at: "not-a-timestamp", page_ref: pageRef, document_generation: 2, method: "GET", url: `${origin}/bad`, resource_kind: "fetch" }], console: []
  }, { runtime_session_ref: "session:fixture", profile_ref: "profile:fixture" });
  assert.equal(malformed.status, "unavailable");
  if (malformed.status === "unavailable") assert.match(malformed.message, /unavailable/);
  assert.equal(safeDiagnosticsUrl(`${origin}/private/token/secret`)?.url, `${origin}/<redacted>`);
  assert.equal(safeDiagnosticsUrl(`${origin}/reset/token=fixture-sentinel`)?.url, `${origin}/<redacted>`);
  assert.equal(safeDiagnosticsUrl(`${origin}/reset/token%3Dfixture-sentinel`)?.url, `${origin}/<redacted>`);
});

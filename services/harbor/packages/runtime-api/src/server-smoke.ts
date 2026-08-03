import assert from "node:assert/strict";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { validateReadOperationProbe } from "./local-provider-launcher.js";

interface StartupLine {
  service: string;
  status: string;
  url: string;
  provider_launcher?: string;
}

const endpointsChecked: string[] = [];
const supervisorToken = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const xhsNoteUrl = "https://www.xiaohongshu.com/explore/0123456789abcdef01234567";
const smokeRoot = mkdtempSync(join(tmpdir(), "harbor-runtime-api-smoke-"));
const xhsProbe = validateReadOperationProbe({
  site_id: "xiaohongshu",
  operation_id: "xhs_search_notes",
  query: "runtime api smoke",
  limit: 1,
  target_url: "https://www.xiaohongshu.com/search_result?keyword=runtime+api+smoke",
  expected_origin: "https://www.xiaohongshu.com"
}, {
  origin: "https://www.xiaohongshu.com",
  pathname: "/search_result",
  search: "?keyword=runtime+api+smoke",
  ready: true,
  pinia_ready: true,
  list_valid: true,
  note_count: 1,
  detail_urls: [xhsNoteUrl],
  search_items: [{ title: "公开搜索笔记", author_display_name: "公开作者", interaction_metrics: { likes: "10" } }],
  operation_response_status: 200,
  operation_response_url: "https://so.xiaohongshu.com/api/sns/web/v2/search/notes",
  xhs_response: {
    status: "completed",
    detail_urls: [xhsNoteUrl],
    search_items: [{ title: "公开搜索笔记", author_display_name: "公开作者", interaction_metrics: { likes: "10" } }]
  }
});
assert.equal(xhsProbe.status, "completed");
if (xhsProbe.status === "completed") {
  assert.deepEqual(xhsProbe.detail_urls, [xhsNoteUrl]);
  assert.deepEqual(xhsProbe.search_items, [{ title: "公开搜索笔记", author_display_name: "公开作者", interaction_metrics: { likes: "10" } }]);
  assert.equal(xhsProbe.public_summary.result_count, 1);
}

const child = spawn("pnpm", ["start:runtime"], {
  cwd: process.cwd(),
  detached: true,
  env: {
    ...process.env,
    HARBOR_RUNTIME_PORT: "0",
    HARBOR_RUNTIME_PROVIDER: "fixture",
    HARBOR_IDENTITY_ENVIRONMENTS_PATH: join(smokeRoot, "identity-environments.json"),
    HARBOR_PROFILE_STORAGE_ROOT: join(smokeRoot, "profiles"),
    HARBOR_MANUAL_AUTH_SUPERVISOR_TOKEN: supervisorToken
  },
  stdio: ["ignore", "pipe", "pipe"]
});

try {
  const startup = await waitForStartup(child);
  assert.equal(startup.service, "harbor-runtime-api");
  assert.equal(startup.status, "ready");
  assert.equal(startup.provider_launcher, "fixture");

  for (const path of ["/health", "/ready", "/readiness", "/runtime/health"]) {
    const body = await getJson(startup.url, path);
    assert.equal(body.status, "ready");
    assert.equal(body.safety_boundary.raw_credentials, "not_exposed");
  }

  const providers = await getJson(startup.url, "/runtime/browser-providers");
  assert.equal(providers.schema_version, "harbor-browser-provider-status/v0");

  const emptyEnvironments = await getJson(startup.url, "/runtime/identity-environments");
  assert.deepEqual(emptyEnvironments.identity_environments, []);

  const identityEnvironment = await postJson(startup.url, "/runtime/identity-environments", {
    site: {
      site_id: "xiaohongshu",
      origin: "https://www.xiaohongshu.com",
      display_name: "Xiaohongshu",
      account_ref: "account_api-smoke"
    },
    language: "zh-CN",
    timezone: "Asia/Shanghai"
  });
  assert.match(identityEnvironment.identity_environment_ref, /^identity-env_[a-f0-9]{24}$/);
  assert.equal(identityEnvironment.public_boundary.raw_material, "not_exposed");

  const mutationCreate = await postJson(startup.url, "/runtime/identity-environment-mutations", {
    operation: "create",
    idempotency_key: "api-smoke-create",
    identity_environment: {
      site: { site_id: "xiaohongshu", origin: "https://www.xiaohongshu.com" }
    }
  });
  assert.equal(mutationCreate.schema_version, "harbor-identity-environment-mutation/v1");
  assert.equal(mutationCreate.status, "completed");
  assert.match(mutationCreate.identity_environment_ref, /^identity-env_[a-f0-9]{24}$/);

  const mutationRemove = await postJson(startup.url, "/runtime/identity-environment-mutations", {
    operation: "remove",
    idempotency_key: "api-smoke-remove",
    identity_environment_ref: mutationCreate.identity_environment_ref
  });
  assert.equal(mutationRemove.effects.local_data, "preserved");

  const environments = await getJson(startup.url, "/runtime/identity-environments");
  assert.equal(environments.identity_environments.length, 1);

  const session = await postJson(startup.url, "/runtime/identity-environment-sessions", {
    identity_environment: {
      identity_environment_ref: "identity-env_api-smoke-session",
      execution_identity_ref: "execution-identity_api-smoke-session",
      profile_ref: "profile_api-smoke-session",
      site: {
        site_id: "xiaohongshu",
        origin: "https://www.xiaohongshu.com",
        display_name: "Xiaohongshu",
        account_ref: "account_api-smoke-session"
      },
      language: "zh-CN",
      timezone: "Asia/Shanghai"
    },
    url: "https://example.test/runtime-api-smoke",
    control_owner: "agent",
    holder_ref: "api-smoke"
  }, true);
  assert.equal(session.lifecycle_state, "active");

  const ownerFacts = await getJson(startup.url, `/runtime/sessions/${session.runtime_session_ref}/runtime-facts`);
  assert.equal(ownerFacts.schema_version, "harbor-core-runtime-facts/v0");
  assert.equal(ownerFacts.fact_refs.session, session.runtime_session_ref);
  assert.equal(JSON.stringify(ownerFacts).includes("public_summary"), false);
  assert.equal(JSON.stringify(ownerFacts).includes("normalized"), false);

  const snapshot = await postJson(startup.url, `/runtime/sessions/${session.runtime_session_ref}/snapshot`, {}, true);
  assert.equal(snapshot.status, "captured");
  assert.equal(snapshot.evidence_refs.length > 0, true);

  const siteFacts = await getJson(
    startup.url,
    `/runtime/sessions/${session.runtime_session_ref}/site-resource-facts?site_id=xiaohongshu&task_kind=search_notes`
  );
  assert.equal(siteFacts.schema_version, "harbor-site-resource-facts/v0");
  assert.equal(siteFacts.public_boundary.raw_dom, "not_exposed");
  assert.equal(siteFacts.evidence_refs.length > 0, true);

  const writePrecheck = await postJson(startup.url, `/runtime/sessions/${session.runtime_session_ref}/write-precheck-facts`, {
    site_id: "xiaohongshu",
    target_label: "Publish note precheck",
    fields: [
      { label: "Title", input_kind: "text", required: true, sensitivity: "public", value_state: "present" }
    ]
  }, true);
  assert.equal(writePrecheck.schema_version, "harbor-write-precheck-facts/v0");
  assert.equal(writePrecheck.submitted, false);
  assert.equal(writePrecheck.pre_write_guard.no_submit_guard, "active");
  assert.equal(writePrecheck.privacy_boundary.raw_values, "not_exposed");

  for (const evidenceRef of [snapshot.evidence_refs[0], siteFacts.evidence_refs[0], writePrecheck.writable_target.evidence_refs[0]]) {
    const evidence = await getJson(startup.url, `/runtime/evidence/${evidenceRef}`);
    assert.equal(evidence.evidence_ref, evidenceRef);
    assert.equal(JSON.stringify(evidence).includes("cookie"), false);
  }

  console.log(JSON.stringify({
    schema_version: "harbor-runtime-api-server-smoke/v0",
    command: "pnpm start:runtime",
    provider_launcher: "fixture",
    endpoints_checked: endpointsChecked,
    safety_boundary: {
      real_account: "not_used",
      real_browser_profile: "not_used",
      production_page: "not_opened",
      external_write_actions: "not_performed"
    }
  }, null, 2));
} finally {
  await stop(child);
  rmSync(smokeRoot, { recursive: true, force: true });
}

async function getJson(baseUrl: string, path: string): Promise<any> {
  const response = await fetch(`${baseUrl}${path}`);
  endpointsChecked.push(`GET ${path}`);
  assert.equal(response.status, 200);
  return response.json();
}

async function postJson(baseUrl: string, path: string, body: unknown, authorized = true): Promise<any> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      "idempotency-key": `smoke-${endpointsChecked.length}`,
      ...(authorized ? { authorization: `Bearer ${supervisorToken}` } : {})
    }
  });
  endpointsChecked.push(`POST ${path}`);
  assert.equal(response.status === 200 || response.status === 201, true);
  return response.json();
}

async function waitForStartup(childProcess: ChildProcessByStdio<null, Readable, Readable>): Promise<StartupLine> {
  let stdout = "";
  let stderr = "";
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for Harbor runtime API startup.\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, 30_000);

    childProcess.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    childProcess.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      const startup = parseStartup(stdout);
      if (startup) {
        clearTimeout(timer);
        resolve(startup);
      }
    });
    childProcess.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`Harbor runtime API exited before startup: code=${code ?? "null"} signal=${signal ?? "null"}\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    });
    childProcess.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function parseStartup(output: string): StartupLine | null {
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(trimmed) as Partial<StartupLine>;
      if (parsed.service === "harbor-runtime-api" && parsed.status === "ready" && parsed.url) {
        return parsed as StartupLine;
      }
    } catch {
      // Ignore pnpm lifecycle output; the runtime server prints a JSON startup line.
    }
  }
  return null;
}

async function stop(childProcess: ChildProcessByStdio<null, Readable, Readable>): Promise<void> {
  if (childProcess.exitCode !== null || childProcess.signalCode !== null) return;
  killGroup(childProcess, "SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      killGroup(childProcess, "SIGKILL");
      resolve();
    }, 5_000);
    childProcess.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function killGroup(childProcess: ChildProcessByStdio<null, Readable, Readable>, signal: NodeJS.Signals): void {
  if (childProcess.pid) {
    try {
      process.kill(-childProcess.pid, signal);
      return;
    } catch {
      // Fall back to the wrapper process if the platform does not expose the group.
    }
  }
  childProcess.kill(signal);
}

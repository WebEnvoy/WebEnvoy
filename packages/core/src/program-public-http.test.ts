import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { normalizeStoredTargetRef } from "./public-target-reference.js";
import {
  createPinnedLookup,
  isPubliclyRoutableAddress,
  parseProgramPublicHttpPolicy,
  ProgramPublicHttpError,
  readProgramPublicHttp,
  validateProgramPublicHttpCall,
  type ProgramPublicHttpPolicy
} from "./program-public-http.js";

const origin = "https://public.example";
test("pinned DNS lookup returns the address shape requested by Node 24 HTTPS", async () => {
  const lookup = createPinnedLookup({ address: "93.184.215.14", family: 4 });
  await new Promise<void>((resolve, reject) => lookup("public.example", { all: true }, (error, addresses) => {
    if (error) return reject(error);
    assert.deepEqual(addresses, [{ address: "93.184.215.14", family: 4 }]);
    resolve();
  }));
  await new Promise<void>((resolve, reject) => lookup("public.example", { all: false }, (error, address, family) => {
    if (error) return reject(error);
    assert.equal(address, "93.184.215.14");
    assert.equal(family, 4);
    resolve();
  }));
});
function makePolicy(overrides: Partial<ProgramPublicHttpPolicy> = {}): ProgramPublicHttpPolicy {
  return parseProgramPublicHttpPolicy({
    transport: "program_anonymous_https", origin, pathname: "/api", allow_one_path_segment: false,
    query_keys: ["q"], headers: { accept: "application/json" }, content_types: ["application/json"],
    max_response_bytes: 1024, max_redirects: 2, timeout_ms: 1000, ...overrides
  }, origin);
}
function request(overrides: Record<string, unknown> = {}) {
  return { url: `${origin}/api?q=abc`, method: "GET", headers: { accept: "application/json" }, ...overrides };
}

test("public program HTTP policy is pinned to HTTPS origin, path, headers, query, and body bounds", () => {
  assert.equal(normalizeStoredTargetRef(origin), origin, "a task's exact public origin is a valid Run scope target");
  const policy = makePolicy();
  const checked = validateProgramPublicHttpCall(policy, request());
  assert.equal(checked.url.href, `${origin}/api?q=abc`);
  assert.equal(checked.call.method, "GET");
  assert.deepEqual(checked.call.headers, { accept: "application/json" });
  for (const denied of [
    request({ url: "http://public.example/api?q=abc" }),
    request({ url: "https://other.example/api?q=abc" }),
    request({ url: `${origin}/admin?q=abc` }),
    request({ url: `${origin}/api?q=abc&token=x` }),
    request({ url: `${origin}/api?q=abc&q=again` }),
    request({ method: "POST" }),
    request({ headers: { accept: "application/json", authorization: "Bearer x" } })
  ]) assert.throws(() => validateProgramPublicHttpCall(policy, denied), ProgramPublicHttpError);
  assert.throws(() => parseProgramPublicHttpPolicy({
    transport: "program_anonymous_https", origin: "https://127.0.0.1", pathname: "/api", allow_one_path_segment: false,
    query_keys: [], headers: {}, content_types: ["application/json"], max_response_bytes: 1024, max_redirects: 0, timeout_ms: 100
  }, "https://127.0.0.1"), /managed_task_network_policy_invalid/);
});

test("address gate rejects private, loopback, link-local, metadata, documentation, and reserved answers", () => {
  for (const address of ["0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.20.0.1", "192.168.1.2", "198.51.100.2", "203.0.113.2", "224.0.0.1", "240.0.0.1", "::1", "fc00::1", "fe80::1", "2001:db8::1", "2002::1", "ff02::1", "3fff::1"]) {
    assert.equal(isPubliclyRoutableAddress(address), false, address);
  }
  for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "2001:4860:4860::8888"]) {
    assert.equal(isPubliclyRoutableAddress(address), true, address);
  }
});

test("bounded read pins DNS before each same-origin redirect and returns a hash-bound opaque response", async () => {
  const policy = makePolicy({ allow_one_path_segment: true });
  const sent: URL[] = [];
  const resolved: string[] = [];
  const dispatched: string[] = [];
  const result = await readProgramPublicHttp(policy, request(), {
    async lookup(hostname) { resolved.push(hostname); return [{ address: "8.8.8.8", family: 4 }]; },
    async beforeDispatch(url, hop) { dispatched.push(`${hop.hop_index}:${url.pathname}`); },
    async send(url, address) {
      assert.equal(address.address, "8.8.8.8");
      sent.push(url);
      return sent.length === 1
        ? { status: 302, location: "/api/v1?q=abc", content_type: "text/plain", body: "redirect" }
        : { status: 200, content_type: "application/json; charset=utf-8", body: '{"ok":true}' };
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.body, '{"ok":true}');
  assert.match(result.response_ref, /^webenvoy:public-http-response\/[0-9a-f-]{36}$/);
  assert.equal(result.facts.redirect_count, 1);
  assert.equal(result.facts.body_sha256, createHash("sha256").update(result.body).digest("hex"));
  assert.deepEqual(resolved, ["public.example", "public.example"]);
  assert.deepEqual(dispatched, ["0:/api", "1:/api/v1"]);
  assert.deepEqual(sent.map(url => url.pathname), ["/api", "/api/v1"]);
});

test("public reader refuses private redirect, wrong MIME, oversized body, and uncertain transport without replay", async () => {
  const policy = makePolicy({ allow_one_path_segment: true });
  let sends = 0;
  const dependencies = {
    async lookup() { return [{ address: "8.8.8.8", family: 4 }]; },
    async send() { sends += 1; return { status: 302, location: "https://127.0.0.1/api?q=abc", content_type: "text/plain", body: "" }; }
  };
  await assert.rejects(readProgramPublicHttp(policy, request(), dependencies), error => error instanceof ProgramPublicHttpError &&
    error.code === "managed_task_network_redirect_denied" && error.dispatch_state === "dispatched" && error.outcome_uncertain === false);
  assert.equal(sends, 1, "a rejected redirect is not followed");

  await assert.rejects(readProgramPublicHttp(makePolicy(), request(), {
    async lookup() { return [{ address: "8.8.8.8", family: 4 }]; },
    async send() { return { status: 200, content_type: "text/plain", body: "not JSON" }; }
  }), /managed_task_network_content_type_denied/);

  await assert.rejects(readProgramPublicHttp(makePolicy({ max_response_bytes: 4 }), request(), {
    async lookup() { return [{ address: "8.8.8.8", family: 4 }]; },
    async send() { return { status: 200, content_type: "application/json", body: "12345" }; }
  }), /managed_task_network_response_too_large/);

  await assert.rejects(readProgramPublicHttp(makePolicy(), request(), {
    async lookup() { return [{ address: "8.8.8.8", family: 4 }]; },
    async send() { throw new ProgramPublicHttpError("managed_task_network_timeout", "dispatched", true); }
  }), error => error instanceof ProgramPublicHttpError && error.outcome_uncertain && error.dispatch_state === "dispatched");
});

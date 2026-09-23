import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const CONTROL_COUNTS = new Set([32, 128, 160]);
const STRESS_COUNT = 800;

export function fixtureHtml(count, { stress = false } = {}) {
  if (stress) {
    if (count !== STRESS_COUNT) throw new RangeError(`stress fixture count must be ${STRESS_COUNT}`);
    const name = '名'.repeat(256);
    const description = '说明'.repeat(128);
    const form = '模块'.repeat(64);
    const region = '区域'.repeat(64);
    const placeholder = '提示'.repeat(64);
    const controls = Array.from({ length: count }, () =>
      `<input type="text" name="${name}" aria-label="${name}" aria-describedby="description" placeholder="${placeholder}">`
    ).join('');
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>WebEnvoy observation cost fixture</title></head><body><form aria-label="${form}"><section role="region" aria-label="${region}"><span id="description">${description}</span>${controls}</section></form></body></html>`;
  }
  if (!CONTROL_COUNTS.has(count)) throw new RangeError('control fixture count must be 32, 128, or 160');
  const controls = Array.from({ length: count }, (_, index) => {
    const id = `control-${index + 1}`;
    return `<label for="${id}">Field ${index + 1}</label><input id="${id}" name="${id}" type="text">`;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>WebEnvoy observation cost fixture</title></head><body><main><form aria-label="Observation form">${controls}</form></main></body></html>`;
}

export function fixtureSha256(html) {
  if (typeof html !== 'string') throw new TypeError('fixture HTML must be a string');
  return createHash('sha256').update(html, 'utf8').digest('hex');
}

export function fixtureForPath(pathname) {
  const match = /^\/controls\/(32|128|160)$/.exec(pathname);
  if (match) {
    const html = fixtureHtml(Number(match[1]));
    return { html, sha256: fixtureSha256(html) };
  }
  if (pathname === '/stress') {
    const html = fixtureHtml(STRESS_COUNT, { stress: true });
    return { html, sha256: fixtureSha256(html) };
  }
  return null;
}

// Compose into the direct shared-driver diagnostic process. Wrappers attach to
// this Driver instance only; Playwright and packaged/runtime files stay intact.
export const PYTHON_DIAGNOSTIC_HELPERS = String.raw`
import asyncio, collections, contextvars, functools, sys, time

class WebEnvoyMeasurement:
    def __init__(self):
        self.active = contextvars.ContextVar("webenvoy_measurement_active", default=None)
        self.rows = collections.defaultdict(lambda: {"count": 0, "inclusive_ns": 0, "exclusive_ns": 0})

    async def timed(self, kind, name, function, *args, **kwargs):
        parent = self.active.get()
        span = {"child_ns": 0}
        token = self.active.set(span)
        started = time.perf_counter_ns()
        try:
            return await function(*args, **kwargs)
        finally:
            inclusive = time.perf_counter_ns() - started
            exclusive = max(0, inclusive - span["child_ns"])
            row = self.rows[(kind, name)]
            row["count"] += 1
            row["inclusive_ns"] += inclusive
            row["exclusive_ns"] += exclusive
            if parent is not None:
                parent["child_ns"] += inclusive
            self.active.reset(token)

    def snapshot(self):
        return [{"kind": kind, "name": name, **row} for (kind, name), row in sorted(self.rows.items())]

def wrap_shared_driver_methods(driver, meter):
    names = ("interact", "snapshot", "_capture_candidate_records", "_indexed_public_semantics", "_read_control", "_target_public_semantics", "target_failure", "_same_element", "_dispose_handle", "_verify_snapshot_batch", "_snapshot_result")
    for name in names:
        original = getattr(driver, name, None)
        if not callable(original):
            continue
        @functools.wraps(original)
        async def forward(*args, __original=original, __name=name, **kwargs):
            return await meter.timed("shared_driver_method", __name, __original, *args, **kwargs)
        setattr(driver, name, forward)

def start_playwright_protocol_counter():
    counts = collections.Counter()
    connection_file = "/playwright/_impl/_connection.py"
    def profile(frame, event, _arg):
        if event != "call" or frame.f_code.co_name != "_send_message_to_server" or not frame.f_code.co_filename.replace("\\", "/").endswith(connection_file):
            return
        method = frame.f_locals.get("method")
        if isinstance(method, str):
            counts[method] += 1
    sys.setprofile(profile)
    return counts, lambda: sys.setprofile(None)

def process_cpu_ns():
    return time.process_time_ns()

def python_helper_self_check():
    class Probe:
        async def interact(self):
            for name in ("snapshot", "_capture_candidate_records", "_indexed_public_semantics", "_read_control", "_target_public_semantics", "target_failure", "_same_element", "_dispose_handle", "_verify_snapshot_batch", "_snapshot_result"):
                await getattr(self, name)()
            return "forwarded"
        async def snapshot(self): await asyncio.sleep(0)
        async def _capture_candidate_records(self): await asyncio.sleep(0)
        async def _indexed_public_semantics(self): await asyncio.sleep(0)
        async def _read_control(self): await asyncio.sleep(0)
        async def _target_public_semantics(self): await asyncio.sleep(0)
        async def target_failure(self): await asyncio.sleep(0)
        async def _same_element(self): await asyncio.sleep(0)
        async def _dispose_handle(self): await asyncio.sleep(0)
        async def _verify_snapshot_batch(self): await asyncio.sleep(0)
        async def _snapshot_result(self):
            await asyncio.sleep(0)
            return None
    meter = WebEnvoyMeasurement()
    probe = Probe()
    wrap_shared_driver_methods(probe, meter)
    assert asyncio.run(probe.interact()) == "forwarded"
    rows = {(row["kind"], row["name"]): row for row in meter.snapshot()}
    assert rows[("shared_driver_method", "interact")]["count"] == 1
    expected = {"interact", "snapshot", "_capture_candidate_records", "_indexed_public_semantics", "_read_control", "_target_public_semantics", "target_failure", "_same_element", "_dispose_handle", "_verify_snapshot_batch", "_snapshot_result"}
    assert {name for kind, name in rows if kind == "shared_driver_method"} == expected
    assert all(row["inclusive_ns"] >= row["exclusive_ns"] for row in rows.values())
    assert sum(row["exclusive_ns"] for row in rows.values()) == rows[("shared_driver_method", "interact")]["inclusive_ns"]

    namespace = {}
    source = "def _send_message_to_server(self, method, params):\n    return method\n"
    exec(compile(source, "/fixture/playwright/_impl/_connection.py", "exec"), namespace)
    counts, stop = start_playwright_protocol_counter()
    try:
        assert namespace["_send_message_to_server"](object(), "Fixture.publicMethod", {"method": "ignore_payload", "payload": "unused"}) == "Fixture.publicMethod"
    finally:
        stop()
    assert counts == {"Fixture.publicMethod": 1}
    before = process_cpu_ns()
    assert process_cpu_ns() >= before
    return {"method_calls": sum(row["count"] for row in meter.snapshot()), "protocol_calls": dict(counts), "cpu_ns": before}
`;

export function selfCheck() {
  assert.equal(fixtureSha256(fixtureHtml(32)), fixtureSha256(fixtureHtml(32)));
  assert.equal((fixtureHtml(160).match(/<input /g) ?? []).length, 160);
  assert.equal((fixtureHtml(800, { stress: true }).match(/<input /g) ?? []).length, 800);
  assert.equal(fixtureForPath('/controls/128')?.sha256, fixtureSha256(fixtureHtml(128)));
  assert.equal(fixtureForPath('/unknown'), null);

  const python = spawnSync(process.env.PYTHON ?? 'python3', ['-c', `${PYTHON_DIAGNOSTIC_HELPERS}\nprint(python_helper_self_check())`], { encoding: 'utf8', timeout: 10_000 });
  if (python.error) throw python.error;
  assert.equal(python.status, 0, python.stderr || python.stdout);
  return { ok: true, fixture_bytes: Buffer.byteLength(fixtureHtml(32)), python: python.stdout.trim() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] !== '--self-check') throw new Error('usage: node standalone-observation-cost-diagnostic.mjs --self-check');
  process.stdout.write(`${JSON.stringify(selfCheck())}\n`);
}

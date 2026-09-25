import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const host = join(dirname(fileURLToPath(import.meta.url)), 'managed-site-worker.mjs');

async function runWorker(source, brokerReplies = [], { closeInput = false, allowSilentExit = false, executionTimeoutMs = 4_000,
  brokerCapabilities = ['runtime.invoke', 'output.write'] } = {}) {
  const child = spawn(process.execPath, ['--experimental-vm-modules', host], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {}
  });
  const frames = [];
  let stderr = '';
  let buffered = '';
  let replyIndex = 0;
  const exit = once(child, 'exit');
  let complete;
  const finished = new Promise(resolve => { complete = resolve; });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffered += chunk;
    for (;;) {
      const newline = buffered.indexOf('\n');
      if (newline < 0) break;
      const line = buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
      if (!line) continue;
      const frame = JSON.parse(line);
      frames.push(frame);
      if (frame.type === 'broker.request') {
        const reply = brokerReplies[replyIndex++];
        if (!reply) {
          child.stdin.write(`${JSON.stringify({ type: 'broker.response', id: frame.id, ok: false, code: 'unexpected_broker_call' })}\n`);
        } else {
          child.stdin.write(`${JSON.stringify({ type: 'broker.response', id: frame.id, ...reply })}\n`);
        }
      }
      if (frame.type === 'complete' || frame.type === 'failure') complete();
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr += chunk; });
  const request = { source, input: {}, context: { run_id: 'run-1' }, broker_capabilities: brokerCapabilities, execution_timeout_ms: executionTimeoutMs };
  child.stdin.write(`${JSON.stringify(request)}\n`);
  if (closeInput) child.stdin.end();
  const timeout = setTimeout(() => child.kill('SIGKILL'), 6000);
  try {
    await Promise.race([finished, exit.then(([code]) => {
      if (code !== 0 && frames.at(-1)?.type !== 'failure' && !allowSilentExit) throw new Error(`worker_exit_${code}: ${stderr}`);
    })]);
  } finally {
    clearTimeout(timeout);
  }
  const [code] = await exit;
  return { code, frames, stderr };
}

test('managed site worker runs the fixed ABI and brokers snapshot and output', async () => {
  const result = await runWorker(
    'export async function run(input, broker, context) { const page = await broker.runtime.invoke({operation_id:"instance.snapshot",action:"read"}); await broker.output.write({summary:page.snapshot.text, run:context.run_id}); }',
    [{ ok: true, result: { snapshot: { text: 'bounded page text' } } }, { ok: true, result: { accepted: true } }]
  );
  assert.equal(result.code, 0);
  assert.deepEqual(result.frames.map(frame => frame.type), ['identity', 'broker.request', 'broker.request', 'complete']);
  assert.equal(result.frames[1].method, 'runtime.invoke');
  assert.equal(result.frames[1].input.operation_id, 'instance.snapshot');
  assert.equal(result.frames[2].method, 'output.write');
  assert.deepEqual(result.frames[2].input, { summary: 'bounded page text', run: 'run-1' });
});

test('managed site worker exposes only network.read for a pinned v1.1 public-read task and consumes one response', async () => {
  const response = { ok: true, status: 200, url: 'https://public.example/api?q=abc', body: '{"rows":[]}', response_ref: 'webenvoy:public-http-response/00000000-0000-4000-8000-000000000001', content_type: 'application/json' };
  const result = await runWorker(
    'export async function run(input, broker) { const response = await broker.network.read({url:"https://public.example/api?q=abc",method:"GET",headers:{accept:"application/json"}}); await broker.output.write({status:response.status, body:response.body}); await broker.network.read({}); }',
    [{ ok: true, result: response }, { ok: true, result: { accepted: true } }],
    { brokerCapabilities: ['network.read', 'output.write'] }
  );
  assert.equal(result.frames.at(-1)?.type, 'failure');
  assert.equal(result.frames.at(-1)?.code, 'managed_site_capability_call_already_used');
  assert.deepEqual(result.frames.filter(frame => frame.type === 'broker.request').map(frame => frame.method), ['network.read', 'output.write']);
  assert.equal(result.frames[1].input.url, response.url);
  assert.deepEqual(result.frames[2].input, { status: 200, body: response.body });
  assert.equal(result.frames.some(frame => frame.method === 'runtime.invoke'), false);
});

test('managed site worker rejects module imports', async () => {
  const result = await runWorker('import fs from "node:fs"; export async function run() {}');
  assert.equal(result.frames.at(-1)?.type, 'failure');
  assert.equal(result.frames.at(-1)?.code, 'managed_site_script_import_forbidden');
});

test('managed site worker rejects a second output write', async () => {
  const result = await runWorker(
    'export async function run(input, broker) { await broker.output.write({ok:true}); await broker.output.write({ok:false}); }',
    [{ ok: true, result: { accepted: true } }]
  );
  assert.equal(result.frames.at(-1)?.type, 'failure');
  assert.equal(result.frames.at(-1)?.code, 'managed_site_output_already_written');
});

test('managed site worker bounds script CPU and exits after its Agent parent closes the pipe', async () => {
  const startedAt = Date.now();
  const result = await runWorker('export async function run() { while (true) {} }', [], { closeInput: true, allowSilentExit: true });
  assert.notEqual(result.code, 0);
  assert.notEqual(result.frames.at(-1)?.type, 'complete');
  assert.ok(Date.now() - startedAt < 1_500, 'Agent pipe closure must terminate the script thread promptly');
});

test('managed site worker bounds an async microtask loop', async () => {
  const startedAt = Date.now();
  const result = await runWorker('export async function run() { while (true) await Promise.resolve(); }', [], { executionTimeoutMs: 1_000 });
  assert.equal(result.frames.at(-1)?.type, 'failure');
  assert.equal(result.frames.at(-1)?.code, 'managed_site_worker_timeout');
  assert.ok(Date.now() - startedAt < 3_000, 'microtask starvation must not outlive the local execution bound');
});

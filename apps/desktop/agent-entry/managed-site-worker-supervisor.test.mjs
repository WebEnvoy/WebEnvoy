import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createManagedSiteWorkerSupervisor } from './managed-site-worker-supervisor.mjs';

const installRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const agentUid = process.getuid?.();
const script = 'export async function run(input, broker, context) { const snapshot = await broker.runtime.invoke({operation_id:"instance.snapshot",action:"read"}); await broker.output.write({run_id:context.run_id, text:snapshot.snapshot.text, process_type:typeof process}); }';
const ticket = (source = script, id = 'worker-ticket-0001') => ({
  ticket_id: id,
  run_id: 'managed-task-run-1',
  package: {
    package_ref: 'lode://site-skill/github/trending',
    revision_ref: 'lode://site-skill/github/trending@1.0.0#0dcd6232cdfd9c88982792d2ce88a39d528a6433',
    package_digest: 'sha256:' + 'a'.repeat(64),
    task_ref: 'read-daily-trending-top5',
    source_ref: 'lode://source/site-skill/github/trending@1.0.0#0dcd6232cdfd9c88982792d2ce88a39d528a6433',
    lock_ref: 'lode://lock/site-skill/github/trending@1.0.0',
    capability_ref: 'lode://site-capability/github/managed-page-snapshot@1.0.0',
    capability_version: '1.0.0',
    source_admission_ref: 'webenvoy.source-admission/site-skill-package/v1#sha256:' + 'b'.repeat(64),
    code_admission_ref: 'webenvoy.code-admission/site-skill-script/v1#sha256:' + 'c'.repeat(64)
  },
  script: {
    script_ref: 'lode://script/site-skill/github/trending/read-daily-top5@1.0.0',
    script_version: '1.0.0',
    script_sha256: 'sha256:' + createHash('sha256').update(source).digest('hex'),
    runtime_kind: 'webenvoy.site-skill-script-abi/v1',
    entrypoint: 'run',
    broker: 'webenvoy.site-skill-broker/v1',
    broker_capabilities: ['runtime.invoke', 'output.write'],
    source
  },
  authorization: { principal_id: 'principal-1', connection_id: 'connection-1', grant_id: 'grant-1', profile_ref: 'profile-1', origin: 'https://github.com' },
  target: { target_type: 'web_page', target_ref: 'page-1' },
  input: { schema_ref: 'lode://schema/site-skill/github/trending/daily-top5/input@1.0.0', value: {} },
  context: { run_id: 'managed-task-run-1', task_ref: 'read-daily-trending-top5' },
  deadline_at: Date.now() + 5_000
});
const callbacks = ({ onBroker = async () => ({}) } = {}) => ({
  onStarted: async () => ({ accepted: true }),
  onBroker
});

test('trusted_local refuses script dispatch before broker or worker start', async () => {
  const calls = [];
  const supervisor = createManagedSiteWorkerSupervisor({
    installRoot, ownerUid: agentUid, agentUid, mode: 'trusted_local',
    probeOwnerSocket: async () => { calls.push('probe'); return 'denied'; }
  });
  await assert.rejects(supervisor.run(ticket(), callbacks({ onBroker: async value => { calls.push(value); return {}; } })),
    error => error.message === 'worker_identity_unavailable' && error.dispatch_state === 'not_dispatched');
  assert.deepEqual(calls, []);
});

test('hardened host refuses worker dispatch unless its real owner-socket probe is denied', async () => {
  const calls = [];
  const supervisor = createManagedSiteWorkerSupervisor({
    installRoot, ownerUid: agentUid - 1, agentUid, mode: 'distinct_uid_hardened',
    probeOwnerSocket: async () => { calls.push('probe'); return 'accessible'; }
  });
  await assert.rejects(supervisor.run(ticket(), { ...callbacks(), onStarted: async () => calls.push('started') }),
    error => error.message === 'owner_socket_acl_unavailable' && error.dispatch_state === 'not_dispatched');
  assert.deepEqual(calls, ['probe']);
});

test('worker host inherits the configured Agent process UID and brokers one snapshot/output pair', async () => {
  const calls = [];
  const ownerUid = agentUid - 1;
  const supervisor = createManagedSiteWorkerSupervisor({
    installRoot, ownerUid, agentUid, mode: 'distinct_uid_hardened', probeOwnerSocket: async () => 'denied'
  });
  try {
    await supervisor.run(ticket(), {
      onStarted: async value => { calls.push(['started', value.ticket_id]); },
      onBroker: async value => {
        calls.push([value.method, value.input]);
        if (value.method === 'runtime.invoke') return { status: 'completed', snapshot: { text: 'bounded snapshot from the same Page' } };
        return { accepted: true };
      }
    });
  } finally {
    await supervisor.stopAll();
  }
  assert.equal(calls[0][0], 'started');
  assert.deepEqual(calls.slice(1).map(([method]) => method), ['runtime.invoke', 'output.write']);
  assert.deepEqual(calls[1][1], { operation_id: 'instance.snapshot', action: 'read' });
  assert.deepEqual(calls[2][1], { run_id: 'managed-task-run-1', text: 'bounded snapshot from the same Page', process_type: 'undefined' });
});

test('a rejected first invoke remains not_dispatched and is not replayed by the supervisor', async () => {
  let invokeCount = 0;
  const supervisor = createManagedSiteWorkerSupervisor({
    installRoot, ownerUid: agentUid - 1, agentUid, mode: 'distinct_uid_hardened', probeOwnerSocket: async () => 'denied'
  });
  try {
    await assert.rejects(supervisor.run(ticket(), {
      onStarted: async () => {},
      onBroker: async () => { invokeCount++; throw Object.assign(new Error('managed_task_ticket_inactive'), { dispatch_state: 'not_dispatched' }); }
    }), error => error.message === 'managed_task_ticket_inactive' && error.dispatch_state === 'not_dispatched');
    assert.equal(invokeCount, 1);
  } finally {
    await supervisor.stopAll();
  }
});

test('Agent supervisor rejects a consumed ticket without another worker or broker call', async () => {
  let brokerCount = 0;
  const supervisor = createManagedSiteWorkerSupervisor({
    installRoot, ownerUid: agentUid, agentUid, mode: 'trusted_local', probeOwnerSocket: async () => 'denied'
  });
  const request = ticket('export async function run(input, broker) { await broker.output.write({ok:true}); }', 'worker-ticket-reused-01');
  await assert.rejects(supervisor.run(request, callbacks()), /worker_identity_unavailable/);
  await assert.rejects(supervisor.run(request, callbacks({ onBroker: async () => { brokerCount++; return {}; } })), /managed_site_worker_ticket_reused/);
  assert.equal(brokerCount, 0);
});

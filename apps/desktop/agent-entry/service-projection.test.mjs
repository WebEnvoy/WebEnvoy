import test from 'node:test';
import assert from 'node:assert/strict';
import { projectHarborResponse, projectSessionSupervision } from './service-projection.mjs';

const terminalFacts = () => ({
  schema_version: 'harbor-runtime-facts/v1',
  runtime_session_ref: 'session:one',
  profile_ref: 'profile:one',
  provider_ref: 'provider:one',
  provider_mode: 'local_dedicated_profile',
  lifecycle_state: 'closed',
  created_at: '2026-09-22T00:00:00.000Z',
  last_seen_at: '2026-09-22T00:00:01.000Z',
  closed_at: '2026-09-22T00:00:01.000Z',
  availability: { cdp: 'unavailable', viewer: 'unavailable', snapshot: 'unavailable', evidence: 'unavailable' },
  control_owner: 'none',
  control_lock: { owner: 'none', state: 'closed', holder_ref: null, updated_at: '2026-09-22T00:00:01.000Z' },
  current_page: { status: 'unavailable' },
  current_error: null,
  facts: []
});

test('terminal Harbor stop without generation projects as a closed session', () => {
  const result = projectHarborResponse({ method: 'POST', url: '/runtime/sessions/session:one/stop' }, terminalFacts());
  assert.equal(result.lifecycle_state, 'closed');
  assert.equal(result.control_lock.state, 'closed');
  assert.equal(Object.hasOwn(result, 'control_generation'), false);
});

test('inspect and non-terminal stop still require control generation', () => {
  const terminal = terminalFacts();
  assert.equal(projectHarborResponse({ method: 'GET', url: '/runtime/sessions/session:one' }, terminal), undefined);
  const active = { ...terminal, lifecycle_state: 'active', control_owner: 'core_task', control_lock: { ...terminal.control_lock, owner: 'core_task', state: 'held', holder_ref: 'holder:one' } };
  assert.equal(projectHarborResponse({ method: 'POST', url: '/runtime/sessions/session:one/stop' }, active), undefined);
});

test('owner session projection exposes only bounded provider stage diagnostics', () => {
  const stages = ['page_list_request', 'page_relation_refresh', 'provider_snapshot'];
  const observedAt = '2026-09-22T00:00:00.000Z';
  const diagnostics = Array.from({ length: 13 }, (_, index) => ({
    stage: stages[index % stages.length], outcome: 'timeout', duration_ms: 60_000, observed_at: observedAt,
    code: 'request_timeout', page_text: 'private page content', stack: 'user:password@private.example'
  }));
  diagnostics.push({ stage: 'provider_snapshot', outcome: 'error', duration_ms: 1, observed_at: observedAt, code: 'https://user:password@private.example' });
  const value = {
    ...terminalFacts(), lifecycle_state: 'active', control_owner: 'core_task', control_generation: 4,
    control_lock: { owner: 'core_task', state: 'held', holder_ref: 'holder:one' },
    provider_operation_diagnostics: diagnostics
  };

  const result = projectHarborResponse({ method: 'GET', url: '/runtime/sessions/session:one' }, value);
  assert.equal(result.provider_operation_diagnostics.length, 11);
  assert.ok(result.provider_operation_diagnostics.some(item => item.stage === 'page_relation_refresh'));
  assert.ok(result.provider_operation_diagnostics.some(item => item.stage === 'provider_snapshot'));
  assert.equal(JSON.stringify(result).includes('private page content'), false);
  assert.equal(JSON.stringify(result).includes('password'), false);
  assert.ok(result.provider_operation_diagnostics.every(item => Object.keys(item).every(key =>
    ['stage', 'outcome', 'duration_ms', 'observed_at', 'code'].includes(key))));
});

test('invalid generation is never hidden by terminal stop compatibility', () => {
  const value = { ...terminalFacts(), control_generation: 'old-format' };
  assert.equal(projectHarborResponse({ method: 'POST', url: '/runtime/sessions/session:one/stop' }, value), undefined);
});

test('owner session supervision accepts only the exact safe Core projection', () => {
  const updatedAt = '2026-09-22T00:00:00.000Z';
  const envelope = {
    schema_version: 'webenvoy.owner-session-runs/v1',
    runtime_session_ref: 'session:A',
    status: 'available',
    runs: [{ run_id: 'managed-abc123', status: 'unknown_outcome', updated_at: updatedAt, operation: 'instance.click', failure_code: 'managed_browser_outcome_unknown' }]
  };
  assert.deepEqual(projectSessionSupervision('session:A', envelope), {
    status: 'available',
    runs: envelope.runs
  });
  assert.deepEqual(projectSessionSupervision('session:B', envelope), {
    status: 'unavailable', error: { code: 'owner_session_runs_invalid' }
  });
  assert.deepEqual(projectSessionSupervision('session:A', undefined), {
    status: 'unavailable', error: { code: 'owner_session_runs_invalid' }
  });
});

test('owner session supervision rejects terminal states and unsafe summary fields without echoing them', () => {
  const base = { schema_version: 'webenvoy.owner-session-runs/v1', runtime_session_ref: 'session:A', status: 'available', runs: [] };
  assert.deepEqual(projectSessionSupervision('session:A', { ...base, runs: [{ run_id: 'run-one', status: 'succeeded', updated_at: '2026-09-22T00:00:00.000Z' }] }), {
    status: 'unavailable', error: { code: 'owner_session_runs_invalid' }
  });
  assert.deepEqual(projectSessionSupervision('session:A', { ...base, unexpected: '/private/path' }), {
    status: 'unavailable', error: { code: 'owner_session_runs_invalid' }
  });
  assert.deepEqual(projectSessionSupervision('session:A', { ok: false, error: { code: 'owner_session_runs_unavailable', path: '/private/path' } }), {
    status: 'unavailable', error: { code: 'owner_session_runs_unavailable' }
  });
});

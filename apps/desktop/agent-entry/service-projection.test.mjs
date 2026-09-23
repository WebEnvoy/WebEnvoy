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

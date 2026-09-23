import test from 'node:test';
import assert from 'node:assert/strict';
import { projectHarborResponse } from './service-projection.mjs';

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

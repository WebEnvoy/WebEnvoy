import assert from 'node:assert/strict';
import test from 'node:test';
import { isOwnerHarborRoute } from './os-boundary.mjs';
import { isOwnerRoute } from './owner-routes.mjs';
import { projectHarborResponse } from './service-projection.mjs';

const sourceRef = 'profile-source:766261cf-b05c-431f-a6c2-4e6efa723d5d';
const sourceRecord = {
  schema_version: 'harbor-profile-source/v1', source_ref: sourceRef, provider_id: 'camoufox',
  source_format: 'camoufox.firefox-places.v86', bookmark_count: 1,
  registered_at: '2026-09-30T12:00:00.000Z', expires_at: '2026-10-01T12:00:00.000Z', revoked_at: null
};

test('owner Profile source routes are allowlisted, Harbor-forwarded, and safely projected', () => {
  const cases = [
    { method: 'POST', url: '/owner/profile-sources' },
    { method: 'GET', url: '/owner/profile-sources' },
    { method: 'POST', url: '/owner/profile-sources/revoke' }
  ];
  for (const request of cases) {
    assert.equal(isOwnerRoute(request), true);
    assert.equal(isOwnerHarborRoute(request), true);
  }
  assert.equal(isOwnerRoute({ method: 'DELETE', url: '/owner/profile-sources' }), false);
  assert.equal(isOwnerHarborRoute({ method: 'GET', url: '/owner/profile-sources?source_path=/private/source' }), false);

  const withPrivateFields = { ...sourceRecord, canonical_path: '/private/source', fingerprint: 'a'.repeat(64) };
  assert.deepEqual(projectHarborResponse(cases[0], { source: withPrivateFields }), { source: sourceRecord });
  assert.deepEqual(projectHarborResponse(cases[1], { sources: [withPrivateFields] }), { sources: [sourceRecord] });
  assert.deepEqual(projectHarborResponse(cases[2], { source: withPrivateFields }), { source: sourceRecord });
  assert.equal(projectHarborResponse(cases[1], { sources: [{ ...sourceRecord, source_ref: 'profile-source_766261cf-b05c-431f-a6c2-4e6efa723d5d' }] }), undefined);

  assert.deepEqual(projectHarborResponse(cases[0], {
    error: 'profile_source_locked', message: '/private/source/.parentlock'
  }), { error: 'profile_source_locked' });
  assert.deepEqual(projectHarborResponse(cases[2], {
    error: 'profile_source_invalid', message: '/private/source/places.sqlite'
  }), { error: 'profile_source_invalid' });
  assert.equal(projectHarborResponse(cases[0], { error: '/private/source/places.sqlite' }), undefined);
});

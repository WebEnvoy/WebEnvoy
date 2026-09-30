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
const proxyRef = 'proxy-ref:766261cf-b05c-431f-a6c2-4e6efa723d5d';
const proxyRecord = {
  schema_version: 'harbor-proxy-reference/v1', proxy_ref: proxyRef, label: 'test proxy',
  registered_at: '2026-09-30T12:00:00.000Z', revoked_at: null,
  availability: 'registered'
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

test('owner proxy reference routes are method-bounded and reject private endpoint data', () => {
  const cases = [
    { method: 'POST', url: '/owner/proxy-references' },
    { method: 'GET', url: '/owner/proxy-references' },
    { method: 'POST', url: '/owner/proxy-references/revoke' }
  ];
  for (const request of cases) {
    assert.equal(isOwnerRoute(request), true);
    assert.equal(isOwnerHarborRoute(request), true);
  }
  for (const request of [
    { method: 'DELETE', url: '/owner/proxy-references' },
    { method: 'GET', url: '/owner/proxy-references/revoke' },
    { method: 'GET', url: '/owner/proxy-references?proxy_ref=private' },
    { method: 'POST', url: '/owner/proxy-references/revoke?proxy_ref=private' }
  ]) {
    assert.equal(isOwnerRoute(request), false);
    assert.equal(isOwnerHarborRoute(request), false);
  }

  assert.deepEqual(projectHarborResponse(cases[0], { proxy_reference: proxyRecord }), { proxy_reference: proxyRecord });
  assert.deepEqual(projectHarborResponse(cases[1], { proxy_references: [proxyRecord] }), { proxy_references: [proxyRecord] });
  assert.deepEqual(projectHarborResponse(cases[2], { proxy_reference: { ...proxyRecord, availability: 'revoked', revoked_at: '2026-09-30T13:00:00.000Z' } }), {
    proxy_reference: { ...proxyRecord, availability: 'revoked', revoked_at: '2026-09-30T13:00:00.000Z' }
  });
  assert.equal(projectHarborResponse(cases[0], { proxy_reference: { ...proxyRecord, endpoint: 'http://user:password@127.0.0.1:3128' } }), undefined);
  assert.equal(projectHarborResponse(cases[1], { proxy_references: [{ ...proxyRecord, proxy_ref: 'proxy-ref:private' }] }), undefined);
  assert.deepEqual(projectHarborResponse(cases[0], { error: 'proxy_reference_invalid', message: 'http://private' }), { error: 'proxy_reference_invalid' });
});

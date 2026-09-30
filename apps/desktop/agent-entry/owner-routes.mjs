import { isOwnerHarborRoute } from './os-boundary.mjs';

export function isOwnerRoute(req) {
  return (req.method === 'POST' && ['/owner/recovery/inspect', '/owner/recovery/backup', '/owner/recovery/plan', '/owner/recovery/apply'].includes(req.url)) ||
    (req.method === 'GET' && /^\/owner\/recovery\/status\/[^/?]+$/.test(req.url)) ||
    (req.method === 'GET' && /^\/owner\/runtime-sessions\/[^/?]+\/runs$/.test(req.url)) ||
    (req.method === 'POST' && ['/owner/site-task-admissions/operations', '/owner/account-systems/operations', '/owner/account-bindings/operations'].includes(req.url)) ||
    (req.method === 'GET' && (req.url === '/owner/files' || req.url.startsWith('/owner/files?'))) ||
    (req.method === 'POST' && ['/owner/files/import', '/owner/files/export', '/owner/files/revoke', '/owner/files/delete'].includes(req.url)) ||
    (req.method === 'GET' && (req.url === '/agent-access' || /^\/agent-access\/operations\/[^/?]+$/.test(req.url))) ||
    ((req.method === 'GET' || req.method === 'PUT') && req.url === '/agent-access/management-policy') ||
    (req.method === 'POST' && (['/agent-access/principals', '/agent-access/grants', '/agent-access/v2/grants', '/agent-access/profile-policies', '/agent-access/v2/profile-policies', '/agent-access/scope-confirmations'].includes(req.url) || /^\/agent-access\/(principals|connections|grants)\/[^/?]+\/revoke$/.test(req.url))) ||
    isOwnerHarborRoute(req);
}

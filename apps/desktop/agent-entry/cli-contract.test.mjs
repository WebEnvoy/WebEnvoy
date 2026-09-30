import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const source = await readFile(join(dirname(fileURLToPath(import.meta.url)), "cli.mjs"), "utf8");
assert.match(source, /action === 'grant-v2'/);
assert.match(source, /action === 'policy-v2'/);
assert.match(source, /args\.includes\('--confirm'\)/);
assert.match(source, /requestOwner\('\/agent-access\/v2\/grants'/);
assert.match(source, /requestOwner\('\/agent-access\/v2\/profile-policies'/);
const grantAllowedFields = /action === 'grant'[\s\S]*?const allowed = \[([^\]]+)\]/.exec(source)?.[1] ?? "";
for (const field of ['max_created_profiles', 'skill_scope', 'profile_source_refs', 'file_scope', 'account_system_scope', 'account_binding_scopes']) {
  assert.match(grantAllowedFields, new RegExp(`'${field}'`), `owner grant file allows ${field}`);
}
const v2GrantAllowedFields = /action === 'grant-v2'[\s\S]*?const allowed = \[([^\]]+)\]/.exec(source)?.[1] ?? "";
for (const field of ['expires_at', 'skill_scope', 'profile_source_refs', 'file_scope', 'account_scope_selections', 'account_system_scope', 'account_binding_scopes', 'replaces_grant_id', 'replaces_grant_digest']) {
  assert.match(v2GrantAllowedFields, new RegExp(`'${field}'`), `v2 Grant refresh allows ${field}`);
}
assert.doesNotMatch(source, /action === 'v2-grant'/);
assert.doesNotMatch(source, /action === 'v2-policy'/);
assert.equal((source.match(/'account_system_scope', 'account_binding_scopes'/g) ?? []).length, 2, 'owner grant and V2 grant both accept AccountSystem template and binding scope selections');
assert.match(source, /requestOwner\('\/agent-access\/grants', value\)/);
assert.match(source, /requestOwner\('\/agent-access\/v2\/grants', value\)/);
assert.match(source, /command === 'profile-source'/);
assert.match(source, /source_path: resolve\(required\('--source-path'\)\)/);
assert.match(source, /ownerWriteRequest\(dataDir, '\/owner\/profile-sources', \{ source_path: sourcePath \}\)/);
assert.match(source, /ownerWriteRequest\(dataDir, '\/owner\/profile-sources\/revoke', \{ source_ref: required\('--source-ref'\) \}\)/);
console.log("Validated explicit v2 owner CLI confirmation and routes.");

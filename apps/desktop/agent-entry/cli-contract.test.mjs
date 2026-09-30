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
assert.doesNotMatch(source, /action === 'v2-grant'/);
assert.doesNotMatch(source, /action === 'v2-policy'/);
assert.equal((source.match(/'account_system_scope', 'account_binding_scopes'/g) ?? []).length, 2, 'owner grant and V2 grant both accept AccountSystem template and binding scope selections');
assert.match(source, /requestOwner\('\/agent-access\/grants', value\)/);
assert.match(source, /requestOwner\('\/agent-access\/v2\/grants', value\)/);
console.log("Validated explicit v2 owner CLI confirmation and routes.");

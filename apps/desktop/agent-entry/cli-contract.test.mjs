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
console.log("Validated explicit v2 owner CLI confirmation and routes.");

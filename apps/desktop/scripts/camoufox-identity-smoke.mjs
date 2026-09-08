import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

// Exercise the real renderer modules without starting a browser or owner service.
const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "../src/renderer");
const urls = new Map();
let selected;
globalThis.__camoufoxSelect = (value) => { selected = value; };
const reactHooks = `export const useState = initial => [typeof initial === 'function' ? initial() : initial, globalThis.__camoufoxSelect]; export const useRef = () => ({current:null}); export const useEffect = () => {};`;
const dataUrl = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
async function moduleUrl(name) {
  if (urls.has(name)) return urls.get(name);
  const path = resolve(root, name);
  let source = ts.transpileModule(await readFile(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  for (const match of [...source.matchAll(/from "([^"]+)"/g)]) {
    const specifier = match[1];
    const target = specifier === "react" ? dataUrl(reactHooks)
      : specifier.startsWith(".") ? await moduleUrl(resolve(dirname(path), `${specifier}.ts`))
      : pathToFileURL(require.resolve(specifier)).href;
    source = source.replaceAll(`from "${specifier}"`, `from "${target}"`);
  }
  const url = dataUrl(source);
  urls.set(name, url);
  return url;
}
const { identityFactsFromPublicRecord } = await import(await moduleUrl("harborIdentityClient.ts"));
const { projectHarborIdentity } = await import(await moduleUrl("harborIdentityProjection.ts"));
const { IdentityEnvironmentManagementPanel } = await import(await moduleUrl("IdentityEnvironmentManagementPanel.tsx"));
const provider = { provider_id: "camoufox", display_name: "Camoufox", role: "qualification", install: { status: "installed", launchability: "launchable" }, capabilities: [] };
const catalog = { providers: [provider] };
const record = { schema_version: "harbor-local-identity-environment-store/v0", identity_environment_ref: "identity-env_public", execution_identity_ref: "execution_public", profile_ref: "profile_public", site: { site_id: "xiaohongshu", origin: "https://www.xiaohongshu.com", display_name: "小红书" }, status: { login_state: "logged_in", browser_storage_state: "present" }, environment_summary: { provider_id: "camoufox" }, refs: { execution_identity_ref: "execution_public", profile_ref: "profile_public" } };
const facts = identityFactsFromPublicRecord(record, catalog);
assert.ok(facts);
const identity = projectHarborIdentity(facts, catalog, "2026-09-08T00:00:00Z");
assert.equal(identity.admissionFacts.providerId, "camoufox");
assert.equal(identity.provider.selected, "Camoufox");
assert.equal(identity.provider.role, "验证 Provider");
assert.equal(identity.browser.defaultProvider, "Camoufox");
assert.equal(identity.browser.session.provider, "Camoufox");
assert.equal(identity.browser.providers[0].name, "Camoufox");
assert.equal(identityFactsFromPublicRecord({ ...record, environment_summary: { provider_id: "unknown" } }, catalog).provider_binding.selected_provider_id, null);
function findSelect(node) {
  if (!node || typeof node !== "object") return null;
  if (node.type === "select" && node.props.name === "providerId") return node;
  return [node.props?.children].flat(Infinity).map(findSelect).find(Boolean);
}
for (const providers of [[provider], []]) {
  const tree = IdentityEnvironmentManagementPanel({ identity, providers, mode: "edit", busy: false, message: "", onCancel() {}, onSubmit() {} });
  const select = findSelect(tree);
  assert.equal(select.props.value, "camoufox", "editing must preserve even an unavailable bound provider");
  select.props.onChange({ target: { value: "camoufox" } });
  assert.equal(selected, "camoufox", "selection must not silently switch provider");
}
// Load the existing pure form-to-intent functions directly from their AST.
const page = ts.createSourceFile("page.tsx", await readFile(resolve(root, "IdentityEnvironmentsPage.tsx"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ["configuration", "businessInput", "knownValue", "normalizeViewport"];
const functions = page.statements.filter((node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)).map((node) => node.getText(page)).join("\n");
const { configuration, businessInput } = await import(dataUrl(ts.transpileModule(`${functions}\nexport { configuration, businessInput };`, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText));
const value = { siteId: "xiaohongshu", providerId: "camoufox", proxyMode: "preserve", language: "", timezone: "", viewport: "" };
assert.deepEqual(configuration(value, identity), {});
assert.equal(businessInput(value).requested_provider_id, "camoufox");
assert.equal(configuration({ ...value, providerId: "chrome_official" }, identity).provider_id, "chrome_official");
delete globalThis.__camoufoxSelect;
console.log("Camoufox identity projection, selection, unavailable-provider preservation and mutation checks passed.");

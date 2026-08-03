import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const inputModule = await import(pathToFileURL(path.resolve("dist-electron/lodeCatalogInput.js")).href);
const [xhsSchema, bossSchema] = await Promise.all([
  readFile("dist-electron/lode/sites/xiaohongshu/search-notes/schemas/input.schema.json", "utf8"),
  readFile("dist-electron/lode/sites/boss/job-search/schemas/input.schema.json", "utf8"),
]);
const xhsUrl = inputModule.projectInputFields(JSON.parse(xhsSchema)).find((field) => field.id === "url");
const xhsKeyword = inputModule.projectInputFields(JSON.parse(xhsSchema)).find((field) => field.id === "keyword");
const bossCity = inputModule.projectInputFields(JSON.parse(bossSchema)).find((field) => field.id === "city_code");
const bossLimit = inputModule.projectInputFields(JSON.parse(bossSchema)).find((field) => field.id === "limit");
const fields = inputModule.projectInputFields({
  type: "object",
  additionalProperties: false,
  required: ["url", "sections"],
  properties: {
    url: { type: "string", format: "uri", pattern: "^https://example\\.test/allowed$" },
    sections: { type: "array", minItems: 1, maxItems: 2, uniqueItems: true, items: { type: "string", enum: ["title", "summary"] } },
  },
});
const rejected = [
  "(a+)+$", "^(a|a?)+$", "^a*a*a*a*a*a*a*a*a*b$", "^[a]*[a]*b$",
  "^[a-z]*[a-y]*z$", "^.*a.*b$", "^[a-z]*x[a-z]*z$", "^allowed|evil$",
].map((pattern) => inputModule.projectInputFields({
  type: "object", additionalProperties: false, properties: { unsafe: { type: "string", pattern } },
})[0]);
const files = inputModule.projectInputFields({
  type: "object",
  additionalProperties: false,
  properties: {
    attachment: { type: "string", contentMediaType: "application/pdf", contentEncoding: "base64" },
    unsafe: { type: "string", contentMediaType: "Bearer secret", contentEncoding: "base64" },
  },
});
const inputSchemaRoot = "dist-electron/lode/sites";
const authoritativePatternFailures = [];
for (const relativePath of (await readdir(inputSchemaRoot, { recursive: true })).filter((file) => file.endsWith("schemas/input.schema.json"))) {
  const schema = JSON.parse(await readFile(path.join(inputSchemaRoot, relativePath), "utf8"));
  const projected = inputModule.projectInputFields(schema);
  for (const [id, declaration] of Object.entries(schema.properties ?? {})) {
    if (declaration?.pattern != null && projected.find((field) => field.id === id)?.kind === "unknown") {
      authoritativePatternFailures.push(`${relativePath}:${id}`);
    }
  }
}
if (xhsUrl?.pattern !== "^https://www\\.xiaohongshu\\.com/(?:explore|search_result/?.*)$" || xhsUrl.patternSafety !== "linear" ||
  xhsUrl.inputProjection !== "owner_ref" || xhsKeyword?.inputProjection !== "owner_ref" ||
  bossCity?.pattern !== "^[0-9]{6,}$" || bossCity.patternSafety !== "linear" || bossCity.inputProjection !== "owner_ref" ||
  bossLimit?.inputProjection !== "safe_summary" ||
  fields[0]?.pattern !== "^https://example\\.test/allowed$" || fields[0]?.patternSafety !== "linear" ||
  fields[1]?.minItems !== 1 || fields[1]?.maxItems !== 2 || fields[1]?.uniqueItems !== true ||
  rejected.some((field) => field?.kind !== "unknown") || files[0]?.kind !== "file" || files[1]?.kind !== "unknown" || authoritativePatternFailures.length > 0) {
  throw new Error("Skill workbench schema smoke failed: safe constraints were lost or unsafe constraints were accepted.");
}

process.stdout.write(`${JSON.stringify({ lodeAssets: true, safePatterns: true, inputProjection: true })}\n`);

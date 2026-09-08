import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const source = await readFile(new URL("../src/renderer/instanceReceipt.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { instanceReceiptFields, runRuntimeSessionRef } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
const run = { resultRows: [{ label: "执行现场", value: "session_receipt-regression" }], updatedAt: "2026-09-08T00:00:00Z" };
const result = {
  resultKind: "xhs_publish_note_image_text_media",
  packageRef: "lode://site-capability/xiaohongshu/publish-note-image-text-media@0.1.0",
  outputSchemaId: "lode://schema/site-capability/xiaohongshu/publish-note-image-text-media/output@0.1.0",
  payloadState: "available", envelopeState: "available",
  data: { normalized: { target_ref: "target:regression", submitted: false,
    media_readback: { status: "observed", media_count: 2, order_status: "observed", ordered_item_refs: ["media:one", "media:two"] },
    page_readback: { status: "observed", route_state: "observed" }, post_check: { status: "passed" }, reconciliation: { status: "matched" }, recovery: { status: "not_required" } } },
};
const fields = (value) => Object.fromEntries(instanceReceiptFields(value, run).map((field) => [field.label, field.value]));
assert.equal(runRuntimeSessionRef(run), "session_receipt-regression");
assert.equal(runRuntimeSessionRef({ resultRows: [{ label: "执行现场", value: "https://unrelated.test" }] }), undefined);
assert.equal(fields(result)["图片数量"], "2");
assert.match(fields(result)["历史回读"], /重新观察/);
assert.equal(fields(result)["Instance 引用"], "session_receipt-regression");
assert.equal(fields(result)["提交状态"], "未提交（submitted=false）");
assert.ok(!JSON.stringify(fields(result)).includes("media:one"));
assert.equal(fields({ ...result, data: { normalized: { media_readback: { media_count: -1 } } } })["图片数量"], "未知");
assert.match(fields({ ...result, data: { normalized: { operation: { status: "unknown_outcome" } } } })["待处理"], /禁止重放/);
assert.ok(fields({ ...result, outputSchemaId: "wrong" })["结果不可用"]);
const fieldResult = { ...result, resultKind: "xhs_publish_note_image_text_fields", packageRef: result.packageRef.replace("media@0.1.0", "fields@0.1.1"), outputSchemaId: result.outputSchemaId.replace("media/output@0.1.0", "fields/output@0.1.1"), data: { normalized: { field_readback: { title: { value_state: "matched" }, body: { value_state: "mismatch" }, validation_status: "failed" } } } };
assert.equal(fields(fieldResult)["标题差异"], "与本次输入一致");
assert.equal(fields(fieldResult)["正文差异"], "不一致");
assert.equal(fields(fieldResult)["字段校验"], "失败");
console.log("Instance receipt regression passed (historical projection only; not live acceptance).");

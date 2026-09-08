import type { CoreRunResult } from "./coreRunResultClient";
import type { RunProjection } from "./taskThreadFixtures";

export function runRuntimeSessionRef(run: RunProjection): string | undefined {
  const candidates = [
    ...run.resultRows.filter((row) => row.label === "执行现场" || row.label === "Runtime session").map((row) => row.value),
    ...(run.fieldSources?.map((field) => field.locator) ?? []),
  ];
  return candidates.find((ref) => /^(?:session_[A-Za-z0-9._-]+|harbor:runtime-session\/[A-Za-z0-9._/-]+)$/.test(ref));
}

/** Historical owner receipt; this projection never authorizes a subsequent action. */
export function instanceReceiptFields(result: CoreRunResult, run: RunProjection) {
  const fieldResult = result.resultKind === "xhs_publish_note_image_text_fields";
  const mediaResult = result.resultKind === "xhs_publish_note_image_text_media";
  if (!fieldResult && !mediaResult) return undefined;
  const family = fieldResult ? "fields" : "media";
  const version = fieldResult ? "0.1.1" : "0.1.0";
  const fields = [{ label: "历史回读", value: "以下是该回合结束时的记录；继续前仍需重新观察身份和页面。" }];
  if (result.packageRef !== `lode://site-capability/xiaohongshu/publish-note-image-text-${family}@${version}` ||
      result.outputSchemaId !== `lode://schema/site-capability/xiaohongshu/publish-note-image-text-${family}/output@${version}` ||
      result.payloadState !== "available" || result.envelopeState !== "available") {
    return [...fields, { label: "结果不可用", value: "回读与该回合的能力契约不一致。" }];
  }
  const data = record(result.data?.normalized);
  if (!data) return [...fields, { label: "结果不可用", value: "该回合未返回结构化回读。" }];
  const media = record(data.media_readback);
  const content = record(data.field_readback);
  const page = record(data.page_readback);
  const operation = record(data.operation);
  const recovery = record(data.recovery);
  fields.push(
    { label: "Instance 引用", value: runRuntimeSessionRef(run) ?? "未提供，无法关联当前现场" },
    { label: "记录时间", value: run.updatedAt ?? "未提供" },
    { label: "动作目标引用", value: text(data.target_ref) ?? "未提供（不是账号或经营对象确认）" },
  );
  if (mediaResult) fields.push(
    { label: "图片回读", value: state(media?.status) },
    { label: "图片数量", value: Number.isSafeInteger(media?.media_count) && Number(media?.media_count) >= 0 ? String(media!.media_count) : "未知" },
    { label: "图片顺序", value: state(media?.order_status) },
    { label: "图片内容", value: "此历史回执仅保存数量和引用；请在同一实例核对图片。" },
  );
  if (fieldResult) fields.push(
    { label: "标题差异", value: state(record(content?.title)?.value_state) },
    { label: "正文差异", value: state(record(content?.body)?.value_state) },
    { label: "字段校验", value: state(content?.validation_status) },
    { label: "字段内容", value: "此历史回执仅保存匹配状态；请在同一实例核对必要字段。" },
  );
  fields.push(
    { label: "页面回读", value: state(page?.status) },
    { label: "页面路径", value: state(page?.route_state) },
    { label: "后置检查", value: state(record(data.post_check)?.status) },
    { label: "对账", value: state(record(data.reconciliation)?.status) },
    { label: "提交状态", value: data.submitted === false ? "未提交（submitted=false）" : "未知" },
    { label: "待处理", value: operation?.status === "unknown_outcome" ? "结果未知：查询同一 operation 并对账，禁止重放。" : recovery?.status === "not_required" ? "该回合无需恢复；继续前重新观察当前身份、经营对象、控制权和页面。" : "需要检查原 operation 或人工接管；保留已有结果。" },
  );
  return fields;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function text(value: unknown) { return typeof value === "string" && value.length > 0 ? value : undefined; }
function state(value: unknown): string {
  const labels: Record<string, string> = { observed: "已观察", matched: "与本次输入一致", mismatch: "不一致", mismatched: "不一致", passed: "通过", failed: "失败", skipped: "未检查", not_run: "未执行", not_applicable: "不适用", unknown: "未知" };
  return typeof value === "string" ? labels[value] ?? "未知" : "未知";
}

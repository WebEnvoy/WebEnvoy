import { ArrowUpRight, FileText, Image, Music2, Search, Video } from "lucide-react";
import { useMemo, useState } from "react";

import type { CoreRunResult, CoreRunResultState } from "./coreRunResultClient";
import type { LodeCatalogSkill } from "./lodeCatalogClient";
import { isOpaqueDetailRef } from "./resultDetailHandoff";
import type { RunProjection } from "./taskThreadFixtures";

type ResultField = { label: string; value: string };
type ResultAsset = { name: string; detail: string; state?: string };
type ResultRow = { id: string; cells: Record<string, string> };
type ResultSkill = Pick<LodeCatalogSkill, "outputKind" | "outputSchemaId" | "packageRef" | "version" | "lockRef">;
const emptyResultMessage = { tone: "neutral", title: "没有匹配数据", summary: "修改业务输入后可提交新的回合。" } as const;

export type BusinessResultPreviewRequest = { itemIds?: string[] };

export type StandardBusinessResult =
  | { kind: "collection"; columns: string[]; rows: ResultRow[]; total: number }
  | { kind: "object"; fields: ResultField[] }
  | { kind: "images"; items: ResultAsset[] }
  | { kind: "media"; items: Array<ResultAsset & { mediaKind: "audio" | "video" }> }
  | { kind: "files"; items: ResultAsset[] }
  | { kind: "generic"; fields: ResultField[]; resultKind?: string };

export function TaskBusinessResult({
  onOpenPreview,
  resultState,
  run,
  selectedItemIds,
  skills = [],
}: {
  onOpenPreview?: (request: BusinessResultPreviewRequest) => void;
  resultState: CoreRunResultState | { status: "fixture" };
  run: RunProjection;
  selectedItemIds?: string[];
  skills?: LodeCatalogSkill[];
}) {
  const unresolved = projectBusinessResultMessage(run, resultState);
  if (unresolved != null) return <ResultMessage {...unresolved} />;

  const model = projectStandardBusinessResult(run, resultState, skills);
  if (model.kind === "collection" && selectedItemIds != null) {
    const rows = model.rows.filter((row) => selectedItemIds.includes(row.id));
    return <CollectionResult model={{ ...model, rows, total: rows.length }} />;
  }
  if (model.kind === "collection") return <CollectionResult model={model} onOpenPreview={onOpenPreview} />;
  if (model.kind === "images") return <AssetGrid items={model.items} onOpenPreview={onOpenPreview} />;
  if (model.kind === "media") return <MediaResult items={model.items} onOpenPreview={onOpenPreview} />;
  if (model.kind === "files") return <FileResult items={model.items} onOpenPreview={onOpenPreview} />;
  return <ObjectResult fields={model.fields} resultKind={model.kind === "generic" ? model.resultKind : undefined} />;
}

export function projectStandardBusinessResult(
  run: RunProjection,
  state: CoreRunResultState | { status: "fixture" },
  skills: readonly ResultSkill[] = [],
): StandardBusinessResult {
  const result = state.status === "ready" ? state.result : undefined;
  if (run.writePrecheck != null) {
    return {
      kind: "object",
      fields: [
        { label: "状态", value: run.writePrecheck.submittedLabel ?? "未提交" },
        { label: "预期变化", value: run.writePrecheck.expectedChangeSummary },
        { label: "提交前", value: run.writePrecheck.beforeLabel },
        { label: "处理后", value: run.writePrecheck.afterLabel },
      ],
    };
  }
  const boundSkill = result == null ? undefined : findExactResultSkill(result, skills);
  const resultKind = boundSkill?.outputKind ?? result?.resultKind;
  const data = result?.data;
  if (data != null) {
    const normalized = nestedReadNormalizedResult(data) ?? (isRecord(data.normalized) ? data.normalized : data);
    if (boundSkill == null) return { kind: "generic", fields: objectFields(normalized), resultKind };
    const nestedReadCollection = nestedReadCollectionResult(data, boundSkill);
    if (nestedReadCollection != null) return nestedReadCollection;
    const assets = assetResult(data, resultKind);
    if (assets != null) return assets;
    const collection = collectionResult(data);
    if (collection != null) return collection;
    const fields = objectFields(normalized);
    return fields.length > 0 ? { kind: "object", fields } : { kind: "generic", fields: [], resultKind };
  }
  const fields = run.resultRows
    .filter((row) => !technicalResultLabels.has(row.label))
    .map((row) => ({ label: row.label, value: row.value }));
  return fields.length > 0 ? { kind: "object", fields } : { kind: "generic", fields: [], resultKind };
}

export function projectBusinessResultMessage(
  run: RunProjection,
  state: CoreRunResultState | { status: "fixture" },
): { tone: "neutral" | "warning" | "danger"; title: string; summary: string } | null {
  if (run.turnStatus === "cancelled") return { tone: "neutral", title: "已取消", summary: "本回合已停止，不会继续执行。" };
  if (run.turnStatus === "status_unknown" || run.outcome === "unknown") return { tone: "warning", title: "执行状态待确认", summary: "不会自动重复提交；请等待 Core 恢复明确状态。" };
  if (run.lifecycle === "queued") return { tone: "neutral", title: "等待执行", summary: "Core 已接收本回合，正在等待执行。" };
  if (run.lifecycle === "running") return { tone: "neutral", title: "正在生成结果", summary: "结果会在处理完成后显示。" };
  if (run.turnStatus === "waiting_for_user") return { tone: "warning", title: "等待本次决定", summary: "完成上方确认后继续处理当前动作。" };
  if (run.outcome === "empty") return emptyResultMessage;
  if (state.status === "ready") {
    const { envelopeState, payloadState } = state.result;
    if (state.result.data?.status === "empty" || state.result.failure?.code === "empty_result") return emptyResultMessage;
    if (state.result.unavailableReason === "run_not_terminal") return { tone: "neutral", title: "结果尚未生成", summary: "本回合仍在处理中。" };
    if (state.result.unavailableReason === "result_ref_missing") return { tone: "warning", title: "结果引用缺失", summary: "本回合已结束，但 Core 没有提供可读取的结果引用。" };
    if (state.result.unavailableReason != null) return { tone: "warning", title: "结果不可读取", summary: "Core 已将本回合结果标记为不可用。" };
    if (payloadState === "not_persisted_in_core") return { tone: "warning", title: "结果内容暂不可用", summary: "本回合已完成，但 Core 当前只保留结果引用，无法恢复业务内容。" };
    if (payloadState === "expired") return { tone: "warning", title: "结果已过期", summary: "保留回合终态，但结果内容已按保留策略过期。" };
    if (payloadState === "redacted" || envelopeState === "redacted") return { tone: "warning", title: "结果已隐藏", summary: "当前只保留脱敏摘要。" };
    if (payloadState === "access_denied") return { tone: "warning", title: "无法查看结果", summary: "当前身份没有查看此结果的权限。" };
    if (payloadState === "deleted_by_policy") return { tone: "neutral", title: "结果已移除", summary: "结果内容已按保留策略删除。" };
    if (state.result.outcome === "cancelled") return { tone: "neutral", title: "已取消", summary: "本回合没有生成业务结果。" };
    if (state.result.outcome === "unknown_outcome") return { tone: "warning", title: "结果状态未知", summary: "不会把旧结果当作本次成功。" };
    if (state.result.outcome === "failed" || state.result.outcome === "blocked") {
      if (/timeout|timed_out|deadline/i.test(state.result.failure?.code ?? "")) {
        return { tone: "danger", title: "执行超时", summary: state.result.failure?.recoveryHint ?? "可检查运行环境后提交新的回合。" };
      }
      return { tone: "danger", title: "未完成", summary: state.result.failure?.recoveryHint ?? recoverySummary(run) };
    }
  }
  if (run.outcome === "failure" || run.lifecycle === "blocked") {
    const summary = recoverySummary(run);
    return /timeout|timed out|超时/i.test(summary)
      ? { tone: "danger", title: "执行超时", summary }
      : { tone: "danger", title: "未完成", summary };
  }
  if (state.status === "loading") return { tone: "neutral", title: "正在读取结果", summary: "正在从 Core 获取本回合的公共结果。" };
  if (state.status === "unavailable") return { tone: "warning", title: "结果暂不可用", summary: state.summary };
  return null;
}

function ResultMessage({ tone, title, summary }: { tone: "neutral" | "warning" | "danger"; title: string; summary: string }) {
  return <section className={`business-result-message ${tone}`} aria-label={title}><strong>{title}</strong><p>{summary}</p></section>;
}

function CollectionResult({ model, onOpenPreview }: {
  model: Extract<StandardBusinessResult, { kind: "collection" }>;
  onOpenPreview?: (request: BusinessResultPreviewRequest) => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [visibleCount, setVisibleCount] = useState(5);
  const [status, setStatus] = useState("");
  const filtered = useMemo(() => model.rows.filter((row) => Object.values(row.cells).join(" ").toLocaleLowerCase().includes(query.toLocaleLowerCase())), [model.rows, query]);
  const visible = filtered.slice(0, visibleCount);
  const allVisibleSelected = visible.length > 0 && visible.every((row) => selected.includes(row.id));
  if (model.rows.length === 0) return <ResultMessage tone="neutral" title="没有匹配数据" summary="修改业务输入后可提交新的回合。" />;
  return (
    <section className="business-collection-result" aria-label="采集结果">
      <header className="business-result-toolbar">
        <label><Search size={14} /><input aria-label="筛选结果" placeholder="筛选" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        {onOpenPreview ? <button type="button" disabled={selected.length === 0} onClick={() => setStatus(exportCollectionRows(model, selected) ? `已导出 ${selected.length} 条。` : "当前环境无法导出。")}>导出选中{selected.length > 0 ? `（${selected.length}）` : ""}</button> : null}
      </header>
      <div className="business-result-table-wrap">
        <table className="business-result-table">
          <thead><tr>{onOpenPreview ? <th className="selection-cell"><input type="checkbox" aria-label="选择当前展示的全部数据" checked={allVisibleSelected} onChange={(event) => setSelected(event.target.checked ? Array.from(new Set([...selected, ...visible.map((row) => row.id)])) : selected.filter((id) => !visible.some((row) => row.id === id)))} /></th> : null}{model.columns.map((column) => <th key={column}>{column}</th>)}{onOpenPreview ? <th className="action-cell" aria-label="操作" /> : null}</tr></thead>
          <tbody>{visible.map((row) => <tr key={row.id}>{onOpenPreview ? <td className="selection-cell"><input type="checkbox" aria-label={`选择 ${row.cells[model.columns[0]!] ?? row.id}`} checked={selected.includes(row.id)} onChange={() => setSelected((current) => current.includes(row.id) ? current.filter((id) => id !== row.id) : [...current, row.id])} /></td> : null}{model.columns.map((column) => <td key={column}>{row.cells[column] ?? "—"}</td>)}{onOpenPreview ? <td className="action-cell"><button type="button" aria-label="在右栏预览" title="在右栏预览" data-workbench-open-right onClick={() => onOpenPreview({ itemIds: [row.id] })}><ArrowUpRight size={14} /></button></td> : null}</tr>)}</tbody>
        </table>
      </div>
      <footer className="business-result-footer">{visible.length < filtered.length ? <button type="button" onClick={() => setVisibleCount((count) => count + 5)}>共 {model.total} 条，点击查看更多</button> : <span>共 {model.total} 条</span>}{status ? <span role="status">{status}</span> : null}</footer>
    </section>
  );
}

function ObjectResult({ fields, resultKind }: { fields: ResultField[]; resultKind?: string }) {
  if (fields.length === 0) return <ResultMessage tone="neutral" title="已完成" summary={resultKind ? `已返回 ${resultKind} 结果，当前只有 owner 引用可用。` : "当前没有可展示的公共字段。"} />;
  return <section className="business-object-result" aria-label="结构化结果">{fields.map((field) => <div key={field.label}><span>{field.label}</span><strong>{field.value}</strong></div>)}</section>;
}

function AssetGrid({ items, onOpenPreview }: { items: ResultAsset[]; onOpenPreview?: (request: BusinessResultPreviewRequest) => void }) {
  return <section className={`business-image-result${onOpenPreview ? "" : " preview"}`} aria-label="图片结果">{items.map((item) => onOpenPreview ? <button type="button" key={`${item.name}-${item.detail}`} data-workbench-open-right onClick={() => onOpenPreview({})}><span><Image size={22} /></span><strong>{item.name}</strong><small>{item.detail}</small></button> : <article key={`${item.name}-${item.detail}`}><span><Image size={22} /></span><strong>{item.name}</strong><small>{item.detail}</small></article>)}</section>;
}

function MediaResult({ items, onOpenPreview }: { items: Array<ResultAsset & { mediaKind: "audio" | "video" }>; onOpenPreview?: (request: BusinessResultPreviewRequest) => void }) {
  return <section className="business-asset-list" aria-label="音视频结果">{items.map((item) => <div key={`${item.name}-${item.detail}`}>{item.mediaKind === "audio" ? <Music2 size={18} /> : <Video size={18} />}<span><strong>{item.name}</strong><small>{item.detail}</small></span>{onOpenPreview ? <button type="button" data-workbench-open-right onClick={() => onOpenPreview({})}>预览</button> : null}</div>)}</section>;
}

function FileResult({ items, onOpenPreview }: { items: ResultAsset[]; onOpenPreview?: (request: BusinessResultPreviewRequest) => void }) {
  return <section className="business-asset-list" aria-label="文件结果">{items.map((item) => <div key={`${item.name}-${item.detail}`}><FileText size={18} /><span><strong>{item.name}</strong><small>{item.detail}</small></span>{item.state ? <em>{item.state}</em> : null}{onOpenPreview ? <button type="button" data-workbench-open-right onClick={() => onOpenPreview({})}>查看</button> : null}</div>)}</section>;
}

function nestedReadCollectionResult(data: Record<string, unknown>, skill: ResultSkill): StandardBusinessResult | null {
  if (
    skill.packageRef !== `lode://site-capability/xiaohongshu/search-notes@${skill.version}` ||
    skill.outputSchemaId !== `lode://schema/site-capability/xiaohongshu/search-notes/output@${skill.version}`
  ) return null;
  const projection = isRecord(data.projection) ? data.projection : undefined;
  const normalized = projection != null && isRecord(projection.normalized) ? projection.normalized : undefined;
  const summary = normalized != null && isRecord(normalized.public_summary) ? normalized.public_summary : undefined;
  if (
    summary == null ||
    summary.operation_id !== "xhs_search_notes" ||
    summary.result_kind !== "xiaohongshu_search_notes_surface" ||
    summary.surface !== "search_result"
  ) return unavailableSearchCollection();
  const detailRefs = summary.detail_refs;
  if (
    !Array.isArray(detailRefs) ||
    detailRefs.length < 1 ||
    detailRefs.length > 15 ||
    !detailRefs.every(isOpaqueDetailRef) ||
    new Set(detailRefs).size !== detailRefs.length
  ) return unavailableSearchCollection();
  if (summary.schema_version === "harbor-read-operation-public-summary/v0") {
    if ("items" in summary || numberField(summary, "result_count") !== detailRefs.length) return unavailableSearchCollection();
    return {
      kind: "object",
      fields: [{ label: "历史结果", value: "此回合仅保留旧版结果引用，无法恢复标题、作者和互动信息。" }],
    };
  }
  if (summary.schema_version !== "harbor-read-operation-public-summary/v1") return unavailableSearchCollection();
  if (!Array.isArray(summary.items) || summary.items.length !== detailRefs.length) return unavailableSearchCollection();
  const rows: ResultRow[] = [];
  for (const [index, item] of summary.items.entries()) {
    if (
      !isRecord(item) ||
      !Object.keys(item).every((key) => ["detail_ref", "title", "author_display_name", "interaction_metrics"].includes(key)) ||
      item.detail_ref !== detailRefs[index] ||
      !publicText(item.title, 200) ||
      ("author_display_name" in item && !publicText(item.author_display_name, 100)) ||
      !validInteractionMetrics(item.interaction_metrics)
    ) return unavailableSearchCollection();
    rows.push({
      id: detailRefs[index]!,
      cells: {
        "标题": item.title,
        "作者": publicText(item.author_display_name, 100) ? item.author_display_name : "—",
        "互动": interactionSummary(item.interaction_metrics),
      },
    });
  }
  const total = numberField(summary, "result_count");
  if (total !== rows.length) return unavailableSearchCollection();
  return {
    kind: "collection",
    columns: ["标题", "作者", "互动"],
    rows,
    total,
  };
}

function unavailableSearchCollection(): StandardBusinessResult {
  return {
    kind: "object",
    fields: [{ label: "结果不可用", value: "Core 返回的搜索卡片不完整，已停止展示。" }],
  };
}

function interactionSummary(value: unknown) {
  if (!isRecord(value)) return "—";
  const entries = [
    ["赞", value.likes],
    ["评论", value.comments],
    ["收藏", value.collects],
  ].flatMap(([label, count]) => publicText(count, 40) ? [`${label} ${count}`] : []);
  return entries.join(" · ") || "—";
}

function validInteractionMetrics(value: unknown) {
  if (value === undefined) return true;
  return isRecord(value) &&
    Object.keys(value).length > 0 &&
    Object.keys(value).every((key) => ["likes", "comments", "collects"].includes(key)) &&
    Object.values(value).every((count) => publicText(count, 40));
}

function publicText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
}

function nestedReadNormalizedResult(data: Record<string, unknown>) {
  const projection = isRecord(data.projection) ? data.projection : undefined;
  const normalized = projection != null && isRecord(projection.normalized) ? projection.normalized : undefined;
  const summary = normalized != null && isRecord(normalized.public_summary) ? normalized.public_summary : undefined;
  return summary != null && isRecord(summary.normalized) ? summary.normalized : undefined;
}

function collectionResult(data: Record<string, unknown>): StandardBusinessResult | null {
  const containers = [data, isRecord(data.normalized) ? data.normalized : undefined]
    .filter((value): value is Record<string, unknown> => value != null);
  const entry = containers.flatMap((container) => collectionKeys.flatMap((key) =>
    Array.isArray(container[key]) ? [[container, container[key]] as const] : [],
  )).find(([, value]) => value.every((item) => isRecord(item)));
  if (entry == null) return null;
  const [container, values] = entry;
  const records = values as Record<string, unknown>[];
  const columns = Array.from(new Set(records.flatMap((record) => Object.keys(record).filter((key) => scalar(record[key]))))).slice(0, 6);
  const rows = records.map((record, index) => ({ id: String(record.id ?? record.ref ?? index), cells: Object.fromEntries(columns.map((column) => [column, displayValue(record[column])])) }));
  const total = numberField(container, "total_count", "result_count", "total", "count") ?? numberField(data, "total_count", "result_count", "total", "count") ?? rows.length;
  return { kind: "collection", columns, rows, total };
}

function findExactResultSkill(result: CoreRunResult, skills: readonly ResultSkill[]) {
  if (result.packageRef == null || result.capabilityVersion == null || result.capabilityLockRef == null || result.outputSchemaId == null) return undefined;
  return skills.find((skill) =>
    skill.packageRef === result.packageRef && skill.version === result.capabilityVersion &&
    skill.lockRef === result.capabilityLockRef && skill.outputSchemaId === result.outputSchemaId,
  );
}

function numberField(value: Record<string, unknown>, ...keys: string[]) {
  const match = keys.map((key) => value[key]).find((item): item is number => typeof item === "number");
  return match;
}

function exportCollectionRows(model: Extract<StandardBusinessResult, { kind: "collection" }>, selectedIds: string[]) {
  if (typeof URL.createObjectURL !== "function") return false;
  const rows = model.rows.filter((row) => selectedIds.includes(row.id));
  if (rows.length === 0) return false;
  const csv = [model.columns, ...rows.map((row) => model.columns.map((column) => row.cells[column] ?? ""))]
    .map((row) => row.map(csvCell).join(","))
    .join("\n");
  const href = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = "webenvoy-results.csv";
  anchor.click();
  URL.revokeObjectURL(href);
  return true;
}

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function assetResult(data: Record<string, unknown>, resultKind?: string): StandardBusinessResult | null {
  const hint = resultKind ?? "";
  const candidates = [data, isRecord(data.normalized) ? data.normalized : undefined]
    .filter((value): value is Record<string, unknown> => value != null)
    .flatMap((container) => Object.entries(container).filter(([, value]) => Array.isArray(value)));
  const match = (pattern: RegExp) => candidates.find(([key]) => pattern.test(key))?.[1] as unknown[] | undefined;
  const hintedItems = match(/^(?:assets|items)$/i);
  const images = match(/image|photo|picture/i) ?? (/image|photo/i.test(hint) ? hintedItems : undefined);
  if (images) return { kind: "images", items: assetItems(images) };
  const media = match(/audio|video|media/i) ?? (/audio|video|media/i.test(hint) ? hintedItems : undefined);
  if (media) return { kind: "media", items: assetItems(media).map((item) => ({ ...item, mediaKind: /audio/i.test(`${hint} ${item.name} ${item.detail}`) ? "audio" : "video" })) };
  const files = match(/file|attachment|download/i) ?? (/file|attachment|download/i.test(hint) ? hintedItems : undefined);
  if (files) return { kind: "files", items: assetItems(files) };
  return null;
}

function assetItems(values: unknown[]): ResultAsset[] {
  return values.slice(0, 100).map((value, index) => {
    if (typeof value === "string") return { name: value, detail: "owner 管理的结果" };
    const record = isRecord(value) ? value : {};
    return {
      name: String(record.name ?? record.title ?? record.label ?? `结果 ${index + 1}`),
      detail: [record.type, record.size, record.duration].filter(scalar).map(String).join(" · ") || "owner 管理的结果",
      ...(scalar(record.status) ? { state: String(record.status) } : {}),
    };
  });
}

function objectFields(data: Record<string, unknown>): ResultField[] {
  return Object.entries(data).slice(0, 50).map(([label, value]) => ({ label, value: displayValue(value) }));
}

function displayValue(value: unknown): string {
  if (value == null) return "—";
  if (scalar(value)) return String(value);
  if (Array.isArray(value)) return `${value.length} 项`;
  if (isRecord(value)) return `${Object.keys(value).length} 个字段`;
  return "—";
}

function scalar(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recoverySummary(run: RunProjection) {
  return run.failureRecovery?.reason ?? run.failureRecovery?.nextActions[0] ?? run.summary;
}

const technicalResultLabels = new Set([
  "Run status", "Result kind", "Payload state", "Post-check", "执行现场", "Runtime session", "Viewer ref",
  "回合序号", "状态", "创建渠道", "失败代码",
]);

const collectionKeys = ["items", "rows", "results", "notes", "jobs", "products", "records"];

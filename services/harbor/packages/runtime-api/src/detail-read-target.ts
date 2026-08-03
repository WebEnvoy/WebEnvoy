import { opaqueRef } from "./refs.js";
import type { AllowlistedReadOperationId, AllowlistedReadOperationSite, LocalProviderReadProbeDetailTarget } from "./runtime-session-types.js";

export type DetailReadFailureClass = "detail_ref_invalid" | "detail_ref_missing" | "detail_ref_expired" | "detail_ref_consumed" | "detail_ref_binding_mismatch";

export interface DetailReadTargetRecord {
  detail_ref: string;
  runtime_session_ref: string;
  site_id: AllowlistedReadOperationSite;
  detail_operation_id: "xhs_read_note_detail" | "boss_read_job_detail";
  canonical_url: string;
  expires_at: number;
  consumed: boolean;
}

const DETAIL_REF_TTL_MS = 10 * 60 * 1000;
const DETAIL_REF_TOMBSTONE_LIMIT = 4096;

interface DetailReadTombstone {
  failure: "detail_ref_expired" | "detail_ref_consumed";
  expires_at: number;
}

export class DetailReadTargetStore {
  private readonly records = new Map<string, DetailReadTargetRecord>();
  private readonly tombstones = new Map<string, DetailReadTombstone>();

  register(input: {
    runtime_session_ref: string;
    site_id: AllowlistedReadOperationSite;
    search_operation_id: "xhs_search_notes" | "boss_job_search";
    targets: readonly LocalProviderReadProbeDetailTarget[];
    now?: number;
  }): string[] {
    const now = input.now ?? Date.now();
    this.pruneTombstones(now);
    const detail_operation_id = input.search_operation_id === "xhs_search_notes" ? "xhs_read_note_detail" : "boss_read_job_detail";
    const refs: string[] = [];
    for (const target of input.targets.slice(0, 15)) {
      if (!isCanonicalDetailUrl(input.site_id, target.canonical_url)) continue;
      const detail_ref = opaqueRef("detail_ref");
      this.records.set(detail_ref, {
        detail_ref,
        runtime_session_ref: input.runtime_session_ref,
        site_id: input.site_id,
        detail_operation_id,
        canonical_url: target.canonical_url,
        expires_at: now + DETAIL_REF_TTL_MS,
        consumed: false
      });
      const expiry = setTimeout(() => {
        if (this.records.delete(detail_ref)) this.addTombstone(detail_ref, "detail_ref_expired", Date.now());
      }, DETAIL_REF_TTL_MS);
      expiry.unref();
      refs.push(detail_ref);
    }
    return refs;
  }

  consume(input: {
    detail_ref: string;
    runtime_session_ref: string;
    site_id: AllowlistedReadOperationSite;
    operation_id: AllowlistedReadOperationId;
    now?: number;
  }): DetailReadTargetRecord | DetailReadFailureClass {
    const now = input.now ?? Date.now();
    this.pruneTombstones(now);
    if (!/^detail_ref_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.detail_ref)) return "detail_ref_invalid";
    const tombstone = this.tombstones.get(input.detail_ref);
    if (tombstone) return tombstone.failure;
    const record = this.records.get(input.detail_ref);
    if (!record) return "detail_ref_missing";
    if (record.expires_at <= now) {
      this.records.delete(input.detail_ref);
      this.addTombstone(input.detail_ref, "detail_ref_expired", now);
      return "detail_ref_expired";
    }
    if (record.runtime_session_ref !== input.runtime_session_ref || record.site_id !== input.site_id || record.detail_operation_id !== input.operation_id) return "detail_ref_binding_mismatch";
    this.records.delete(input.detail_ref);
    this.addTombstone(input.detail_ref, "detail_ref_consumed", now);
    return { ...record, consumed: true };
  }

  restoreAfterRetryableFailure(record: DetailReadTargetRecord, now = Date.now()): boolean {
    if (!record.consumed || record.expires_at <= now || this.records.has(record.detail_ref)) return false;
    if (this.tombstones.get(record.detail_ref)?.failure !== "detail_ref_consumed") return false;
    this.tombstones.delete(record.detail_ref);
    this.records.set(record.detail_ref, { ...record, consumed: false });
    return true;
  }

  clearSession(runtimeSessionRef: string, now = Date.now()): void {
    this.pruneTombstones(now);
    for (const [detailRef, record] of this.records) {
      if (record.runtime_session_ref !== runtimeSessionRef) continue;
      this.records.delete(detailRef);
      this.addTombstone(detailRef, "detail_ref_expired", now);
    }
  }

  private addTombstone(detailRef: string, failure: DetailReadTombstone["failure"], now: number): void {
    this.tombstones.delete(detailRef);
    this.tombstones.set(detailRef, { failure, expires_at: now + DETAIL_REF_TTL_MS });
    while (this.tombstones.size > DETAIL_REF_TOMBSTONE_LIMIT) {
      const oldest = this.tombstones.keys().next().value as string | undefined;
      if (!oldest) break;
      this.tombstones.delete(oldest);
    }
  }

  private pruneTombstones(now: number): void {
    for (const [detailRef, tombstone] of this.tombstones) {
      if (tombstone.expires_at > now) continue;
      this.tombstones.delete(detailRef);
    }
  }
}

export function isCanonicalDetailUrl(siteId: AllowlistedReadOperationSite, value: string): boolean {
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) return false;
  if (siteId === "xiaohongshu") {
    return url.origin === "https://www.xiaohongshu.com" && /^\/explore\/[a-f0-9]{24}$/i.test(url.pathname) &&
      [...url.searchParams.keys()].every((key) => key === "xsec_token" || key === "xsec_source") &&
      url.searchParams.getAll("xsec_token").length <= 1 && url.searchParams.getAll("xsec_source").length <= 1;
  }
  return url.origin === "https://www.zhipin.com" && /^\/job_detail\/[A-Za-z0-9_-]+\.html$/.test(url.pathname) && !url.search;
}

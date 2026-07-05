import { inferFailureAttribution, normalizeFailureRecord, type FailureAttribution } from "./failure-attribution.js";
import { projectRunSummary, type RunPostCheckSummary, type RunSummary } from "./run-query.js";
import type { FailureRecord, FileRunRecordStore, RunRecord } from "./run-record-store.js";

export const capabilityRunQuerySchemaVersion = "webenvoy.capability-run-query.v0";

export type CapabilityRunQueryFilter = {
  capability_ref: string;
  capability_version?: string;
  capability_source_ref?: string;
  package_ref?: string;
  limit?: number;
};

export type CapabilityFailureSummary = {
  run_id: string;
  status: RunRecord["status"];
  updated_at: string;
  failure: FailureRecord;
  post_check?: RunPostCheckSummary;
};

export type CapabilityRunQueryEnvelope = {
  schema_version: typeof capabilityRunQuerySchemaVersion;
  capability_ref: string;
  capability_version?: string;
  capability_source_ref?: string;
  package_ref?: string;
  total_runs: number;
  returned_runs: number;
  status_counts: Partial<Record<RunRecord["status"], number>>;
  failure_attribution_counts: Record<FailureAttribution, number>;
  latest_run?: RunSummary;
  latest_failure?: CapabilityFailureSummary;
  runs: RunSummary[];
};

export type CapabilityRunQueryResult =
  | {
      ok: true;
      capability_runs: CapabilityRunQueryEnvelope;
    }
  | {
      ok: false;
      failure: FailureRecord;
    };

function queryFailure(code: string, recoveryHint: string): FailureRecord {
  return {
    category: "request_invalid",
    code,
    phase: "query",
    recovery_hint: recoveryHint,
    attribution: "input"
  };
}

function matchesFilter(record: RunRecord, filter: CapabilityRunQueryFilter): boolean {
  return (
    record.capability_ref === filter.capability_ref &&
    (filter.capability_version === undefined || record.capability_version === filter.capability_version) &&
    (filter.capability_source_ref === undefined || record.capability_source_ref === filter.capability_source_ref) &&
    (filter.package_ref === undefined || record.package_ref === filter.package_ref)
  );
}

function byMostRecent(left: RunRecord, right: RunRecord): number {
  const updated = right.updated_at.localeCompare(left.updated_at);
  return updated === 0 ? right.run_id.localeCompare(left.run_id) : updated;
}

function countStatuses(records: readonly RunRecord[]): Partial<Record<RunRecord["status"], number>> {
  const counts: Partial<Record<RunRecord["status"], number>> = {};
  for (const record of records) {
    counts[record.status] = (counts[record.status] ?? 0) + 1;
  }
  return counts;
}

function emptyAttributionCounts(): Record<FailureAttribution, number> {
  return {
    capability: 0,
    input: 0,
    runtime: 0,
    site: 0,
    evidence: 0,
    unknown: 0
  };
}

function countFailureAttributions(records: readonly RunRecord[]): Record<FailureAttribution, number> {
  const counts = emptyAttributionCounts();
  for (const record of records) {
    if (record.failure) {
      counts[inferFailureAttribution(record.failure)] += 1;
    }
  }
  return counts;
}

function latestFailure(records: readonly RunRecord[]): CapabilityFailureSummary | undefined {
  const record = records.find((entry) => entry.failure !== undefined);
  if (!record?.failure) {
    return undefined;
  }
  const terminalSummary = projectRunSummary(record).terminal_summary;
  return {
    run_id: record.run_id,
    status: record.status,
    updated_at: record.updated_at,
    failure: normalizeFailureRecord(record.failure),
    ...(terminalSummary?.post_check === undefined ? {} : { post_check: terminalSummary.post_check })
  };
}

export async function getCapabilityRunSummary(store: FileRunRecordStore, filter: CapabilityRunQueryFilter): Promise<CapabilityRunQueryResult> {
  if (!filter.capability_ref) {
    return {
      ok: false,
      failure: queryFailure("capability_ref_required", "fix_input")
    };
  }

  const requestedLimit = filter.limit === undefined || !Number.isFinite(filter.limit) ? 20 : filter.limit;
  const limit = Math.max(0, Math.min(Math.trunc(requestedLimit), 100));
  const matching = (await store.listRunRecords()).filter((record) => matchesFilter(record, filter)).sort(byMostRecent);
  const runs = matching.slice(0, limit).map(projectRunSummary);
  const failure = latestFailure(matching);
  return {
    ok: true,
    capability_runs: {
      schema_version: capabilityRunQuerySchemaVersion,
      capability_ref: filter.capability_ref,
      ...(filter.capability_version === undefined ? {} : { capability_version: filter.capability_version }),
      ...(filter.capability_source_ref === undefined ? {} : { capability_source_ref: filter.capability_source_ref }),
      ...(filter.package_ref === undefined ? {} : { package_ref: filter.package_ref }),
      total_runs: matching.length,
      returned_runs: runs.length,
      status_counts: countStatuses(matching),
      failure_attribution_counts: countFailureAttributions(matching),
      ...(runs[0] === undefined ? {} : { latest_run: runs[0] }),
      ...(failure === undefined ? {} : { latest_failure: failure }),
      runs
    }
  };
}

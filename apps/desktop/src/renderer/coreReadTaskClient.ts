import type { OutcomeKind, OwnerSource, RunProjection, TaskProjection } from "./taskThreadFixtures";
import { fixtureOrDemoPayloadReason } from "./ownerPayloadGuards";
import { requestOwnerJson } from "./ownerApiClient";

type CoreReadStatus = "loading" | "ready" | "offline";
type JsonRecord = Record<string, unknown>;

export type CoreReadCapability = {
  capabilityRef: string;
  capabilityVersion: string;
  packageRef: string;
};

export type CoreReadTaskSpec = {
  taskId: string;
  mode: "read" | "write-precheck";
  packageName: string;
  packageVersion: string;
  capabilities: CoreReadCapability[];
  resourceRequirementRefs: string[];
  resourceRequirementProfileId: string;
  evidencePolicyRef: string;
  boundary: string;
};

type CoreRunStatus =
  | "pending"
  | "admitted"
  | "running"
  | "succeeded"
  | "failed"
  | "blocked"
  | "requires_user_action"
  | "manual_recovery_required"
  | "unknown_outcome"
  | "cancelled"
  | "expired";

type CoreRunSummary = {
  run_id: string;
  status: CoreRunStatus;
  timeline?: { updated_at?: string; terminal_at?: string };
  task?: {
    capability_ref?: string;
    capability_version?: string;
    capability_source_ref?: string;
    capability_lock_ref?: string;
    package_ref?: string;
  };
  admission?: {
    action_risk?: string;
  };
  runtime_refs?: {
    session_binding?: {
      runtime_session_ref?: string;
      identity_environment_ref?: string;
      control_owner?: string;
      lifecycle_state?: string;
      session_use?: string;
    };
  };
  terminal_summary?: {
    result_ref?: string;
    post_check?: { status?: string; summary?: string };
    failure?: { code?: string; category?: string; phase?: string; recovery_hint?: string };
  };
};

type CoreEvidenceRef = {
  ref: string;
  source?: string;
  state?: string;
  raw_access?: string;
  recorded_at?: string;
  runtime_session_ref?: string;
  consumer_boundary?: string;
};

type CoreResultEnvelope = {
  result?: {
    envelope_state?: string;
    payload_state?: string;
    unavailable_reason?: string;
    result_ref?: string;
    result_envelope?: {
      result_kind?: string;
      result_ref?: string;
      package_ref?: string;
      source_refs?: string[];
      evidence_refs?: string[];
      preview_result?: CorePreviewResult;
      post_check?: { ref?: string; post_check_ref?: string; status?: string; summary?: string };
      failure?: { code?: string; category?: string; phase?: string; recovery_hint?: string };
    };
    preview_result?: CorePreviewResult;
  };
  failure?: { code?: string; category?: string; phase?: string; recovery_hint?: string };
  evidence_refs?: CoreEvidenceRef[];
};

type CoreResultEnvelopeBody = NonNullable<NonNullable<CoreResultEnvelope["result"]>["result_envelope"]>;

type CorePreviewState = "available" | "preview_unavailable" | "page_changed" | "user_cancelled" | "expired";

type CorePreviewResult = {
  state?: string;
  submitted?: boolean;
  expected_change?: {
    change_kind?: string;
    target_ref?: string;
    summary?: string;
    external_submit?: boolean;
  };
  action_refs?: {
    action_request_id?: string;
  };
  capability?: {
    capability_ref?: string;
    capability_version?: string;
    capability_source_ref?: string;
    capability_lock_ref?: string;
    package_ref?: string;
  };
  evidence_refs?: string[];
  failure_class?: string;
  consumer_boundary?: string;
};

type CoreFailureEnvelope = {
  reason_class?: string;
  app_action?: string;
  retryable?: boolean;
  failure?: { code?: string; category?: string; phase?: string; recovery_hint?: string };
};

type CoreSessionRefsEnvelope = {
  session_refs?: {
    runtime_session_ref?: string;
    identity_environment_ref?: string;
    control_owner?: string;
    lifecycle_state?: string;
    session_use?: string;
  };
};

type CoreRefKind = "session" | "source" | "evidence" | "post-check" | "result";

export type CoreReadTaskLoadState = {
  status: CoreReadStatus;
  endpoint: string;
  fetchedAt: string;
  summary: string;
  tasks: TaskProjection[];
  liveTaskIds: string[];
};

const coreLiveSource: OwnerSource = "Core live";

export const coreReadTaskSpecs: CoreReadTaskSpec[] = [
  {
    taskId: "task-xhs-real-read",
    mode: "read",
    packageName: "@lode/xiaohongshu-read-only",
    packageVersion: "0.1.0",
    capabilities: [
      {
        capabilityRef: "lode:capability/search-notes",
        capabilityVersion: "0.1.0",
        packageRef: "lode://site-capability/xiaohongshu/search-notes@0.1.0",
      },
      {
        capabilityRef: "lode:capability/read-note-detail",
        capabilityVersion: "0.1.0",
        packageRef: "lode://site-capability/xiaohongshu/read-note-detail@0.1.0",
      },
    ],
    resourceRequirementRefs: ["xiaohongshu.search-notes.resources"],
    resourceRequirementProfileId: "search-notes-logged-in-ready-page",
    evidencePolicyRef: "evidence-policy:refs-only",
    boundary: "Core owner API 返回 run/result/evidence refs；App 不读取 raw evidence、DOM、截图正文、Cookie、token 或 profile storage。",
  },
  {
    taskId: "task-boss-real-read",
    mode: "read",
    packageName: "@lode/boss-read-only",
    packageVersion: "0.1.0",
    capabilities: [
      {
        capabilityRef: "lode:capability/job-search",
        capabilityVersion: "0.1.0",
        packageRef: "lode://site-capability/boss/job-search@0.1.0",
      },
      {
        capabilityRef: "lode:capability/read-job-detail",
        capabilityVersion: "0.1.0",
        packageRef: "lode://site-capability/boss/read-job-detail@0.1.0",
      },
    ],
    resourceRequirementRefs: ["boss.job-search.resources"],
    resourceRequirementProfileId: "job-search-logged-in-ready-page",
    evidencePolicyRef: "evidence-policy:refs-only",
    boundary: "Core owner API 只暴露 BOSS 只读 run/result/evidence refs；App 不打招呼、不投递、不保存聊天或简历材料。",
  },
  {
    taskId: "task-xhs-publish-write-preview",
    mode: "write-precheck",
    packageName: "@lode/xiaohongshu-write-pre-preview",
    packageVersion: "0.1.0",
    capabilities: [
      {
        capabilityRef: "lode:capability/xiaohongshu-draft-precheck",
        capabilityVersion: "0.1.0",
        packageRef: "lode://site-capability/xiaohongshu/draft-precheck@0.1.0",
      },
    ],
    resourceRequirementRefs: ["xiaohongshu.publish-note-precheck.resources"],
    resourceRequirementProfileId: "xhs-creator-publish-page-precheck",
    evidencePolicyRef: "evidence-policy:refs-only",
    boundary: "Core owner API 返回小红书写前验证 run/result/evidence refs；App 只展示 expected_change、approval state 和 owner submitted 状态，不点击发布。",
  },
  {
    taskId: "task-boss-greeting-write-preview",
    mode: "write-precheck",
    packageName: "@lode/boss-greeting-write-pre-preview",
    packageVersion: "0.1.0",
    capabilities: [
      {
        capabilityRef: "lode:capability/boss-greeting-precheck",
        capabilityVersion: "0.1.0",
        packageRef: "lode://site-capability/boss/greeting-precheck@0.1.0",
      },
    ],
    resourceRequirementRefs: ["boss.greet-precheck.resources"],
    resourceRequirementProfileId: "boss-greet-target-precheck",
    evidencePolicyRef: "evidence-policy:refs-only",
    boundary: "Core owner API 返回 BOSS 打招呼写前验证 refs；App 只展示消息框预览、风险状态和 owner submitted 状态，不发送消息。",
  },
];

export function coreReadTaskStateFromFallback(endpoint: string, tasks: TaskProjection[]): CoreReadTaskLoadState {
  return {
    status: "loading",
    endpoint,
    fetchedAt: "pending",
    summary: "正在读取 Core capability-runs、run result、evidence refs、failure refs 和 write-precheck refs。",
    tasks,
    liveTaskIds: [],
  };
}

export async function fetchCoreReadTaskState(
  endpoint: string,
  fallbackTasks: TaskProjection[],
): Promise<CoreReadTaskLoadState> {
  const fetchedAt = new Date().toISOString();
  const projectedTasks: TaskProjection[] = [];
  const errors: string[] = [];

  for (const spec of coreReadTaskSpecs) {
    const fallbackTask = fallbackTasks.find((task) => task.id === spec.taskId);
    if (!fallbackTask) continue;
    const projected = await fetchCoreReadTask(endpoint, spec, fallbackTask, fetchedAt);
    if (projected.ok) {
      projectedTasks.push(projected.task);
    } else {
      errors.push(projected.error);
    }
  }

  if (projectedTasks.length === 0) {
    return {
      status: "offline",
      endpoint,
      fetchedAt,
      summary: `Core endpoint 未返回可消费的真实 run projection；继续显示本地 fallback。${errors[0] ? ` ${errors[0]}` : ""}`,
      tasks: fallbackTasks,
      liveTaskIds: [],
    };
  }

  const liveById = new Map(projectedTasks.map((task) => [task.id, task]));
  return {
    status: "ready",
    endpoint,
    fetchedAt,
    summary: `已读取 ${projectedTasks.length} 个 Core 真实任务 projection；结果正文、写前验证和证据仍由 owner refs 承接。`,
    tasks: fallbackTasks.map((task) => liveById.get(task.id) ?? task),
    liveTaskIds: projectedTasks.map((task) => task.id),
  };
}

async function fetchCoreReadTask(
  endpoint: string,
  spec: CoreReadTaskSpec,
  fallbackTask: TaskProjection,
  fetchedAt: string,
): Promise<{ ok: true; task: TaskProjection } | { ok: false; error: string }> {
  const projectedRuns: Array<{ run: RunProjection; updatedAt: string }> = [];
  const errors: string[] = [];

  for (const capability of spec.capabilities) {
    const result = await fetchCapabilityRuns(endpoint, capability, spec);
    if (result.ok) {
      projectedRuns.push(...result.runs);
    } else {
      errors.push(result.error);
    }
  }

  if (projectedRuns.length === 0) {
    return { ok: false, error: errors[0] ?? `${spec.taskId} returned no runs` };
  }

  const seen = new Set<string>();
  const runs = projectedRuns
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .flatMap(({ run }) => {
      if (seen.has(run.id)) return [];
      seen.add(run.id);
      return [run];
    });

  return {
    ok: true,
    task: {
      ...fallbackTask,
      source: coreLiveSource,
      packageSource: {
        ...fallbackTask.packageSource,
        name: spec.packageName,
        version: spec.packageVersion,
        capabilityRef: spec.capabilities.map((capability) => capability.capabilityRef).join(" + "),
        sourceRef: spec.capabilities.map((capability) => capability.packageRef).join(" + "),
        lockRef: fallbackTask.packageSource.lockRef?.replace(/0\.[23]\.0/g, spec.packageVersion),
        fetchedAt,
        source: coreLiveSource,
        boundary: spec.boundary,
      },
      runs,
    },
  };
}

async function fetchCapabilityRuns(
  endpoint: string,
  capability: CoreReadCapability,
  spec: CoreReadTaskSpec,
): Promise<{ ok: true; runs: Array<{ run: RunProjection; updatedAt: string }> } | { ok: false; error: string }> {
  const params = new URLSearchParams({
    capability_ref: capability.capabilityRef,
    capability_version: capability.capabilityVersion,
    package_ref: capability.packageRef,
    limit: "8",
  });
  const response = await requestJson(endpoint, `/capability-runs?${params.toString()}`);
  const body = okPayload(response, "capability_runs");
  const fixtureReason = fixtureOrDemoPayloadReason(body ?? response);
  if (fixtureReason) {
    return { ok: false, error: `${capability.capabilityRef} returned fixture/demo/smoke payload: ${fixtureReason}` };
  }
  const runsValue = body == null ? [] : arrayValue(body.runs);
  const latestRun = body == null ? null : recordValue(body.latest_run);
  const runSummaries = runsValue.length > 0 ? runsValue : latestRun == null ? [] : [latestRun];

  if (runSummaries.length === 0) {
    return { ok: false, error: `${capability.capabilityRef} has no runs` };
  }

  const projections = await Promise.all(
    runSummaries.map((item, index) => {
      const run = coreRunSummary(item);
      return run == null
        ? ({ ok: false, error: `${capability.capabilityRef} run ${index + 1} returned invalid summary` } as const)
        : fetchRunProjection(endpoint, run, spec);
    }),
  );
  const failures = projections.flatMap((projection) => (projection.ok ? [] : [projection.error]));
  const runs = projections.flatMap((projection) => (projection.ok ? [projection.projection] : []));

  if (failures.length > 0) {
    return { ok: false, error: failures[0] };
  }

  if (runs.length === 0) {
    return { ok: false, error: `${capability.capabilityRef} has no readable run details` };
  }

  return { ok: true, runs };
}

async function fetchRunProjection(
  endpoint: string,
  run: CoreRunSummary,
  spec: CoreReadTaskSpec,
): Promise<{ ok: true; projection: { run: RunProjection; updatedAt: string } } | { ok: false; error: string }> {
  const runId = encodeURIComponent(run.run_id);
  const [resultResponse, evidenceResponse, failureResponse, sessionResponse] = await Promise.all([
    requestJson(endpoint, `/runs/${runId}/result`),
    requestJson(endpoint, `/runs/${runId}/evidence-refs`),
    requestJson(endpoint, `/runs/${runId}/failure`),
    requestJson(endpoint, `/runs/${runId}/session-refs`),
  ]);
  const resultPayload = requiredOkPayload(resultResponse, "result", `/runs/${runId}/result`);
  const evidencePayload = requiredOkPayload(evidenceResponse, "evidence", `/runs/${runId}/evidence-refs`);
  const failurePayload = requiredOkPayload(failureResponse, "failure_reason", `/runs/${runId}/failure`);
  const sessionPayload = requiredOkPayload(sessionResponse, "session_refs", `/runs/${runId}/session-refs`);
  if (!resultPayload.ok) return { ok: false, error: resultPayload.error };
  if (!evidencePayload.ok) return { ok: false, error: evidencePayload.error };
  if (!failurePayload.ok) return { ok: false, error: failurePayload.error };
  if (!sessionPayload.ok) return { ok: false, error: sessionPayload.error };

  const result = resultPayload.payload as CoreResultEnvelope;
  const evidence = evidencePayload.payload;
  const failure = failurePayload.payload as CoreFailureEnvelope;
  const session = sessionPayload.payload as CoreSessionRefsEnvelope;
  const fixtureReason = fixtureOrDemoPayloadReason({ run, result, evidence, failure, session });
  if (fixtureReason) {
    return { ok: false, error: `/runs/${runId} returned fixture/demo/smoke payload: ${fixtureReason}` };
  }
  const envelope = result?.result?.result_envelope;
  const refReason = coreProjectionRefReason(run, result, evidence, session, envelope);
  if (refReason) {
    return { ok: false, error: `/runs/${runId} returned invalid typed ref: ${refReason}` };
  }
  const isWritePrecheck = spec.mode === "write-precheck";
  const previewResult = corePreviewResult(envelope?.preview_result ?? result?.result?.preview_result);
  const postCheck = run.terminal_summary?.post_check ?? envelope?.post_check;
  const runtimeSessionRefFromSession =
    session?.session_refs?.runtime_session_ref ??
    run.runtime_refs?.session_binding?.runtime_session_ref;
  const objectEvidenceRefs = coreEvidenceRefs(evidence?.evidence_refs).length > 0
    ? coreEvidenceRefs(evidence?.evidence_refs)
    : coreEvidenceRefs(result?.evidence_refs);
  const resultEvidenceRefs = objectEvidenceRefs.length > 0
    ? objectEvidenceRefs
    : envelopeEvidenceRefs(envelope?.evidence_refs, run, runtimeSessionRefFromSession);
  const evidenceRefs = dedupeEvidenceRefs([
    ...resultEvidenceRefs,
    ...envelopeEvidenceRefs(previewResult?.evidence_refs, run, runtimeSessionRefFromSession, "preview_result"),
  ]);
  const runtimeSessionRef =
    runtimeSessionRefFromSession ??
    evidenceRefs.find((ref) => ref.runtime_session_ref)?.runtime_session_ref;
  const failureRecord = failure?.failure ?? result?.failure ?? envelope?.failure ?? run.terminal_summary?.failure;
  const hasFailureRecovery = Boolean(failureRecord || (failure?.reason_class && failure.reason_class !== "none"));
  const resultKind = envelope?.result_kind ?? (isWritePrecheck ? "real_page_write_precheck_projection" : result?.result?.unavailable_reason ?? "not_available");
  const payloadState = result?.result?.payload_state ?? "not_reported";
  const writeState = isWritePrecheck
    ? writePrecheckState(run, result, previewResult, failureRecord, failure?.reason_class)
    : null;
  const lifecycle = isWritePrecheck && writeState != null
    ? lifecycleFromWritePrecheck(run.status, writeState)
    : lifecycleFromStatus(run.status);
  const outcome = isWritePrecheck && writeState != null
    ? outcomeFromWritePrecheck(run.status, writeState)
    : outcomeFromStatus(run.status);
  const resultRows = isWritePrecheck && writeState != null
    ? writePrecheckResultRows(run, resultKind, payloadState, previewResult, writeState, runtimeSessionRef)
    : [
        { label: "Run status", value: run.status, source: coreLiveSource },
        { label: "Result kind", value: resultKind, source: coreLiveSource },
        { label: "Payload state", value: payloadState, source: coreLiveSource },
        { label: "Post-check", value: postCheck?.status ? `${postCheck.status}: ${postCheck.summary ?? ""}` : "not reported", source: coreLiveSource },
        ...(runtimeSessionRef ? [{ label: "执行现场", value: runtimeSessionRef, source: coreLiveSource }] : []),
      ];
  const writePrecheck = isWritePrecheck && writeState != null
    ? coreWritePrecheck(run, previewResult, writeState, evidenceRefs, runtimeSessionRef)
    : undefined;
  const approval = isWritePrecheck && writeState != null
    ? coreApprovalPreview(run, previewResult, writeState)
    : undefined;

  return {
    ok: true,
    projection: {
      updatedAt: run.timeline?.updated_at ?? run.timeline?.terminal_at ?? "",
      run: {
        id: run.run_id,
        label: `${siteRunLabel(run)} ${run.run_id.replace(/^run_/, "").slice(0, 24)}`,
        lifecycle,
        outcome,
        summary: isWritePrecheck && writeState != null
          ? summaryFromWritePrecheckRun(run, writeState, evidenceRefs.length, previewResult)
          : summaryFromCoreRun(run, resultKind, evidenceRefs.length, failureRecord),
        actionIntent: isWritePrecheck && writeState != null
          ? actionIntentFromWritePrecheckRun(writeState)
          : actionIntentFromCoreRun(run, failure),
        owner: "Core",
        source: coreLiveSource,
        resultRows,
        fieldSources: evidenceRefs.map((entry, index) => ({
          field: `证据引用 ${index + 1}`,
          value: entry.ref,
          locator: entry.runtime_session_ref ?? runtimeSessionRef ?? "Core evidence refs query",
          evidenceRef: entry.ref,
          source: coreLiveSource,
        })),
        evidenceCards: evidenceRefs.map((entry, index) => ({
          id: `ev-${run.run_id}-${index}`,
          title: `Core evidence ref ${index + 1}`,
          summary: `${entry.ref}; raw_access=${entry.raw_access ?? "not_available_from_core"}; recorded_at=${entry.recorded_at ?? "unknown"}.`,
          viewerLabel: "打开 owner evidence ref",
          viewerHref: `#${encodeURIComponent(entry.ref)}`,
          source: coreLiveSource,
          status: evidenceStatus(entry.state),
          freshness: entry.recorded_at ?? "unknown",
          provenance: entry.source ?? "Core evidence refs query",
        })),
        capabilityAttribution: {
          capabilityRef: previewResult?.capability?.capability_ref ?? run.task?.capability_ref ?? "unknown",
          version: previewResult?.capability?.capability_version ?? run.task?.capability_version ?? "unknown",
          sourceRef: previewResult?.capability?.capability_source_ref ?? run.task?.capability_source_ref ?? run.task?.package_ref ?? "unknown",
          failureClass: failureClass(failure?.reason_class, failureRecord?.code),
          summary: isWritePrecheck
            ? "Core 查询返回写前验证 capability、action request、runtime session、submitted 状态和 evidence refs；App 只展示引用。"
            : "Core 查询返回 capability、package、runtime session 和 evidence refs；App 只展示引用。",
        },
        ...(writePrecheck ? { writePrecheck } : {}),
        ...(approval ? { approval } : {}),
        ...(hasFailureRecovery
          ? {
              failureRecovery: {
                state: failureStateLabel(failure?.reason_class, failureRecord?.code),
                reason: failureRecord?.code ?? failure?.reason_class ?? "Core returned recoverable state",
                nextActions: failureNextActions(failure),
                source: coreLiveSource,
              },
            }
          : {}),
        process: [
          "Core capability-runs query returned owner run summary.",
          "Core run result/evidence/session/failure refs were read without raw evidence.",
          runtimeSessionRef ? `Harbor runtime session ref: ${runtimeSessionRef}.` : "No runtime session ref was exposed.",
        ],
      },
    },
  };
}

export async function fetchCoreRunProjectionById(
  endpoint: string,
  runId: string,
  spec: CoreReadTaskSpec,
): Promise<{ ok: true; run: RunProjection } | { ok: false; error: string }> {
  const encodedRunId = encodeURIComponent(runId);
  const response = await requestJson(endpoint, `/runs/${encodedRunId}`);
  const body = okPayload(response, "run") ?? okPayload(response, "run_record") ?? recordValue(response);
  const fixtureReason = fixtureOrDemoPayloadReason(body);
  if (fixtureReason) {
    return { ok: false, error: `/runs/${encodedRunId} returned fixture/demo/smoke payload: ${fixtureReason}` };
  }
  const run = coreRunSummary(body);

  if (run == null) {
    return { ok: false, error: `/runs/${encodedRunId} returned invalid run summary` };
  }

  const projection = await fetchRunProjection(endpoint, run, spec);
  return projection.ok
    ? { ok: true, run: projection.projection.run }
    : { ok: false, error: projection.error };
}

async function requestJson(base: string, path: string): Promise<unknown> {
  return requestOwnerJson(base, path, { timeoutMs: 2500 });
}

function okPayload(value: unknown, key: string): JsonRecord | null {
  if (!isRecord(value) || value.ok !== true) return null;
  return recordValue(value[key]);
}

function requiredOkPayload(
  value: unknown,
  key: string,
  path: string,
): { ok: true; payload: JsonRecord } | { ok: false; error: string } {
  if (!isRecord(value)) {
    return { ok: false, error: `${path} returned invalid JSON` };
  }

  if (value.ok !== true) {
    const failure = recordValue(value.error) ?? recordValue(value.failure);
    const code = stringValue(failure?.code) ?? stringValue(failure?.reason_class) ?? "owner_read_failed";
    return { ok: false, error: `${path} failed: ${code}` };
  }

  const payload = recordValue(value[key]);
  return payload == null
    ? { ok: false, error: `${path} missing ${key}` }
    : { ok: true, payload };
}

function envelopeEvidenceRefs(
  value: unknown,
  run: CoreRunSummary,
  runtimeSessionRef: string | undefined,
  source = "result_envelope",
): CoreEvidenceRef[] {
  return arrayValue(value).flatMap((item) => {
    const ref = stringValue(item);
    return ref
      ? [
          {
            ref,
            source,
            state: "available",
            raw_access: "not_available_from_core",
            recorded_at: run.timeline?.terminal_at ?? run.timeline?.updated_at ?? "unknown",
            ...(runtimeSessionRef === undefined ? {} : { runtime_session_ref: runtimeSessionRef }),
          },
        ]
      : [];
  });
}

function dedupeEvidenceRefs(refs: CoreEvidenceRef[]): CoreEvidenceRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    if (seen.has(ref.ref)) return false;
    seen.add(ref.ref);
    return true;
  });
}

function coreRunSummary(value: unknown): CoreRunSummary | null {
  if (!isRecord(value)) return null;
  const runId = stringValue(value.run_id);
  const status = stringValue(value.status);
  if (!runId || !isCoreRunStatus(status)) return null;
  return {
    run_id: runId,
    status,
    timeline: recordValue(value.timeline) as CoreRunSummary["timeline"],
    task: recordValue(value.task) as CoreRunSummary["task"],
    admission: recordValue(value.admission) as CoreRunSummary["admission"],
    runtime_refs: recordValue(value.runtime_refs) as CoreRunSummary["runtime_refs"],
    terminal_summary: recordValue(value.terminal_summary) as CoreRunSummary["terminal_summary"],
  };
}

function coreEvidenceRefs(value: unknown): CoreEvidenceRef[] {
  return arrayValue(value).flatMap((item) => {
    const record = recordValue(item);
    const ref = stringValue(record?.ref);
    return ref ? [{ ...record, ref } as CoreEvidenceRef] : [];
  });
}

function coreProjectionRefReason(
  run: CoreRunSummary,
  result: CoreResultEnvelope,
  evidence: JsonRecord,
  session: CoreSessionRefsEnvelope,
  envelope: CoreResultEnvelopeBody | undefined,
): string | null {
  const checks: Array<[unknown, CoreRefKind, string]> = [
    [run.runtime_refs?.session_binding?.runtime_session_ref, "session", "run.runtime_refs.session_binding.runtime_session_ref"],
    [session.session_refs?.runtime_session_ref, "session", "session.session_refs.runtime_session_ref"],
    [run.terminal_summary?.result_ref, "result", "run.terminal_summary.result_ref"],
    [result.result?.result_ref, "result", "result.result.result_ref"],
    [envelope?.result_ref, "result", "result.result.result_envelope.result_ref"],
    [envelope?.source_refs, "source", "result.result.result_envelope.source_refs"],
    [envelope?.evidence_refs, "evidence", "result.result.result_envelope.evidence_refs"],
    [result.result?.preview_result?.evidence_refs, "evidence", "result.result.preview_result.evidence_refs"],
    [envelope?.preview_result?.evidence_refs, "evidence", "result.result.result_envelope.preview_result.evidence_refs"],
  ];
  const postCheck = envelope?.post_check;
  checks.push(
    [postCheck?.ref, "post-check", "result.result.result_envelope.post_check.ref"],
    [postCheck?.post_check_ref, "post-check", "result.result.result_envelope.post_check.post_check_ref"],
  );

  for (const [value, kind, path] of checks) {
    const reason = typedCoreRefValueReason(value, kind, path);
    if (reason) return reason;
  }
  for (const [index, item] of arrayValue(evidence.evidence_refs).entries()) {
    const record = recordValue(item);
    if (record == null) return `evidence.evidence_refs[${index}] must be an object`;
    const refReason = typedCoreRefValueReason(record.ref, "evidence", `evidence.evidence_refs[${index}].ref`, true);
    if (refReason) return refReason;
    const sessionReason = typedCoreRefValueReason(
      record.runtime_session_ref,
      "session",
      `evidence.evidence_refs[${index}].runtime_session_ref`,
    );
    if (sessionReason) return sessionReason;
  }
  for (const [index, item] of arrayValue(result.evidence_refs).entries()) {
    const record = recordValue(item);
    if (record == null) return `result.evidence_refs[${index}] must be an object`;
    const refReason = typedCoreRefValueReason(record.ref, "evidence", `result.evidence_refs[${index}].ref`, true);
    if (refReason) return refReason;
    const sessionReason = typedCoreRefValueReason(record.runtime_session_ref, "session", `result.evidence_refs[${index}].runtime_session_ref`);
    if (sessionReason) return sessionReason;
  }
  return null;
}

function typedCoreRefValueReason(value: unknown, kind: CoreRefKind, path: string, required = false): string | null {
  if (value === undefined) return required ? `${path} is required` : null;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const reason = typedCoreRefValueReason(value[index], kind, `${path}[${index}]`, true);
      if (reason) return reason;
    }
    return null;
  }
  if (typeof value !== "string" || !coreRefPattern(kind).test(value) || unsafeCoreRef.test(value)) {
    return `${path} is not a safe ${kind} ref`;
  }
  return null;
}

const unsafeCoreRef =
  /^https?:\/\/|(?:^|[:._/-])(?:token|cookie|secret|password|credential|authorization|bearer|raw[\s_-]*evidence|raw[\s_-]*dom|har)(?:$|[:._/-])/i;

function coreRefPattern(kind: CoreRefKind): RegExp {
  if (kind === "session") return /^(?:session_[A-Za-z0-9._-]+|harbor:runtime-session\/[A-Za-z0-9._/-]+)$/;
  if (kind === "source") return /^(?:source_[A-Za-z0-9._-]+|harbor:source-trace\/[A-Za-z0-9._/-]+)$/;
  if (kind === "evidence") return /^(?:(?:evidence|screenshot|post_check)_[A-Za-z0-9._-]+|harbor:evidence\/[A-Za-z0-9._/-]+)$/;
  if (kind === "post-check") return /^post_check_[A-Za-z0-9._-]+$/;
  return /^result:core\/[A-Za-z0-9._/-]+$/;
}

function corePreviewResult(value: unknown): CorePreviewResult | undefined {
  const record = recordValue(value);
  if (record == null) return undefined;
  return {
    state: stringValue(record.state),
    submitted: typeof record.submitted === "boolean" ? record.submitted : undefined,
    expected_change: recordValue(record.expected_change) as CorePreviewResult["expected_change"],
    action_refs: recordValue(record.action_refs) as CorePreviewResult["action_refs"],
    capability: recordValue(record.capability) as CorePreviewResult["capability"],
    evidence_refs: arrayValue(record.evidence_refs).flatMap((item) => stringValue(item) ?? []),
    failure_class: stringValue(record.failure_class),
    consumer_boundary: stringValue(record.consumer_boundary),
  };
}

function writePrecheckState(
  run: CoreRunSummary,
  result: CoreResultEnvelope,
  preview: CorePreviewResult | undefined,
  failure: CoreResultEnvelope["failure"] | undefined,
  failureReasonClass: string | undefined,
): CorePreviewState {
  if (run.status === "expired" || result.result?.payload_state === "expired" || failureReasonClass === "expired") return "expired";
  if (run.status === "cancelled" || failure?.code === "user_cancelled" || failureReasonClass === "user_cancelled") return "user_cancelled";
  if (failure?.code === "page_changed" || failureReasonClass === "page_changed") return "page_changed";
  if (failure?.code === "preview_unavailable" || failureReasonClass === "preview_unavailable" || result.result?.unavailable_reason) return "preview_unavailable";
  if (run.status === "failed" || run.status === "blocked") return "preview_unavailable";
  const state = previewStateValue(preview?.state);
  if (state === "available") return preview?.submitted === false ? "available" : "preview_unavailable";
  if (state) return state;
  return "preview_unavailable";
}

function previewStateValue(value: string | undefined): CorePreviewState | undefined {
  if (
    value === "available" ||
    value === "preview_unavailable" ||
    value === "page_changed" ||
    value === "user_cancelled" ||
    value === "expired"
  ) {
    return value;
  }
  return undefined;
}

function lifecycleFromWritePrecheck(
  status: CoreRunStatus,
  state: CorePreviewState,
): RunProjection["lifecycle"] {
  if (state === "available" && status === "succeeded") return "needs-action";
  if (state === "expired" || state === "page_changed" || state === "preview_unavailable") return "blocked";
  if (state === "user_cancelled") return "completed";
  return lifecycleFromStatus(status);
}

function outcomeFromWritePrecheck(status: CoreRunStatus, state: CorePreviewState): OutcomeKind {
  if (state === "available") return "partial";
  if (state === "expired") return "expired";
  if (state === "user_cancelled") return "failure-safe";
  if (state === "page_changed" || state === "preview_unavailable") return "unavailable";
  return outcomeFromStatus(status);
}

function writePrecheckResultRows(
  run: CoreRunSummary,
  resultKind: string,
  payloadState: string,
  preview: CorePreviewResult | undefined,
  state: CorePreviewState,
  runtimeSessionRef: string | undefined,
): RunProjection["resultRows"] {
  return [
    { label: "Run status", value: run.status, source: coreLiveSource },
    { label: "Result kind", value: resultKind, source: coreLiveSource },
    { label: "Preview state", value: state, source: coreLiveSource },
    { label: "Payload state", value: payloadState, source: coreLiveSource },
    { label: "Submitted", value: submittedLabel(preview), source: coreLiveSource },
    { label: "Action request", value: preview?.action_refs?.action_request_id ?? "not exposed", source: coreLiveSource },
    ...(runtimeSessionRef ? [{ label: "执行现场", value: runtimeSessionRef, source: coreLiveSource }] : []),
  ];
}

function coreWritePrecheck(
  run: CoreRunSummary,
  preview: CorePreviewResult | undefined,
  state: CorePreviewState,
  evidenceRefs: CoreEvidenceRef[],
  runtimeSessionRef: string | undefined,
): NonNullable<RunProjection["writePrecheck"]> {
  const expectedChange = preview?.expected_change;
  const targetRef = expectedChange?.target_ref ?? "owner writable target ref";
  const expectedSummary = expectedChange?.summary ?? "Core write-precheck projection is available from owner refs.";
  const externalSubmit = expectedChange?.external_submit === false ? "false" : "not exposed";
  const submitted = submittedLabel(preview);
  return {
    state,
    modeLabel: `真实页面写前验证 / ${state}`,
    expectedChangeSummary: expectedSummary,
    beforeLabel: runtimeSessionRef ?? "Core owner refs",
    afterLabel: targetRef,
    submittedLabel: submitted,
    diffRows: [
      {
        label: "expected_change",
        before: "当前页面 owner refs",
        after: expectedSummary,
        source: coreLiveSource,
      },
      {
        label: "external_submit",
        before: "not requested",
        after: externalSubmit,
        source: coreLiveSource,
      },
      {
        label: "submitted",
        before: "Core owner truth",
        after: submitted,
        source: coreLiveSource,
      },
      {
        label: "evidence refs",
        before: "owner refs",
        after: `${evidenceRefs.length} refs`,
        source: coreLiveSource,
      },
    ],
    noSubmitGuard: "active",
    stateNote: writePrecheckStateNote(state, preview),
  };
}

function coreApprovalPreview(
  run: CoreRunSummary,
  preview: CorePreviewResult | undefined,
  state: CorePreviewState,
): NonNullable<RunProjection["approval"]> {
  const actionRequestId = preview?.action_refs?.action_request_id ?? "not exposed";
  const statuses: NonNullable<RunProjection["approval"]>["statuses"] = [];
  const canApprove = state === "available" && preview?.submitted === false;
  if (canApprove) {
    statuses.push({
      label: "审批请求",
      status: "pending",
      detail: "等待用户审查 owner 写前验证；App 不执行审批或提交。",
    });
  }
  if (state === "available" && !canApprove) {
    statuses.push({
      label: "阻止审批",
      status: "blocked",
      detail: "Core 未明确返回 submitted=false，App 不显示为可审批。",
    });
  }
  if (state === "expired") {
    statuses.push({
      label: "过期请求",
      status: "expired",
      detail: "写前验证已过期，不能继续审批或提交。",
    });
  }
  if (state === "page_changed" || state === "preview_unavailable") {
    statuses.push({
      label: "阻止审批",
      status: "blocked",
      detail: "页面或证据状态不再匹配，必须重新验证。",
    });
  }
  if (state === "user_cancelled") {
    statuses.push({
      label: "取消记录",
      status: "cancelled",
      detail: "取消只记录终止状态，不生成提交结果。",
    });
  }

  return {
    actionRequestId,
    riskLabel: `${run.admission?.action_risk ?? "write"} / medium / no-submit`,
    riskLevel: canApprove ? "low" : "blocked",
    statuses,
    cancelIntent: "记录取消意图；不发送提交、发布、打招呼或投递动作。",
    boundary: preview?.consumer_boundary ?? "Core owns action request and submitted truth; App only displays refs and local cancel intent.",
  };
}

function writePrecheckStateNote(state: CorePreviewState, preview: CorePreviewResult | undefined) {
  if (preview?.submitted !== false) {
    return `写前验证阻断：${submittedLabel(preview)}，App 不显示为可审批或已提交。`;
  }
  if (state === "expired") return "页面状态已过期；未提交，submitted=false / 未提交。";
  if (state === "user_cancelled") return "已取消：没有执行提交，submitted=false / 未提交。";
  if (state === "page_changed") return "页面已变化：写前验证不可继续，submitted=false / 未提交。";
  if (state === "preview_unavailable") return "写前验证不可用：没有提交结果，submitted=false / 未提交。";
  return "写前验证可审查；这不是提交结果，submitted=false / 未提交。";
}

function submittedLabel(preview: CorePreviewResult | undefined) {
  if (preview?.submitted === false) return "false / 未提交";
  if (preview?.submitted === true) return "true / blocked";
  return "unknown / blocked";
}

function lifecycleFromStatus(status: CoreRunStatus): RunProjection["lifecycle"] {
  if (status === "pending") return "queued";
  if (status === "admitted" || status === "running") return "running";
  if (status === "requires_user_action" || status === "manual_recovery_required") return "needs-action";
  if (status === "failed" || status === "blocked" || status === "expired") return "blocked";
  return "completed";
}

function outcomeFromStatus(status: CoreRunStatus): OutcomeKind {
  if (status === "succeeded") return "success";
  if (status === "cancelled" || status === "manual_recovery_required" || status === "requires_user_action") return "failure-safe";
  if (status === "expired") return "expired";
  if (status === "unknown_outcome") return "unknown";
  if (status === "failed" || status === "blocked") return "failure";
  return "partial";
}

function evidenceStatus(status: string | undefined): RunProjection["evidenceCards"][number]["status"] {
  if (status === "expired") return "expired";
  if (status === "redacted") return "redacted";
  if (status === "stale") return "stale";
  if (status === "access_denied" || status === "deleted_by_policy" || status === "missing") return "unavailable";
  return "available";
}

function failureClass(
  reasonClass: string | undefined,
  code: string | undefined,
): NonNullable<RunProjection["capabilityAttribution"]>["failureClass"] {
  if (code === "user_cancelled") return "none";
  if (code === "page_changed") return "site_changed";
  if (code === "preview_unavailable") return "evidence_expired";
  if (!reasonClass || reasonClass === "none") return "none";
  if (reasonClass === "login_required") return "login_required";
  if (reasonClass === "page_changed") return "site_changed";
  if (reasonClass === "field_unavailable" || code === "field_missing") return "field_missing";
  if (reasonClass === "risk_prompt") return "captcha";
  if (reasonClass === "evidence_unavailable") return "evidence_expired";
  if (reasonClass === "capability_failure") return "capability";
  return "runtime";
}

function failureStateLabel(reasonClass: string | undefined, code: string | undefined) {
  if (code === "user_cancelled") return "已取消";
  if (code === "page_changed") return "页面变化";
  if (code === "preview_unavailable") return "写前验证不可用";
  if (reasonClass === "login_required") return "未登录";
  if (reasonClass === "risk_prompt") return "验证码";
  if (reasonClass === "page_changed") return "页面变化";
  if (reasonClass === "field_unavailable" || code === "field_missing") return "字段缺失";
  return code ?? reasonClass ?? "Core failure";
}

function failureNextActions(failure: CoreFailureEnvelope | null): string[] {
  const action = failure?.app_action && failure.app_action !== "none"
    ? failure.app_action
    : failure?.failure?.recovery_hint;
  return [
    action ? `执行 owner-supported action: ${action}` : "查看 Core failure reason",
    failure?.retryable ? "修复身份环境或页面状态后再次执行" : "等待 owner 修复或人工处理",
  ];
}

function summaryFromWritePrecheckRun(
  run: CoreRunSummary,
  state: CorePreviewState,
  evidenceCount: number,
  preview: CorePreviewResult | undefined,
) {
  if (state === "preview_unavailable") {
    return `Core 返回 ${run.status} 写前验证阻断状态；App 不显示 pending approval，submitted 状态按 owner truth 展示。`;
  }
  if (state === "available") {
    return `Core 返回真实页面写前验证：${evidenceCount} 个 evidence ref 可审查；submitted=false / 未提交。`;
  }
  if (preview?.submitted !== false) {
    return `Core 返回 ${run.status} 写前验证状态；${submittedLabel(preview)}，不能继续审批或提交。`;
  }
  if (state === "expired") {
    return "Core 返回写前验证过期状态；不能继续审批或提交，submitted=false / 未提交。";
  }
  if (state === "user_cancelled") {
    return "Core 返回取消状态；App 不显示为已提交，submitted=false / 未提交。";
  }
  if (state === "page_changed") {
    return "Core 返回页面变化状态；需要重新生成写前验证，submitted=false / 未提交。";
  }
  return `Core 返回 ${run.status} 写前验证状态；App 只展示 refs 和 no-submit guard。`;
}

function actionIntentFromWritePrecheckRun(state: CorePreviewState) {
  if (state === "available") {
    return "Owner-supported action intent: 审查写前验证；App 只记录取消意图，不执行审批或提交。";
  }
  if (state === "expired" || state === "page_changed" || state === "preview_unavailable") {
    return "Owner-supported action intent: 刷新页面证据后重新生成写前验证。";
  }
  return "Owner-supported action intent: 重新生成写前验证或修改输入。";
}

function summaryFromCoreRun(
  run: CoreRunSummary,
  resultKind: string,
  evidenceCount: number,
  failure: CoreResultEnvelope["failure"] | undefined,
) {
  if (failure) {
    return `Core 返回 ${run.status}：${failure.code ?? "failure"}；App 展示恢复动作和 evidence refs。`;
  }
  if (run.status === "succeeded") {
    return `Core 返回真实只读结果 envelope（${resultKind}），包含 ${evidenceCount} 个 evidence ref；App 不保存原始证据正文。`;
  }
  return `Core 返回 ${run.status} run projection，当前可查看 ${evidenceCount} 个 evidence ref。`;
}

function actionIntentFromCoreRun(run: CoreRunSummary, failure: CoreFailureEnvelope | null) {
  if (failure?.app_action && failure.app_action !== "none") {
    return `Owner-supported action intent: ${failure.app_action}.`;
  }
  if (run.status === "succeeded") return "Owner-supported action intent: 查看结果依据或再次执行同一输入。";
  return "Owner-supported action intent: 打开执行现场或等待 Core 回读。";
}

function siteRunLabel(run: CoreRunSummary) {
  const packageRef = run.task?.package_ref ?? run.task?.capability_source_ref ?? "";
  if (packageRef.includes("xiaohongshu") && packageRef.includes("precheck")) return "小红书 Preview";
  if (packageRef.includes("boss") && packageRef.includes("precheck")) return "BOSS Preview";
  if (packageRef.includes("xiaohongshu")) return "小红书 Run";
  if (packageRef.includes("boss")) return "BOSS Run";
  return "Core Run";
}

function isCoreRunStatus(value: string | undefined): value is CoreRunStatus {
  return (
    value === "pending" ||
    value === "admitted" ||
    value === "running" ||
    value === "succeeded" ||
    value === "failed" ||
    value === "blocked" ||
    value === "requires_user_action" ||
    value === "manual_recovery_required" ||
    value === "unknown_outcome" ||
    value === "cancelled" ||
    value === "expired"
  );
}

function recordValue(value: unknown): JsonRecord | null {
  return isRecord(value) ? value : null;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

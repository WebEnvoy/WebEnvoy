import { fixtureOrDemoPayloadReason } from "./ownerPayloadGuards";
import { requestOwnerJson } from "./ownerApiClient";

type JsonRecord = Record<string, unknown>;
const coreResultOwnerInspectionDepth = 12;

export type CoreRunResult = {
  outcome: string;
  resultKind?: string;
  outputSchemaId?: string;
  packageRef?: string;
  capabilityVersion?: string;
  capabilityLockRef?: string;
  data?: JsonRecord;
  projectionRef?: string;
  payloadState: string;
  envelopeState: string;
  unavailableReason?: string;
  failure?: { code?: string; category?: string; phase?: string; recoveryHint?: string };
};

export type CoreRunResultState =
  | { status: "loading" }
  | { status: "ready"; result: CoreRunResult }
  | { status: "unavailable"; reason: "owner" | "invalid"; summary: string };

export async function fetchCoreRunResult(
  endpoint: string,
  runId: string,
  signal?: AbortSignal,
): Promise<CoreRunResultState> {
  const path = `/runs/${encodeURIComponent(runId)}/result`;
  let response: unknown;
  try {
    response = await requestOwnerJson(endpoint, path, { timeoutMs: 3500, signal });
  } catch (error) {
    return unavailable("owner", error instanceof Error ? error.message : String(error));
  }
  const envelope = asRecord(response);
  if (envelope?.ok === false) return unavailable("owner", string(envelope.error) ?? "暂时无法读取本回合结果。");
  const query = asRecord(envelope?.result);
  const result = asRecord(query?.result);
  if (query?.schema_version !== "webenvoy.result-query.v0" || query.run_id !== runId || result == null) {
    return unavailable("invalid", "Core 返回了不兼容的结果投影。");
  }
  const resultEnvelope = asRecord(result.result_envelope);
  if (resultEnvelope != null && (resultEnvelope.schema_version !== "webenvoy.result-envelope.v0" || resultEnvelope.run_record_ref !== runId)) {
    return unavailable("invalid", "Core 返回的结果与当前回合不匹配。");
  }
  const fixtureReason = fixtureOrDemoPayloadReason(response, { maximumDepth: coreResultOwnerInspectionDepth });
  if (fixtureReason) return unavailable("invalid", "结果来源不是可用于生产展示的 owner 数据。");
  const data = asRecord(resultEnvelope?.data);
  const payloadState = string(result.payload_state) ?? "unavailable";
  if (data != null && (resultEnvelope?.ok !== true || resultEnvelope.terminal !== true)) {
    return unavailable("invalid", "非成功终态返回了结果正文，已停止渲染。");
  }
  if (data != null && payloadState !== "available") {
    return unavailable("invalid", "Core 将结果标记为未持久化，却同时返回了正文；已停止渲染。");
  }
  if (data != null && !isPublicResultValue(data)) {
    return unavailable("invalid", "结果包含不能在 App 中展示的字段，已停止渲染。");
  }
  const failure = asRecord(query.failure) ?? asRecord(resultEnvelope?.failure);
  return {
    status: "ready",
    result: {
      outcome: string(resultEnvelope?.outcome) ?? outcomeFromStatus(string(query.status)),
      resultKind: string(resultEnvelope?.result_kind),
      outputSchemaId: string(resultEnvelope?.output_schema_id),
      packageRef: string(resultEnvelope?.package_ref),
      capabilityVersion: string(resultEnvelope?.capability_version),
      capabilityLockRef: string(resultEnvelope?.capability_lock_ref),
      ...(data == null ? {} : { data }),
      projectionRef: string(resultEnvelope?.projection_ref),
      payloadState,
      envelopeState: string(result.envelope_state) ?? "unavailable",
      unavailableReason: string(result.unavailable_reason),
      ...(failure == null ? {} : {
        failure: {
          code: string(failure.code),
          category: string(failure.category),
          phase: string(failure.phase),
          recoveryHint: string(failure.recovery_hint),
        },
      }),
    },
  };
}

function unavailable(reason: "owner" | "invalid", summary: string): CoreRunResultState {
  return { status: "unavailable", reason, summary };
}

function outcomeFromStatus(status: string | undefined) {
  if (status === "succeeded") return "success";
  if (status === "cancelled") return "cancelled";
  if (status === "unknown_outcome") return "unknown_outcome";
  return status ?? "unknown_outcome";
}

function isPublicResultValue(value: unknown, depth = 0): boolean {
  if (depth > 8) return false;
  if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.length <= 500 && value.every((item) => isPublicResultValue(item, depth + 1));
  if (!isRecord(value)) return false;
  return Object.entries(value).every(([key, item]) => !isForbiddenResultKey(key) && isPublicResultValue(item, depth + 1));
}

function isForbiddenResultKey(key: string) {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLocaleLowerCase();
  return forbiddenResultKeyParts.some((part) => normalized.includes(part));
}

const forbiddenResultKeyParts = [
  "authorization", "cookie", "credential", "password", "passwd", "secret", "token",
  "apikey", "accesskey", "privatekey", "encryptionkey",
  "rawpayload", "rawevidencebody", "fulldom", "networkresponsebody", "providerprivateobject",
  "localpath", "profilepath", "runtimesession", "cdpref", "cdpendpoint", "vncurl", "viewerurl",
  "websocketdebuggerurl", "screenshot", "videobody", "videobytes", "videodata",
];

function asRecord(value: unknown): JsonRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function string(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

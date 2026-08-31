const bossTokenPattern = /(^|[^a-z0-9])boss(?=$|[^a-z0-9])/i;
const bossCapabilityRefs = new Set([
  "lode:capability/job-search",
  "lode:capability/read-job-detail",
  "lode:capability/boss-greeting-precheck",
]);

export const bossProductionDeferredReason = "目标站点当前访问受限，功能延期；不会创建生产任务。";

type BossTaskLike = {
  siteSkill?: unknown;
  threadContext?: {
    siteLabel?: unknown;
    siteSkillKey?: unknown;
  };
  packageSource?: {
    name?: unknown;
    capabilityRef?: unknown;
    sourceRef?: unknown;
    lockRef?: unknown;
  };
  runs?: Array<{
    capabilityAttribution?: {
      capabilityRef?: unknown;
      sourceRef?: unknown;
    };
    inputDefinition?: {
      packageRef?: unknown;
      inputSchemaRef?: unknown;
    };
  }>;
};

export function isBossProductionSkill(skill: { siteSlug?: unknown; packageRef?: unknown; lockRef?: unknown }) {
  return stringValue(skill.siteSlug)?.trim().toLowerCase() === "boss" ||
    [skill.packageRef, skill.lockRef].some(isBossReference);
}

/** Identify BOSS from stable task/owner refs only; ordinary titles and copy are intentionally ignored. */
export function isBossProductionTask(task: BossTaskLike) {
  const taskRefs = [
    task.siteSkill,
    task.threadContext?.siteLabel,
    task.threadContext?.siteSkillKey,
    task.packageSource?.name,
    task.packageSource?.capabilityRef,
    task.packageSource?.sourceRef,
    task.packageSource?.lockRef,
  ];
  if (taskRefs.some(isBossReference)) return true;

  return (task.runs ?? []).some((run) => [
    run.capabilityAttribution?.capabilityRef,
    run.capabilityAttribution?.sourceRef,
    run.inputDefinition?.packageRef,
    run.inputDefinition?.inputSchemaRef,
  ].some(isBossReference));
}

/** Shared Electron/renderer guard for production task POSTs. */
export function isBossProductionTaskPost(path: string, method: string, body: unknown) {
  if (method !== "POST" || !isProductionTaskPath(path)) return false;
  const payload = recordValue(body) ?? parseJsonRecord(body);
  if (payload == null) return false;

  const taskIntent = recordValue(payload.task_intent);
  const capability = recordValue(taskIntent?.capability);
  const scope = recordValue(taskIntent?.scope);
  return [
    payload.package_ref,
    payload.packageRef,
    payload.capability_ref,
    payload.capabilityRef,
    capability?.ref,
    capability?.source_ref,
    capability?.sourceRef,
    capability?.lock_ref,
    capability?.lockRef,
  ].some(isBossReference) || scope?.target_type === "boss_job_search" || scope?.targetType === "boss_job_search";
}

function isProductionTaskPath(path: string) {
  let pathname = path;
  try {
    pathname = new URL(path, "http://localhost").pathname;
  } catch {
    // Parsed owner requests already enforce a path; keep this helper total for direct boundary tests.
  }
  return pathname === "/tasks" || pathname === "/threads" || /^\/threads\/[^/]+\/turns$/.test(pathname);
}

function isBossReference(value: unknown) {
  const normalized = stringValue(value);
  return normalized != null && (bossCapabilityRefs.has(normalized) || bossTokenPattern.test(normalized));
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseJsonRecord(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    return recordValue(JSON.parse(value));
  } catch {
    return null;
  }
}

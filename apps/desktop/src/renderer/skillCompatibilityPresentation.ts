import {
  isCandidateUsable,
  type IdentityCompatibilityCandidate,
  type SkillIdentityCompatibilityState,
} from "./coreIdentityCompatibilityClient";
import type { IdentityEnvironmentProjection } from "./identityEnvironmentFixtures";
import type { LodeCatalogLoadState, LodeCatalogSkill } from "./lodeCatalogClient";
import type { RuntimeSupervisorState } from "./runtimeSupervisorState";

export function compatibilityCandidateLabel(candidate: IdentityCompatibilityCandidate | undefined) {
  if (candidate?.status === "compatible") return "兼容";
  if (candidate?.status === "unknown_until_runtime") return "提交时再检查";
  if (candidate?.status === "awaiting_target") return "待填写具体目标";
  if (candidate?.status === "requires_setup") return "需要完成设置";
  if (candidate?.status === "incompatible") return "当前不可用";
  return "尚未检查";
}

export function compatibilityRecoveryCopy(candidate: IdentityCompatibilityCandidate | undefined) {
  switch (candidate?.recoveryAction) {
    case "open_manual_auth":
      return { label: "登录账号", destination: "identity" as const };
    case "repair_browser_environment":
    case "connect_identity_environment":
    case "install_or_select_provider":
      return { label: "修复浏览器环境", destination: "identity" as const };
    case "refresh_owner_facts":
      return { label: "刷新账号状态", destination: "identity" as const };
    case "select_supported_package_version":
    case "repair_package_contract":
    case "select_matching_resource_requirements":
      return { label: "更新或修复站点技能", destination: "skill_repair" as const };
    case "fix_target":
      return { label: "填写具体目标", destination: "target" as const };
    case "select_matching_identity":
      return { label: "选择其他账号身份", destination: "identity_selection" as const };
    default:
      return null;
  }
}

export function candidateIdentityList(
  skill: LodeCatalogSkill,
  identities: IdentityEnvironmentProjection[],
) {
  return identities.filter((identity) => identity.siteId === skill.siteSlug);
}

export function compatibilityCandidate(
  identity: IdentityEnvironmentProjection | undefined,
  compatibility: SkillIdentityCompatibilityState | undefined,
) {
  return identity == null
    ? undefined
    : compatibility?.candidates.find(
        (candidate) => candidate.identityEnvironmentRef === identity.identityEnvironmentRef,
      );
}

export function skillLaunchState(
  skill: LodeCatalogSkill,
  identity: IdentityEnvironmentProjection | undefined,
  candidate: IdentityCompatibilityCandidate | undefined,
  compatibility: SkillIdentityCompatibilityState,
  runtime: RuntimeSupervisorState,
  catalogStatus: LodeCatalogLoadState["status"],
) {
  if (catalogStatus !== "ready") return { ok: false, reason: "站点技能目录需要刷新后才能创建任务。" };
  if (skill.availability !== "available") return { ok: false, reason: skill.availabilityReason };
  if (compatibility.status !== "ready") return { ok: false, reason: compatibility.summary };
  if (identity == null) return { ok: false, reason: "没有可用的账号身份候选。" };
  if (!isCandidateUsable(candidate)) return { ok: false, reason: "Core 未确认当前账号身份可以进入任务创建。" };
  if (!runtime.canUseLiveRuntime) return { ok: false, reason: runtime.summary };
  return {
    ok: true,
    reason: candidate?.status === "unknown_until_runtime"
      ? "可进入任务创建；正式提交时会重新检查运行窗口。"
      : "使用当前技能和账号身份创建任务。",
  };
}

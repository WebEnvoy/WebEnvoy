import { useEffect, useRef, useState } from "react";

import type { CreateTaskSelection } from "./CreateTaskShell";
import {
  createAwaitingTargetCompatibility,
  fetchSkillIdentityCompatibility,
  isCandidateUsable,
  loadingSkillIdentityCompatibility,
  skillRequiresExactTarget,
  unavailableSkillIdentityCompatibility,
  type IdentityCompatibilityCandidate,
  type SkillIdentityCompatibilityState,
} from "./coreIdentityCompatibilityClient";
import { identitySelectionStorageKey, type HarborIdentityLoadState } from "./harborIdentityTypes";
import {
  fetchLodeCatalog,
  type LodeCatalogLoadState,
  type LodeCatalogSkill,
} from "./lodeCatalogClient";
import { createLatestRequestGate } from "./latestRequestGate";
import { compatibilityRecoveryCopy } from "./skillCompatibilityPresentation";
import type { IdentityRecoveryRequest, SiteSkillRecoveryRequest } from "./siteSkillRecovery";
import type { RuntimeSupervisorState } from "./runtimeSupervisorState";
import { isOpaqueDetailRef, isXiaohongshuDetailHandoffSkill } from "./resultDetailHandoff";

type SkillWorkbenchOptions = {
  coreEndpoint: string;
  catalog: LodeCatalogLoadState;
  identities: HarborIdentityLoadState["identities"];
  runtime: RuntimeSupervisorState;
  onCatalogChange: (catalog: LodeCatalogLoadState) => void;
  onOpenCreate: () => void;
  onOpenIdentity: () => void;
  onOpenLibrary: () => void;
};

type ResolvedCompatibility = {
  skill: LodeCatalogSkill;
  identity: HarborIdentityLoadState["identities"][number];
  compatibility: SkillIdentityCompatibilityState;
  candidate: IdentityCompatibilityCandidate | undefined;
};

export function useSkillWorkbench(options: SkillWorkbenchOptions) {
  const [compatibilityBySkill, setCompatibilityBySkill] = useState<Record<string, SkillIdentityCompatibilityState>>({});
  const [createTaskSelection, setCreateTaskSelection] = useState<CreateTaskSelection | null>(null);
  const requestGateRef = useRef(createLatestRequestGate());
  const contextRef = useRef("");
  const contextKey = skillWorkbenchContextKey(options);
  contextRef.current = contextKey;
  const recovery = useSkillRecovery(options, setCreateTaskSelection);
  useSkillWorkbenchEffects(options, contextKey, requestGateRef, setCompatibilityBySkill, setCreateTaskSelection);

  async function resolveCompatibility(skill: LodeCatalogSkill, identityId?: string, targetRef?: string) {
    const request = requestGateRef.current.begin();
    const context = contextRef.current;
    const refreshedCatalog = await fetchLodeCatalog(request.signal);
    if (!request.isCurrent() || contextRef.current !== context) return;
    const result = await resolveRefreshedCompatibility(options, refreshedCatalog, skill, identityId, targetRef, request.signal);
    if (!request.isCurrent() || contextRef.current !== context) return;
    options.onCatalogChange(refreshedCatalog);
    if (result == null) return;
    setCompatibilityBySkill((current) => ({ ...current, [result.skill.id]: result.compatibility }));
    return result;
  }

  async function useSiteSkill(skill: LodeCatalogSkill, identityId?: string) {
    const resolved = await resolveCompatibility(skill, identityId);
    if (resolved == null || resolved.compatibility.status !== "ready" || !isCandidateUsable(resolved.candidate)) return;
    setCreateTaskSelection({ skill: resolved.skill, identityId: resolved.identity.id });
    options.onOpenCreate();
  }

  async function useResultDetail(detailRef: string, identityEnvironmentRef?: string) {
    if (!isOpaqueDetailRef(detailRef) || options.catalog.status !== "ready") return false;
    const identity = options.identities.find((item) => item.identityEnvironmentRef === identityEnvironmentRef);
    const skill = options.catalog.skills.find(isXiaohongshuDetailHandoffSkill);
    if (identity == null || skill == null || identity.siteId !== skill.siteSlug) return false;
    const resolved = await resolveCompatibility(skill, identity.id, detailRef);
    if (resolved == null || resolved.compatibility.status !== "ready" || !isCandidateUsable(resolved.candidate)) return false;
    setCreateTaskSelection({ skill: resolved.skill, identityId: resolved.identity.id, targetRef: detailRef });
    options.onOpenCreate();
    return true;
  }

  function resetTargetCompatibility(skill: LodeCatalogSkill, identityId: string) {
    requestGateRef.current.invalidate();
    const identity = options.identities.find((item) => item.id === identityId);
    setCompatibilityBySkill((current) => ({
      ...current,
      [skill.id]: createAwaitingTargetCompatibility(identity == null ? [] : [identity.identityEnvironmentRef]),
    }));
  }

  return {
    acknowledgeSiteSkillRecovery: recovery.acknowledgeSiteSkillRecovery,
    abandonIdentityRecovery: recovery.abandonIdentityRecovery,
    abandonSiteSkillRecovery: recovery.abandonSiteSkillRecovery,
    compatibilityBySkill,
    createTaskSelection,
    identityRecoveryRequest: recovery.identityRecoveryRequest,
    siteSkillRecoveryRequest: recovery.siteSkillRecoveryRequest,
    checkCreateTaskCompatibility: async (skill: LodeCatalogSkill, identityId: string, targetRef?: string) =>
      (await resolveCompatibility(skill, identityId, targetRef))?.compatibility ?? null,
    clearCreateTaskSelection: () => setCreateTaskSelection(null),
    invalidateRequests: () => requestGateRef.current.invalidate(),
    recoverCandidate: recovery.recoverCandidate,
    recoverRuntimeIdentity: recovery.recoverRuntimeIdentity,
    recoverRuntimeSkill: recovery.recoverRuntimeSkill,
    recoverExactTarget: recovery.recoverExactTarget,
    resumeCreateTaskAfterIdentityRecovery: recovery.resumeCreateTaskAfterIdentityRecovery,
    resetTargetCompatibility,
    selectCreateTaskSkill: (skill?: LodeCatalogSkill) => setCreateTaskSelection(skill == null ? null : { skill }),
    useSiteSkill,
    useResultDetail,
  };
}

function useSkillRecovery(
  options: SkillWorkbenchOptions,
  setSelection: React.Dispatch<React.SetStateAction<CreateTaskSelection | null>>,
) {
  const [siteSkillRecoveryRequest, setSiteSkillRecoveryRequest] = useState<SiteSkillRecoveryRequest>();
  const [identityRecoveryRequest, setIdentityRecoveryRequest] = useState<IdentityRecoveryRequest>();
  const keyRef = useRef(0);

  function recoverCandidate(skill: LodeCatalogSkill, identityId: string, candidate: IdentityCompatibilityCandidate) {
    const copy = compatibilityRecoveryCopy(candidate);
    if (copy?.destination === "target") {
      setSelection({ skill, identityId });
      options.onOpenCreate();
    } else if (copy?.destination === "skill_repair" || copy?.destination === "identity_selection") {
      setSiteSkillRecoveryRequest({ key: ++keyRef.current, skillId: skill.id, identityId, destination: copy.destination });
      options.onOpenLibrary();
    } else if (copy?.destination === "identity") {
      const destination = candidate.recoveryAction === "refresh_owner_facts"
        ? "refresh"
        : candidate.recoveryAction === "open_manual_auth"
        ? "authentication"
        : "provider";
      openIdentityRecovery(skill, identityId, destination);
    }
  }

  function recoverRuntimeIdentity(skill: LodeCatalogSkill, identityId: string) {
    openIdentityRecovery(skill, identityId, "refresh");
  }

  function recoverRuntimeSkill(skill: LodeCatalogSkill) {
    setSelection({ skill });
    setIdentityRecoveryRequest({ key: ++keyRef.current, destination: "refresh" });
    options.onOpenIdentity();
  }

  function openIdentityRecovery(skill: LodeCatalogSkill, identityId: string, destination: IdentityRecoveryRequest["destination"]) {
    setSelection({ skill, identityId });
    window.localStorage.setItem(identitySelectionStorageKey, identityId);
    setIdentityRecoveryRequest({ key: ++keyRef.current, identityId, destination });
    options.onOpenIdentity();
  }

  function recoverExactTarget(skill: LodeCatalogSkill, identityId: string) {
    void skill;
    void identityId;
    setSelection(null);
    options.onOpenLibrary();
  }

  function resumeCreateTaskAfterIdentityRecovery() {
    if (identityRecoveryRequest == null) return false;
    setIdentityRecoveryRequest(undefined);
    return true;
  }

  function acknowledgeSiteSkillRecovery(key: number) {
    setSiteSkillRecoveryRequest((current) => current?.key === key ? undefined : current);
  }

  function abandonSiteSkillRecovery() {
    setSiteSkillRecoveryRequest(undefined);
  }

  function abandonIdentityRecovery() {
    setIdentityRecoveryRequest(undefined);
  }

  return {
    acknowledgeSiteSkillRecovery,
    abandonIdentityRecovery,
    abandonSiteSkillRecovery,
    identityRecoveryRequest,
    recoverCandidate,
    recoverRuntimeIdentity,
    recoverRuntimeSkill,
    recoverExactTarget,
    resumeCreateTaskAfterIdentityRecovery,
    siteSkillRecoveryRequest,
  };
}

function useSkillWorkbenchEffects(
  options: SkillWorkbenchOptions,
  contextKey: string,
  requestGateRef: React.RefObject<ReturnType<typeof createLatestRequestGate>>,
  setCompatibility: React.Dispatch<React.SetStateAction<Record<string, SkillIdentityCompatibilityState>>>,
  setSelection: React.Dispatch<React.SetStateAction<CreateTaskSelection | null>>,
) {
  useEffect(() => {
    requestGateRef.current.invalidate();
    return () => requestGateRef.current.invalidate();
  }, [contextKey]);
  useEffect(() => loadCompatibility(options, setCompatibility), [contextKey]);
  useEffect(() => {
    if (options.catalog.status !== "ready") return;
    setSelection((current) => refreshSelection(current, options.catalog));
  }, [options.catalog]);
}

function loadCompatibility(
  options: SkillWorkbenchOptions,
  setCompatibility: React.Dispatch<React.SetStateAction<Record<string, SkillIdentityCompatibilityState>>>,
) {
  let cancelled = false;
  const skills = options.catalog.skills.filter((skill) => !skill.facets.includes("sample"));
  const unavailable = compatibilityUnavailableReason(options);
  if (unavailable != null) {
    setCompatibility(Object.fromEntries(skills.map((skill) => [skill.id, unavailableSkillIdentityCompatibility(unavailable)])));
    return () => { cancelled = true; };
  }
  setCompatibility(initialCompatibility(skills, options));
  const pending = skills.filter((skill) => skill.availability === "available" && !skillRequiresExactTarget(skill));
  const refs = options.identities.map((identity) => identity.identityEnvironmentRef);
  let index = 0;
  const worker = async () => {
    while (!cancelled && index < pending.length) {
      const skill = pending[index++];
      if (skill == null) continue;
      const next = await fetchSkillIdentityCompatibility(options.coreEndpoint, skill, refs);
      if (!cancelled) setCompatibility((current) => ({ ...current, [skill.id]: next }));
    }
  };
  void Promise.all(Array.from({ length: Math.min(4, pending.length) }, worker));
  return () => { cancelled = true; };
}

function initialCompatibility(skills: LodeCatalogSkill[], options: SkillWorkbenchOptions) {
  return Object.fromEntries(skills.map((skill) => {
    const matchingRefs = options.identities.filter((identity) => identity.siteId === skill.siteSlug)
      .map((identity) => identity.identityEnvironmentRef);
    const state = skill.availability !== "available"
      ? unavailableSkillIdentityCompatibility(skill.availabilityReason)
      : skillRequiresExactTarget(skill)
      ? createAwaitingTargetCompatibility(matchingRefs)
      : loadingSkillIdentityCompatibility();
    return [skill.id, state];
  }));
}

async function resolveRefreshedCompatibility(
  options: SkillWorkbenchOptions,
  catalog: LodeCatalogLoadState,
  originalSkill: LodeCatalogSkill,
  identityId: string | undefined,
  targetRef: string | undefined,
  signal: AbortSignal,
): Promise<ResolvedCompatibility | undefined> {
  const skill = catalog.skills.find((item) => item.packageRef === originalSkill.packageRef);
  const identity = options.identities.find((item) => item.id === identityId);
  if (catalog.status !== "ready" || skill?.availability !== "available" || identity == null ||
    skillVersionKey(skill) !== skillVersionKey(originalSkill) || !options.runtime.canUseLiveRuntime) return;
  const compatibility = skillRequiresExactTarget(skill) && targetRef == null
    ? createAwaitingTargetCompatibility([identity.identityEnvironmentRef])
    : await fetchSkillIdentityCompatibility(options.coreEndpoint, skill, [identity.identityEnvironmentRef], signal, targetRef);
  const candidate = compatibility.candidates.find((item) => item.identityEnvironmentRef === identity.identityEnvironmentRef);
  return { skill, identity, compatibility, candidate };
}

function compatibilityUnavailableReason(options: SkillWorkbenchOptions) {
  if (options.catalog.status !== "ready") return "站点技能目录需要刷新后才能检查账号身份。";
  return options.runtime.canUseLiveRuntime ? null : options.runtime.summary;
}

function refreshSelection(current: CreateTaskSelection | null, catalog: LodeCatalogLoadState) {
  if (current == null) return current;
  const skill = catalog.skills.find((item) => item.packageRef === current.skill.packageRef && item.availability === "available");
  return skill == null ? null : { ...current, skill };
}

function skillWorkbenchContextKey(options: SkillWorkbenchOptions) {
  return [
    options.coreEndpoint,
    options.runtime.canUseLiveRuntime,
    options.catalog.status,
    ...options.identities.map((identity) => [
      identity.id, identity.identityEnvironmentRef, identity.source, identity.readiness.state,
      identity.login.state, identity.login.recoveryRequired,
    ].join(":")).sort(),
    ...options.catalog.skills.map(skillVersionKey).sort(),
  ].join("|");
}

function skillVersionKey(skill: LodeCatalogSkill) {
  return [skill.packageRef, skill.lockRef ?? "", skill.version, skill.availability,
    ...skill.actions.map((action) => `${action.id}:${action.operationMode}:${action.resourceRequirementRef}:${action.resourceRequirementProfileIds.join(",")}`),
  ].join(":");
}

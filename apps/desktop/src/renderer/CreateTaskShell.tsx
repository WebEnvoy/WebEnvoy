import { ArrowRight, CircleUserRound } from "lucide-react";
import { useEffect, useRef } from "react";

import type { HarborIdentityLoadState } from "./harborIdentityTypes";
import {
  catalogSkillName,
  catalogSkillSiteName,
  type LodeCatalogLoadState,
  type LodeCatalogSkill,
} from "./lodeCatalogClient";
import { OwnerState } from "./OwnerState";
import { RuntimeBlockedOwnerState, RuntimeCheckingOwnerState } from "./RuntimeOwnerState";
import { runtimeSupervisorIsChecking, type RuntimeSupervisorState } from "./runtimeSupervisorState";
import {
  compatibilityTargetFieldId,
  isCandidateUsable,
  skillRequiresExactTarget,
  type IdentityCompatibilityCandidate,
  type SkillIdentityCompatibilityState,
} from "./coreIdentityCompatibilityClient";
import {
  candidateIdentityList,
  compatibilityCandidate,
  compatibilityCandidateLabel,
  compatibilityRecoveryCopy,
} from "./skillCompatibilityPresentation";
import { compatibilityTargetValue, type SkillInputDraft } from "./skillInputDraft";
import { StructuredTaskComposer } from "./StructuredTaskComposer";
import { createTaskThreadTurn } from "./coreTaskThreadSubmitClient";
import type { TaskProjection } from "./taskThreadFixtures";
export type CreateTaskSelection = {
  skill: LodeCatalogSkill;
  identityId?: string;
  targetRef?: string;
};

type CheckCompatibility = (
  skill: LodeCatalogSkill,
  identityId: string,
  targetRef?: string,
) => Promise<SkillIdentityCompatibilityState | null>;

type CreateTaskShellProps = {
  catalog: LodeCatalogLoadState;
  compatibilityBySkill: Record<string, SkillIdentityCompatibilityState>;
  identities: HarborIdentityLoadState["identities"];
  selection: CreateTaskSelection | null;
  runtimeSupervisorState: RuntimeSupervisorState;
  coreEndpoint: string;
  onSelect: (skill: LodeCatalogSkill, identityId?: string) => void;
  onCreateIdentity: () => void;
  onCheckCompatibility: CheckCompatibility;
  onRecover: () => void;
  onRecoverCandidate: (skill: LodeCatalogSkill, identityId: string, candidate: IdentityCompatibilityCandidate) => void;
  onRecoverRuntimeIdentity: (skill: LodeCatalogSkill, identityId: string) => void;
  onRecoverRuntimeSkill: (skill: LodeCatalogSkill) => void;
  onRecoverExactTarget: (skill: LodeCatalogSkill, identityId: string) => void;
  onTargetChange: (skill: LodeCatalogSkill, identityId: string) => void;
  onTaskCreated: (task: TaskProjection) => void;
};

type CreateTaskIdentity = HarborIdentityLoadState["identities"][number];

type CreateTaskCombination = {
  skill: LodeCatalogSkill;
  identity: CreateTaskIdentity;
  candidate: IdentityCompatibilityCandidate | undefined;
};

export function CreateTaskShell(props: CreateTaskShellProps) {
  const selectedIdentity = props.identities.find((identity) => identity.id === props.selection?.identityId);
  const intro = props.selection == null
    ? "选择账号身份与站点技能后填写业务输入。"
    : selectedIdentity == null
    ? "为当前站点技能选择账号身份。"
    : "业务输入由当前技能合同定义。";
  return (
    <section className="create-task-shell" aria-labelledby="create-task-heading">
      <div className="create-task-intro">
        <h1 id="create-task-heading">这次要让 WebEnvoy 完成什么？</h1>
        <p aria-live="polite">{intro}</p>
      </div>
      <CreateTaskContent {...props} />
    </section>
  );
}

function CreateTaskContent(props: CreateTaskShellProps) {
  const { catalog, compatibilityBySkill, identities, selection, onRecover } = props;
  const identity = identities.find((item) => item.id === selection?.identityId);
  if (catalog.status === "loading") return <OwnerState title="正在读取站点技能" summary={catalog.summary} />;
  if (catalog.status === "offline") return <OwnerState title="站点技能暂不可用" summary={catalog.summary} onRecover={onRecover} />;
  if (catalog.status === "stale") return <OwnerState title="站点技能目录需要刷新" summary={catalog.summary} onRecover={onRecover} />;
  if (selection != null && selection.targetRef == null && skillRequiresExactTarget(selection.skill)) {
    const matchingIdentity = identity ?? candidateIdentityList(selection.skill, identities)[0];
    return <OwnerState
      title="请先从搜索结果选择笔记"
      summary="详情读取只接受搜索结果生成的安全引用，不能直接填写网址。"
      actionLabel={matchingIdentity == null ? "管理账号身份" : "选择搜索技能"}
      onRecover={matchingIdentity == null
        ? props.onCreateIdentity
        : () => props.onRecoverExactTarget(selection.skill, matchingIdentity.id)}
    />;
  }
  if (selection == null || identity == null) {
    return <CreateTaskChooser
      {...props}
      focusIdentitySelection={selection?.identityId != null && identity == null}
      selectedSkill={selection?.skill}
    />;
  }
  return (
    <CreateTaskComposer
      key={`${selection.skill.packageRef}:${selection.skill.version}:${selection.identityId ?? "none"}:${selection.targetRef ?? "manual"}`}
      compatibility={compatibilityBySkill[selection.skill.id]}
      identity={identity}
      selection={selection}
      onCheckCompatibility={props.onCheckCompatibility}
      onRecover={onRecover}
      onRecoverCandidate={props.onRecoverCandidate}
      onRecoverRuntimeIdentity={props.onRecoverRuntimeIdentity}
      onRecoverExactTarget={props.onRecoverExactTarget}
      onTargetChange={props.onTargetChange}
      coreEndpoint={props.coreEndpoint}
      runtimeSupervisorState={props.runtimeSupervisorState}
      onTaskCreated={props.onTaskCreated}
    />
  );
}

function CreateTaskChooser(props: CreateTaskShellProps & { focusIdentitySelection?: boolean; selectedSkill?: LodeCatalogSkill }) {
  const chooserRef = useRef<HTMLDivElement>(null);
  const selectedSkill = props.selectedSkill;
  const selectableSkills = props.catalog.skills.filter((skill) => !skillRequiresExactTarget(skill));
  const skills = selectedSkill == null
    ? selectableSkills
    : selectableSkills.filter((skill) => skill.packageRef === selectedSkill.packageRef);
  const combinations = createTaskCombinations(skills, props.compatibilityBySkill, props.identities);
  const compatibilityLoading = skills.some((skill) =>
    skill.availability === "available" &&
    (props.compatibilityBySkill[skill.id] == null || props.compatibilityBySkill[skill.id]?.status === "loading"),
  );
  useEffect(() => {
    if (!props.focusIdentitySelection) return;
    const frame = window.requestAnimationFrame(() => chooserRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [props.focusIdentitySelection]);
  if (combinations.length === 0) {
    return props.identities.length === 0
      ? <OwnerState title="还没有账号身份" summary="先创建账号身份，再继续创建任务。" actionLabel="创建账号身份" onRecover={props.onCreateIdentity} />
      : <OwnerState title="没有匹配站点的账号身份" summary={props.selectedSkill == null ? "已有账号身份与当前站点技能不匹配。" : "当前技能没有可用的账号身份。"} actionLabel="管理账号身份" onRecover={props.onCreateIdentity} />;
  }
  if (runtimeSupervisorIsChecking(props.runtimeSupervisorState)) return <RuntimeCheckingOwnerState />;
  if (!props.runtimeSupervisorState.canUseLiveRuntime) {
    return <RuntimeBlockedOwnerState
      runtime={props.runtimeSupervisorState}
      onOpenBrowser={selectedSkill == null
        ? props.onCreateIdentity
        : () => props.onRecoverRuntimeSkill(selectedSkill)}
      onOpenSettings={props.onRecover}
    />;
  }
  if (compatibilityLoading && combinations.every(({ candidate }) => candidate == null)) {
    return <OwnerState title="正在检查账号身份" summary="Core 正在预检查站点技能与账号身份是否兼容。" />;
  }
  return (
    <div ref={chooserRef} className="create-task-recommendations" aria-label="账号身份与站点技能组合">
      {combinations.map((combination) => (
        <CreateTaskRecommendation {...combination} {...props} key={`${combination.skill.id}:${combination.identity.id}`} />
      ))}
    </div>
  );
}

function CreateTaskRecommendation({
  skill,
  identity,
  candidate,
  runtimeSupervisorState,
  onSelect,
  onRecoverCandidate,
}: CreateTaskCombination & Pick<CreateTaskShellProps, "runtimeSupervisorState" | "onSelect" | "onRecoverCandidate">) {
  const runtimeUnavailable = skill.availability !== "available" || !runtimeSupervisorState.canUseLiveRuntime;
  const usable = !runtimeUnavailable && isCandidateUsable(candidate);
  const recovery = compatibilityRecoveryCopy(candidate);
  return (
    <button
      type="button"
      disabled={!usable && recovery == null}
      title={runtimeUnavailable ? skill.availabilityReason || runtimeSupervisorState.summary : compatibilityCandidateLabel(candidate)}
      onClick={() => usable ? onSelect(skill, identity.id) : candidate != null && onRecoverCandidate(skill, identity.id, candidate)}
    >
      <span className="create-task-recommendation-icon"><CircleUserRound size={16} /></span>
      <span><strong>{catalogSkillName(skill)}</strong><small>{identity.accountLabel} · {compatibilityCandidateLabel(candidate)}</small></span>
      <ArrowRight size={15} />
    </button>
  );
}

function createTaskCombinations(
  skills: LodeCatalogSkill[],
  compatibilityBySkill: Record<string, SkillIdentityCompatibilityState>,
  identities: HarborIdentityLoadState["identities"],
) {
  return skills.flatMap((skill) => candidateIdentityList(skill, identities).map((identity) => ({
    skill,
    identity,
    candidate: compatibilityCandidate(identity, compatibilityBySkill[skill.id]),
  })));
}

type CreateTaskComposerProps = {
  compatibility?: SkillIdentityCompatibilityState;
  identity?: CreateTaskIdentity;
  selection: CreateTaskSelection;
  onCheckCompatibility: CheckCompatibility;
  onRecover: () => void;
  onRecoverCandidate: (skill: LodeCatalogSkill, identityId: string, candidate: IdentityCompatibilityCandidate) => void;
  onRecoverRuntimeIdentity: (skill: LodeCatalogSkill, identityId: string) => void;
  onRecoverExactTarget: (skill: LodeCatalogSkill, identityId: string) => void;
  onTargetChange: (skill: LodeCatalogSkill, identityId: string) => void;
  coreEndpoint: string;
  runtimeSupervisorState: RuntimeSupervisorState;
  onTaskCreated: (task: TaskProjection) => void;
};

function CreateTaskComposer(props: CreateTaskComposerProps) {
  const { identity, selection } = props;
  if (identity == null) return <OwnerState title="账号身份不可用" summary="重新选择兼容账号身份后再创建任务。" />;
  if (runtimeSupervisorIsChecking(props.runtimeSupervisorState)) return <RuntimeCheckingOwnerState />;
  if (!props.runtimeSupervisorState.canUseLiveRuntime) {
    return <RuntimeBlockedOwnerState
      runtime={props.runtimeSupervisorState}
      onOpenBrowser={() => props.onRecoverRuntimeIdentity(selection.skill, identity.id)}
      onOpenSettings={props.onRecover}
    />;
  }
  return <StructuredTaskComposer
    endpoint={props.coreEndpoint}
    identity={identity}
    runtime={props.runtimeSupervisorState}
    skill={selection.skill}
    fixedBusinessInput={selection.targetRef == null ? undefined : { label: "业务输入", summary: "读取所选搜索结果的详情" }}
    submitLabel="创建任务"
    onPreSubmit={async (draft: SkillInputDraft) => {
      const fieldId = compatibilityTargetFieldId(selection.skill);
      const targetRef = selection.targetRef ?? compatibilityTargetValue(draft, fieldId);
      const state = await props.onCheckCompatibility(selection.skill, identity.id, targetRef);
      const candidate = compatibilityCandidate(identity, state ?? props.compatibility);
      return isCandidateUsable(candidate)
        ? { ok: true }
        : { ok: false, reason: candidate == null ? state?.summary ?? "Core 未返回账号身份兼容性。" : compatibilityCandidateLabel(candidate) };
    }}
    onSubmit={(draft, ownerRefs, executionPolicy, threadModes, threadModeOverrides) => createTaskThreadTurn({
      endpoint: props.coreEndpoint,
      skill: selection.skill,
      identity,
      draft,
      ownerRefs,
      executionPolicy,
      runtime: props.runtimeSupervisorState,
      ownerTargetRef: selection.targetRef,
      threadModes,
      threadModeOverrides,
    })}
    onTask={props.onTaskCreated}
  />;
}

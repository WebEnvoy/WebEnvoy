import { ArrowLeft, ArrowRight, CircleAlert, CircleCheck, Globe2, Plus, UserRound } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";

import type { IdentityCompatibilityCandidate, SkillIdentityCompatibilityState } from "./coreIdentityCompatibilityClient";
import type { IdentityEnvironmentProjection } from "./identityEnvironmentFixtures";
import { catalogSkillName, catalogSkillSiteName, type LodeCatalogLoadState, type LodeCatalogSkill } from "./lodeCatalogClient";
import type { RuntimeSupervisorState } from "./runtimeSupervisorState";
import {
  candidateIdentityList,
  compatibilityCandidate,
  compatibilityCandidateLabel,
  compatibilityRecoveryCopy,
  skillLaunchState,
} from "./skillCompatibilityPresentation";
import { actionLabel, categoryLabel, displaySummary, outputLabel, resultViewLabel, skillStatusLabel } from "./siteSkillPresentation";
import type { SiteSkillRecoveryRequest } from "./siteSkillRecovery";

export type SiteSkillDetailProps = {
  catalogStatus: LodeCatalogLoadState["status"];
  compatibility: SkillIdentityCompatibilityState;
  identities: IdentityEnvironmentProjection[];
  runtimeSupervisorState: RuntimeSupervisorState;
  recoveryRequest?: SiteSkillRecoveryRequest;
  skill: LodeCatalogSkill;
  onBack: () => void;
  onContextChange: () => void;
  onCreateIdentity: () => void;
  onRecoverCandidate: (skill: LodeCatalogSkill, identityId: string, candidate: IdentityCompatibilityCandidate) => void;
  onUse: (skill: LodeCatalogSkill, identityId?: string) => void;
};

export function SiteSkillDetail(props: SiteSkillDetailProps) {
  const { compatibility, identities, skill } = props;
  const backRef = useRef<HTMLButtonElement>(null);
  const identityListRef = useRef<HTMLDivElement>(null);
  const maintenanceRef = useRef<HTMLDetailsElement>(null);
  const compatibleIdentities = candidateIdentityList(skill, identities);
  const [selectedIdentityId, setSelectedIdentityId] = useState(compatibleIdentities[0]?.id ?? "");
  const selectedIdentity = compatibleIdentities.find((identity) => identity.id === selectedIdentityId);
  const candidate = compatibilityCandidate(selectedIdentity, compatibility);
  const recovery = compatibilityRecoveryCopy(candidate);
  const launch = skillLaunchState(skill, selectedIdentity, candidate, compatibility, props.runtimeSupervisorState, props.catalogStatus);

  useEffect(() => backRef.current?.focus(), []);
  useEffect(() => {
    if (!compatibleIdentities.some((identity) => identity.id === selectedIdentityId)) {
      setSelectedIdentityId(compatibleIdentities[0]?.id ?? "");
    }
  }, [compatibleIdentities, selectedIdentityId]);
  useEffect(() => {
    if (props.recoveryRequest?.destination === "skill_repair") {
      if (maintenanceRef.current != null) maintenanceRef.current.open = true;
      maintenanceRef.current?.querySelector<HTMLElement>("summary")?.focus();
    } else if (props.recoveryRequest?.destination === "identity_selection") {
      const originalId = CSS.escape(props.recoveryRequest.identityId);
      const candidate = identityListRef.current?.querySelector<HTMLElement>(`[role='radio']:not([data-identity-id='${originalId}'])`) ??
        document.querySelector<HTMLElement>(".compatible-identities-section .production-secondary-button");
      candidate?.focus();
    }
  }, [props.recoveryRequest]);

  function recover() {
    if (recovery == null || selectedIdentity == null || candidate == null) return;
    if (recovery.destination === "target") props.onUse(skill, selectedIdentity.id);
    else if (recovery.destination === "identity_selection") {
      const alternate = identityListRef.current?.querySelector<HTMLButtonElement>("[role='radio']:not([aria-checked='true'])");
      if (alternate != null) alternate.focus();
      else props.onCreateIdentity();
    } else if (recovery.destination === "skill_repair") {
      if (maintenanceRef.current != null) maintenanceRef.current.open = true;
      maintenanceRef.current?.querySelector<HTMLElement>("summary")?.focus();
    } else props.onRecoverCandidate(skill, selectedIdentity.id, candidate);
  }

  return (
    <div className="production-library-page production-skill-detail">
      <button ref={backRef} className="production-back-link" type="button" onClick={props.onBack}><ArrowLeft size={14} />返回站点技能</button>
      <SkillDetailHeader skill={skill} selectedIdentityId={selectedIdentityId} launch={launch} onUse={props.onUse} />
      {skill.availability !== "available" ? (
        <div className="library-source-notice warning" role="status"><CircleAlert size={15} /><span>{skill.availabilityReason}</span></div>
      ) : null}
      <SkillContractOverview skill={skill} />
      <CompatibleIdentities
        compatibility={compatibility}
        identities={identities}
        candidates={compatibleIdentities}
        identityListRef={identityListRef}
        launchOk={launch.ok}
        recoveryLabel={recovery?.label}
        selectedIdentityId={selectedIdentityId}
        onCreateIdentity={props.onCreateIdentity}
        onRecover={recover}
        onSelect={(identityId) => { props.onContextChange(); setSelectedIdentityId(identityId); }}
      />
      <SkillMaintenance maintenanceRef={maintenanceRef} skill={skill} />
    </div>
  );
}

function SkillDetailHeader({
  skill,
  selectedIdentityId,
  launch,
  onUse,
}: Pick<SiteSkillDetailProps, "skill" | "onUse"> & { selectedIdentityId: string; launch: { ok: boolean; reason: string } }) {
  return (
    <header className="production-page-heading skill-detail-heading">
      <div className="production-skill-title">
        <span className="production-skill-icon large"><Globe2 size={21} /></span>
        <div>
          <span className="production-eyebrow">{catalogSkillSiteName(skill)}</span><h1>{catalogSkillName(skill)}</h1>
          <div className="production-skill-tags">
            <em>{categoryLabel(skill.category)}</em>{skill.actions.map((action) => <em key={action.id}>{actionLabel(action.category)}</em>)}
          </div>
        </div>
      </div>
      <button className="production-primary-button" type="button" disabled={!launch.ok || selectedIdentityId.length === 0} title={launch.reason} onClick={() => onUse(skill, selectedIdentityId)}>
        去使用<ArrowRight size={14} />
      </button>
    </header>
  );
}

function SkillContractOverview({ skill }: Pick<SiteSkillDetailProps, "skill">) {
  return (
    <div className="production-skill-detail-grid">
      <section>
        <h2>这个技能能做什么</h2><p className="production-lead-copy">{displaySummary(skill)}</p>
        <dl className="production-skill-facts">
          <div><dt>业务动作</dt><dd>{skill.actions.length > 0 ? skill.actions.map((action) => actionLabel(action.category)).join("、") : "未声明"}</dd></div>
          <div><dt>返回结果</dt><dd>{outputLabel(skill.outputKind)}</dd></div>
          <div><dt>结果视图</dt><dd>{resultViewLabel(skill)}</dd></div>
        </dl>
      </section>
      <section>
        <h2>创建任务时的输入</h2>
        <div className="production-contract-fields">
          {skill.inputFields.map((field) => (
            <div key={field.id}><span><strong>{field.label}</strong>{field.required ? <em>必填</em> : null}</span><small>{field.options?.join(" / ") ?? field.description}</small></div>
          ))}
        </div>
        <p className="production-muted-copy">字段、选项与校验来自当前技能合同。</p>
      </section>
    </div>
  );
}

function CompatibleIdentities({
  compatibility,
  identities,
  candidates,
  identityListRef,
  launchOk,
  recoveryLabel,
  selectedIdentityId,
  onCreateIdentity,
  onRecover,
  onSelect,
}: {
  compatibility: SkillIdentityCompatibilityState;
  identities: IdentityEnvironmentProjection[];
  candidates: IdentityEnvironmentProjection[];
  identityListRef: React.RefObject<HTMLDivElement | null>;
  launchOk: boolean;
  recoveryLabel: string | undefined;
  selectedIdentityId: string;
  onCreateIdentity: () => void;
  onRecover: () => void;
  onSelect: (identityId: string) => void;
}) {
  return (
    <section className="compatible-identities-section">
      <div><h2>选择账号身份候选</h2><p>由 Core 根据技能声明与账号身份公共状态预检查；提交时会再次确认。</p></div>
      {compatibility.status !== "ready" ? (
        <div className="library-source-notice warning" role="status"><CircleAlert size={15} /><span>{compatibility.summary}</span></div>
      ) : null}
      {candidates.length === 0 ? (
        <button className="production-secondary-button" type="button" onClick={onCreateIdentity}>
          <Plus size={14} />{identities.length === 0 ? "创建账号身份" : "管理账号身份"}
        </button>
      ) : (
        <>
          <IdentityCandidateList
            candidates={candidates}
            compatibility={compatibility}
            identityListRef={identityListRef}
            selectedIdentityId={selectedIdentityId}
            onSelect={onSelect}
          />
          {!launchOk && recoveryLabel != null ? <button className="production-secondary-button" type="button" onClick={onRecover}>{recoveryLabel}</button> : null}
        </>
      )}
    </section>
  );
}

function IdentityCandidateList({
  candidates,
  compatibility,
  identityListRef,
  selectedIdentityId,
  onSelect,
}: {
  candidates: IdentityEnvironmentProjection[];
  compatibility: SkillIdentityCompatibilityState;
  identityListRef: React.RefObject<HTMLDivElement | null>;
  selectedIdentityId: string;
  onSelect: (identityId: string) => void;
}) {
  return (
    <div ref={identityListRef} className="compatible-identity-list" role="radiogroup" aria-label="账号身份候选">
      {candidates.map((identity) => (
        <button
          className={identity.id === selectedIdentityId ? "selected" : ""}
          type="button" role="radio" aria-checked={identity.id === selectedIdentityId}
          tabIndex={identity.id === selectedIdentityId ? 0 : -1}
          data-identity-id={identity.id}
          onClick={() => onSelect(identity.id)}
          onKeyDown={(event) => selectIdentityByKey(event, candidates, identity.id, onSelect)}
          key={identity.id}
        >
          <span className="compatible-identity-icon"><UserRound size={15} /></span>
          <span><strong>{identity.accountLabel}</strong><small>{compatibilityCandidateLabel(compatibilityCandidate(identity, compatibility))}</small></span>
          {identity.id === selectedIdentityId ? <CircleCheck size={15} /> : null}
        </button>
      ))}
    </div>
  );
}

function SkillMaintenance({ maintenanceRef, skill }: { maintenanceRef: React.RefObject<HTMLDetailsElement | null>; skill: LodeCatalogSkill }) {
  return (
    <details ref={maintenanceRef} className="production-skill-maintenance">
      <summary>版本与兼容性<span>当前版本 {skill.version}</span></summary>
      <dl>
        <div><dt>技能包版本</dt><dd>{skill.version}{skill.latestVersion !== skill.version ? `（可更新至 ${skill.latestVersion}）` : ""}</dd></div>
        <div><dt>状态</dt><dd>{skillStatusLabel(skill)} · {skill.lifecycle}</dd></div>
        <div><dt>来源</dt><dd>本机已安装</dd></div><div><dt>更新时间</dt><dd>{skill.updatedAt}</dd></div>
        <div><dt>输入合同</dt><dd>{skill.inputSchemaId || "缺失"}</dd></div><div><dt>输出合同</dt><dd>{skill.outputSchemaId || "缺失"}</dd></div>
        {skill.resultView.mode === "skill" ? (
          <><div><dt>视图版本</dt><dd>{skill.resultView.viewId} · v{skill.resultView.viewVersion}</dd></div><div><dt>兼容回退</dt><dd>App 标准结构化视图</dd></div></>
        ) : null}
        <div><dt>技能包</dt><dd>{skill.packageRef}</dd></div>
      </dl>
    </details>
  );
}

function selectIdentityByKey(
  event: KeyboardEvent<HTMLButtonElement>,
  identities: IdentityEnvironmentProjection[],
  currentId: string,
  select: (id: string) => void,
) {
  const delta = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
  if (delta === 0 || identities.length < 2) return;
  event.preventDefault();
  const nextIndex = (identities.findIndex((identity) => identity.id === currentId) + delta + identities.length) % identities.length;
  select(identities[nextIndex]!.id);
  event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role='radio']")[nextIndex]?.focus();
}

import { AlertTriangle, CircleAlert, CircleCheck, Save, Send, ShieldAlert, Square, Trash2, X } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { CreateTaskFields } from "./CreateTaskFields";
import {
  declaredExecutionCategories,
  executionPolicyModeMutation,
  fetchEffectiveExecutionPolicy,
  fetchSkillExecutionPolicyConfiguration,
  loadingExecutionPolicyState,
  policyModesByCategory,
  policySourceForCategory,
  policySourceLabel,
  putSkillExecutionPolicy,
  putThreadExecutionPolicy,
  sourceVersionForPolicy,
  type EffectiveExecutionPolicy,
  type ExecutionCategory,
  type ExecutionMode,
  type ExecutionPolicyLoadState,
  type ExecutionPolicyModes,
} from "./executionPolicyClient";
import type { HarborIdentityLoadState } from "./harborIdentityTypes";
import { catalogSkillName, catalogSkillSiteName, type LodeCatalogSkill } from "./lodeCatalogClient";
import { releaseLocalAttachments } from "./localFileClient";
import type { RuntimeSupervisorState } from "./runtimeSupervisorState";
import { validateSkillInputDraft, type SkillInputAttachment, type SkillInputDraft, type SkillInputValue } from "./skillInputDraft";
import {
  releaseSkillInputOwnerRefs,
  sealSkillInput,
  type SkillInputOwnerRefs,
  type SkillInputProjectionRefs,
} from "./skillInputOwnerClient";
import {
  initialTaskThreadSubmitState,
  projectTaskSubmissionSkill,
  reconcileTaskThreadTurn,
  type TaskTurnSubmissionAttempt,
  type TaskThreadSubmitState,
} from "./coreTaskThreadSubmitClient";
import { registerComposerInput } from "./focusComposer";
import type { TaskProjection } from "./taskThreadFixtures";
import { useCreateTaskDraft } from "./useCreateTaskDraft";

type Identity = HarborIdentityLoadState["identities"][number];

export type StructuredTaskComposerProps = {
  endpoint: string;
  identity: Identity;
  runtime: RuntimeSupervisorState;
  skill: LodeCatalogSkill;
  threadRef?: string;
  submitBlockedReason?: string;
  activeTurnLabel?: string;
  initialUnknownAttempt?: TaskTurnSubmissionAttempt;
  fixedBusinessInput?: { label: string; summary: string };
  submitLabel: string;
  onPreSubmit?: (draft: SkillInputDraft) => Promise<{ ok: true } | { ok: false; reason: string }>;
  onSubmit: (
    draft: SkillInputDraft,
    ownerRefs: SkillInputProjectionRefs,
    policy: EffectiveExecutionPolicy,
    modes: ExecutionPolicyModes,
    modeOverrides: ExecutionPolicyModes,
  ) => Promise<TaskThreadSubmitState>;
  onCancelActiveTurn?: () => Promise<TaskThreadSubmitState>;
  onTask: (task: TaskProjection) => void;
};

export function StructuredTaskComposer(props: StructuredTaskComposerProps) {
  const { clearDraft, clearing, draft, loading, restored, setDraft } = useCreateTaskDraft(props.skill, props.identity.id);
  const submissionSkill = projectTaskSubmissionSkill(props.skill);
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const [submitted, setSubmitted] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [submitState, setSubmitState] = useState<TaskThreadSubmitState>(() =>
    props.initialUnknownAttempt == null ? initialTaskThreadSubmitState : persistedUnknownState(props.initialUnknownAttempt),
  );
  const [policyState, setPolicyState] = useState<ExecutionPolicyLoadState>(loadingExecutionPolicyState);
  const [modes, setModes] = useState<ExecutionPolicyModes>({});
  const [modifiedCategories, setModifiedCategories] = useState<Set<ExecutionCategory>>(() => new Set());
  const formRef = useRef<HTMLFormElement>(null);
  const errors = props.fixedBusinessInput == null ? validateSkillInputDraft(submissionSkill, draft) : {};

  useEffect(() => {
    let cancelled = false;
    setPolicyState(loadingExecutionPolicyState());
    void fetchEffectiveExecutionPolicy(props.endpoint, props.skill.packageRef, props.threadRef).then((state) => {
      if (cancelled) return;
      setPolicyState(state);
      if (state.status === "ready") {
        setModes(policyModesByCategory(state.policy));
        setModifiedCategories(new Set());
      }
    });
    return () => { cancelled = true; };
  }, [props.endpoint, props.skill.packageRef, props.threadRef]);

  useEffect(() => {
    const attempt = props.initialUnknownAttempt;
    setSubmitState((current) => {
      if (attempt == null) return current.status === "unknown" ? initialTaskThreadSubmitState : current;
      if (
        current.status === "unknown" &&
        current.attempt.threadRef === attempt.threadRef &&
        current.attempt.idempotencyKey === attempt.idempotencyKey
      ) return current;
      return persistedUnknownState(attempt);
    });
  }, [props.initialUnknownAttempt?.idempotencyKey, props.initialUnknownAttempt?.threadRef]);

  useEffect(() => {
    const input = formRef.current?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input:not([type='hidden']), textarea, select");
    if (input == null) return;
    input.dataset.webenvoyComposer = "";
    return registerComposerInput(input, { composerId: props.threadRef ? "task-thread-primary" : "create-task-primary", isPrimaryComposer: true });
  }, [props.skill.packageRef, props.threadRef]);

  useEffect(() => {
    if (props.fixedBusinessInput == null) return;
    const frame = window.requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>("[data-fixed-business-input]")?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [props.fixedBusinessInput?.summary]);

  if (loading) return <div className="composer-owner-state" role="status">正在恢复受保护草稿。</div>;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (Object.keys(errors).length > 0) {
      announceAndFocus(`有 ${Object.keys(errors).length} 个字段需要修正。`);
      return;
    }
    if (props.submitBlockedReason != null) {
      setSubmitState({ status: "blocked", summary: props.submitBlockedReason });
      return;
    }
    if (policyState.status !== "ready") {
      setSubmitState({ status: "blocked", summary: policyState.summary });
      return;
    }
    const preflight = await props.onPreSubmit?.(draft);
    if (preflight != null && !preflight.ok) {
      setSubmitState({ status: "blocked", summary: preflight.reason });
      return;
    }
    const submittedDraft = props.fixedBusinessInput == null ? draft : { values: {}, files: {} };
    let sealedOwnerRefs: SkillInputOwnerRefs | undefined;
    setSubmitState({
      status: "submitting",
      summary: props.fixedBusinessInput == null ? "正在封存业务输入并提交 Core 任务回合。" : "正在提交 Core 任务回合。",
    });
    if (props.fixedBusinessInput == null) {
      const sealed = await sealSkillInput(props.skill, props.identity.id, submittedDraft);
      if (!sealed.ok) {
        setSubmitState({ status: "blocked", summary: sealed.reason });
        return;
      }
      sealedOwnerRefs = sealed.refs;
    }
    const result = await props.onSubmit(
      submittedDraft,
      sealedOwnerRefs ?? { fieldOwnerRefs: {}, attachmentRefs: {} },
      policyState.policy,
      modes,
      executionPolicyModeMutation(modes, modifiedCategories),
    );
    setSubmitState(result);
    if ("task" in result && result.task != null) props.onTask(result.task);
    if ((result.status === "blocked" || result.status === "failed") && sealedOwnerRefs != null) {
      await releaseSkillInputOwnerRefs([sealedOwnerRefs.ownerRef]);
    }
    if (result.status !== "ready") return;
    await finishAcceptedTurn();
  }

  async function finishAcceptedTurn() {
    if (props.fixedBusinessInput != null) {
      setAnnouncement("任务回合已提交。");
      return;
    }
    const persistence = await clearDraft();
    setTouched(new Set());
    setSubmitted(false);
    setAnnouncement(persistence === "ready"
      ? "任务回合已提交，业务输入已清空。"
      : "任务回合已提交，当前输入已清空，但无法确认系统受保护存储中的旧草稿已删除。");
  }

  function announceAndFocus(message: string) {
    setAnnouncement(message);
    window.requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus());
  }

  function updateValue(id: string, value: SkillInputValue) {
    setDraft((current) => ({ ...current, values: { ...current.values, [id]: value } }));
    setSubmitState((current) => current.status === "unknown" ? current : initialTaskThreadSubmitState);
  }

  function updateFiles(id: string, files: SkillInputAttachment[]) {
    const retained = new Set(files.map((file) => file.id));
    void releaseLocalAttachments((draft.files[id] ?? []).filter((file) => !retained.has(file.id)));
    setDraft((current) => ({ ...current, files: { ...current.files, [id]: files } }));
    setSubmitState((current) => current.status === "unknown" ? current : initialTaskThreadSubmitState);
  }

  async function clearEntireDraft() {
    const persistence = await clearDraft();
    setTouched(new Set());
    setSubmitted(false);
    setSubmitState((current) => current.status === "unknown" ? current : initialTaskThreadSubmitState);
    setAnnouncement(persistence === "ready"
      ? "业务输入已清空。"
      : "当前输入已清空，但无法确认系统受保护存储中的旧记录已删除。");
  }

  async function cancelActiveTurn() {
    if (props.onCancelActiveTurn == null) return;
    setSubmitState({ status: "submitting", summary: `正在停止${props.activeTurnLabel ?? "当前回合"}。` });
    const result = await props.onCancelActiveTurn();
    setSubmitState(result);
    if ("task" in result && result.task != null) props.onTask(result.task);
  }

  async function reconcileUnknownTurn() {
    if (submitState.status !== "unknown") return;
    const attempt = submitState.attempt;
    setSubmitState({ status: "submitting", summary: "正在按原提交标识检查 Core 线程事实。" });
    const result = await reconcileTaskThreadTurn(props.endpoint, attempt);
    setSubmitState(result);
    if ("task" in result && result.task != null) props.onTask(result.task);
    if (result.status === "ready") await finishAcceptedTurn();
  }

  return (
    <form ref={formRef} className="thread-composer create-task-composer structured-task-composer" noValidate onSubmit={submit}>
      <div className="sr-only" aria-live="assertive" aria-atomic="true">{announcement}</div>
      {props.fixedBusinessInput == null && (restored.restored || restored.persistence === "unavailable") ? (
        <div className="create-task-draft-state" role="status">
          {restored.restored ? "已恢复草稿。" : ""}
          {restored.omittedFieldIds.length > 0 ? "敏感字段需重新填写。" : ""}
          {restored.persistence === "unavailable" ? "系统受保护存储不可用。" : ""}
        </div>
      ) : null}
      <fieldset className="create-task-fieldset" disabled={clearing || submitState.status === "submitting"}>
        {props.fixedBusinessInput == null ? (
          <CreateTaskFields
            draft={draft}
            errors={errors}
            submitted={submitted}
            touched={touched}
            onBlur={(fieldId) => setTouched((current) => new Set(current).add(fieldId))}
            onFiles={updateFiles}
            onValue={updateValue}
            skill={submissionSkill}
          />
        ) : (
          <div className="fixed-business-input" aria-label="业务输入" data-fixed-business-input tabIndex={-1}>
            <span>{props.fixedBusinessInput.label}</span>
            <strong>{props.fixedBusinessInput.summary}</strong>
          </div>
        )}
      </fieldset>
      <ComposerFooter
        {...props}
        clearing={clearing}
        modes={modes}
        modifiedCategories={modifiedCategories}
        policyState={policyState}
        submitState={submitState}
        onCancel={cancelActiveTurn}
        onClear={clearEntireDraft}
        onModes={setModes}
        onModifiedCategories={setModifiedCategories}
        onPolicyState={setPolicyState}
        onReconcile={reconcileUnknownTurn}
      />
      <ComposerStatus blockedReason={props.submitBlockedReason} state={submitState} onReconcile={reconcileUnknownTurn} />
    </form>
  );
}

function ComposerFooter(props: StructuredTaskComposerProps & {
  clearing: boolean;
  modes: ExecutionPolicyModes;
  modifiedCategories: Set<ExecutionCategory>;
  policyState: ExecutionPolicyLoadState;
  submitState: TaskThreadSubmitState;
  onCancel: () => void;
  onClear: () => void;
  onModes: (modes: ExecutionPolicyModes) => void;
  onModifiedCategories: (categories: Set<ExecutionCategory>) => void;
  onPolicyState: (state: ExecutionPolicyLoadState) => void;
  onReconcile: () => void;
}) {
  const busy = props.clearing || props.submitState.status === "submitting";
  const submitLocked = busy || props.submitState.status === "unknown";
  return (
    <div className="create-task-composer-toolbar">
      {props.fixedBusinessInput == null ? <button className="composer-icon-button" type="button" disabled={busy} aria-label="清空业务输入" title="清空业务输入" onClick={props.onClear}><Trash2 size={14} /></button> : null}
      <span className="create-task-context" title={`${catalogSkillSiteName(props.skill)} · ${catalogSkillName(props.skill)} · ${props.identity.accountLabel}`}>
        <strong>{catalogSkillName(props.skill)}</strong><small>{props.identity.accountLabel} · {catalogSkillSiteName(props.skill)}</small>
      </span>
      <ExecutionPolicyMenu {...props} />
      <DangerousAutoRisk active={declaredExecutionCategories(props.skill).includes("destructive") && props.modes.destructive === "auto"} />
      {props.onCancelActiveTurn == null ? null : (
        <button className="composer-icon-button" type="button" disabled={busy} aria-label="停止当前回合" title="停止当前回合" onClick={props.onCancel}><Square size={13} /></button>
      )}
      <button className="production-primary-button create-task-submit" type="submit" disabled={submitLocked || props.submitBlockedReason != null || props.policyState.status !== "ready"}>
        <Send size={14} />{busy ? "提交中" : props.submitLabel}
      </button>
    </div>
  );
}

function ExecutionPolicyMenu(props: StructuredTaskComposerProps & {
  modes: ExecutionPolicyModes;
  modifiedCategories: Set<ExecutionCategory>;
  policyState: ExecutionPolicyLoadState;
  onModes: (modes: ExecutionPolicyModes) => void;
  onModifiedCategories: (categories: Set<ExecutionCategory>) => void;
  onPolicyState: (state: ExecutionPolicyLoadState) => void;
}) {
  const categories = declaredExecutionCategories(props.skill);
  const current = props.policyState.status === "ready" ? policySummary(props.policyState.policy, categories[0]) : props.policyState.summary;
  async function save(destination: "thread" | "skill") {
    if (props.policyState.status !== "ready" || props.modifiedCategories.size === 0) return;
    props.onPolicyState({ status: "loading", summary: "正在保存执行方式。" });
    let sourceVersion = sourceVersionForPolicy(props.policyState.policy, "thread_revision");
    if (destination === "skill") {
      const configuration = await fetchSkillExecutionPolicyConfiguration(props.endpoint, props.skill.packageRef);
      if (configuration.status !== "ready") {
        props.onPolicyState({ status: "unavailable", summary: configuration.summary });
        return;
      }
      sourceVersion = configuration.configuration?.sourceVersion ?? null;
    }
    const mutationModes = executionPolicyModeMutation(props.modes, props.modifiedCategories);
    const state = destination === "thread" && props.threadRef
      ? await putThreadExecutionPolicy(props.endpoint, props.threadRef, props.skill.packageRef, mutationModes, sourceVersion)
      : await putSkillExecutionPolicy(props.endpoint, props.skill.packageRef, mutationModes, sourceVersion);
    if (state.status !== "ready") {
      props.onPolicyState(state);
      return;
    }
    const effective = await fetchEffectiveExecutionPolicy(props.endpoint, props.skill.packageRef, props.threadRef);
    props.onPolicyState(effective);
    if (effective.status === "ready") {
      props.onModes(policyModesByCategory(effective.policy));
      props.onModifiedCategories(new Set());
    }
  }
  return (
    <details className="composer-execution-menu">
      <summary title="当前执行方式"><ShieldAlert size={14} /><span>{current}</span></summary>
      <div className="composer-execution-popover">
        {categories.map((category) => (
          <div className="composer-execution-row" key={category}>
            <span><strong>{categoryLabel(category)}</strong><small>{categoryDetail(category)}</small></span>
            <div role="group" aria-label={`${categoryLabel(category)}执行方式`}>
              {(["auto", "confirm", "deny"] as ExecutionMode[]).map((mode) => (
                <button
                  type="button"
                  className={props.modes[category] === mode ? "selected" : ""}
                  aria-pressed={props.modes[category] === mode}
                  onClick={() => updateMode(props, category, mode)}
                  key={mode}
                >{modeLabel(mode)}</button>
              ))}
            </div>
          </div>
        ))}
        {props.threadRef ? (
          <div className="composer-execution-actions">
            <button type="button" disabled={props.modifiedCategories.size === 0} onClick={() => void save("thread")}><CircleCheck size={13} />保存到当前线程</button>
            <button type="button" disabled={props.modifiedCategories.size === 0} onClick={() => void save("skill")}><Save size={13} />另存为我的技能默认</button>
          </div>
        ) : <small>未修改时沿用当前有效方式；仅修改项会写入新线程。</small>}
      </div>
    </details>
  );
}

function updateMode(
  props: {
    modes: ExecutionPolicyModes;
    modifiedCategories: Set<ExecutionCategory>;
    policyState: ExecutionPolicyLoadState;
    onModes: (modes: ExecutionPolicyModes) => void;
    onModifiedCategories: (categories: Set<ExecutionCategory>) => void;
  },
  category: ExecutionCategory,
  mode: ExecutionMode,
) {
  const modified = new Set(props.modifiedCategories);
  const effective = props.policyState.status === "ready" ? policyModesByCategory(props.policyState.policy)[category] : undefined;
  if (mode === effective) modified.delete(category);
  else modified.add(category);
  props.onModes({ ...props.modes, [category]: mode });
  props.onModifiedCategories(modified);
}

function DangerousAutoRisk({ active }: { active: boolean }) {
  const [copyDismissed, setCopyDismissed] = useState(false);
  if (!active) return null;
  return (
    <span className="composer-dangerous-auto-risk" title="危险行为已设为自动执行">
      <AlertTriangle size={15} />
      {copyDismissed ? null : <span>危险行为自动执行</span>}
      {copyDismissed ? null : (
        <button type="button" aria-label="关闭危险行为说明" title="关闭说明" onClick={() => setCopyDismissed(true)}><X size={12} /></button>
      )}
    </span>
  );
}

function ComposerStatus({ blockedReason, state, onReconcile }: {
  blockedReason?: string;
  state: TaskThreadSubmitState;
  onReconcile: () => void;
}) {
  if (state.status === "idle" && blockedReason == null) return null;
  const status = state.status === "unknown" ? "unknown" : blockedReason == null ? state.status : "blocked";
  const summary = state.status === "unknown" ? state.summary : blockedReason ?? state.summary;
  return (
    <div className={`create-task-submit-state ${status}`} role="status">
      <CircleAlert size={15} />
      <span>
        <strong>{status === "submitting" ? "正在处理" : status === "ready" ? "已处理" : status === "unknown" ? "状态未知" : "暂不可提交"}</strong>
        <small>{summary}</small>
      </span>
      {state.status === "unknown" ? (
        <button type="button" onClick={onReconcile}>重新检查</button>
      ) : null}
    </div>
  );
}

function persistedUnknownState(attempt: TaskTurnSubmissionAttempt): TaskThreadSubmitState {
  return {
    status: "unknown",
    summary: "Core 尚未确认当前回合状态；重新检查不会重复提交。",
    attempt,
  };
}

function policySummary(policy: EffectiveExecutionPolicy, category: ExecutionCategory | undefined) {
  const effective = category == null ? null : policySourceForCategory(policy, category);
  return effective == null || category == null ? "执行方式不可用" : `${categoryLabel(category)} · ${modeLabel(effective.mode)} · ${policySourceLabel(effective.source)}`;
}

function categoryLabel(category: ExecutionCategory) {
  return { read: "读取和下载", prepare: "填写但不提交", commit: "发布或提交", destructive: "危险行为" }[category];
}

function categoryDetail(category: ExecutionCategory) {
  return { read: "浏览、读取或下载", prepare: "填写或生成内容并停在提交前", commit: "发布、发送或提交", destructive: "删除、付款或其他难以撤销的动作" }[category];
}

function modeLabel(mode: ExecutionMode) {
  return { auto: "自动", confirm: "确认", deny: "禁止" }[mode];
}

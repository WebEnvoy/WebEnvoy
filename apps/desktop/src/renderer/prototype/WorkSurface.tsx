import {
  ArrowUp,
  ArrowUpRight,
  BookOpenText,
  Bookmark,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  ExternalLink,
  FileText,
  FolderOpen,
  ListFilter,
  Library,
  LoaderCircle,
  Paperclip,
  PenLine,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Square,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type FocusEvent as ReactFocusEvent, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";

import { ThreadNavigationRail, type ThreadNavigationItem } from "../ThreadNavigationRail";

import {
  actionCategories,
  actionCategoryLabels,
  articleResultForRun,
  executionModeLabels,
  hasCompatibleOutputView,
  identityCanUseSkill,
  initialActionCategoryForTask,
  productRows,
  resultRows,
  snapshotSubmittedFields,
  skills,
  writeResultForRun,
  type ActionCategory,
  type ExecutionMode,
  type ExecutionPolicy,
  type Identity,
  type PrototypeRun,
  type PrototypePreviewSelection,
  type PrototypeTask,
  type Skill,
  type SkillInputField,
} from "./prototypeData";

export function WorkSurface({
  globalPolicy,
  identities,
  initialTaskDraft,
  mode,
  preferredIdentityId,
  selectedSkill,
  selectedSkillEnabled,
  skillPolicy,
  task,
  taskExecutionModes,
  taskExecutionSources,
  tasks,
  threadExecutionModes,
  onCreateIdentity,
  onCreateTask,
  onOpenPreview,
  onOpenBrowser,
  onOpenLibrary,
  onContinueWrite,
  onReconnectTask,
  onRecoverIdentity,
  onReturnWriteToEdit,
  onTerminateUnknownTask,
  onTakeoverAborted,
  onTakeoverCompleted,
  onSelectSkill,
}: {
  globalPolicy: ExecutionPolicy;
  identities: Identity[];
  initialTaskDraft?: Record<string, string>;
  mode: "detail" | "create";
  preferredIdentityId: string;
  selectedSkill: Skill;
  selectedSkillEnabled: boolean;
  skillPolicy?: ExecutionPolicy;
  task: PrototypeTask;
  taskExecutionModes: ExecutionPolicy;
  taskExecutionSources: Record<ActionCategory, string>;
  tasks: PrototypeTask[];
  threadExecutionModes: Record<string, Partial<ExecutionPolicy>>;
  onCreateIdentity: (inputs: Record<string, string>) => void;
  onCreateTask: (task: PrototypeTask, executionModes?: Partial<ExecutionPolicy>) => void;
  onOpenPreview: (selection: PrototypePreviewSelection) => void;
  onOpenBrowser: () => void;
  onOpenLibrary: () => void;
  onContinueWrite: (runId: string, executionSource: string) => void;
  onReconnectTask: () => void;
  onRecoverIdentity: () => void;
  onReturnWriteToEdit: (run: PrototypeRun) => void;
  onTerminateUnknownTask: () => void;
  onTakeoverAborted: () => void;
  onTakeoverCompleted: () => void;
  onSelectSkill: (skillId: string) => void;
}) {
  if (mode === "create") {
    return (
      <CreateTaskSurface
        globalPolicy={globalPolicy}
        identities={identities}
        initialTaskDraft={initialTaskDraft}
        preferredIdentityId={preferredIdentityId}
        selectedSkill={selectedSkill}
        selectedSkillEnabled={selectedSkillEnabled}
        skillPolicy={skillPolicy}
        tasks={tasks}
        threadExecutionModes={threadExecutionModes}
        onCreateIdentity={onCreateIdentity}
        onCreateTask={onCreateTask}
        onOpenLibrary={onOpenLibrary}
        onSelectSkill={onSelectSkill}
      />
    );
  }

  return (
    <TaskDetail
      task={task}
      executionModes={taskExecutionModes}
      executionSources={taskExecutionSources}
      onContinueWrite={onContinueWrite}
      onReconnectTask={onReconnectTask}
      onRecoverIdentity={onRecoverIdentity}
      onReturnWriteToEdit={onReturnWriteToEdit}
      onTerminateUnknownTask={onTerminateUnknownTask}
      onOpenBrowser={onOpenBrowser}
      onOpenPreview={onOpenPreview}
      onTakeoverAborted={onTakeoverAborted}
      onTakeoverCompleted={onTakeoverCompleted}
    />
  );
}

function TaskDetail({
  task,
  executionModes,
  executionSources,
  onContinueWrite,
  onReconnectTask,
  onRecoverIdentity,
  onReturnWriteToEdit,
  onTerminateUnknownTask,
  onOpenBrowser,
  onOpenPreview,
  onTakeoverAborted,
  onTakeoverCompleted,
}: {
  task: PrototypeTask;
  executionModes: ExecutionPolicy;
  executionSources: Record<ActionCategory, string>;
  onContinueWrite: (runId: string, executionSource: string) => void;
  onReconnectTask: () => void;
  onRecoverIdentity: () => void;
  onReturnWriteToEdit: (run: PrototypeRun) => void;
  onTerminateUnknownTask: () => void;
  onOpenBrowser: () => void;
  onOpenPreview: (selection: PrototypePreviewSelection) => void;
  onTakeoverAborted: () => void;
  onTakeoverCompleted: () => void;
}) {
  const [takeoverStep, setTakeoverStep] = useState<"idle" | "opened" | "validating" | "failed">("idle");
  const [takeoverAttempts, setTakeoverAttempts] = useState(0);
  const threadContentRef = useRef<HTMLDivElement | null>(null);
  const previousLatestRunStateRef = useRef(task.runs?.at(-1)?.state ?? task.state);
  const storedRuns = task.runs ?? [{ id: "run-current", label: task.title, input: task.title, state: task.state, stateLabel: task.stateLabel, summary: task.summary, artifactSet: task.artifactSet, artifactState: task.artifactState, artifactTotal: task.artifactTotal, artifactCurrent: task.artifactCurrent }];
  const taskResumed = task.kind === "takeover" && task.state === "running";
  const runs = taskResumed ? storedRuns.map((run, index) => index === storedRuns.length - 1 ? { ...run, state: "running" as const, stateLabel: "正在继续", summary: "登录状态校验成功，任务已恢复执行。" } : run) : storedRuns;

  useEffect(() => {
    setTakeoverStep("idle");
    setTakeoverAttempts(0);
    previousLatestRunStateRef.current = task.runs?.at(-1)?.state ?? task.state;
  }, [task.id]);

  useEffect(() => {
    if (takeoverStep !== "validating") return;
    const timer = window.setTimeout(() => {
      if (takeoverAttempts === 0) {
        setTakeoverAttempts(1);
        setTakeoverStep("failed");
      } else {
        onTakeoverCompleted();
      }
    }, 900);
    return () => window.clearTimeout(timer);
  }, [onTakeoverCompleted, takeoverAttempts, takeoverStep]);

  useEffect(() => {
    if (takeoverStep !== "failed") return;
    window.requestAnimationFrame(() => threadContentRef.current?.querySelector<HTMLElement>("[data-takeover-recovery] button")?.focus());
  }, [takeoverStep]);

  useEffect(() => {
    if (!taskResumed || takeoverStep !== "validating") return;
    setTakeoverStep("idle");
    window.requestAnimationFrame(() => threadContentRef.current?.querySelector<HTMLElement>(".task-turn-detail:last-child .task-execution-disclosure > summary")?.focus());
  }, [taskResumed, takeoverStep]);

  useEffect(() => {
    const latestState = task.runs?.at(-1)?.state ?? task.state;
    const previousState = previousLatestRunStateRef.current;
    previousLatestRunStateRef.current = latestState;
    if (previousState !== "checking" || latestState === "checking") return;
    const selector = latestState === "unknown"
      ? "[data-run-recovery] .prototype-button.primary"
      : ".task-turn-detail:last-child .task-execution-disclosure > summary";
    window.requestAnimationFrame(() => threadContentRef.current?.querySelector<HTMLElement>(selector)?.focus());
  }, [task.runs, task.state]);

  return (
    <div className="prototype-page task-detail-page">
      <div className="prototype-task-thread-layout">
        <PrototypeRunRail runs={runs} taskId={task.id} />
        <div ref={threadContentRef} className="prototype-task-thread-content">
          {task.identityRemoval != null ? <section className="prototype-callout action-needed task-identity-recovery"><CircleAlert size={18} /><div><strong>{task.identityRemoval === "environment-deleted" ? "本机账号环境已删除" : "账号身份已从 App 移除"}</strong><p>历史回合仍可查看，但这个线程不能继续提交。请选择兼容账号身份创建新线程。</p></div><button className="prototype-button primary" type="button" onClick={onRecoverIdentity}>选择账号身份</button></section> : null}
          <div className="task-turn-timeline">
            {runs.map((run, index) => <TaskTurn key={`${task.id}-${run.id}`} run={run} task={task} latest={index === runs.length - 1} taskResumed={taskResumed} takeoverStep={takeoverStep} executionModes={executionModes} executionSources={executionSources} onContinueWrite={onContinueWrite} onOpenBrowser={onOpenBrowser} onOpenPreview={onOpenPreview} onReconnectTask={onReconnectTask} onReturnWriteToEdit={onReturnWriteToEdit} onTakeoverAborted={onTakeoverAborted} onTakeoverStepChange={setTakeoverStep} onTerminateUnknownTask={onTerminateUnknownTask} />)}
          </div>
        </div>
      </div>
    </div>
  );
}

function TaskTurn({ run, task, latest, taskResumed, takeoverStep, executionModes, executionSources, onContinueWrite, onOpenBrowser, onOpenPreview, onReconnectTask, onReturnWriteToEdit, onTakeoverAborted, onTakeoverStepChange, onTerminateUnknownTask }: { run: PrototypeRun; task: PrototypeTask; latest: boolean; taskResumed: boolean; takeoverStep: "idle" | "opened" | "validating" | "failed"; executionModes: ExecutionPolicy; executionSources: Record<ActionCategory, string>; onContinueWrite: (runId: string, executionSource: string) => void; onOpenBrowser: () => void; onOpenPreview: (selection: PrototypePreviewSelection) => void; onReconnectTask: () => void; onReturnWriteToEdit: (run: PrototypeRun) => void; onTakeoverAborted: () => void; onTakeoverStepChange: (step: "idle" | "opened" | "validating" | "failed") => void; onTerminateUnknownTask: () => void }) {
  const waiting = latest && task.kind === "takeover" && task.state === "waiting";
  const resumed = latest && taskResumed;
  const newlyCreated = latest && !resumed && run.state === "running" && run.artifactState === "pending";
  const progressSummary = run.state === "running" || run.state === "waiting" || run.state === "checking" || run.state === "unknown";
  const actions = taskExecutionActions(task, run, { newlyCreated, resumed, waiting });
  const summaryCopy = taskSummaryCopy(run, { newlyCreated, resumed, waiting });
  const previewTab = hasCompatibleOutputView(run.outputView, run.artifactSet ?? task.artifactSet) ? "skill-view" : run.artifactSet === "article" ? "markdown" : run.artifactSet === "download-files" ? "media" : "json";
  const executionState = run.state === "running" || run.state === "checking" ? "running" : run.state === "waiting" ? "waiting" : run.state === "unknown" ? "unknown" : run.state === "cancelled" ? "cancelled" : "complete";
  const terminating = run.state === "checking" && run.stateLabel === "正在终止";
  const executionLabel = terminating ? "正在终止" : run.state === "checking" ? "正在检查" : executionState === "running" ? "正在执行" : executionState === "waiting" ? "等待处理" : executionState === "unknown" ? "状态未知" : executionState === "cancelled" ? "已取消" : "已处理";
  const hasResult = run.artifactState === "ready";
  const source = run.source ?? task.source;

  return (
    <article className="task-turn-detail" data-content-search-unit-key={`${task.id}-${run.id}`}>
      <TaskInputCard task={task} run={run} />
      <section className="task-progress-block" aria-label={`${run.label}执行记录`}>
        <details className="task-execution-disclosure">
          <summary><span className={`task-execution-status ${executionState}`}><ChevronDown size={14} /><strong>{executionLabel}</strong><small>{executionState === "complete" ? run.duration ?? "耗时未知" : executionState === "running" ? `${actions.length} 个动作` : executionState === "unknown" ? "等待重新检查" : executionState === "cancelled" ? "已停止" : "需要人工处理"}</small></span></summary>
          <ol>{actions.map((action, index) => <li key={`${action.label}-${index}`}><span className={`task-action-marker ${action.state}`} aria-hidden="true">{action.state === "running" ? <LoaderCircle size={12} /> : action.state === "success" ? <Check size={12} /> : action.state === "cancelled" ? <X size={12} /> : <CircleAlert size={12} />}</span><div><strong>{action.label}</strong><p>{action.detail}</p></div></li>)}</ol>
        </details>
        {waiting ? <section className="prototype-callout action-needed" data-takeover-recovery={takeoverStep === "failed" ? "" : undefined}><CircleAlert size={18} /><div><strong>{takeoverStep === "failed" ? "仍未检测到登录" : "需要你完成登录"}</strong><p>{takeoverStep === "idle" ? "任务已暂停。打开对应账号的浏览器，登录后返回这里确认。" : takeoverStep === "opened" ? "浏览器已拉起；完成登录后点击“我已完成”。" : takeoverStep === "validating" ? "正在校验登录与页面状态。" : "登录或目标页面校验失败；可以重新打开、再次校验或终止本回合。"}</p></div><div className="section-actions">{takeoverStep === "idle" ? <button className="prototype-button primary" type="button" onClick={() => { onOpenBrowser(); onTakeoverStepChange("opened"); }}>打开浏览器</button> : takeoverStep === "opened" ? <><button className="prototype-button" type="button" onClick={onTakeoverAborted}>无法完成</button><button className="prototype-button primary" type="button" onClick={() => onTakeoverStepChange("validating")}><Check size={14} />我已完成</button></> : takeoverStep === "validating" ? <button className="prototype-button" type="button" disabled><LoaderCircle size={14} />正在校验</button> : <><button className="prototype-button" type="button" onClick={() => { onOpenBrowser(); onTakeoverStepChange("opened"); }}>再次打开</button><button className="prototype-button" type="button" onClick={() => onTakeoverStepChange("validating")}>重新校验</button><button className="prototype-button danger" type="button" onClick={onTakeoverAborted}>终止回合</button></>}</div></section> : null}
        {latest && run.state === "checking" ? <section className="prototype-callout action-needed"><LoaderCircle size={18} /><div><strong>{terminating ? "正在终止回合" : "正在重新检查"}</strong><p>{terminating ? "已发送终止请求，正在等待运行服务确认；确认前不会解锁新的提交。" : "正在读取原回合的运行事实，不会重复提交。"}</p></div><button className="prototype-button" type="button" disabled>{terminating ? "终止中" : "检查中"}</button></section> : null}
        {latest && run.state === "unknown" ? <section className="prototype-callout action-needed" data-run-recovery=""><CircleAlert size={18} /><div><strong>{run.recoveryAttempts ? "仍无法确认运行状态" : "暂时无法确认运行状态"}</strong><p>{run.recoveryAttempts ? "运行服务仍不可达。可以稍后重试，或明确终止这个回合。" : "App 会先重新读取运行事实，不会自动重复提交这个回合。"}</p></div><div className="section-actions"><button className="prototype-button danger" type="button" onClick={onTerminateUnknownTask}>终止回合</button><button className="prototype-button primary" type="button" onClick={onReconnectTask}><RefreshCw size={14} />重新检查</button></div></section> : null}
      </section>
      <section className="task-summary-block" aria-label={`${run.label}${progressSummary ? "进度" : "结果"}`}>
        <header><div className={`task-summary-heading ${run.state === "checking" ? "running" : run.state}`}><span className="task-summary-state-icon" aria-hidden="true">{run.state === "success" || run.state === "not-submitted" ? <CheckCircle2 size={17} /> : run.state === "running" || run.state === "checking" ? <LoaderCircle size={17} /> : <CircleAlert size={17} />}</span><h2>{summaryCopy}</h2></div>{run.artifactState !== "none" ? <button className="task-preview-button" type="button" aria-label={`在右侧打开${run.label}结果`} title="在右侧打开结果" onClick={() => onOpenPreview({ kind: "file", runId: run.id, tab: previewTab })}><ArrowUpRight size={15} /></button> : null}</header>
        {newlyCreated ? <div className="task-progress-snapshot"><div className="prototype-progress"><span style={{ width: "16%" }} /></div><span>准备中</span></div> : null}
        {!newlyCreated && hasResult && task.kind === "collection" ? <CollectionResult executionMode={executionModes.observe} executionSource={executionSources.observe} run={run} task={task} onOpenPreview={onOpenPreview} /> : null}
        {!newlyCreated && hasResult && task.kind === "article" ? <ArticleResult run={run} /> : null}
        {!newlyCreated && hasResult && task.kind === "download" ? <DownloadResult executionMode={executionModes.observe} executionSource={executionSources.observe} /> : null}
        {!newlyCreated && hasResult && task.kind === "write" ? <WriteResult run={run} task={task} executionMode={executionModes.external} executionSource={executionSources.external} onContinue={onContinueWrite} onReturnEdit={() => onReturnWriteToEdit(run)} /> : null}
        {resumed ? <div className="task-progress-snapshot"><div className="prototype-progress"><span style={{ width: "22%" }} /></div><span>已读取 3 / 18</span></div> : null}
      </section>
      {run.endedAt != null ? <footer className="task-turn-timestamp"><time aria-label={`回合结束于 ${run.endedAt}`}>{run.endedAt}</time>{source !== "App" ? <span>· 由 {source} 创建</span> : null}</footer> : null}
    </article>
  );
}

function TaskInputCard({ task, run }: { task: PrototypeTask; run: PrototypeRun }) {
  const fields = run.submittedFields?.map(({ label, value }) => ({ label, value })) ?? [{ label: "业务输入", value: run.input || "历史回合未记录" }];
  if (run.attachments?.length) fields.push({ label: "附件", value: run.attachments.join("、") });
  return (
    <section className={`task-input-card ${task.kind}`} aria-label={`${task.skill}输入`}>
      <div className="task-input-kind"><span>{task.skill}</span></div>
      <dl>{fields.map((field) => <div key={field.label}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl>
    </section>
  );
}

type TaskInputDraft = Record<string, string>;

function skillForTask(task: PrototypeTask) {
  return skills.find((skill) => skill.site === task.site && skill.name === task.skill);
}

function initialInputDraft(skill: Skill) {
  return Object.fromEntries(skill.inputFields.map((field) => [field.key, field.defaultValue ?? ""]));
}

function primaryInput(skill: Skill, draft: TaskInputDraft) {
  return draft[skill.inputFields[0]?.key ?? ""]?.trim() ?? "";
}

function readThreadDraft(taskId: string, skill: Skill) {
  try {
    const stored = JSON.parse(window.localStorage.getItem(`webenvoy.prototype.thread-draft.${taskId}`) ?? "null") as { inputs?: TaskInputDraft; attachments?: string[] } | null;
    return { inputs: { ...initialInputDraft(skill), ...stored?.inputs }, attachments: stored?.attachments ?? [] };
  } catch {
    return { inputs: initialInputDraft(skill), attachments: [] as string[] };
  }
}

function taskInputValidation(skill: Skill, draft: TaskInputDraft): { key: string; message: string } | null {
  const emptyField = skill.inputFields.find((field) => (draft[field.key] ?? "").trim() === "");
  if (emptyField != null) return { key: emptyField.key, message: `请填写${emptyField.label}` };
  const urlField = skill.inputFields.find((field) => field.control === "url");
  if (urlField != null) {
    try {
      const url = new URL(draft[urlField.key]);
      if (url.protocol !== "http:" && url.protocol !== "https:") return { key: urlField.key, message: `请输入有效的${urlField.label}` };
    } catch {
      return { key: urlField.key, message: `请输入有效的${urlField.label}` };
    }
  }
  const urlsField = skill.inputFields.find((field) => field.key === "urls");
  if (urlsField != null && draft.urls.split("\n").map((value) => value.trim()).filter(Boolean).some((value) => {
    try { return !["http:", "https:"].includes(new URL(value.trim()).protocol); } catch { return true; }
  })) return { key: urlsField.key, message: `请输入有效的${urlsField.label}` };
  const numberField = skill.inputFields.find((field) => field.control === "number");
  if (numberField != null) {
    const value = Number(draft[numberField.key]);
    const minimum = numberField.min ?? 1;
    const maximum = numberField.max ?? 100;
    if (!Number.isInteger(value) || value < minimum || value > maximum) return { key: numberField.key, message: `${numberField.label}需为 ${minimum}-${maximum} 的整数` };
  }
  return null;
}

function fieldControl(field: SkillInputField, value: string, disabled: boolean, invalid: boolean, validationId: string, onBlur: () => void, onChange: (value: string) => void) {
  const common = { "aria-describedby": invalid ? validationId : undefined, "aria-invalid": invalid || undefined, disabled, value, onBlur, onChange: (event: { target: { value: string } }) => onChange(event.target.value) };
  if (field.control === "textarea") return <textarea {...common} rows={2} placeholder={field.placeholder} />;
  if (field.control === "select") return <select {...common}>{field.options?.map((option) => <option key={option}>{option}</option>)}</select>;
  return <input {...common} type={field.control ?? "text"} min={field.min} max={field.max} placeholder={field.placeholder} />;
}

function useClosableDetails() {
  const ref = useRef<HTMLDetailsElement | null>(null);

  useEffect(() => {
    function closeOnOutsidePointer(event: PointerEvent) {
      const details = ref.current;
      if (details?.open && !details.contains(event.target as Node)) details.removeAttribute("open");
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
  }, []);

  function closeAndFocusSummary() {
    ref.current?.removeAttribute("open");
    window.requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>("summary")?.focus());
  }

  return {
    ref,
    closeAndFocusSummary,
    onBlur(event: ReactFocusEvent<HTMLDetailsElement>) {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.removeAttribute("open");
    },
    onKeyDown(event: ReactKeyboardEvent<HTMLDetailsElement>) {
      if (event.key !== "Escape" || !event.currentTarget.open) return;
      event.preventDefault();
      event.stopPropagation();
      closeAndFocusSummary();
    },
  };
}

function ComposerAttachments({ attachments, disabled, staleAttachments = [], onRemove }: { attachments: string[]; disabled: boolean; staleAttachments?: string[]; onRemove: (name: string) => void }) {
  if (attachments.length === 0) return null;
  return <div className="prototype-composer-attachments">{attachments.map((name) => <div className="prototype-composer-attachment" key={name}><span>{name}{staleAttachments.includes(name) ? "（需重新选择）" : ""}</span><button type="button" aria-label={`移除附件 ${name}`} title="移除附件" disabled={disabled} onClick={() => onRemove(name)}><X size={11} /></button></div>)}</div>;
}

function selectedAttachmentNames(files: FileList | null) {
  return Array.from(files ?? []).map((file) => file.name);
}

export function PrototypeTaskThreadComposer({ actionCategories, actionCategory, blockedReason, editRequest, executionLocked, executionModes, executionSources, identityLabel, task, onExecutionModeChange, onSaveAsSkillDefaults, onStop, onSubmit }: {
  actionCategories: ActionCategory[];
  actionCategory: ActionCategory;
  blockedReason?: string;
  editRequest?: { runId: string; inputs: Record<string, string>; attachments: string[] } | null;
  executionLocked: boolean;
  executionModes: ExecutionPolicy;
  executionSources: Record<ActionCategory, string>;
  identityLabel: string;
  task: PrototypeTask;
  onExecutionModeChange: (category: ActionCategory, mode: ExecutionMode) => void;
  onSaveAsSkillDefaults: () => void;
  onStop: () => void;
  onSubmit: (inputs: Record<string, string>, attachments?: string[], actionCategory?: ActionCategory, executionSource?: string) => void;
}) {
  const skill = skillForTask(task)!;
  const restoredDraft = readThreadDraft(task.id, skill);
  const [draft, setDraft] = useState<TaskInputDraft>(restoredDraft.inputs);
  const [attachments, setAttachments] = useState<string[]>(restoredDraft.attachments);
  const [staleAttachments, setStaleAttachments] = useState<string[]>(restoredDraft.attachments);
  const [pendingDecision, setPendingDecision] = useState(false);
  const [decisionStatus, setDecisionStatus] = useState("");
  const [showValidation, setShowValidation] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const rejectButtonRef = useRef<HTMLButtonElement | null>(null);
  const wasRunningRef = useRef(task.state === "running");
  const executionMenu = useClosableDetails();
  const executionMode = executionModes[actionCategory];
  const executionSource = executionSources[actionCategory];
  const hasThreadOverrides = actionCategories.some((category) => executionSources[category] === "当前线程");
  const validationError = taskInputValidation(skill, draft);
  const inputValid = validationError == null;
  const running = task.state === "running";
  const blocked = executionLocked || task.state === "waiting" || task.state === "checking" || task.state === "unknown" || executionMode === "block";
  const canSubmit = inputValid && !blocked && !running && !pendingDecision && staleAttachments.length === 0;
  const status = executionLocked ? blockedReason ?? "技能声明不匹配，已停止执行" : task.state === "waiting" ? "账号需要登录，恢复后可提交" : task.state === "checking" ? "正在检查上一回合状态，暂不能提交" : task.state === "unknown" ? "上一回合状态未知，暂不能提交" : executionMode === "block" ? "当前业务动作已设为禁止" : staleAttachments.length > 0 ? `${staleAttachments.length} 个附件需要重新选择或移除` : running ? "当前回合正在执行；可以准备下一次输入" : decisionStatus || (inputValid ? "输入已校验" : showValidation ? validationError.message : "填写业务输入后提交");

  useEffect(() => {
    const stored = readThreadDraft(task.id, skill);
    setDraft(stored.inputs);
    setAttachments(stored.attachments);
    setStaleAttachments(stored.attachments);
    setPendingDecision(false);
    setDecisionStatus("");
    setShowValidation(false);
  }, [task.id]);

  useEffect(() => {
    try {
      window.localStorage.setItem(`webenvoy.prototype.thread-draft.${task.id}`, JSON.stringify({ inputs: draft, attachments }));
    } catch {
      // Draft persistence must not block business input.
    }
  }, [attachments, draft, task.id]);

  useEffect(() => {
    setPendingDecision(false);
    setDecisionStatus("");
  }, [actionCategory, executionMode, identityLabel, task.site]);

  useEffect(() => {
    if (editRequest == null) return;
    setDraft({ ...initialInputDraft(skill), ...editRequest.inputs });
    setAttachments(editRequest.attachments);
    setStaleAttachments([]);
    setPendingDecision(false);
    setDecisionStatus("已恢复该回合的输入，可修改后重新提交");
    setShowValidation(false);
    window.setTimeout(focusPrimaryInput, 0);
  }, [editRequest, skill]);

  useEffect(() => {
    if (pendingDecision) rejectButtonRef.current?.focus();
  }, [pendingDecision]);

  useEffect(() => {
    if (wasRunningRef.current && !running) window.setTimeout(focusPrimaryInput, 0);
    wasRunningRef.current = running;
  }, [running]);

  useEffect(() => {
    if (!pendingDecision) return;
    const timer = window.setTimeout(() => {
      setPendingDecision(false);
      setDecisionStatus("确认已超时，输入仍保留");
      window.setTimeout(focusPrimaryInput, 0);
    }, 60_000);
    return () => window.clearTimeout(timer);
  }, [pendingDecision]);

  function focusPrimaryInput() {
    formRef.current?.querySelector<HTMLElement>("[data-webenvoy-composer] input, [data-webenvoy-composer] textarea, [data-webenvoy-composer] select")?.focus();
  }

  function commit(executionRecordSource = executionSource) {
    onSubmit(draft, attachments, actionCategory, executionRecordSource);
    setDraft(initialInputDraft(skill));
    setAttachments([]);
    setStaleAttachments([]);
    setPendingDecision(false);
    setDecisionStatus("");
    setShowValidation(false);
    if (fileInputRef.current != null) fileInputRef.current.value = "";
    try { window.localStorage.removeItem(`webenvoy.prototype.thread-draft.${task.id}`); } catch { /* no-op */ }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (wasRunningRef.current) return;
    setShowValidation(true);
    if (!canSubmit) return;
    if (executionMode === "confirm") {
      setPendingDecision(true);
      return;
    }
    commit();
  }

  return (
    <form ref={formRef} className="thread-composer prototype-thread-composer" aria-label={`${task.skill}业务输入`} onSubmit={submit}>
      <ComposerAttachments attachments={attachments} disabled={pendingDecision} staleAttachments={staleAttachments} onRemove={(name) => { setAttachments((current) => current.filter((item) => item !== name)); setStaleAttachments((current) => current.filter((item) => item !== name)); }} />
      {pendingDecision ? <section className="composer-action-confirmation" aria-label="确认当前动作"><div><CircleAlert size={16} /><span><strong>{actionCategoryLabels[actionCategory]}</strong><small>{identityLabel} · {task.site} · {primaryInput(skill, draft)}{attachments.length > 0 ? ` · ${attachments.length} 个附件` : ""}</small></span></div><div><button ref={rejectButtonRef} type="button" onClick={() => { setPendingDecision(false); setDecisionStatus("已拒绝这一次，输入仍保留"); window.setTimeout(focusPrimaryInput, 0); }}>拒绝这一次</button><button className="primary" type="button" onClick={() => commit("当前动作决定")}>允许这一次</button></div></section> : <div className={`prototype-composer-fields ${skill.inputFields.length === 1 ? "single" : ""}`}>
        {skill.inputFields.map((field, index) => <label key={field.key}><span>{field.label}</span><span data-webenvoy-composer={index === 0 ? "" : undefined}>{fieldControl(field, draft[field.key] ?? "", pendingDecision, showValidation && validationError?.key === field.key, "thread-composer-validation", () => setShowValidation(true), (value) => setDraft((current) => ({ ...current, [field.key]: value })))}</span></label>)}
      </div>}
      <div className="composer-toolbar">
        <div className="composer-inline-controls"><input ref={fileInputRef} className="prototype-composer-file-input" type="file" multiple onChange={(event) => { const added = selectedAttachmentNames(event.target.files); setAttachments((current) => Array.from(new Set([...current, ...added]))); setStaleAttachments((current) => current.filter((name) => !added.includes(name))); event.target.value = ""; }} /><button className="composer-icon-button" type="button" aria-label="添加附件" title="添加附件" disabled={pendingDecision} onClick={() => fileInputRef.current?.click()}><Paperclip size={15} /></button><span className="prototype-composer-context" title={`${identityLabel} · ${task.skill}`}>{identityLabel} · {task.skill}</span>{executionLocked ? <span className="composer-execution-locked" title={blockedReason ?? executionSource}><CircleAlert size={14} /><span>{blockedReason ?? `${executionModeLabels[executionMode]} · ${executionSource}`}</span></span> : <details ref={executionMenu.ref} className="composer-execution-menu" onBlur={executionMenu.onBlur} onKeyDown={executionMenu.onKeyDown}><summary title={`当前动作：${actionCategoryLabels[actionCategory]}；来源：${executionSource}`}>{actionCategory === "sensitive" && executionMode === "auto" ? <CircleAlert className="danger" size={14} /> : <ShieldCheck size={14} />}<span>{actionCategoryLabels[actionCategory]} · {executionModeLabels[executionMode]} · {executionSource}</span><ChevronDown size={12} /></summary><div><small>当前技能的线程执行设置</small>{actionCategories.map((category) => <div className="composer-execution-row" key={category}><span><strong>{actionCategoryLabels[category]}</strong><small>{executionSources[category]}</small></span><div className="execution-mode-options" role="group" aria-label={`${actionCategoryLabels[category]}执行方式`}>{(["auto", "confirm", "block"] as ExecutionMode[]).map((mode) => <button aria-pressed={executionModes[category] === mode} className={executionModes[category] === mode ? "selected" : ""} type="button" key={mode} onClick={() => onExecutionModeChange(category, mode)}>{executionModeLabels[mode]}</button>)}</div></div>)}{actionCategories.some((category) => category === "sensitive" && executionModes[category] === "auto") ? <p className="execution-risk"><CircleAlert size={13} />危险行为将自动执行</p> : null}<small>修改仅用于当前线程后续回合</small>{hasThreadOverrides ? <button className="save-skill-policy" type="button" onClick={() => { onSaveAsSkillDefaults(); executionMenu.closeAndFocusSummary(); }}>保存为该技能的默认设置</button> : null}</div></details>}</div>
        <div className="composer-expanding-controls"><span id="thread-composer-validation" className={`composer-validation ${canSubmit ? "ready" : showValidation || blocked || running ? "blocked" : ""}`} aria-live="polite">{status}</span></div>
        <div className="composer-actions">{running ? <button className="composer-send composer-stop" type="button" aria-label="停止当前回合" title="停止当前回合" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onStop(); }}><Square size={13} /></button> : <button className="composer-send" type="submit" aria-label="提交任务回合" title={status} disabled={blocked || pendingDecision}><ArrowUp size={16} /></button>}</div>
      </div>
    </form>
  );
}

type TaskExecutionAction = { label: string; detail: string; state: "success" | "running" | "waiting" | "failed" | "cancelled" };

function taskExecutionActions(task: PrototypeTask, run: PrototypeRun, state: { newlyCreated: boolean; resumed: boolean; waiting: boolean }): TaskExecutionAction[] {
  const finalState = state.waiting || run.state === "not-submitted" || run.state === "unknown" ? "waiting" : run.state === "running" || run.state === "checking" ? "running" : run.state === "cancelled" ? "cancelled" : run.state === "partial" || run.state === "failed" ? "failed" : "success";
  const commonStart: TaskExecutionAction[] = [{ label: "打开目标页面", detail: targetUrl(task.site, task.kind), state: "success" }];
  if (state.newlyCreated) return [{ label: "准备账号环境", detail: `正在启动“${task.identity}”的浏览器环境。`, state: "running" }];
  if (task.kind === "takeover") return [...commonStart, { label: "检查账号登录状态", detail: state.resumed ? "登录校验已通过，继续读取收藏夹。" : "登录状态已过期，任务已暂停。", state: finalState }];
  if (task.kind === "download") return [...commonStart, { label: "解析文件地址", detail: "识别 4 个公开视频文件。", state: "success" }, { label: "下载文件", detail: "3 个文件已保存，1 个来源失效。", state: finalState }];
  if (task.kind === "write") return [...commonStart, { label: "填写标题与正文", detail: run.input, state: "success" }, { label: "添加话题与图片", detail: "页面内容已完成填写。", state: "success" }, { label: "停在提交前", detail: "校验通过，尚未点击发布。", state: finalState }];
  if (task.kind === "article") return [...commonStart, { label: "等待文章加载", detail: "正文与图片区域已加载。", state: "success" }, { label: "读取页面内容", detail: "正文、作者信息和图片已整理。", state: finalState }];
  const submitAction = task.site === "淘宝" ? { label: "点击“上新商品”筛选", detail: "等待商品列表刷新。", state: "success" as const } : { label: "点击“搜索”按钮", detail: `提交“${task.skill}”操作。`, state: "success" as const };
  return [...commonStart, { label: "填写业务输入", detail: run.input, state: "success" }, submitAction, { label: "向下滚动一屏", detail: "加载更多页面结果。", state: "success" }, { label: "读取并整理结果", detail: run.artifactCurrent != null && run.artifactTotal != null ? `已返回 ${run.artifactCurrent}/${run.artifactTotal} 条。` : run.summary, state: finalState }];
}

function targetUrl(site: string, kind: PrototypeTask["kind"]) {
  if (site === "小红书") return kind === "write" ? "https://creator.xiaohongshu.com/publish/publish" : "https://www.xiaohongshu.com/explore";
  if (site === "淘宝") return "https://www.taobao.com/";
  if (site === "微信公众号") return "https://mp.weixin.qq.com/s/example";
  if (site === "抖音") return "https://www.douyin.com/";
  return `https://${site}/`;
}

function taskSummaryCopy(run: PrototypeRun, state: { newlyCreated: boolean; resumed: boolean; waiting: boolean }) {
  if (state.waiting) return "正在等待登录恢复；完成登录并通过校验后会自动继续。";
  if (state.resumed) return "登录校验已通过，任务已恢复执行。";
  if (state.newlyCreated) return "任务已经开始；业务结果就绪后会显示在这里。";
  if (run.state === "running" && run.artifactCurrent != null && run.artifactTotal != null) return `已返回 ${run.artifactCurrent}/${run.artifactTotal} 条结果，任务仍在继续。`;
  if (run.state === "partial") return "已保存 3/4 个文件；未完成项保留在结果中，可单独重试。";
  if (run.state === "cancelled") return "本回合已由用户取消，没有继续执行。";
  if (run.state === "checking") return run.stateLabel === "正在终止" ? "正在等待运行服务确认终止；确认前不会解锁新的提交。" : "正在重新检查原回合状态，不会重复提交。";
  if (run.state === "unknown") return "暂时无法确认本回合状态；重新检查前不会重复提交。";
  if (run.state === "not-submitted") return "内容已准备完成但尚未发布，当前状态保持为未提交。";
  return run.summary;
}

function PrototypeRunRail({ runs, taskId }: { runs: PrototypeRun[]; taskId: string }) {
  const navigationItems: ThreadNavigationItem[] = runs.map((run) => ({
    id: `${taskId}-${run.id}`,
    getLabel: () => run.input,
    hasOutput: run.artifactState === "ready",
    getPreview: () => ({
      response: run.summary,
      outputs: [
        { type: "state", label: run.stateLabel },
        ...(run.duration == null ? [] : [{ type: "duration", label: run.duration }]),
      ],
    }),
  }));

  return (
    <ThreadNavigationRail
      ariaLabel="当前任务线程回合导航"
      items={navigationItems}
      minimumItemCount={1}
    />
  );
}

function CollectionResult({ executionMode, executionSource, run, task, onOpenPreview }: { executionMode: ExecutionMode; executionSource: string; run: PrototypeRun; task: PrototypeTask; onOpenPreview: (selection: PrototypePreviewSelection) => void }) {
  const [visibleCount, setVisibleCount] = useState(5);
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [filterActive, setFilterActive] = useState(false);
  const [batchConfirming, setBatchConfirming] = useState(false);
  const [batchOutcomes, setBatchOutcomes] = useState<Array<{ title: string; state: "成功" | "失败" | "跳过"; detail: string }>>([]);
  const [batchStatus, setBatchStatus] = useState("");
  const running = run.state === "running";
  const isProductCollection = task.site === "淘宝";
  const rows = isProductCollection ? productRows : resultRows;
  const total = running ? run.artifactCurrent ?? rows.length : run.artifactTotal ?? rows.length;
  const availableRows = rows.slice(0, Math.min(total, rows.length)).filter((row) => !filterActive || (isProductCollection ? row[2] === "有货" : Number(row[2].replace(/,/g, "")) >= 1000));
  const visibleRows = availableRows.slice(0, visibleCount);
  const nextCount = Math.min(5, availableRows.length - visibleRows.length);
  const selectedRecords = rows.filter((row) => selectedRows.includes(row[0]));
  const applicableRecords = selectedRecords.filter((row) => !isProductCollection || row[2] === "有货");

  useEffect(() => {
    setBatchConfirming(false);
    setBatchOutcomes([]);
    setBatchStatus("");
  }, [selectedRows]);

  useEffect(() => {
    if (!batchConfirming) return;
    setBatchConfirming(false);
    setBatchStatus("执行方式已变化，请重新发起批量导出");
  }, [executionMode, executionSource]);

  if (total === 0) return null;

  function executeBatch() {
    if (executionMode === "block") {
      setBatchConfirming(false);
      setBatchStatus("读取和下载已设为禁止，本次导出未执行");
      return;
    }
    let applicableIndex = 0;
    setBatchOutcomes(selectedRecords.map((row) => {
      if (isProductCollection && row[2] !== "有货") return { title: row[0], state: "跳过", detail: "当前库存状态不适用于导出动作" };
      applicableIndex += 1;
      return applicableIndex === 2
        ? { title: row[0], state: "失败", detail: "示例：写入导出文件失败，可单独重试" }
        : { title: row[0], state: "成功", detail: "已写入本次导出文件" };
    }));
    setBatchStatus(`本次导出使用：${executionModeLabels[executionMode]} · ${executionMode === "confirm" ? "当前动作决定" : executionSource}`);
    setBatchConfirming(false);
  }

  return (
    <section className="prototype-section result-section">
      <div className="prototype-section-title">
        <div>
          <h2>采集结果</h2>
        </div>
        <div className="section-actions"><button className={`prototype-button ${filterActive ? "selected" : ""}`} type="button" aria-pressed={filterActive} onClick={() => setFilterActive((value) => !value)}><ListFilter size={14} />{filterActive ? "清除筛选" : "筛选"}</button><button className="prototype-button" type="button" disabled={selectedRows.length === 0 || executionMode === "block"} title={executionMode === "block" ? "读取和下载已设为禁止" : "导出选中数据"} onClick={() => setBatchConfirming(true)}>导出选中{selectedRows.length > 0 ? `（${selectedRows.length}）` : ""}</button></div>
      </div>
      {running ? <div className="prototype-progress"><span style={{ width: "45%" }} /></div> : null}
      <div className="prototype-table-wrap">
        <table className="prototype-table">
          <thead><tr><th><input type="checkbox" aria-label="选择当前展示的全部数据" checked={visibleRows.length > 0 && visibleRows.every((row) => selectedRows.includes(row[0]))} onChange={(event) => setSelectedRows(event.target.checked ? Array.from(new Set([...selectedRows, ...visibleRows.map((row) => row[0])])) : selectedRows.filter((title) => !visibleRows.some((row) => row[0] === title)))} /></th>{(isProductCollection ? ["商品", "价格", "库存", "读取时间"] : ["笔记标题", "作者", "互动", "读取时间"]).map((heading) => <th key={heading}>{heading}</th>)}<th aria-label="操作" /></tr></thead>
          <tbody>{visibleRows.map((row) => <tr key={row[0]}><td><input type="checkbox" aria-label={`选择 ${row[0]}`} checked={selectedRows.includes(row[0])} onChange={() => setSelectedRows((current) => current.includes(row[0]) ? current.filter((title) => title !== row[0]) : [...current, row[0]])} /></td>{row.map((cell) => <td key={cell}>{cell}</td>)}<td><button type="button" aria-label={`在右侧预览 ${row[0]}`} title="在右侧预览" onClick={() => onOpenPreview({ kind: isProductCollection ? "product" : "note", row, runId: run.id })}><ArrowUpRight size={14} /></button></td></tr>)}</tbody>
        </table>
      </div>
      {availableRows.length === 0 ? <div className="prototype-empty result-empty"><Search size={20} /><h3>没有匹配数据</h3><p>修改业务输入后提交新的回合。</p></div> : null}
      <footer className="result-table-footer">{nextCount > 0 ? <button className="result-more-button" type="button" onClick={() => setVisibleCount((count) => count + nextCount)}>共 {total} 条，点击查看更多</button> : <span>共 {total} 条</span>}{selectedRows.length > 0 ? <span>已选 {selectedRows.length} 条</span> : null}</footer>
      {batchConfirming && executionMode !== "block" ? <section className="prototype-callout action-needed" aria-label="确认批量导出"><CircleAlert size={18} /><div><strong>确认导出所选数据</strong><p>已选 {selectedRecords.length} 条，其中 {applicableRecords.length} 条可处理。此操作只生成导出文件，不修改站点内容。当前方式：{executionModeLabels[executionMode]} · {executionSource}。</p></div><div className="section-actions"><button className="prototype-button" type="button" onClick={() => setBatchConfirming(false)}>取消</button><button className="prototype-button primary" type="button" onClick={executeBatch}>{executionMode === "confirm" ? "允许这一次" : "确认导出"}</button></div></section> : null}
      {batchOutcomes.length > 0 ? <section className="file-result-list" aria-label="批量导出结果" aria-live="polite">{batchOutcomes.map((outcome) => <div className="file-result-row" key={outcome.title}><FileText size={18} /><div><strong>{outcome.title}</strong><span>{outcome.detail}</span></div><span className={outcome.state === "成功" ? "saved" : "failed"}>{outcome.state}</span></div>)}</section> : null}
      {executionMode === "block" && selectedRows.length > 0 ? <p className="composer-validation blocked">读取和下载已设为禁止，不能导出所选数据</p> : batchStatus ? <p className="muted-copy" role="status"><ShieldCheck size={13} />{batchStatus}</p> : null}
    </section>
  );
}

function ArticleResult({ run }: { run: PrototypeRun }) {
  const [opened, setOpened] = useState(false);
  const article = articleResultForRun(run);
  return (
    <article className="prototype-section article-result">
      <div className="article-kicker">{article.kicker}</div>
      <h2>{article.title}</h2>
      <div className="article-byline">{article.author} · 2026 年 7 月 14 日</div>
      <p>本周我们重新梳理了账号身份、站点技能与任务之间的关系。用户无需理解运行时组件，只需要选择要完成的业务目标和对应账号。</p>
      <p>任务完成后，App 首先呈现可阅读的内容和可操作的结果。运行记录与诊断仍然保留，但只在需要追溯或排查时展开。</p>
      <p className="muted-copy">来源：{article.source}</p>
      <button className="prototype-button" type="button" onClick={() => setOpened(true)}><ExternalLink size={14} />{opened ? "已在浏览器中打开" : "打开来源文章"}</button>
    </article>
  );
}

function DownloadResult({ executionMode, executionSource }: { executionMode: ExecutionMode; executionSource: string }) {
  const [status, setStatus] = useState("");
  const [pendingAction, setPendingAction] = useState<{ label: string; result: string } | null>(null);
  const actionTriggerRef = useRef<HTMLButtonElement | null>(null);
  const rejectButtonRef = useRef<HTMLButtonElement | null>(null);
  const files = [
    ["新品发布会-主片.mp4", "126 MB", "已保存"],
    ["新品发布会-封面.png", "8 MB", "已保存"],
    ["产品讲解-音轨.mp3", "42 MB", "已保存"],
    ["活动素材-源文件.zip", "—", "来源已失效"],
  ];

  useEffect(() => {
    if (pendingAction == null) return;
    rejectButtonRef.current?.focus();
  }, [pendingAction]);

  useEffect(() => {
    if (pendingAction == null) return;
    setPendingAction(null);
    setStatus("执行方式已变化，请重新发起文件操作");
    window.requestAnimationFrame(() => actionTriggerRef.current?.focus());
  }, [executionMode, executionSource]);

  function requestAction(trigger: HTMLButtonElement, label: string, result: string) {
    actionTriggerRef.current = trigger;
    if (executionMode === "block") {
      setStatus(`读取和下载已设为禁止，未执行“${label}”`);
    } else if (executionMode === "confirm") {
      setPendingAction({ label, result });
    } else {
      setStatus(`${result} · ${executionModeLabels[executionMode]} · ${executionSource}`);
    }
  }

  function finishAction(allowed: boolean) {
    if (pendingAction == null) return;
    if (allowed && executionMode !== "confirm") {
      setStatus("执行方式已变化，本次文件操作未执行");
      setPendingAction(null);
      window.requestAnimationFrame(() => actionTriggerRef.current?.focus());
      return;
    }
    setStatus(allowed ? `${pendingAction.result} · 确认 · 当前动作决定` : `已拒绝这一次，未执行“${pendingAction.label}”`);
    setPendingAction(null);
    window.requestAnimationFrame(() => actionTriggerRef.current?.focus());
  }

  return (
    <section className="prototype-section">
      <div className="prototype-section-title"><div><h2>下载文件</h2><p>3 个已保存到“下载/WebEnvoy/活动素材”</p></div><button className="prototype-button" type="button" onClick={(event) => requestAction(event.currentTarget, "显示下载目录", "已在访达中显示下载目录")}><FolderOpen size={14} />在访达中显示</button></div>
      <div className="file-result-list">{files.map(([name, size, state], index) => <div className="file-result-row" key={name}><FileText size={18} /><div><strong>{name}</strong><span>{size}</span></div><span className={index === 3 ? "failed" : "saved"}>{state}</span>{index === 3 ? <button className="prototype-button compact" type="button" onClick={(event) => requestAction(event.currentTarget, `重试 ${name}`, `${name} 仍无法获取；来源已失效`)}>重试</button> : <button type="button" aria-label={`打开 ${name}`} onClick={(event) => requestAction(event.currentTarget, `打开 ${name}`, `已使用系统应用打开 ${name}`)}><ExternalLink size={14} /></button>}</div>)}</div>
      {pendingAction && executionMode === "confirm" ? <section className="composer-action-confirmation" aria-label={`确认${pendingAction.label}`}><div><CircleAlert size={16} /><span><strong>读取和下载</strong><small>{pendingAction.label} · {executionSource}</small></span></div><div><button ref={rejectButtonRef} type="button" onClick={() => finishAction(false)}>拒绝这一次</button><button className="primary" type="button" onClick={() => finishAction(true)}>允许这一次</button></div></section> : null}
      {status ? <p className="muted-copy" role="status">{status}</p> : null}
    </section>
  );
}

function WriteResult({ run, task, executionMode, executionSource, onContinue, onReturnEdit }: { run: PrototypeRun; task: PrototypeTask; executionMode: ExecutionMode; executionSource: string; onContinue: (runId: string, executionSource: string) => void; onReturnEdit: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState("");
  const rejectRef = useRef<HTMLButtonElement | null>(null);
  const continueRef = useRef<HTMLButtonElement | null>(null);
  const submitted = run.state === "success" && (run.actionCategory === "external" || run.executionRecords?.some((record) => record.actionCategory === "external" && record.outcome === "completed") === true);
  const result = writeResultForRun(run, task);

  useEffect(() => {
    if (confirming) rejectRef.current?.focus();
    if (!confirming) return;
    const timer = window.setTimeout(() => { setConfirming(false); setStatus("确认已超时，本次发布未执行"); window.requestAnimationFrame(() => continueRef.current?.focus()); }, 60_000);
    return () => window.clearTimeout(timer);
  }, [confirming]);

  useEffect(() => {
    if (!confirming) return;
    setConfirming(false);
    setStatus("执行方式已变化，请重新决定是否发布");
    window.requestAnimationFrame(() => continueRef.current?.focus());
  }, [executionMode, executionSource]);

  function continueWrite() {
    if (executionMode === "block") {
      setStatus("发布或提交已设为禁止");
    } else if (executionMode === "confirm") {
      setConfirming(true);
    } else {
      onContinue(run.id, executionSource);
    }
  }

  function allowOnce() {
    if (executionMode !== "confirm") {
      setConfirming(false);
      setStatus("执行方式已变化，本次发布未执行");
      window.requestAnimationFrame(() => continueRef.current?.focus());
      return;
    }
    setConfirming(false);
    onContinue(run.id, "当前动作决定");
  }

  return (
    <section className="prototype-section write-result">
      <div className="write-state">{submitted ? <CheckCircle2 size={16} /> : <Square size={16} />}<div><strong>{submitted ? "已提交" : "未提交"}</strong><span>{submitted ? "内容已经发布并记录本次执行方式。" : "页面内容已填写并通过校验，没有点击发布。"}</span></div></div>
      <div className="write-preview"><div><span>目标账号</span><strong>{result.identity}</strong></div><div><span>标题</span><strong>{result.title}</strong></div><div><span>正文</span><p>{result.body}</p></div>{result.topics.length > 0 ? <div><span>话题</span><strong>{result.topics.join(" ")}</strong></div> : null}</div>
      {!submitted && confirming && executionMode === "confirm" ? <section className="composer-action-confirmation" aria-label="确认发布这一次"><div><CircleAlert size={16} /><span><strong>发布或提交</strong><small>当前内容将对外可见 · {executionSource}</small></span></div><div><button ref={rejectRef} type="button" onClick={() => { setConfirming(false); setStatus("已拒绝这一次，本次发布未执行"); window.requestAnimationFrame(() => continueRef.current?.focus()); }}>拒绝这一次</button><button className="primary" type="button" onClick={allowOnce}>允许这一次</button></div></section> : null}
      {!submitted && !confirming ? <div className="write-actions"><button className="prototype-button" type="button" onClick={onReturnEdit}>返回编辑</button><button ref={continueRef} className="prototype-button primary" type="button" onClick={continueWrite} disabled={executionMode === "block"}><Play size={14} />继续处理</button></div> : null}
      {status || executionMode === "block" ? <p className="composer-validation blocked" aria-live="polite">{status || "发布或提交已设为禁止"}</p> : null}
    </section>
  );
}

function CreateTaskSurface({ globalPolicy, identities, initialTaskDraft, preferredIdentityId, selectedSkill, selectedSkillEnabled, skillPolicy, tasks, threadExecutionModes, onCreateIdentity, onCreateTask, onOpenLibrary, onSelectSkill }: { globalPolicy: ExecutionPolicy; identities: Identity[]; initialTaskDraft?: Record<string, string>; preferredIdentityId: string; selectedSkill: Skill; selectedSkillEnabled: boolean; skillPolicy?: ExecutionPolicy; tasks: PrototypeTask[]; threadExecutionModes: Record<string, Partial<ExecutionPolicy>>; onCreateIdentity: (inputs: Record<string, string>) => void; onCreateTask: (task: PrototypeTask, executionModes?: Partial<ExecutionPolicy>) => void; onOpenLibrary: () => void; onSelectSkill: (skillId: string) => void }) {
  const [draft, setDraft] = useState<TaskInputDraft>(() => ({ ...initialInputDraft(selectedSkill), ...initialTaskDraft }));
  const [attachments, setAttachments] = useState<string[]>([]);
  const [identityId, setIdentityId] = useState(preferredIdentityId);
  const [pendingDecision, setPendingDecision] = useState(false);
  const [decisionStatus, setDecisionStatus] = useState("");
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [creationExecutionModes, setCreationExecutionModes] = useState<Partial<ExecutionPolicy>>({});
  const formRef = useRef<HTMLFormElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const createButtonRef = useRef<HTMLButtonElement | null>(null);
  const rejectButtonRef = useRef<HTMLButtonElement | null>(null);
  const executionMenu = useClosableDetails();
  const compatibleIdentities = identities.filter((identity) => identityCanUseSkill(identity, selectedSkill));
  const selectedIdentity = compatibleIdentities.find((identity) => identity.id === identityId);
  const existingThread = tasks.find((task) => task.site === selectedSkill.site && task.skill === selectedSkill.name && task.identityId === identityId);
  const existingThreadHasActiveRun = existingThread?.runs?.some((run) => ["running", "waiting", "checking", "unknown"].includes(run.state)) ?? false;
  const taskKind: PrototypeTask["kind"] = selectedSkill.id === "wechat-read" ? "article" : selectedSkill.tags.includes("内容发布") ? "write" : selectedSkill.tags.includes("内容下载") ? "download" : "collection";
  const actionCategory = initialActionCategoryForTask(taskKind);
  const actionDeclared = selectedSkill.actionCategories.includes(actionCategory);
  const suggestedTasks = [
    { skillId: "xhs-search", identityId: "xhs-a" },
    { skillId: "xhs-publish", identityId: "xhs-a" },
    { skillId: "wechat-read", identityId: "wechat-brand" },
    { skillId: "xhs-favorites", identityId: "xhs-a" },
  ];
  const executionModes = Object.fromEntries(actionCategories.map((category) => [category, selectedSkill.actionCategories.includes(category) ? creationExecutionModes[category] ?? (existingThread == null ? undefined : threadExecutionModes[existingThread.id]?.[category]) ?? skillPolicy?.[category] ?? globalPolicy[category] : "block"])) as ExecutionPolicy;
  const executionSources = Object.fromEntries(actionCategories.map((category) => [category, selectedSkill.actionCategories.includes(category) ? creationExecutionModes[category] != null || (existingThread != null && threadExecutionModes[existingThread.id]?.[category] != null) ? "当前线程" : skillPolicy == null ? "全局默认" : "我的技能默认" : "技能声明不匹配"])) as Record<ActionCategory, string>;
  const executionMode = executionModes[actionCategory];
  const executionSource = executionSources[actionCategory];
  const validationError = taskInputValidation(selectedSkill, draft);

  useEffect(() => {
    setDraft({ ...initialInputDraft(selectedSkill), ...initialTaskDraft });
    setAttachments([]);
    setPendingDecision(false);
    setDecisionStatus("");
    setSubmitAttempted(false);
    setCreationExecutionModes({});
  }, [selectedSkill.id]);

  useEffect(() => {
    const preferredIsCompatible = compatibleIdentities.some((identity) => identity.id === preferredIdentityId);
    setIdentityId(preferredIsCompatible ? preferredIdentityId : compatibleIdentities[0]?.id ?? "");
  }, [preferredIdentityId, selectedSkill.id]);

  useEffect(() => {
    setPendingDecision(false);
    setDecisionStatus("");
    setSubmitAttempted(false);
    setCreationExecutionModes({});
  }, [identityId]);

  useEffect(() => {
    setPendingDecision(false);
    setDecisionStatus("");
    setSubmitAttempted(false);
  }, [executionMode]);

  useEffect(() => {
    if (pendingDecision) rejectButtonRef.current?.focus();
  }, [pendingDecision]);

  useEffect(() => {
    if (!pendingDecision) return;
    const timer = window.setTimeout(() => {
      setPendingDecision(false);
      setDecisionStatus("确认已超时，输入仍保留");
      window.requestAnimationFrame(focusDecisionTrigger);
    }, 60_000);
    return () => window.clearTimeout(timer);
  }, [pendingDecision]);

  function focusDecisionTrigger() {
    if (createButtonRef.current != null) createButtonRef.current.focus();
    else formRef.current?.querySelector<HTMLElement>("input, textarea, select")?.focus();
  }

  function createTask(executionRecordSource = executionSource) {
    if (!selectedSkillEnabled) return;
    if (selectedIdentity == null) return;
    if (existingThreadHasActiveRun) return;
    const input = primaryInput(selectedSkill, draft);
    const quantity = Number(draft.quantity);
    onCreateTask({
      id: `task-${Date.now()}`,
      title: `${selectedSkill.name} · ${input}`,
      skill: selectedSkill.name,
      site: selectedSkill.site,
      identity: selectedIdentity.account,
      identityId: selectedIdentity.id,
      source: "App",
      state: "running",
      stateLabel: "正在运行",
      updatedAt: "刚刚",
      summary: `已使用“${input}”创建任务，结果会在此页面持续更新。`,
      kind: taskKind,
      runs: [{ id: "run-01", label: "本回合", input, inputs: { ...draft }, submittedFields: snapshotSubmittedFields(selectedSkill, draft), fieldSchemaVersion: selectedSkill.inputSchemaVersion, source: "App", attachments, state: "running", stateLabel: "正在运行", summary: `正在使用“${selectedIdentity.account}”执行“${selectedSkill.name}”。`, artifactSet: taskKind === "article" ? "article" : taskKind === "download" ? "download-files" : taskKind === "write" ? "write-preview" : selectedSkill.site === "淘宝" ? "shop-products" : "xhs-notes", artifactState: "pending", artifactTotal: Number.isFinite(quantity) ? quantity : undefined, outputView: selectedSkill.outputView, executionMode, executionSource: executionRecordSource, actionCategory, executionRecords: [{ actionCategory, executionMode, executionSource: executionRecordSource, outcome: "running" }] }],
      artifactSet: taskKind === "article" ? "article" : taskKind === "download" ? "download-files" : taskKind === "write" ? "write-preview" : selectedSkill.site === "淘宝" ? "shop-products" : "xhs-notes",
      artifactState: "pending",
    }, creationExecutionModes);
  }

  function submitTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitAttempted(true);
    if (!selectedSkillEnabled || validationError != null || selectedIdentity == null || executionMode === "block" || existingThreadHasActiveRun) return;
    if (executionMode === "confirm") {
      setPendingDecision(true);
      return;
    }
    createTask();
  }

  return (
    <div className="prototype-page create-task-page">
      <section className="create-task-empty" aria-labelledby="create-task-heading">
        <span className="create-task-empty-icon" aria-hidden="true"><Square size={22} /></span>
        <h1 id="create-task-heading">这次要让 WebEnvoy 完成什么？</h1>
        <div className="create-task-suggestions">
          {suggestedTasks.map(({ skillId, identityId: suggestedIdentityId }) => {
            const skill = skills.find((item) => item.id === skillId);
            const identity = identities.find((item) => item.id === suggestedIdentityId);
            if (skill == null || identity == null || !identityCanUseSkill(identity, skill)) return null;
            const icon = skillId === "xhs-search" ? <Search size={16} /> : skillId === "wechat-read" ? <BookOpenText size={16} /> : skillId === "xhs-favorites" ? <Bookmark size={16} /> : <PenLine size={16} />;
            const selected = selectedSkill.id === skill.id && identityId === identity.id;
            return <button aria-pressed={selected} className={selected ? "selected" : ""} type="button" key={`${skill.id}-${identity.id}`} onClick={() => { onSelectSkill(skill.id); setIdentityId(identity.id); }}>{icon}<span><strong>{skill.name}</strong><small>{identity.account} · {skill.site}</small></span></button>;
          })}
        </div>
      </section>

      <form ref={formRef} className="thread-composer create-task-launcher" aria-label="创建任务" noValidate onSubmit={submitTask}>
        <div className="create-task-context-row">
          <label><span>站点技能</span><select disabled={pendingDecision} value={selectedSkill.id} onChange={(event) => onSelectSkill(event.target.value)}>{skills.filter((skill) => skill.availability === "available").map((skill) => <option key={skill.id} value={skill.id}>{skill.site} · {skill.name}</option>)}</select></label>
          {compatibleIdentities.length > 0 ? <label><span>账号身份</span><select disabled={pendingDecision} value={identityId} onChange={(event) => setIdentityId(event.target.value)}>{compatibleIdentities.map((identity) => <option key={identity.id} value={identity.id}>{identity.account} · {identity.platformId ?? identity.name}</option>)}</select></label> : <div className="empty-inline"><CircleAlert size={16} /><span>没有兼容的账号身份</span><button type="button" disabled={pendingDecision} onClick={() => onCreateIdentity(draft)}>创建账号身份</button></div>}
        </div>
        <ComposerAttachments attachments={attachments} disabled={pendingDecision} onRemove={(name) => setAttachments((current) => current.filter((item) => item !== name))} />
        <div className={`create-task-fields ${selectedSkill.inputFields.length === 1 ? "single" : ""}`}>{selectedSkill.inputFields.map((field) => <label className="create-task-business-input" key={field.key}><span>{field.label}</span>{fieldControl(field, draft[field.key] ?? "", pendingDecision, submitAttempted && validationError?.key === field.key, "create-task-validation", () => setSubmitAttempted(true), (value) => setDraft((current) => ({ ...current, [field.key]: value })))}</label>)}</div>
        {pendingDecision ? <section className="composer-action-confirmation create-action-confirmation" aria-label="确认当前动作"><div><CircleAlert size={16} /><span><strong>{actionCategoryLabels[actionCategory]}</strong><small>{selectedIdentity?.account} · {selectedSkill.site} · {primaryInput(selectedSkill, draft)}{attachments.length > 0 ? ` · ${attachments.length} 个附件` : ""}</small></span></div><div><button ref={rejectButtonRef} type="button" onClick={() => { setPendingDecision(false); setDecisionStatus("已拒绝这一次，业务输入仍保留"); window.requestAnimationFrame(focusDecisionTrigger); }}>拒绝这一次</button><button className="primary" type="button" onClick={() => createTask("当前动作决定")}>允许这一次</button></div></section> : null}
        <div className="composer-toolbar">
          <div className="composer-inline-controls"><input ref={fileInputRef} className="prototype-composer-file-input" type="file" multiple onChange={(event) => { const added = selectedAttachmentNames(event.target.files); setAttachments((current) => Array.from(new Set([...current, ...added]))); event.target.value = ""; }} /><button className="composer-icon-button" type="button" aria-label="添加附件" title="添加附件" disabled={pendingDecision} onClick={() => fileInputRef.current?.click()}><Paperclip size={15} /></button><button className="composer-icon-button" type="button" title="浏览站点技能" aria-label="浏览站点技能" disabled={pendingDecision} onClick={onOpenLibrary}><Library size={15} /></button><span className="prototype-composer-context">{selectedSkill.site} · {selectedSkill.name}</span>{actionDeclared ? <details ref={executionMenu.ref} className="composer-execution-menu" onBlur={executionMenu.onBlur} onKeyDown={executionMenu.onKeyDown}><summary title={`当前动作：${actionCategoryLabels[actionCategory]}；来源：${executionSource}`}>{actionCategory === "sensitive" && executionMode === "auto" ? <CircleAlert className="danger" size={14} /> : <ShieldCheck size={14} />}<span>{actionCategoryLabels[actionCategory]} · {executionModeLabels[executionMode]} · {executionSource}</span><ChevronDown size={12} /></summary><div><small>{existingThread == null ? "新任务线程的执行设置" : "当前任务线程的执行设置"}</small>{selectedSkill.actionCategories.map((category) => <div className="composer-execution-row" key={category}><span><strong>{actionCategoryLabels[category]}</strong><small>{executionSources[category]}</small></span><div className="execution-mode-options" role="group" aria-label={`${actionCategoryLabels[category]}执行方式`}>{(["auto", "confirm", "block"] as ExecutionMode[]).map((mode) => <button aria-pressed={executionModes[category] === mode} className={executionModes[category] === mode ? "selected" : ""} disabled={pendingDecision} type="button" key={mode} onClick={() => setCreationExecutionModes((current) => ({ ...current, [category]: mode }))}>{executionModeLabels[mode]}</button>)}</div></div>)}{selectedSkill.actionCategories.some((category) => category === "sensitive" && executionModes[category] === "auto") ? <p className="execution-risk"><CircleAlert size={13} />危险行为将自动执行</p> : null}<small>{existingThread == null ? "创建后用于该线程的后续回合" : "提交后用于该线程的后续回合"}</small></div></details> : <span className="composer-execution-locked" title={executionSource}><CircleAlert size={14} /><span>{executionModeLabels[executionMode]} · {executionSource}</span></span>}</div>
          <div className="composer-expanding-controls">{!selectedSkillEnabled || decisionStatus || executionMode === "block" || compatibleIdentities.length === 0 || existingThreadHasActiveRun || (submitAttempted && validationError != null) ? <span id="create-task-validation" className="composer-validation blocked" aria-live="polite">{!selectedSkillEnabled ? "站点技能已停用，请先重新启用" : decisionStatus || (executionMode === "block" ? "当前业务动作已禁止" : compatibleIdentities.length === 0 ? "请选择兼容的账号身份" : existingThreadHasActiveRun ? "该任务线程已有活动回合，请等待结束后再提交" : validationError?.message)}</span> : null}</div>
          <div className="composer-actions"><button ref={createButtonRef} className="composer-send" type="submit" title={existingThreadHasActiveRun ? "该任务线程已有活动回合" : "创建并运行"} aria-label="创建并运行" disabled={!selectedSkillEnabled || pendingDecision || compatibleIdentities.length === 0 || executionMode === "block" || existingThreadHasActiveRun}><ArrowUp size={15} /></button></div>
        </div>
      </form>
    </div>
  );
}

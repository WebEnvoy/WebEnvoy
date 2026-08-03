import { useEffect, useMemo, useRef, useState } from "react";

import type { CoreReadTaskLoadState } from "./coreReadTaskClient";
import { mergeSubmittedCoreTaskOverrides } from "./coreThreadClient";
import { coreTaskSubmitReadiness, initialCoreTaskSubmitState, promoteSubmittedCoreTask, submitCoreReadOnlyTask, type CoreTaskSubmitState } from "./coreTaskSubmitClient";
import type { HarborIdentityLoadState } from "./harborIdentityTypes";
import { projectRuntimeGatedTasks, type RuntimeSupervisorState } from "./runtimeSupervisorState";
import { releaseSkillInputOwnerRefs, terminalSkillInputOwnerRefs } from "./skillInputOwnerClient";
import type { TaskProjection } from "./taskThreadFixtures";
import { outcomeLabel } from "./TaskThreadFields";
import type { ThreadNavigationItem } from "./ThreadNavigationRail";

type SubmittedTaskOverride = { endpoint: string; taskId: string; task: TaskProjection };
export type TaskPreviewSelection = {
  runId: string;
  tab: "result" | "evidence";
  itemIds?: string[];
};

export function useAppTasks(
  coreReadState: CoreReadTaskLoadState,
  endpoint: string,
  runtime: RuntimeSupervisorState,
  identities: HarborIdentityLoadState["identities"],
) {
  const [submitStates, setSubmitStates] = useState<Record<string, CoreTaskSubmitState>>({});
  const [submittedOverrides, setSubmittedOverrides] = useState<Record<string, SubmittedTaskOverride>>({});
  const [businessInputs, setBusinessInputs] = useState<Record<string, string>>({});
  const releasedOwnerRefs = useRef(new Set<string>());
  const currentOverrides = useMemo(() => Object.values(submittedOverrides).filter((item) => item.endpoint === endpoint), [endpoint, submittedOverrides]);
  const effectiveCoreReadState = useMemo(() => mergeSubmittedCoreTaskOverrides(coreReadState, currentOverrides), [coreReadState, currentOverrides]);
  const effectiveCoreReadTasks = useMemo(() => effectiveCoreReadState.tasks.map((task) => applyLocalTaskContext(task, businessInputs)), [businessInputs, effectiveCoreReadState.tasks]);
  const taskThreads = useMemo(() => projectRuntimeGatedTasks(effectiveCoreReadTasks, runtime, effectiveCoreReadState.liveTaskIds), [effectiveCoreReadState.liveTaskIds, effectiveCoreReadTasks, runtime]);
  useEffect(() => {
    const ownerRefs = terminalSkillInputOwnerRefs(effectiveCoreReadTasks).filter((ownerRef) => !releasedOwnerRefs.current.has(ownerRef));
    if (ownerRefs.length === 0) return;
    void releaseSkillInputOwnerRefs(ownerRefs).then((released) => {
      if (released) for (const ownerRef of ownerRefs) releasedOwnerRefs.current.add(ownerRef);
    });
  }, [effectiveCoreReadTasks]);
  const workbenchTaskThreads = useMemo(() => taskThreads.filter((task) => task.threadContext != null), [taskThreads]);
  const selection = useTaskSelection(taskThreads);
  const selectedSubmitTask = selection.selectedTask == null
    ? undefined
    : effectiveCoreReadTasks.find((task) => task.id === selection.selectedTask?.id) ?? selection.selectedTask;
  const submitKey = selectedSubmitTask == null ? "" : coreSubmitStateKey(selectedSubmitTask.id, endpoint);
  const coreSubmitState = submitStates[submitKey] ?? initialCoreTaskSubmitState;
  const submission = useTaskSubmission({
    endpoint, identities, runtime, selectedSubmitTask, selection, setBusinessInputs,
    setSubmitStates, setSubmittedOverrides,
  });
  const threadNavigationItems = useThreadNavigation(selection.selectedTask);
  function acceptTaskThreadProjection(task: TaskProjection) {
    const key = coreSubmitStateKey(task.id, endpoint);
    setSubmittedOverrides((current) => ({ ...current, [key]: { endpoint, taskId: task.id, task } }));
    selection.selectTask(task);
  }
  return {
    ...selection, ...submission, coreSubmitState, effectiveCoreReadState, selectedSubmitTask,
    taskThreads, threadNavigationItems, workbenchTaskThreads, acceptTaskThreadProjection,
  };
}

function useTaskSelection(tasks: TaskProjection[]) {
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [selectedRunId, setSelectedRunId] = useState("");
  const [previewSelections, setPreviewSelections] = useState<Record<string, TaskPreviewSelection>>({});
  const [rightPanelOpenRequestKey, setRightPanelOpenRequestKey] = useState<number>();
  const selectedTaskIdRef = useRef(selectedTaskId);
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? tasks[0];
  const selectedRun = selectedTask?.runs.find((run) => run.id === selectedRunId) ?? selectedTask?.runs.at(-1);
  const previewSelection = selectedTask == null ? undefined : previewSelections[selectedTask.id];
  const previewRun = previewSelection == null ? undefined : selectedTask?.runs.find((run) => run.id === previewSelection.runId);
  useEffect(() => { selectedTaskIdRef.current = selectedTaskId; }, [selectedTaskId]);
  useEffect(() => {
    const task = tasks.find((item) => item.id === selectedTaskId) ?? tasks[0];
    if (task == null) return;
    if (task.id !== selectedTaskId) {
      setSelectedTaskId(task.id);
      setSelectedRunId(task.runs.at(-1)?.id ?? "");
    } else if (!task.runs.some((run) => run.id === selectedRunId)) setSelectedRunId(task.runs.at(-1)?.id ?? "");
  }, [selectedRunId, selectedTaskId, tasks]);

  function selectTask(task: TaskProjection) {
    setSelectedTaskId(task.id);
    setSelectedRunId(task.runs.at(-1)?.id ?? "");
  }

  return {
    previewRun, previewSelection, rightPanelOpenRequestKey, selectedRun, selectedTask, selectedTaskIdRef, selectTask, setSelectedRunId,
    requestRightPanel: (selection: TaskPreviewSelection) => {
      if (selectedTask != null && selectedTask.runs.some((run) => run.id === selection.runId)) {
        setPreviewSelections((current) => ({ ...current, [selectedTask.id]: selection }));
        setRightPanelOpenRequestKey((key) => (key ?? 0) + 1);
      }
    },
  };
}

function useTaskSubmission(options: {
  endpoint: string;
  identities: HarborIdentityLoadState["identities"];
  runtime: RuntimeSupervisorState;
  selectedSubmitTask: TaskProjection | undefined;
  selection: ReturnType<typeof useTaskSelection>;
  setBusinessInputs: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setSubmitStates: React.Dispatch<React.SetStateAction<Record<string, CoreTaskSubmitState>>>;
  setSubmittedOverrides: React.Dispatch<React.SetStateAction<Record<string, SubmittedTaskOverride>>>;
}) {
  const endpointRef = useRef(options.endpoint);
  useEffect(() => { endpointRef.current = options.endpoint; }, [options.endpoint]);

  function updateBusinessInput(value: string) {
    const task = options.selectedSubmitTask;
    if (task == null) return;
    const key = coreSubmitStateKey(task.id, options.endpoint);
    options.setBusinessInputs((current) => ({ ...current, [task.id]: value }));
    options.setSubmitStates((current) => ({ ...current, [key]: initialCoreTaskSubmitState }));
  }

  async function submit() {
    const task = options.selectedSubmitTask;
    if (task == null) return;
    const endpoint = options.endpoint;
    const key = coreSubmitStateKey(task.id, endpoint);
    const readiness = coreTaskSubmitReadiness(task, options.runtime, options.identities);
    if (!readiness.ok) {
      options.setSubmitStates((current) => ({ ...current, [key]: { status: "blocked", summary: readiness.reason } }));
      return;
    }
    options.setSubmitStates((current) => ({ ...current, [key]: { status: "submitting", summary: "正在向 Core POST /tasks 提交只读 task intent。" } }));
    const result = await submitCoreReadOnlyTask(endpoint, task, options.runtime, options.identities);
    options.setSubmitStates((current) => ({ ...current, [key]: result }));
    if (result.status !== "ready") return;
    options.setSubmittedOverrides((current) => ({
      ...current,
      [key]: { endpoint, taskId: task.id, task: promoteSubmittedCoreTask(task, result.run) },
    }));
    if (options.selection.selectedTaskIdRef.current === task.id && endpointRef.current === endpoint) {
      options.selection.setSelectedRunId(result.run.id);
    }
  }

  return { submitSelectedCoreTask: submit, updateSelectedTaskBusinessInput: updateBusinessInput };
}

function useThreadNavigation(task: TaskProjection | undefined) {
  return useMemo<ThreadNavigationItem[]>(() => (task?.runs ?? []).map((run) => ({
    id: run.id,
    getLabel: () => `${run.label} · ${outcomeLabel(run.outcome)}`,
    hasOutput: run.evidenceCards.length > 0,
    getPreview: () => ({
      response: run.summary,
      outputs: [
        { type: "outcome", label: outcomeLabel(run.outcome) },
        { type: "lifecycle", label: run.lifecycle },
        ...run.resultRows.slice(0, 2).map((row) => ({ type: "field", label: row.label })),
      ],
    }),
  })), [task]);
}

function applyLocalTaskContext(task: TaskProjection, overrides: Record<string, string>): TaskProjection {
  return {
    ...task,
    businessInput: overrides[task.id] ?? task.businessInput,
    searchQuery: overrides[task.id] === undefined ? task.searchQuery : undefined,
  };
}

function coreSubmitStateKey(taskId: string, endpoint: string) {
  return `${endpoint}::${taskId}`;
}

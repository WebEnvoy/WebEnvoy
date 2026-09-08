import { useEffect, useState } from "react";
import { fetchRunInstance, projectRunInstance, type RunInstanceState } from "./runInstanceClient";
import { requestOwnerJson } from "./ownerApiClient";
import { SourceField } from "./TaskThreadFields";

export function RunInstancePanel({ coreEndpoint, harborEndpoint, runId }: { coreEndpoint: string; harborEndpoint: string; runId: string }) {
  const [state, setState] = useState<RunInstanceState>({ status: "loading" });
  const [refresh, setRefresh] = useState(0);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    void fetchRunInstance(coreEndpoint, harborEndpoint, runId, controller.signal).then((next) => {
      if (!controller.signal.aborted) setState(next);
    });
    return () => controller.abort();
  }, [coreEndpoint, harborEndpoint, runId, refresh]);

  async function control(action: "takeover" | "return") {
    if (state.status !== "ready") return;
    const expected = state.instance.runtimeSessionRef;
    setState({ status: "loading" });
    const current = await fetchRunInstance(coreEndpoint, harborEndpoint, runId);
    if (current.status !== "ready" || current.instance.runtimeSessionRef !== expected) {
      setState(current.status === "ready" ? { status: "unavailable", summary: "Instance 绑定已变化，请重新检查。" } : current);
      return;
    }
    try {
      const handoff = action === "takeover" && current.instance.controlOwner === "core_task";
      const result = await requestOwnerJson(harborEndpoint, `/runtime/sessions/${encodeURIComponent(expected)}/${action === "takeover" ? handoff ? "handoff" : "lock" : "release"}`, {
        method: "POST",
        body: handoff
          ? { control_owner: "user", expected_control_owner: "core_task", handoff_reason: "user_requested" }
          : { control_owner: "user", ...(action === "takeover" ? { holder_ref: "app-browser-page" } : {}) },
      });
      const confirmed = projectRunInstance({ runtime_session_ref: expected, profile_ref: current.instance.profileRef, identity_environment_ref: current.instance.identityEnvironmentRef }, result);
      const transferred = confirmed.status === "ready" && (action === "takeover" ? confirmed.instance.controlOwner === "user" && confirmed.instance.controlState === "held" : confirmed.instance.controlOwner === "none" && confirmed.instance.controlState === "released");
      setMessage(!transferred ? "控制权操作未确认；请刷新查看同一 Instance 的状态。" : action === "return" ? "已交还控制；Agent 必须重新观察账号、经营对象和页面，再决定继续或结束。" : "已请求接管同一 Instance；此操作不改写 Run 或外部结果。");
    } catch {
      setMessage("控制权操作未确认；请刷新查看同一 Instance 的状态。");
    }
    setRefresh((value) => value + 1);
  }
  const instance = state.status === "ready" ? state.instance : undefined;
  const active = instance?.lifecycle === "active" || instance?.lifecycle === "locked" || instance?.lifecycle === "idle";
  return <section aria-label="当前回合的真实 Instance">
    <h3>当前 Instance</h3>
    {state.status === "unavailable" ? <p role="status">{state.summary}</p> : state.status === "loading" ? <p role="status">正在读取本回合的现场…</p> : null}
    {instance ? <dl className="context-facts compact">
      <SourceField label="Instance" value={instance.runtimeSessionRef} source="Core / Harbor live" />
      <SourceField label="Profile" value={instance.profileRef} source="Harbor live" />
      <SourceField label="身份环境引用" value={instance.identityEnvironmentRef ?? "未提供"} source="Harbor live" />
      <SourceField label="执行身份引用" value={instance.executionIdentityRef ?? "未提供"} source="Harbor live" />
      <SourceField label="实例状态" value={instance.lifecycle} source="Harbor live" />
      <SourceField label="控制权" value={`${instance.controlOwner} / ${instance.controlState}`} source="Harbor live" />
      <SourceField label="最近页面状态" value={`${instance.pageStatus} · ${instance.observedAt}`} source="Harbor live" />
    </dl> : null}
    <p>身份引用和页面状态不等于当前账号、经营对象或内容确认。页面记录可能已变化，继续前需要 Agent 重新观察。</p>
    <div className="single-action-actions">
      <button type="button" disabled={state.status === "loading"} onClick={() => setRefresh((value) => value + 1)}>刷新现场状态</button>
      {active && instance ? instance.controlOwner === "user" && instance.controlState === "held" ? <button type="button" onClick={() => void control("return")}>交还控制</button> : instance.controlOwner !== "user" ? <button type="button" onClick={() => void control("takeover")}>接管同一实例</button> : null : null}
    </div>
    {message ? <p role="status">{message}</p> : null}
  </section>;
}

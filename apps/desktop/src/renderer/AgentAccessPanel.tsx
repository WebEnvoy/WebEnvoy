import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { createLatestRequestGate } from "./latestRequestGate";
import {
  allowAgentManagement, fetchAgentManagementPolicy, agentManagementScope, createAgentGrantInput, createAgentOperationsV2Input, createAgentOperationsV2DirectGrantInput, createAgentOperationsV2GrantInput, createAgentOperationsV2PolicyInput, fetchAgentAccess, fetchAgentOwnerFiles, mutateAgentAccess, queryAgentAccessOperation,
  agentOperations, defaultAgentOperations, agentFileMimeTypes, agentFileMaxBytes, createProfilePolicyInput, type AgentScopeInput, type AgentAccessState,
} from "./agentAccessClient";

export function AgentAccessPanel({ endpoint }: { endpoint: string }) {
  const storageKey = `webenvoy.agent-access.pending:${endpoint}`;
  const [state, setState] = useState<AgentAccessState | null>(null);
  const [busy, setBusy] = useState(false);
  const [managementAllowed, setManagementAllowed] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(() => localStorage.getItem(storageKey) ?? "");
  const pendingRef = useRef(pending);
  const busyRef = useRef(false);
  const [principalId, setPrincipalId] = useState("");
  const [hours, setHours] = useState(24);
  const [profileRef, setProfileRef] = useState("");
  const [templateProviderId, setTemplateProviderId] = useState<string | null>(null);
  const [scope, setScope] = useState<AgentScopeInput>({ origin: "", origins: [""], operations: [...defaultAgentOperations], controlled: false });
  const [policyRef, setPolicyRef] = useState("");
  const [policyScope, setPolicyScope] = useState<AgentScopeInput>({ origin: "", origins: [""], operations: [...defaultAgentOperations], controlled: false });
  const [policyDraftDigest, setPolicyDraftDigest] = useState<string | undefined>();
  const [v2GrantId, setV2GrantId] = useState("");
  const [v2Scope, setV2Scope] = useState<AgentScopeInput>({ origin: "", origins: [""], operations: [...defaultAgentOperations], controlled: false });
  const [v2GrantDraftId, setV2GrantDraftId] = useState<string | undefined>();
  const [v2GrantDraftDigest, setV2GrantDraftDigest] = useState<string | undefined>();
  const [v2PolicyDraftRef, setV2PolicyDraftRef] = useState<string | undefined>();
  const [v2PolicyDraftDigest, setV2PolicyDraftDigest] = useState<string | undefined>();
  const [v2Hours, setV2Hours] = useState(24);
  const [v2Replace, setV2Replace] = useState(false);
  const [v2FileRefs, setV2FileRefs] = useState<string[]>([]);
  const [v2FileMimes, setV2FileMimes] = useState<string[]>([]);
  const [v2MaxFileBytes, setV2MaxFileBytes] = useState(agentFileMaxBytes);
  const [directV2FileRefs, setDirectV2FileRefs] = useState<string[]>([]);
  const [directV2FileMimes, setDirectV2FileMimes] = useState<string[]>([]);
  const [directV2MaxFileBytes, setDirectV2MaxFileBytes] = useState(agentFileMaxBytes);
  const [grantPolicyDraftDigest, setGrantPolicyDraftDigest] = useState<string | undefined>();
  const [ownerFiles, setOwnerFiles] = useState<Awaited<ReturnType<typeof fetchAgentOwnerFiles>>>([]);
  const [ownerFilesRefresh, setOwnerFilesRefresh] = useState(0);
  const alive = useRef(true);
  const readGate = useRef(createLatestRequestGate());

  async function refresh() {
    const request = readGate.current.begin();
    setOwnerFilesRefresh(current => current + 1);
    void fetchAgentManagementPolicy(endpoint).then(policy => {
      if (alive.current && request.isCurrent()) setManagementAllowed(policy?.modes.commit === "auto" && policy?.modes.read === "auto" && policy?.modes.prepare === "auto");
    }).catch(() => { if (alive.current && request.isCurrent()) setManagementAllowed(false); });
    try {
      const next = await fetchAgentAccess(endpoint, request.signal);
      if (alive.current && request.isCurrent()) { setState(next); setError(""); }
    } catch {
      if (alive.current && request.isCurrent()) { setState(null); setError("无法读取 Core 授权状态。请检查本地连接与管理权限后刷新。"); }
    }
  }
  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => { alive.current = false; readGate.current.invalidate(); };
  }, [endpoint]);

  function remember(key: string) {
    if (key) localStorage.setItem(storageKey, key);
    else localStorage.removeItem(storageKey);
    pendingRef.current = key;
    if (alive.current) setPending(key);
  }

  async function mutate(path: string, makeBody: (key: string) => unknown) {
    if (busyRef.current || pendingRef.current) return;
    const existing = localStorage.getItem(storageKey);
    if (existing) { pendingRef.current = existing; setPending(existing); return; }
    busyRef.current = true;
    setBusy(true); setError(""); setMessage("");
    try {
      const key = crypto.randomUUID();
      const body = makeBody(key);
      remember(key);
      readGate.current.invalidate();
      setState(null);
      const result = await mutateAgentAccess(endpoint, path, body);
      if (result !== "unknown") remember("");
      if (!alive.current) return;
      setState(null);
      await refresh();
      if (result === "rejected") setError("Core 拒绝了此操作，请检查管理权限和输入。");
      else setMessage(result === "completed" ? "操作已由 Core 确认，已刷新授权状态。" : "操作结果未知。仅可查询原操作；不会重发登记、授权或撤销请求。");
    } catch (error) {
      if (alive.current) setError(error instanceof Error ? error.message : "未能安全完成操作。若已有操作编号，请查询原操作结果。");
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  }

  async function reconcile() {
    if (busyRef.current || !pendingRef.current) return;
    busyRef.current = true; setBusy(true);
    try {
      const result = await queryAgentAccessOperation(endpoint, pendingRef.current);
      if (result === "completed") remember("");
      if (!alive.current) return;
      await refresh();
      setMessage(result === "completed" ? "Core 已确认原操作，授权状态已刷新。" : "Core 尚不能确认原操作。保留原操作编号，禁止重新提交；可稍后继续查询。");
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  }

  function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const name = String(data.get("display_name") ?? "").trim();
    const hash = String(data.get("credential_hash") ?? "").trim().toLowerCase();
    if (!name || !/^[a-f0-9]{64}$/.test(hash)) { setError("请输入名称和客户端提供的 64 位 SHA-256 公开指纹。"); return; }
    void mutate("/agent-access/principals", key => ({ idempotency_key: key, display_name: name, credential_hash: hash }));
  }

  const disabled = busy || Boolean(pending) || state === null;
  const activePrincipals = state?.principals.filter(item => item.revoked_at === null) ?? [];
  const principalName = (id: string) => state?.principals.find(item => item.principal_id === id)?.display_name ?? id;
  const v2Candidates = state?.grants.flatMap(grant => grant.scope_semantics === "legacy_request_guard_v1" && grant.revoked_at === null && Date.parse(grant.expires_at) > Date.now()
    ? grant.profile_refs.map(profileRef => ({ grant, policy: state.profile_policies.find(policy => policy.profile_ref === profileRef && policy.scope_semantics === "legacy_request_guard_v1") })).filter(item => item.policy !== undefined)
    : []) ?? [];
  const v2GrantCandidates = state?.grants.filter(grant => grant.scope_semantics === "agent_operations_v2" && grant.profile_refs.some(profileRef => state.profile_policies.some(policy => policy.profile_ref === profileRef && policy.scope_semantics === "agent_operations_v2"))) ?? [];
  const selectedV2Grant = v2GrantCandidates.find(grant => grant.grant_id === v2GrantId) ?? v2GrantCandidates[0];
  const selectedV2ProfileRef = selectedV2Grant?.profile_refs.find(profileRef => state?.profile_policies.some(policy => policy.profile_ref === profileRef && policy.scope_semantics === "agent_operations_v2")) ?? "";
  const selectedV2Policy = selectedV2ProfileRef ? state?.profile_policies.find(policy => policy.profile_ref === selectedV2ProfileRef && policy.scope_semantics === "agent_operations_v2") : undefined;
  const selectedPolicy = state?.profile_policies.find(item => item.profile_ref === policyRef);
  const selectedGrantPolicy = profileRef ? state?.profile_policies.find(item => item.profile_ref === profileRef) : undefined;
  const v2GrantCreation = selectedGrantPolicy?.scope_semantics === "agent_operations_v2";
  const v2PolicyEditing = selectedPolicy?.scope_semantics === "agent_operations_v2";
  const hasV2Profile = Boolean(state?.profile_policies.some(item => item.scope_semantics === "agent_operations_v2"));
  const directSelectedFiles = ownerFiles.filter(file => file.profile_ref === selectedGrantPolicy?.profile_ref && file.status === "available" && directV2FileRefs.includes(file.file_ref));
  const directHasFileOperation = scope.operations.some(operation => operation === "file.upload" || operation === "file.download");
  const directFileScope = directHasFileOperation || directSelectedFiles.length || directV2FileMimes.length ? { upload_refs: directSelectedFiles.map(file => file.file_ref), allowed_mime_types: directV2FileMimes, max_file_bytes: directV2MaxFileBytes } : undefined;
  const v2HasFileOperation = v2Scope.operations.some(operation => operation === "file.upload" || operation === "file.download");
  const v2NeedsFileScope = v2HasFileOperation || v2FileRefs.length > 0 || v2FileMimes.length > 0 || Boolean(selectedV2Grant?.file_scope);
  useEffect(() => {
    if (v2GrantId || !v2GrantCandidates.length) return;
    const grant = v2GrantCandidates[0]!;
    const profileRef = grant.profile_refs.find(ref => state?.profile_policies.some(item => item.profile_ref === ref && item.scope_semantics === "agent_operations_v2"));
    const profile = profileRef ? state?.profile_policies.find(item => item.profile_ref === profileRef && item.scope_semantics === "agent_operations_v2") : undefined;
    setV2GrantId(grant.grant_id);
    setV2Scope({ origin: grant.allowed_origins.find(origin => profile?.allowed_origins.includes(origin)) ?? "", origins: grant.allowed_origins.filter(origin => profile?.allowed_origins.includes(origin)), operations: grant.allowed_operations.filter(operation => operation !== "profile.create" && profile?.allowed_operations.includes(operation)), controlled: false });
    setV2FileRefs(grant.file_scope?.upload_refs ?? []);
    setV2FileMimes(grant.file_scope?.allowed_mime_types ?? []);
    setV2MaxFileBytes(grant.file_scope?.max_file_bytes ?? agentFileMaxBytes);
    setV2GrantDraftId(grant.grant_id);
    setV2GrantDraftDigest(grant.grant_digest);
    setV2PolicyDraftRef(profileRef);
    setV2PolicyDraftDigest(profile?.policy_digest);
  }, [state, v2GrantCandidates, v2GrantId]);
  useEffect(() => {
    if (!hasV2Profile) { setOwnerFiles([]); return; }
    let current = true;
    void fetchAgentOwnerFiles(endpoint).then(files => { if (current) setOwnerFiles(files); }).catch(() => { if (current) setOwnerFiles([]); });
    return () => { current = false; };
  }, [endpoint, hasV2Profile, ownerFilesRefresh]);
  useEffect(() => {
    if (!selectedPolicy || selectedPolicy.scope_semantics !== "agent_operations_v2" || selectedPolicy.policy_digest === policyDraftDigest) return;
    setPolicyScope({ origin: selectedPolicy.allowed_origins[0] ?? "", origins: selectedPolicy.allowed_origins, operations: selectedPolicy.allowed_operations, controlled: selectedPolicy.controlled_interaction_origins.length > 0, controlledOrigins: selectedPolicy.controlled_interaction_origins });
    setPolicyDraftDigest(selectedPolicy.policy_digest);
  }, [selectedPolicy?.profile_ref, selectedPolicy?.policy_digest, selectedPolicy?.scope_semantics, policyDraftDigest]);
  useEffect(() => {
    if (!selectedV2Grant || !selectedV2Policy) return;
    if (selectedV2Grant.grant_id === v2GrantDraftId && selectedV2Grant.grant_digest === v2GrantDraftDigest && selectedV2Policy.profile_ref === v2PolicyDraftRef && selectedV2Policy.policy_digest === v2PolicyDraftDigest) return;
    setV2Scope({ origin: selectedV2Grant.allowed_origins.find(origin => selectedV2Policy.allowed_origins.includes(origin)) ?? "", origins: selectedV2Grant.allowed_origins.filter(origin => selectedV2Policy.allowed_origins.includes(origin)), operations: selectedV2Grant.allowed_operations.filter(operation => operation !== "profile.create" && selectedV2Policy.allowed_operations.includes(operation)), controlled: false });
    setV2FileRefs(selectedV2Grant.file_scope?.upload_refs ?? []);
    setV2FileMimes(selectedV2Grant.file_scope?.allowed_mime_types ?? []);
    setV2MaxFileBytes(selectedV2Grant.file_scope?.max_file_bytes ?? agentFileMaxBytes);
    setV2GrantDraftId(selectedV2Grant.grant_id);
    setV2GrantDraftDigest(selectedV2Grant.grant_digest);
    setV2PolicyDraftRef(selectedV2Policy.profile_ref);
    setV2PolicyDraftDigest(selectedV2Policy.policy_digest);
  }, [selectedV2Grant?.grant_id, selectedV2Grant?.grant_digest, selectedV2Policy?.profile_ref, selectedV2Policy?.policy_digest, v2GrantDraftId, v2GrantDraftDigest, v2PolicyDraftRef, v2PolicyDraftDigest]);
  return <section className="settings-group" aria-label="Agent 接入管理">
    <header className="settings-group-header">
      <h2>Agent 接入与授权</h2>
      <p>此处授予浏览器管理范围。每次动作仍受现有授权策略、Profile 权限及实例控制权约束。</p>
    </header>
    <div className="settings-group-content">
      <div className="settings-action-row"><button type="button" className="save-button" disabled={busy} onClick={() => void refresh()}>刷新授权状态</button></div>
      {error && <p className="settings-error" role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {pending && <div role="status"><p>待确认操作：{pending}</p><button type="button" className="save-button" disabled={busy} onClick={() => void reconcile()}>查询原操作结果</button></div>}
      <div className="settings-action-row">
        <p>{managementAllowed ? "已授权的环境管理与受控页面操作可直接执行。" : "创建 Profile 与受控交互还需要允许环境管理与受控页面操作直接执行。此设置不更改网站任务的执行方式，也不授予新的 Profile、origin 或操作权限。"}</p>
        <button type="button" className="save-button" disabled={disabled || managementAllowed} onClick={async () => {
          if (busyRef.current) return;
          busyRef.current = true; setBusy(true); setError("");
          try { await allowAgentManagement(endpoint); await refresh(); }
          catch (error) { setError(error instanceof Error ? error.message : "请刷新核对管理执行策略。"); }
          finally { busyRef.current = false; setBusy(false); }
        }}>允许已授权的环境管理与受控页面操作</button>
      </div>
      <form onSubmit={register}>
        <h3>登记 Agent</h3>
        <p>先由 Agent 本地客户端生成凭据，仅粘贴其 SHA-256 公开指纹。不要粘贴原始 token；App 不生成或展示密钥。</p>
        <label className="connection-field"><span>Agent 名称</span><input name="display_name" required maxLength={128} disabled={disabled} /></label>
        <label className="connection-field"><span>SHA-256 公开指纹</span><input name="credential_hash" required pattern="[a-fA-F0-9]{64}" minLength={64} maxLength={64} autoComplete="off" spellCheck={false} disabled={disabled} /></label>
        <button className="save-button" type="submit" disabled={disabled}>登记 Agent</button>
      </form>
      <form onSubmit={event => { event.preventDefault(); if (!policyRef) return; if (v2PolicyEditing && selectedPolicy?.policy_digest !== policyDraftDigest) { setError("Profile policy 已刷新，请重新确认当前范围后再提交。"); return; } if (v2PolicyEditing && !window.confirm("确认调整此 v2 Profile 权限上限？Core 会核对当前摘要，并要求 Harbor 保持 Profile 停止；已有 Grant 不会自动扩大。")) return; void mutate(v2PolicyEditing ? "/agent-access/v2/profile-policies" : "/agent-access/profile-policies", key => v2PolicyEditing ? createAgentOperationsV2PolicyInput(selectedPolicy!, policyScope, key) : createProfilePolicyInput(policyRef, policyScope, key)); }}>
        <h3>{v2PolicyEditing ? "调整 v2 Profile 权限上限" : "配置受管 Profile 权限上限"}</h3>
        <p>{v2PolicyEditing ? "调整 v2 权限会先核对当前摘要，并要求 Harbor 可信地保持此 Profile 停止；运行中的 Profile 会被拒绝。" : "独立保存此 Profile 的上限，会替换当前 origin 与操作列表，并影响其已有 Grant。保存后再单独授予 Agent；Grant 不能提高此上限。"}</p>
        <label className="connection-field"><span>配置 Profile</span><select required value={policyRef} disabled={disabled} onChange={event => {
          const ref = event.currentTarget.value; setPolicyRef(ref);
          const policy = state?.profile_policies.find(item => item.profile_ref === ref);
          setPolicyDraftDigest(policy?.scope_semantics === "agent_operations_v2" ? policy.policy_digest : undefined);
          setPolicyScope({ origin: policy?.allowed_origins[0] ?? "", origins: policy?.allowed_origins ?? [""], operations: policy?.allowed_operations ?? [...defaultAgentOperations], controlled: Boolean(policy?.controlled_interaction_origins.length), controlledOrigins: policy?.controlled_interaction_origins ?? [] });
        }}><option value="">请选择受管 Profile</option>{state?.profile_policies.map(item => <option key={item.profile_ref} value={item.profile_ref}>{item.profile_ref}</option>)}</select></label>
        <ScopeFields value={policyScope} onChange={setPolicyScope} disabled={disabled} declaration={!v2PolicyEditing} />
        <button className="save-button" type="submit" disabled={disabled || !policyRef}>{v2PolicyEditing ? "确认调整 v2 权限上限" : "保存 Profile 权限上限"}</button>
      </form>
      <form onSubmit={event => { event.preventDefault(); if (v2GrantCreation && selectedGrantPolicy) { if (selectedGrantPolicy.policy_digest !== grantPolicyDraftDigest) { setError("Profile policy 已刷新，请重新选择 Profile 并确认当前范围后再提交。"); return; } if (directHasFileOperation && !directV2FileMimes.length) { setError("文件操作必须明确确认至少一个允许的 MIME 类型。"); return; } if (scope.operations.includes("file.upload") && !directSelectedFiles.length) { setError("file.upload 至少需要选择一个可用的 owner 文件材料。"); return; } if (!window.confirm(`确认直接签发 v2 Grant？Principal：${principalId}；Profile：${selectedGrantPolicy.profile_ref}；origin：${scope.origins?.filter(Boolean).join("、") || scope.origin}；操作：${scope.operations.join("、") || "无"}；文件 ref：${directFileScope?.upload_refs.join("、") || "无"}；文件 MIME：${directFileScope?.allowed_mime_types.join("、") || "无"}；文件上限：${directFileScope?.max_file_bytes ?? "无"} bytes；期限：${hours} 小时（提交时起算）；替换：否：直接新签发；来源：无；当前 policy 摘要 ${selectedGrantPolicy.policy_digest ?? "缺少，请刷新"} 会由 Core 再次核对。`)) return; void mutate("/agent-access/v2/grants", key => createAgentOperationsV2DirectGrantInput(principalId, selectedGrantPolicy, scope, key, hours, directFileScope)); return; } void mutate("/agent-access/grants", key => createAgentGrantInput(principalId, hours, key, scope, profileRef, templateProviderId)); }}>
        <h3>{v2GrantCreation ? "直接签发 v2 Grant" : "授予非生产浏览器权限"}</h3>
        <p>{v2GrantCreation ? "已选择 v2 Profile；提交完整 Principal、单一 Profile、origin、操作、期限和当前 policy 摘要。没有 source 也可以由 owner 直接签发，Core 固定为 v2 且不创建 Profile。" : agentManagementScope}</p>
        <label className="connection-field"><span>授权 Agent</span><select name="grant_principal" required value={principalId} disabled={disabled} onChange={event => setPrincipalId(event.currentTarget.value)}><option value="">请选择 Agent</option>{activePrincipals.map(item => <option key={item.principal_id} value={item.principal_id}>{item.display_name} · {item.principal_id}</option>)}</select></label>
        <label className="connection-field"><span>{v2GrantCreation ? "授权 v2 Profile" : "授权 Profile 或创建模板"}</span><select name="grant_profile" required={v2GrantCreation} value={profileRef} disabled={disabled} onChange={event => { const ref = event.currentTarget.value; const policy = state?.profile_policies.find(item => item.profile_ref === ref); setProfileRef(ref); setGrantPolicyDraftDigest(policy?.scope_semantics === "agent_operations_v2" ? policy.policy_digest : undefined); setDirectV2FileRefs([]); setDirectV2FileMimes([]); setDirectV2MaxFileBytes(agentFileMaxBytes); setScope(current => ({ ...current, controlled: false })); }}><option value="">{v2GrantCreation ? "请选择 v2 Profile" : "创建最多 2 个新 Profile"}</option>{state?.profile_policies.map(item => <option key={item.profile_ref} value={item.profile_ref}>{item.profile_ref} · {item.scope_semantics === "agent_operations_v2" ? "v2" : "legacy"}</option>)}</select></label>
        {!profileRef && !v2GrantCreation && <label className="connection-field"><span>创建模板 Provider</span><select value={templateProviderId ?? ""} disabled={disabled} onChange={event => setTemplateProviderId(event.currentTarget.value || null)}><option value="">动态：本次选择或用户新建默认</option><option value="cloakbrowser">固定 CloakBrowser</option><option value="chrome_official">固定 Google Chrome</option><option value="camoufox">固定 Camoufox</option></select></label>}
        <p>{v2GrantCreation ? `此授权仍受 v2 Profile 上限约束；当前 policy 摘要：${selectedGrantPolicy?.policy_digest ?? "缺少，请刷新"}。` : profileRef ? "此授权仍受已保存的 Profile 上限约束；受控页面声明须在上方独立保存。" : "新环境使用中文、Asia/Shanghai 时区。所选范围同时作为创建模板权限上限；不包含已有 Profile。"}</p>
        <ScopeFields value={scope} onChange={setScope} disabled={disabled} declaration={!profileRef} />
        {v2GrantCreation && <><fieldset disabled={disabled}><legend>选择现有 owner 文件材料</legend>{ownerFiles.filter(file => file.profile_ref === selectedGrantPolicy?.profile_ref && file.status === "available").length === 0 && <p>此 Profile 没有可批准的 owner 文件材料。</p>}{ownerFiles.filter(file => file.profile_ref === selectedGrantPolicy?.profile_ref && file.status === "available").map(file => <label key={file.file_ref} style={{ display: "block" }}><input type="checkbox" name="direct_file_ref" value={file.file_ref} checked={directV2FileRefs.includes(file.file_ref)} onChange={event => { const checked = event.currentTarget.checked; setDirectV2FileRefs(current => checked ? [...new Set([...current, file.file_ref])] : current.filter(ref => ref !== file.file_ref)); }} />{file.display_name} · {file.mime_type} · {file.byte_length} bytes</label>)}</fieldset><fieldset disabled={disabled}><legend>明确确认 file_scope</legend>{agentFileMimeTypes.map(mime => <label key={mime} style={{ display: "block" }}><input type="checkbox" name="direct_file_mime" value={mime} checked={directV2FileMimes.includes(mime)} onChange={event => { const checked = event.currentTarget.checked; setDirectV2FileMimes(current => checked ? [...new Set([...current, mime])] : current.filter(item => item !== mime)); }} />允许 MIME：{mime}</label>)}<label className="connection-field"><span>文件上限 bytes</span><input name="direct_file_max_bytes" type="number" min={1} max={agentFileMaxBytes} step={1} required value={directV2MaxFileBytes} onChange={event => setDirectV2MaxFileBytes(Number(event.currentTarget.value))} /></label><p>file.download 不从上传材料推导 MIME 或大小上限；请明确确认完整 file_scope。</p></fieldset></>}
        <label className="connection-field"><span>授权有效期</span><select value={hours} disabled={disabled} onChange={event => setHours(Number(event.currentTarget.value))}><option value={1}>1 小时</option><option value={24}>24 小时</option><option value={168}>7 天</option></select></label>
        <button className="save-button" type="submit" disabled={disabled || !activePrincipals.some(item => item.principal_id === principalId) || v2GrantCreation && !profileRef}>{v2GrantCreation ? "确认签发 v2 Grant" : "授予所选范围"}</button>
      </form>
      <h3>Agent（Principal）</h3>
      {state?.principals.length === 0 && <p>尚未登记 Agent。</p>}
      {state?.principals.map(item => <div className="settings-row we-settings-row" key={item.principal_id}><div><strong>{item.display_name} · {item.revoked_at ? "已撤销" : "已登记"}</strong><span>{item.principal_id}</span></div></div>)}
      <h3>连接（Connection）</h3>
      {state?.connections.length === 0 && <p>尚无连接记录。</p>}
      {state?.connections.map(item => <div className="settings-row we-settings-row" key={item.connection_id}><div><strong>{principalName(item.principal_id)} · {item.revoked_at ? "已撤销" : "连接已登记"}</strong><span>{item.connection_id} · {new Date(item.connected_at).toLocaleString()}</span></div></div>)}
      <h3>授权（Grant）</h3>
      {state?.grants.length === 0 && <p>尚无授权。</p>}
      {state?.grants.map(item => <div className="settings-row we-settings-row" key={item.grant_id}><div>
        <strong>{principalName(item.principal_id)} · {item.revoked_at ? "已撤销" : Date.parse(item.expires_at) <= Date.now() ? "已过期" : "有效"}</strong>
        <span>{item.grant_id}</span><span>{item.scope_semantics === "agent_operations_v2" ? "控制 Agent 操作（v2）" : "兼容请求保护（legacy）"} · 有效至 {new Date(item.expires_at).toLocaleString()} · {item.allowed_origins.join("、") || "无站点授权"}</span>
        <span>允许操作：{item.allowed_operations.join("、")}</span><span>{item.creation_template ? item.creation_template.provider_id ?? "动态 Provider" : "无创建模板"} · 已创建 {item.created_profile_refs.length} / {item.max_created_profiles} 个 Profile</span>
        <span>已授权 Profile：{[...new Set([...item.profile_refs, ...item.created_profile_refs])].join("、") || "尚无"}</span>
        <button className="save-button" type="button" disabled={disabled || item.revoked_at !== null} onClick={() => void mutate(`/agent-access/grants/${encodeURIComponent(item.grant_id)}/revoke`, key => ({ idempotency_key: key }))}>撤销授权</button>
      </div></div>)}
      <h3>启用新版 Agent 操作边界</h3>
      <p>这会控制所选 Agent 的页面读取、操作、文件使用与明确导航；不提供整个浏览器的全生命周期网络隔离。只处理已停止的所选 Profile，不修改原授权或其它 Profile。</p>
      {v2Candidates.length === 0 && <p>没有可确认的 legacy Profile 授权。</p>}
      {v2Candidates.map(({ grant, policy }) => <div className="settings-row we-settings-row" key={`${grant.grant_id}:${policy!.profile_ref}`}><div>
        <strong>{principalName(grant.principal_id)} · {policy!.profile_ref}</strong>
        <span>网站：{grant.allowed_origins.filter(origin => policy!.allowed_origins.includes(origin)).join("、") || "无"}</span>
        <span>操作：{grant.allowed_operations.filter(operation => operation !== "profile.create" && policy!.allowed_operations.includes(operation)).join("、") || "无"}</span>
        <span>文件：{grant.file_scope ? `${grant.file_scope.upload_refs.length} 个上传材料，${grant.file_scope.allowed_mime_types.join("、")}，上限 ${grant.file_scope.max_file_bytes} bytes` : "未授权"}</span>
        <button className="save-button" type="button" disabled={disabled} onClick={() => {
          if (!window.confirm(`确认让 ${principalName(grant.principal_id)} 在 ${policy!.profile_ref} 使用新版 Agent 操作边界？这不提供全浏览器网络隔离。`)) return;
          void mutate("/agent-access/scope-confirmations", key => createAgentOperationsV2Input(grant, policy!, key));
        }}>确认启用新版边界</button>
      </div></div>)}
      <h3>续发或重新签发 v2 Grant</h3>
      <p>来源可以已过期或已撤销，但此操作只创建新 Grant，不会恢复旧 Grant。勾选替换时仅允许有效的单 Profile Grant 原子撤销并新签发；文件 ref、类型和大小上限会随本次签发固定。</p>
      {v2GrantCandidates.length === 0 && <p>没有可续发的 v2 Grant。</p>}
      {v2GrantCandidates.length > 0 && <form onSubmit={event => {
        event.preventDefault();
        if (!selectedV2Grant || !selectedV2Policy) return;
        const selectedFiles = ownerFiles.filter(file => file.profile_ref === selectedV2ProfileRef && file.status === "available" && v2FileRefs.includes(file.file_ref));
        const fileScope = v2NeedsFileScope ? { upload_refs: selectedFiles.map(file => file.file_ref), allowed_mime_types: v2FileMimes, max_file_bytes: v2MaxFileBytes } : undefined;
        if (selectedV2Grant.grant_id !== v2GrantDraftId || selectedV2Grant.grant_digest !== v2GrantDraftDigest || selectedV2Policy.profile_ref !== v2PolicyDraftRef || selectedV2Policy.policy_digest !== v2PolicyDraftDigest) { setError("来源 Grant 或 Profile policy 已刷新，请重新选择来源并确认当前范围后再提交。"); return; }
        if (v2HasFileOperation && !v2FileMimes.length) { setError("文件操作必须明确确认至少一个允许的 MIME 类型。"); return; }
        if (v2Scope.operations.includes("file.upload") && !selectedFiles.length) { setError("file.upload 至少需要选择一个可用的 owner 文件材料。"); return; }
        const expirySummary = `${v2Hours} 小时（提交时起算）`;
        const replacementSummary = v2Replace ? "是：同一事务撤销当前有效的单 Profile Grant" : "否：来源 Grant 保持不变";
        const summary = [
          `Principal：${selectedV2Grant.principal_id}`,
          `Profile：${selectedV2ProfileRef}`,
          `origin：${v2Scope.origins?.filter(Boolean).join("、") || v2Scope.origin || "无"}`,
          `操作：${v2Scope.operations.join("、") || "无"}`,
          `文件 ref：${selectedFiles.map(file => file.file_ref).join("、") || "无"}`,
          `文件 MIME：${fileScope?.allowed_mime_types.join("、") || "无"}`,
          `文件上限：${fileScope?.max_file_bytes ?? "无"} bytes`,
          `期限：${expirySummary}`,
          `替换：${replacementSummary}`,
        ].join("；");
        if (!window.confirm(`确认签发新的 v2 Grant？${summary}。来源摘要与当前 policy 摘要会由 Core 再次核对；${v2Replace ? "旧 Grant 将原子撤销。" : "旧 Grant 不会被修改。"}`)) return;
        void mutate("/agent-access/v2/grants", key => createAgentOperationsV2GrantInput(selectedV2Grant, selectedV2Policy, key, { scope: v2Scope, hours: v2Hours, fileScope, replaces: v2Replace }));
      }}>
        <label className="connection-field"><span>来源 v2 Grant</span><select required value={selectedV2Grant?.grant_id ?? ""} disabled={disabled} onChange={event => {
          const grant = v2GrantCandidates.find(item => item.grant_id === event.currentTarget.value);
          const profileRef = grant?.profile_refs.find(profileRef => state?.profile_policies.some(item => item.profile_ref === profileRef && item.scope_semantics === "agent_operations_v2"));
          const profile = profileRef ? state?.profile_policies.find(item => item.profile_ref === profileRef && item.scope_semantics === "agent_operations_v2") : undefined;
          setV2GrantId(event.currentTarget.value); setV2Replace(false);
          setV2Scope({ origin: grant?.allowed_origins.find(origin => profile?.allowed_origins.includes(origin)) ?? "", origins: grant?.allowed_origins.filter(origin => profile?.allowed_origins.includes(origin)) ?? [""], operations: grant?.allowed_operations.filter(operation => operation !== "profile.create" && profile?.allowed_operations.includes(operation)) ?? [...defaultAgentOperations], controlled: false });
          setV2FileRefs(grant?.file_scope?.upload_refs ?? []);
          setV2FileMimes(grant?.file_scope?.allowed_mime_types ?? []);
          setV2MaxFileBytes(grant?.file_scope?.max_file_bytes ?? agentFileMaxBytes);
          setV2GrantDraftId(grant?.grant_id);
          setV2GrantDraftDigest(grant?.grant_digest);
          setV2PolicyDraftRef(profileRef);
          setV2PolicyDraftDigest(profile?.policy_digest);
        }}>{v2GrantCandidates.map(grant => <option key={grant.grant_id} value={grant.grant_id}>{grant.grant_id} · {grant.revoked_at ? "已撤销" : Date.parse(grant.expires_at) <= Date.now() ? "已过期" : "有效"}</option>)}</select></label>
        {selectedV2Grant && <p>来源 Grant 摘要：{selectedV2Grant.grant_digest ?? "缺少摘要，请刷新"}。目标 Profile：{selectedV2ProfileRef}；当前 policy 摘要：{selectedV2Policy?.policy_digest ?? "缺少摘要，请刷新"}。提交会再次核对这两个摘要。</p>}
        <ScopeFields value={v2Scope} onChange={setV2Scope} disabled={disabled} declaration={false} />
        <fieldset disabled={disabled}><legend>选择现有 owner 文件材料</legend>{ownerFiles.filter(file => file.profile_ref === selectedV2ProfileRef && file.status === "available").length === 0 && <p>此 Profile 没有可批准的 owner 文件材料。</p>}{ownerFiles.filter(file => file.profile_ref === selectedV2ProfileRef && file.status === "available").map(file => <label key={file.file_ref} style={{ display: "block" }}><input type="checkbox" name="v2_file_ref" value={file.file_ref} checked={v2FileRefs.includes(file.file_ref)} onChange={event => { const checked = event.currentTarget.checked; setV2FileRefs(current => checked ? [...new Set([...current, file.file_ref])] : current.filter(ref => ref !== file.file_ref)); }} />{file.display_name} · {file.mime_type} · {file.byte_length} bytes</label>)}</fieldset>
        <fieldset disabled={disabled}><legend>明确确认 file_scope</legend>{agentFileMimeTypes.map(mime => <label key={mime} style={{ display: "block" }}><input type="checkbox" name="v2_file_mime" value={mime} checked={v2FileMimes.includes(mime)} onChange={event => { const checked = event.currentTarget.checked; setV2FileMimes(current => checked ? [...new Set([...current, mime])] : current.filter(item => item !== mime)); }} />允许 MIME：{mime}</label>)}<label className="connection-field"><span>文件上限 bytes</span><input name="v2_file_max_bytes" type="number" min={1} max={agentFileMaxBytes} step={1} required value={v2MaxFileBytes} onChange={event => setV2MaxFileBytes(Number(event.currentTarget.value))} /></label><p>续发会显式提交 MIME、大小上限和上传材料 ref；download-only 来源保留空 upload_refs。</p></fieldset>
        <label className="connection-field"><span>新 Grant 有效期</span><select required value={v2Hours} disabled={disabled} onChange={event => setV2Hours(Number(event.currentTarget.value))}><option value={1}>1 小时（提交时起算）</option><option value={24}>24 小时（提交时起算）</option><option value={168}>7 天（提交时起算）</option></select></label>
        <label><input type="checkbox" checked={v2Replace} disabled={disabled || !selectedV2Grant || Boolean(selectedV2Grant.revoked_at) || Date.parse(selectedV2Grant.expires_at) <= Date.now() || selectedV2Grant.profile_refs.length !== 1} onChange={event => setV2Replace(event.currentTarget.checked)} />确认替换此有效单 Profile Grant（原子撤销旧 Grant）</label>
        <button className="save-button" type="submit" disabled={disabled || !selectedV2Grant || !selectedV2Policy}>确认签发 v2 Grant</button>
      </form>}
      <h3>Profile 权限上限</h3>
      {state?.profile_policies.length === 0 && <p>尚无受此授权管理的 Profile。</p>}
      {state?.profile_policies.map(item => <div className="settings-row we-settings-row" key={item.profile_ref}><div><strong>{item.profile_ref}</strong><span>{item.scope_semantics === "agent_operations_v2" ? "Agent 操作边界 v2" : "legacy 请求保护"}</span><span>{item.allowed_origins.join("、")}</span><span>{item.allowed_operations.join("、")}</span><span>受控交互 origin：{item.controlled_interaction_origins.join("、") || "未声明"}</span></div></div>)}
    </div>
  </section>;
}

function ScopeFields({ value, onChange, disabled, declaration }: { value: AgentScopeInput; onChange: (scope: AgentScopeInput) => void; disabled: boolean; declaration: boolean }) {
  const origins = value.origins?.length ? value.origins : [value.origin];
  const updateOrigins = (next: string[]) => onChange({ ...value, origin: next[0] ?? "", origins: next, ...(value.controlledOrigins === undefined ? {} : { controlledOrigins: value.controlledOrigins.filter(origin => next.includes(origin)) }) });
  return <fieldset disabled={disabled}>
    <legend>明确授权范围</legend>
    <span>精确 origin 集合</span>
    {origins.map((origin, index) => <div className="settings-action-row" key={index}>
      <label className="connection-field" style={{ flex: 1 }}><span className="sr-only">origin {index + 1}</span><input name={`scope_origin_${index}`} type="url" required value={origin} placeholder="协议://主机:端口" onChange={event => updateOrigins(origins.map((item, itemIndex) => itemIndex === index ? event.currentTarget.value : item))} /></label>
      {origins.length > 1 && <button className="save-button" type="button" onClick={() => updateOrigins(origins.filter((_, itemIndex) => itemIndex !== index))}>移除</button>}
    </div>)}
    <button className="save-button" type="button" onClick={() => updateOrigins([...origins, ""])}>添加 origin</button>
    <fieldset><legend>必要操作（逐项选择）</legend>{agentOperations.map(([operation, label]) => <label key={operation} style={{ display: "block" }}><input type="checkbox" name={operation} checked={value.operations.includes(operation)} onChange={event => onChange({ ...value, operations: event.currentTarget.checked ? [...value.operations, operation] : value.operations.filter(item => item !== operation) })} />{label}（{operation}）</label>)}</fieldset>
    <p>控件观察、点击、输入、按键、滚动和等待仅适用于 owner 明确声明的专用受控 origin；不得用于真实身份或外部业务效果。未声明时 Core 拒绝这些操作，公开正文读取不受此声明影响。</p>
    {declaration && <label><input type="checkbox" name="controlled_origin" checked={value.controlled} onChange={event => onChange({ ...value, controlled: event.currentTarget.checked, controlledOrigins: event.currentTarget.checked ? origins : [] })} />此 origin 是无登录身份、无外部业务效果的专用受控页面</label>}
    {!declaration && value.controlledOrigins !== undefined && <fieldset><legend>精确受控交互 origin</legend>{origins.map(origin => <label key={origin} style={{ display: "block" }}><input type="checkbox" checked={value.controlledOrigins!.includes(origin)} onChange={event => onChange({ ...value, controlled: event.currentTarget.checked || value.controlledOrigins!.some(item => item !== origin), controlledOrigins: event.currentTarget.checked ? [...new Set([...value.controlledOrigins!, origin])] : value.controlledOrigins!.filter(item => item !== origin) })} />允许受控交互：{origin}</label>)}</fieldset>}
  </fieldset>;
}

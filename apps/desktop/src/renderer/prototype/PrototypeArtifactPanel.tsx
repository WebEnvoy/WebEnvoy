import * as Tabs from "@radix-ui/react-tabs";
import { Braces, CircleAlert, ExternalLink, FileArchive, FileText, Image as ImageIcon, LoaderCircle, Music2, Plus, RotateCw, ShieldCheck, Video, X } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import samplePagePreview from "../../../artifacts/app-208-real-read-task.png";
import { articleResultForRun, executionModeLabels, hasCompatibleOutputView, productRows, resultRows, writeResultForRun, type ArtifactSet, type ExecutionMode, type PrototypePreviewSelection, type PrototypeRun, type PrototypeTask } from "./prototypeData";

const downloadFiles = [
  { name: "新品发布会-主片.mp4", size: "126 MB", state: "已保存" },
  { name: "新品发布会-封面.png", size: "8 MB", state: "已保存" },
  { name: "产品讲解-音轨.mp3", size: "42 MB", state: "已保存" },
  { name: "活动素材-源文件.zip", size: null, state: "来源已失效" },
];

type FileTabId = "json" | "markdown" | "image" | "media" | "skill-view";
type ResultTabId = `result:${string}`;
type ArtifactTabId = FileTabId | ResultTabId;
type RunTabState = { openTabIds: ArtifactTabId[]; activeTabId: ArtifactTabId | null };
type ResultSelection = Extract<PrototypePreviewSelection, { kind: "note" | "product" }>;

const artifactTabLabels: Record<FileTabId, string> = {
  json: "result.json",
  markdown: "summary.md",
  image: "page.png",
  media: "媒体与文件",
  "skill-view": "商品对比",
};

export function PrototypeArtifactPanel({ executionMode, executionSource, requestKey, run, selection, tabHost, task }: { executionMode: ExecutionMode; executionSource: string; requestKey: number; run: PrototypeRun | null; selection: PrototypePreviewSelection | null; tabHost: Element | null; task: PrototypeTask }) {
  const artifactSet = run?.artifactSet ?? (run == null ? undefined : task.artifactSet);
  const state = run == null ? "none" : run.artifactState ?? task.artifactState ?? (artifactSet == null ? "none" : "ready");
  const artifact = run != null && state === "ready" && artifactSet != null ? createArtifact(run, artifactSet, task) : null;
  const [resultTabs, setResultTabs] = useState<Record<ResultTabId, ResultSelection>>({});
  const [tabStateByRun, setTabStateByRun] = useState<Record<string, RunTabState>>({});
  const tabState = run == null ? initialRunTabState() : tabStateByRun[run.id] ?? initialRunTabState();
  const addButtonRef = useRef<HTMLButtonElement | null>(null);
  const panelContentRef = useRef<HTMLDivElement | null>(null);
  const previousRequestKeyRef = useRef(requestKey);
  const availableTabIds = useMemo<ArtifactTabId[]>(() => {
    if (run == null) return [];
    const result: ArtifactTabId[] = Object.entries(resultTabs).filter(([, item]) => item.runId === run.id).map(([tabId]) => tabId as ResultTabId);
    if (artifact != null) result.push("json", "markdown");
    if (artifact != null && artifactSet === "xhs-notes") result.push("image");
    if (artifact != null && artifactSet === "download-files") result.push("media");
    if (artifact != null && hasCompatibleOutputView(run.outputView, artifactSet)) result.unshift("skill-view");
    return result;
  }, [artifact, artifactSet, resultTabs, run]);
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  useEffect(() => {
    if (selection == null || run == null) return;
    const tabId = selection.kind === "file" ? selection.tab : resultTabId(selection);
    if (selection.kind !== "file") setResultTabs((current) => ({ ...current, [tabId as ResultTabId]: selection }));
    setTabStateByRun((current) => {
      const currentRun = current[run.id] ?? initialRunTabState();
      return { ...current, [run.id]: { openTabIds: currentRun.openTabIds.includes(tabId) ? currentRun.openTabIds : [...currentRun.openTabIds, tabId], activeTabId: tabId } };
    });
  }, [requestKey, run, selection]);

  useEffect(() => {
    const activeTab = Array.from(tabHost?.querySelectorAll<HTMLElement>("[data-artifact-tab-id]") ?? []).find((element) => element.dataset.artifactTabId === tabState.activeTabId);
    activeTab?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [tabHost, tabState.activeTabId, tabState.openTabIds.length]);

  useEffect(() => {
    if (previousRequestKeyRef.current === requestKey) return;
    previousRequestKeyRef.current = requestKey;
    const frame = window.requestAnimationFrame(() => panelContentRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [requestKey]);

  function activateTab(tabId: ArtifactTabId) {
    if (run == null) return;
    setTabStateByRun((current) => {
      const currentRun = current[run.id] ?? initialRunTabState();
      return { ...current, [run.id]: { ...currentRun, activeTabId: tabId } };
    });
  }

  function focusTab(tabId: ArtifactTabId | null) {
    if (tabId == null) return;
    window.requestAnimationFrame(() => {
      Array.from(tabHost?.querySelectorAll<HTMLElement>("[data-artifact-tab-id]") ?? []).find((element) => element.dataset.artifactTabId === tabId)?.focus();
    });
  }

  function closeTab(tabId: ArtifactTabId) {
    if (run == null) return;
    const index = tabState.openTabIds.indexOf(tabId);
    const nextTabs = tabState.openTabIds.filter((id) => id !== tabId);
    const nextActiveTab = tabState.activeTabId === tabId ? nextTabs[Math.min(index, nextTabs.length - 1)] ?? null : tabState.activeTabId;
    setTabStateByRun((current) => {
      return { ...current, [run.id]: { openTabIds: nextTabs, activeTabId: nextActiveTab } };
    });
    if (nextActiveTab == null) window.requestAnimationFrame(() => addButtonRef.current?.focus());
    else focusTab(nextActiveTab);
  }

  function openTab(tabId: ArtifactTabId) {
    if (run == null) return;
    setTabStateByRun((current) => {
      const currentRun = current[run.id] ?? initialRunTabState();
      return { ...current, [run.id]: { openTabIds: currentRun.openTabIds.includes(tabId) ? currentRun.openTabIds : [...currentRun.openTabIds, tabId], activeTabId: tabId } };
    });
    setAddMenuOpen(false);
    focusTab(tabId);
  }

  const closedTabIds = availableTabIds.filter((id) => !tabState.openTabIds.includes(id));

  function toggleAddMenu() {
    const nextOpen = !addMenuOpen;
    setAddMenuOpen(nextOpen);
    if (nextOpen) window.requestAnimationFrame(() => addButtonRef.current?.parentElement?.querySelector<HTMLElement>("[role=menuitem]")?.focus());
  }

  function handleAddMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!addMenuOpen) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setAddMenuOpen(false);
      addButtonRef.current?.focus();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=menuitem]"));
    if (items.length === 0) return;
    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : event.key === "ArrowDown" ? (currentIndex + 1 + items.length) % items.length : (currentIndex - 1 + items.length) % items.length;
    items[nextIndex]?.focus();
  }

  return (
    <aside className="prototype-artifact-panel codex-scrollbar" aria-label="任务文件预览">
      <Tabs.Root className="panel-tabs prototype-controlled-tabs" value={tabState.activeTabId ?? ""} onValueChange={(value) => activateTab(value as ArtifactTabId)}>
        {tabHost == null ? null : createPortal(
          <div className="panel-tab-strip prototype-artifact-tab-strip">
            <div className="panel-tab-scroll"><Tabs.List className="panel-tab-list" aria-label="任务文件预览">{tabState.openTabIds.map((tabId) => <div className={`prototype-closable-tab ${tabState.activeTabId === tabId ? "active" : ""}`} key={tabId}><Tabs.Trigger className="panel-tab-trigger" data-artifact-tab-id={tabId} title={tabLabel(tabId, resultTabs)} value={tabId}><span className="panel-tab-label">{tabLabel(tabId, resultTabs)}</span></Tabs.Trigger><button className="prototype-tab-close" type="button" aria-label={`关闭 ${tabLabel(tabId, resultTabs)}`} title="关闭" onClick={() => closeTab(tabId)}><X size={12} /></button></div>)}</Tabs.List></div>
            <div className="prototype-tab-add-wrap" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setAddMenuOpen(false); }} onKeyDown={handleAddMenuKeyDown}><button ref={addButtonRef} className="prototype-tab-add" type="button" aria-label="打开文件" aria-expanded={addMenuOpen} aria-haspopup="menu" title="打开文件" disabled={closedTabIds.length === 0} onClick={toggleAddMenu}><Plus size={14} /></button>{addMenuOpen ? <div className="prototype-tab-add-menu" role="menu">{closedTabIds.map((tabId) => <button type="button" role="menuitem" key={tabId} onClick={() => openTab(tabId)}>{tabLabel(tabId, resultTabs)}</button>)}</div> : null}</div>
          </div>,
          tabHost,
        )}
        <div ref={panelContentRef} className="panel-tab-content" tabIndex={-1}>{run == null ? <ArtifactIdle /> : tabState.activeTabId == null ? state === "pending" ? <ArtifactPending /> : availableTabIds.length > 0 ? <ArtifactTabsClosed /> : <ArtifactEmpty /> : renderTab(tabState.activeTabId, artifact, artifactSet, resultTabs, run, state, task, openTab, executionMode, executionSource)}</div>
      </Tabs.Root>
    </aside>
  );
}

function initialRunTabState(): RunTabState {
  return { openTabIds: [], activeTabId: null };
}

function resultTabId(result: ResultSelection): ResultTabId {
  return `result:${result.runId}:${result.kind}:${result.row[0]}`;
}

function isResultTabId(tabId: ArtifactTabId): tabId is ResultTabId {
  return tabId.startsWith("result:");
}

function tabLabel(tabId: ArtifactTabId, resultTabs: Record<ResultTabId, ResultSelection>) {
  if (!isResultTabId(tabId)) return artifactTabLabels[tabId];
  const result = resultTabs[tabId];
  return result == null ? "结果详情" : `${result.kind === "product" ? "商品" : "笔记"} · ${result.row[0]}`;
}

function renderTab(tabId: ArtifactTabId, artifact: ReturnType<typeof createArtifact> | null, artifactSet: ArtifactSet | undefined, resultTabs: Record<ResultTabId, ResultSelection>, run: PrototypeRun, state: "ready" | "pending" | "none", task: PrototypeTask, openTab: (tabId: ArtifactTabId) => void, executionMode: ExecutionMode, executionSource: string) {
  if (isResultTabId(tabId)) return resultTabs[tabId] == null ? <ArtifactEmpty /> : <ResultItemPreview executionMode={executionMode} executionSource={executionSource} result={resultTabs[tabId]} />;
  if (artifact == null) return state === "pending" ? <ArtifactPending /> : <ArtifactEmpty />;
  if (tabId === "skill-view") return hasCompatibleOutputView(run.outputView, artifactSet) ? <ProductComparisonView artifact={createProductArtifact(run)} executionMode={executionMode} executionSource={executionSource} onOpenStructuredData={() => openTab("json")} /> : <FilePreview icon={<Braces size={16} />} name="result.json" meta={artifact.jsonMeta}><pre>{JSON.stringify(artifact.payload, null, 2)}</pre></FilePreview>;
  if (tabId === "json") return <FilePreview icon={<Braces size={16} />} name="result.json" meta={artifact.jsonMeta}><pre>{JSON.stringify(artifact.payload, null, 2)}</pre></FilePreview>;
  if (tabId === "markdown") return <FilePreview icon={<FileText size={16} />} name="summary.md" meta="Markdown"><ArtifactMarkdown run={run} task={task} set={artifactSet} /></FilePreview>;
  if (tabId === "media") return <FilePreview icon={<Video size={16} />} name="媒体与文件" meta={`${downloadFiles.length} 个文件`}><MediaFilePreview executionMode={executionMode} executionSource={executionSource} /></FilePreview>;
  return <FilePreview icon={<ImageIcon size={16} />} name="page.png" meta="PNG · 1280 × 800"><img className="artifact-image-preview" src={samplePagePreview} alt="小红书采集任务页面截图样例" /></FilePreview>;
}

function usePolicyAction(executionMode: ExecutionMode, executionSource: string) {
  const [pending, setPending] = useState<{ label: string; result: string } | null>(null);
  const [status, setStatus] = useState("");
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const rejectRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (pending == null) return;
    rejectRef.current?.focus();
    const timer = window.setTimeout(() => {
      setPending(null);
      setStatus("确认已超时，本次操作未执行");
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }, 60_000);
    return () => window.clearTimeout(timer);
  }, [pending]);

  useEffect(() => {
    if (pending == null) return;
    setPending(null);
    setStatus("执行方式已变化，请重新发起操作");
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, [executionMode, executionSource]);

  function request(trigger: HTMLButtonElement, label: string, result: string) {
    triggerRef.current = trigger;
    if (executionMode === "block") {
      setStatus(`读取和下载已设为禁止，未执行“${label}”`);
    } else if (executionMode === "confirm") {
      setPending({ label, result });
    } else {
      setStatus(`${result} · ${executionModeLabels[executionMode]} · ${executionSource}`);
    }
  }

  function finish(allowed: boolean) {
    if (pending == null) return;
    if (allowed && executionMode !== "confirm") {
      setStatus("执行方式已变化，本次操作未执行");
      setPending(null);
      window.requestAnimationFrame(() => triggerRef.current?.focus());
      return;
    }
    setStatus(allowed ? `${pending.result} · 确认 · 当前动作决定` : `已拒绝这一次，未执行“${pending.label}”`);
    setPending(null);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  return { finish, pending, rejectRef, request, status, triggerRef };
}

function ProductComparisonView({ artifact, executionMode, executionSource, onOpenStructuredData }: { artifact: ReturnType<typeof createProductArtifact>; executionMode: ExecutionMode; executionSource: string; onOpenStructuredData: () => void }) {
  const [viewFailed, setViewFailed] = useState(false);
  const action = usePolicyAction(executionMode, executionSource);
  const products = artifact.payload.preview.slice(0, 3);
  const lowestPrice = Math.min(...products.map(({ price }) => Number(price.replace(/[^\d.]/g, ""))));
  const inStock = products.filter(({ stock }) => stock === "有货").length;

  if (viewFailed) {
    return (
      <section className="skill-output-view" aria-label="商品对比兼容视图">
        <header><div><span>App 标准视图</span><h2>商品结果</h2><p>技能视图暂不可用，已切换到兼容视图。</p></div><div className="section-actions"><button className="prototype-button compact" type="button" onClick={onOpenStructuredData}><Braces size={14} />结构化数据</button><button className="prototype-button compact" type="button" onClick={() => setViewFailed(false)}><RotateCw size={14} />重新加载视图</button></div></header>
        <section className="prototype-callout action-needed"><CircleAlert size={18} /><div><strong>已隔离技能视图错误</strong><p>结构化结果和其他预览未受影响。</p></div></section>
        <div className="prototype-table-wrap"><table className="prototype-table"><thead><tr><th>商品</th><th>价格</th><th>库存</th></tr></thead><tbody>{products.map(({ title, price, stock }) => <tr key={title}><td>{title}</td><td>{price}</td><td>{stock}</td></tr>)}</tbody></table></div>
      </section>
    );
  }

  return (
    <section className="skill-output-view" aria-label="商品对比">
      <header>
        <div><span>商品列表采集</span><h2>商品对比</h2><p>按价格与库存比较当前结果中的前三项。</p></div>
        <div className="section-actions"><button className="prototype-button compact" type="button" onClick={onOpenStructuredData}><Braces size={14} />结构化数据</button><button className="prototype-button compact" type="button" onClick={() => setViewFailed(true)}><CircleAlert size={14} />模拟视图不可用</button></div>
      </header>
      <div className="skill-output-comparison">
        {products.map(({ title, price, stock }, index) => (
          <article key={title}>
            <span className="skill-output-rank">{index + 1}</span>
            <div><strong>{title}</strong><small>{stock}</small></div>
            <b>{price}</b>
          </article>
        ))}
      </div>
      <dl className="skill-output-facts"><div><dt>最低价格</dt><dd>¥{lowestPrice}</dd></div><div><dt>当前有货</dt><dd>{inStock} / {products.length}</dd></div><div><dt>结果总数</dt><dd>{artifact.payload.current} 条</dd></div></dl>
      {action.pending && executionMode === "confirm" ? <section className="composer-action-confirmation" aria-label="确认导出有货商品"><div><CircleAlert size={16} /><span><strong>读取和下载</strong><small>{action.pending.label} · {executionSource}</small></span></div><div><button ref={action.rejectRef} type="button" onClick={() => action.finish(false)}>拒绝这一次</button><button className="primary" type="button" onClick={() => action.finish(true)}>允许这一次</button></div></section> : <div className="section-actions"><button ref={action.triggerRef} className="prototype-button primary" type="button" onClick={(event) => action.request(event.currentTarget, "导出当前有货商品", "已交由 App，技能视图未直接执行")}>导出有货商品</button></div>}
      {action.status ? <p className="muted-copy" role="status"><ShieldCheck size={13} />{action.status}</p> : null}
      <footer><span>由“商品列表采集”技能 v1.4.2 提供</span><span>结构化结果仍由 App 保留</span></footer>
    </section>
  );
}

function MediaFilePreview({ executionMode, executionSource }: { executionMode: ExecutionMode; executionSource: string }) {
  const action = usePolicyAction(executionMode, executionSource);
  return (
    <div className="artifact-media-list">
      {downloadFiles.map((file) => {
        const kind = mediaKind(file.name);
        const unavailable = file.state !== "已保存";
        return (
          <div className="artifact-media-row" key={file.name}>
            <span className={`artifact-media-icon ${kind.id}`} aria-hidden="true">{kind.icon}</span>
            <div><strong>{file.name}</strong><span>{kind.label} · {file.size ?? "大小未知"}</span></div>
            <span className={unavailable ? "failed" : "saved"}>{file.state}</span>
            <button className="prototype-button compact" type="button" onClick={(event) => action.request(event.currentTarget, `${unavailable ? "重新获取" : "打开"} ${file.name}`, unavailable ? `正在重新获取 ${file.name}` : `已请求系统打开 ${file.name}`)}>{unavailable ? <RotateCw size={13} /> : <ExternalLink size={13} />}{unavailable ? "重新获取" : "打开文件"}</button>
          </div>
        );
      })}
      <p className="artifact-media-fallback">音视频、图片和压缩包由系统应用打开；不支持内联预览的格式仍保留文件信息和恢复入口。</p>
      {action.pending && executionMode === "confirm" ? <section className="composer-action-confirmation" aria-label={`确认${action.pending.label}`}><div><CircleAlert size={16} /><span><strong>读取和下载</strong><small>{action.pending.label} · {executionSource}</small></span></div><div><button ref={action.rejectRef} type="button" onClick={() => action.finish(false)}>拒绝这一次</button><button className="primary" type="button" onClick={() => action.finish(true)}>允许这一次</button></div></section> : null}
      {action.status ? <p className="artifact-media-feedback" role="status">{action.status}</p> : null}
    </div>
  );
}

function mediaKind(name: string) {
  const extension = name.split(".").pop()?.toLowerCase();
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(extension ?? "")) return { id: "image", label: "图片", icon: <ImageIcon size={17} /> };
  if (["mp3", "wav", "m4a", "aac"].includes(extension ?? "")) return { id: "audio", label: "音频", icon: <Music2 size={17} /> };
  if (["mp4", "mov", "webm", "mkv"].includes(extension ?? "")) return { id: "video", label: "视频", icon: <Video size={17} /> };
  return { id: "file", label: "文件", icon: <FileArchive size={17} /> };
}

function ResultItemPreview({ executionMode, executionSource, result }: { executionMode: ExecutionMode; executionSource: string; result: ResultSelection }) {
  const { row } = result;
  const product = result.kind === "product";
  const action = usePolicyAction(executionMode, executionSource);
  return (
    <article className="artifact-result-preview">
      <div className="artifact-result-heading">
        <div><span>{product ? "采集结果 · 商品" : "采集结果 · 笔记"}</span><h2>{row[0]}</h2><p>{product ? `${row[1]} · ${row[2]} · ${row[3]}读取` : `${row[1]} · ${row[3]}`}</p></div>
        <button type="button" aria-label={product ? "打开商品详情" : "打开来源页面"} title={product ? "打开商品详情" : "打开来源页面"} onClick={(event) => action.request(event.currentTarget, product ? `打开商品详情 ${row[0]}` : `打开来源页面 ${row[0]}`, product ? `已请求打开商品详情 ${row[0]}` : `已请求打开来源页面 ${row[0]}`)}><ExternalLink size={15} /></button>
      </div>
      <div className="artifact-result-body">
        <p>{product ? "轻量便携的桌面补光设备，适合直播、视频会议和近距离产品拍摄。" : "把资料交给 AI 之前，先明确最终要消费的业务结果。适合自动化的不是打开网页本身，而是可重复的搜索、阅读、整理和交付过程。"}</p>
        {!product ? <p>这篇笔记整理了五种常见方法，并对适用场景、输入要求和结果形式进行了对比。</p> : null}
      </div>
      <dl className="artifact-result-facts">
        {product ? <><div><dt>价格</dt><dd>{row[1]}</dd></div><div><dt>库存</dt><dd>{row[2]}</dd></div><div><dt>店铺</dt><dd>示例数码配件店</dd></div><div><dt>发货地</dt><dd>浙江杭州</dd></div></> : <><div><dt>互动</dt><dd>{row[2]}</dd></div><div><dt>评论</dt><dd>126</dd></div><div><dt>收藏</dt><dd>943</dd></div><div><dt>话题</dt><dd>#AI工具 #效率提升</dd></div></>}
      </dl>
      {action.pending && executionMode === "confirm" ? <section className="composer-action-confirmation" aria-label={`确认${action.pending.label}`}><div><CircleAlert size={16} /><span><strong>读取和下载</strong><small>{action.pending.label} · {executionSource}</small></span></div><div><button ref={action.rejectRef} type="button" onClick={() => action.finish(false)}>拒绝这一次</button><button className="primary" type="button" onClick={() => action.finish(true)}>允许这一次</button></div></section> : null}
      {action.status ? <p className="muted-copy" role="status">{action.status}</p> : null}
    </article>
  );
}

function createArtifact(run: PrototypeRun, set: ArtifactSet, task: PrototypeTask) {
  if (set === "xhs-notes") {
    const items = resultRows.map(([title, author, interactions, readAt]) => ({ title, author, interactions, readAt }));
    const total = run.artifactTotal ?? items.length;
    return { jsonMeta: `JSON · ${items.length}/${total} 条预览`, payload: { input: run.input, status: run.stateLabel, total, preview: items } };
  }
  if (set === "shop-products") {
    return createProductArtifact(run);
  }
  if (set === "article") {
    const article = articleResultForRun(run);
    return { jsonMeta: "JSON · 文章摘要", payload: { input: run.input, url: article.source, title: article.title, author: article.author, publishedAt: article.publishedAt } };
  }
  if (set === "download-files") {
    return { jsonMeta: `JSON · ${downloadFiles.length} 个文件`, payload: { input: run.input, files: downloadFiles } };
  }
  const write = writeResultForRun(run, task);
  return { jsonMeta: "JSON · 未提交", payload: { input: run.input, submitted: run.state === "success", title: write.title, body: write.body, topics: write.topics } };
}

function createProductArtifact(run: PrototypeRun) {
  const items = productRows.map(([title, price, stock, readAt]) => ({ title, price, stock, readAt }));
  const current = run.artifactCurrent ?? items.length;
  return { jsonMeta: `JSON · ${items.length}/${current} 条预览`, payload: { input: run.input, status: run.stateLabel, current, expected: run.artifactTotal, preview: items } };
}

function ArtifactMarkdown({ run, set, task }: { run: PrototypeRun; set: ArtifactSet | undefined; task: PrototypeTask }) {
  return (
    <article className="markdown-preview">
      <h1>{run.input}</h1>
      <p>{run.summary}</p>
      <h2>{set === "write-preview" ? "提交状态" : set === "download-files" ? "文件结果" : "任务结果"}</h2>
      {set === "write-preview" ? <p><strong>未提交</strong>。页面内容已填写并校验，没有点击发布。</p> : null}
      {set === "download-files" ? <ul>{downloadFiles.map((file) => <li key={file.name}>{file.name}：{file.state}</li>)}</ul> : null}
      {set !== "write-preview" && set !== "download-files" ? <ul><li>站点：{task.site}</li><li>站点技能：{task.skill}</li><li>账号身份：{task.identity}</li></ul> : null}
      <blockquote>这是交互原型中的样例文件预览。</blockquote>
    </article>
  );
}

function ArtifactPending() {
  return <div className="artifact-empty"><LoaderCircle size={20} /><strong>文件尚未生成</strong><span>任务产出首个文件后会显示在这里。</span></div>;
}

function ArtifactIdle() {
  return <div className="artifact-empty"><FileText size={20} /><strong>尚未打开预览</strong><span>从中栏的任务回合中打开结果或文件。</span></div>;
}

function ArtifactEmpty() {
  return <div className="artifact-empty"><ImageIcon size={20} /><strong>没有可预览文件</strong><span>当前运行尚未返回文件。</span></div>;
}

function ArtifactTabsClosed() {
  return <div className="artifact-empty"><FileText size={20} /><strong>没有打开的文件</strong><span>点击上方“+”打开当前运行的文件。</span></div>;
}

function FilePreview({ children, icon, meta, name }: { children: ReactNode; icon: ReactNode; meta: string; name: string }) {
  return <section className="artifact-file-preview"><header>{icon}<div><strong>{name}</strong><span>{meta}</span></div></header><div className="artifact-preview-body">{children}</div></section>;
}

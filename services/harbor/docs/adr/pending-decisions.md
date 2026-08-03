# ADR 待决策索引

## 2026-07-14 Provider 生命周期纠偏

[ADR 0009](0009-provider-lifecycle-management.md) 已接受 managed、system、external
provider 的生命周期所有权，以及检测、安装、更新、修复和启动验证的最小状态。
因此旧“只提供下载引导/不安装 browser binary”只保留为阶段历史，不再是当前产品
完成口径。具体下载来源、checksum 和安装目标由 Harbor #280 实现时固化，不能从
任意镜像猜测。

本文件是 Harbor ADR 的唯一待决策索引。ADR 正文中的未决项必须引用这里的 ID。

## 第一阶段真相源边界收口

本节收口 GitHub issues #8、#9、#16、#17、#18、#19 的第一阶段边界判断。来源为 2026-06-30 回读的 issue 正文、[Harbor 路线图](../../ROADMAP.md)、[0002. Profile、Session 与 Provider 事实](0002-profile-session-and-provider-facts.md)、[0003. 本地 Chrome 与远程浏览器边界](0003-local-chrome-vs-remote-browser-boundary.md)、[0004. Snapshot、RefMap 与证据捕获](0004-snapshot-refmap-and-evidence-capture.md) 以及 `docs/draft/` 下的现有草稿。

| 对象/事实 | 本仓归属 | 非本仓归属 | 消费方 | 依据 | 状态 |
|---|---|---|---|---|---|
| Profile facts | Harbor 记录持久浏览器身份容器、storage/profile ref、proxy、locale、timezone、user agent、extensions、运行状态和健康事件。 | 不拥有 Core Run Record、Lode resource requirement、App UI 状态或真实凭据明文。 | Core、App、Lode resource requirements。 | ADR 0002；`docs/draft/profile-identity-model.md`；`docs/draft/runtime-capability-facts.md`。 | accepted |
| Execution Identity facts | Harbor 记录 `site_id`、`account_ref`、关联 Profile、login state、allowed execution channels、risk/recovery events、usage history 和 evidence policy ref。 | 不判断任务业务成功，不定义 normalized result，不保存 Lode capability schema。 | Core admission、App Browser 表面、Lode resource requirements。 | ADR 0002；`docs/draft/profile-identity-model.md`；`docs/draft/resource-lifecycle.md`。 | accepted |
| Runtime Session facts | Harbor 记录 session ref、provider/profile/identity refs、CDP/Viewer/Snapshot/Evidence 可用性、lease/resource trace refs、错误状态和 control facts。 | Core 拥有 task/run 状态机、admission、unknown outcome 和 Run Record；App 只展示和发送用户意图。 | Core、App、Agent/CLI/API。 | ADR 0002；ADR 0003；`docs/draft/resource-lifecycle.md`。 | accepted |
| Provider facts | Harbor/Browser Driver 生产 provider type、engine、local/remote mode、profile/CDP/viewer/snapshot/evidence capabilities、limitations、license/binary boundary 和 validation evidence refs。 | 不输出 provider 排名、站点通过率承诺、黑盒风险分或 provider-specific launch flags 作为公共 contract。 | Core resource matching、App provider health 展示、Lode requirement matching。 | ADR 0002；ADR 0003；`docs/draft/browser-drivers.md`；research synthesis。 | accepted |
| Provider claims and secrets | Harbor 只能把 provider claim 标记为 claim，并用 validation evidence ref 区分；secrets、tokens、raw provider credentials 不进入公共 facts。 | 不把 README/marketing claim 当成 WebEnvoy capability evidence，不默认再分发 provider binary。 | Core/App 只能消费脱敏 facts 或 refs。 | ADR 0002；research `anti-detection-and-provider-facts`。 | rejected |
| Snapshot refs | Harbor 按 Runtime Session 和 evidence policy 生成页面观察 artifact refs，可包括 DOM、AX tree、semantic text、simplified HTML 或 provider-native snapshot metadata。 | 不属于 Lode normalized result、collection/comment/dataset schema 或站点业务字段。 | Core action/extraction context、App evidence/browser view、Lode authoring。 | ADR 0004；`docs/draft/evidence-store.md`。 | accepted |
| RefMap refs | Harbor 生成绑定 session、page/frame、snapshot generation 和 navigation state 的临时元素引用，负责解析、stale-ref error 或要求 resnapshot。 | 不保证跨站点版本稳定，不作为业务 locator 或 Lode schema。 | Core action execution、Lode authoring、App debug view。 | ADR 0004；research `execution-space-and-context`。 | accepted |
| Evidence refs and source trace | Harbor 按 evidence policy 捕获、脱敏、存储并暴露 screenshot/network/console/trace/raw payload/diagnostic refs 与 provenance；Core 只把 refs 写入 Run Record。 | Core 不复制完整 Harbor evidence store；默认不上传 cookies、tokens、credentials、完整 storage、完整 DOM、完整 bodies、完整 screenshots、HAR、video 或 trace。 | Core Run Record、App evidence view、debug/closeout evidence。 | ADR 0004；`docs/draft/evidence-store.md`；research `evidence-and-observability`。 | accepted |
| Sensitive evidence by default | 默认不持久化或上传高敏 runtime material；需要显式 policy、retention、redaction 和 export 边界。 | 不把 ring buffer、raw logs、provider public endpoint 或 unredacted artifacts 当正式 evidence。 | Core/App 只能消费 policy 允许的 refs。 | ADR 0004；`docs/draft/evidence-store.md`。 | rejected |
| Viewer facts | Harbor 暴露 viewer ref/ws、transport type、access boundary、clipboard/input capability、provider limitations 和 control owner hint。 | 不直接裸露内部 VNC/CDP endpoint 给所有上层，不把 live viewer 等同完整 recovery。 | App Browser/Viewer、Core run record refs、用户接管流程。 | ADR 0003；research `human-handoff-and-recovery`。 | accepted |
| Handoff and control ownership facts | Harbor 记录 runtime control owner、handoff capability、user-control state、pause/lock capability 和恢复所需 runtime facts。 | Core 拥有 run-level pause/resume/unknown outcome/reconciliation；App 拥有用户可见审批、接管和反馈 UI。 | Core、App、用户。 | ADR 0003；research `human-handoff-and-recovery`。 | accepted; PD-0010 blocks detailed state machine |

阶段一 closeout 可直接消费上表。后续字段集、API schema、provider validation packet、Snapshot/RefMap contract、retention/encryption、trace/HAR/video 开启策略、stale RefMap 错误语义和 handoff 状态机仍保留为下列非本轮阻塞项：PD-0003、PD-0004、PD-0005、PD-0006、PD-0008、PD-0009、PD-0010、PD-0011、PD-0012、PD-0013、PD-0014、PD-0015、PD-0016、PD-0017。PD-0007 已由 ADR 0009 解决。

| Issue | 本节覆盖 |
|---|---|
| #8 | Profile、Execution Identity、Runtime Session 与 Provider facts 的 Harbor truth source 边界。 |
| #9 | Snapshot、RefMap、Evidence refs、Viewer、handoff 和 control ownership facts 的 Harbor truth source 边界。 |
| #16 | Profile / Execution Identity / Runtime Session 三行。 |
| #17 | Provider facts 与 Provider claims and secrets 两行。 |
| #18 | Snapshot refs、RefMap refs、Evidence refs and source trace、Sensitive evidence by default 四行。 |
| #19 | Viewer facts、Handoff and control ownership facts 两行。 |

## 第一阶段受控浏览器现场与 provider baseline 收口

本节收口 GitHub issues #6、#7、#10、#11、#12、#13、#14、#15、#20、#21、#22、#23 的第一阶段剩余边界。来源为 2026-06-30 回读的 issue 正文、[Harbor 路线图](../../ROADMAP.md)、ADR 0002/0003/0004、`/Volumes/2T/dev/WebEnvoy/research/absorability/Harbor/runtime-provider-profile-viewer.md`、`/Volumes/2T/dev/WebEnvoy/research/absorability/themes/anti-detection-and-provider-facts.md`、`/Volumes/2T/dev/WebEnvoy/research/absorability/themes/human-handoff-and-recovery.md`，以及 issue 正文指向的只读 sources locator。

CloakBrowser 可以作为第一条受控浏览器 provider baseline 的候选边界，但本阶段只接受 provider facts、license/binary facts、runtime smoke 条件和 evidence locator；不承诺反检测成功率，不打包或再分发 provider binary，不写 Harbor runtime 代码。

| 检查项 | 通过条件 | 失败分类 | 所需环境 | 证据 locator | 状态 |
|---|---|---|---|---|---|
| Provider source and binary boundary | 记录 provider source、wrapper license、binary/license boundary、安装/更新入口和是否需要用户自带 provider。 | license/binary_unknown；redistribution_not_allowed；install_source_unknown | 只读官方仓库和本地 sources；不运行 binary。 | `sources/CloakHQ/CloakBrowser`；`sources/CloakHQ/CloakBrowser-Manager`；research `runtime-provider-profile-viewer.md`。 | historical baseline input; current enablement governed by ADR 0009 and Harbor #280 |
| Minimal runtime session facts | smoke 只要求 Harbor 能引用 `profile_ref`、`runtime_session_ref`、provider mode、status、CDP capability、viewer capability、snapshot/evidence capability 和 current error。 | session_unavailable；provider_launch_failure；capability_missing；runtime_error | 后续 runtime experiment；本 PR 只定义 facts boundary。 | ADR 0002；ADR 0003；research `runtime-provider-profile-viewer.md`。 | accepted |
| Page-site observation refs | smoke 输出页面现场引用而不是业务结果：`snapshot_ref`、`refmap_ref`、`source_trace`、可选 `screenshot_ref` / `diagnostic_ref`。 | snapshot_unavailable；refmap_stale；evidence_policy_denied；diagnostic_missing | 后续 runtime experiment；evidence policy 明确允许时才采集。 | ADR 0004；research `evidence-and-observability.md`；research `execution-space-and-context.md`。 | accepted |
| Viewer and takeover facts | smoke 只验证 viewer ref/ws、transport、access boundary、control owner hint、handoff capability 和 user-control state 可被记录。 | viewer_unavailable；control_owner_unknown；handoff_not_supported | 后续 runtime experiment；App/Core 状态机另行决定。 | ADR 0003；research `human-handoff-and-recovery.md`；`sources/CloakHQ/CloakBrowser-Manager`；`sources/Tencent/BrowserSkill`；`sources/citrolabs/ego-lite`。 | accepted; detailed state machine blocked by PD-0010/PD-0012 |
| Provider facts exposure | Core/App 只消费 provider type、engine/mode、profile/CDP/viewer/snapshot/evidence capabilities、known limitations、license/binary boundary 和 validation evidence refs。 | fact_missing；claim_without_evidence；secret_leak；provider_flag_leaked | docs-only boundary now；schema later。 | ADR 0002；research `anti-detection-and-provider-facts.md`。 | accepted; field schema blocked by PD-0003/PD-0005 |
| Anti-detection claim handling | 上游 stealth、fingerprint、Cloudflare/reCAPTCHA 等声明只能标为 provider claim 或 experiment input，并附来源；不能写成 WebEnvoy success guarantee。 | unverified_success_claim；marketing_claim_as_fact；target_site_guarantee | 只读 provider docs/source；不触碰真实目标站点。 | `sources/CloakHQ/CloakBrowser`；`sources/daijro/camoufox`；`sources/Kaliiiiiiiiii-Vinyzu/patchright`；research `anti-detection-and-provider-facts.md`。 | rejected as product commitment |

第一条只读纵向闭环中，Harbor 提供受控 runtime session 引用、页面现场引用、snapshot/refmap/evidence refs、viewer/takeover 的最小状态事实。Core 仍拥有 admission、Run Record、unknown outcome 和任务成功判断；Lode 仍拥有站点能力 schema；App 只展示 viewer、approval、handoff 和 evidence refs。

| 研究/外部机制 | 可吸收内容 | 不吸收内容 | 来源 locator | 状态 |
|---|---|---|---|---|
| CloakBrowser | 作为首个 provider baseline 候选；记录 provider source、binary/license boundary、capability claims、validation evidence refs。 | 不承诺反检测成功率；不默认再分发 binary；不把 provider flags 暴露为公共 Harbor schema。 | `sources/CloakHQ/CloakBrowser`；research `anti-detection-and-provider-facts.md`。 | accepted with constraints |
| CloakBrowser-Manager | Profile runtime、viewer/VNC、CDP proxy、provider args adapter 的机制参考；可吸收 viewer ref、CDP ref、端口隔离和 provider adapter 经验。 | 不整体迁入 backend/frontend、内存 `RunningProfile`、UI shell 或 provider-specific lifecycle。 | `sources/CloakHQ/CloakBrowser-Manager`；research `runtime-provider-profile-viewer.md`。 | accepted as reference |
| Handoff/control ownership references | 吸收 explicit control owner、handoff/takeover、user-controlled hard stop、dashboard/live viewer/annotation 的状态事实。 | 不把 live viewer 等同完整恢复；不允许 Agent 自动抢回用户控制；不把 setup/profile 错误当业务失败。 | research `human-handoff-and-recovery.md`；`sources/Tencent/BrowserSkill`；`sources/citrolabs/ego-lite`；`sources/microsoft/playwright-cli`。 | accepted as reference |
| Hosted browser / vault / persona / external UI shell | 仅作为边界和未来 re-evaluation 输入。 | 不进入 Harbor MVP；不迁入真实账号托管平台、密钥库、人设平台、hosted runtime 平台化或外部 Profile Browser shell。 | issues #11、#22、#23；research `browser-identity-and-runtime.md`。 | rejected for MVP |

| Issue | 本节覆盖 |
|---|---|
| #6 | CloakBrowser 作为首个 provider baseline 的采用边界、runtime smoke 前置条件和非承诺边界。 |
| #7 | Provider facts 与反检测成功率承诺的边界。 |
| #10 | CloakBrowser-Manager、handoff/control ownership、viewer/CDP 机制的参考吸收边界。 |
| #11 | hosted browser、vault、persona 平台、外部 UI shell 的 Harbor MVP 非目标。 |
| #12 | Provider source、license/binary、安装/更新和依赖风险作为历史 baseline input；当前 enablement 由 ADR 0009 和 Harbor #280 承接。 |
| #13 | 最小 runtime smoke 检查项、通过条件、失败分类、环境和证据 locator。 |
| #14 | Provider facts 最小暴露字段和 Core/App 消费边界；版本化字段集仍由 PD-0003 阻塞。 |
| #15 | Anti-detect claim 只能作为 claim / experiment input；产品成功率承诺被拒绝。 |
| #20 | CloakBrowser-Manager Profile Runtime、Viewer/VNC、CDP proxy、provider args adapter 只作参考或改造后吸收。 |
| #21 | BrowserSkill、ego-lite、Playwright dashboard 的 handoff/control ownership 只作状态事实参考。 |
| #22 | hosted browser、vault、persona 平台不进入 MVP。 |
| #23 | 外部 Profile Browser / hosted console UI shell 不整体迁入 Harbor。 |

## PD-0001

- 问题：ADR 被接受后，版本化 Runtime API schema 应放在哪里？
- 来源 ADR：[0001. 记录架构决策](0001-record-architecture-decisions.md)
- 阻塞什么：后续 Runtime API schema 的仓库归属；不阻塞 ADR 0001 成立。
- 当前状态：后续决策。
- 后续归属/下一步：Harbor 进入 API schema 草案时决定。

## PD-0002

- 问题：已接受 ADR 后续是否需要 owner 字段，还是 Git 历史已经足够？
- 来源 ADR：[0001. 记录架构决策](0001-record-architecture-decisions.md)
- 阻塞什么：ADR 维护流程细化；不阻塞 ADR 0001 成立。
- 当前状态：后续决策。
- 后续归属/下一步：ADR 数量增长或多人维护时再评估。

## PD-0003

- 问题：provider/profile/session/evidence facts 的首版版本化字段集是什么？
- 来源 ADR：[0002. Profile、Session 与 Provider 事实](0002-profile-session-and-provider-facts.md)
- 阻塞什么：首版 Harbor facts schema。
- 当前状态：草案待决策。
- 后续归属/下一步：Runtime API schema 草案中定义。

## PD-0004

- 问题：哪些 health states 可以被 Core 用于只读、写入和恢复任务准入？
- 来源 ADR：[0002. Profile、Session 与 Provider 事实](0002-profile-session-and-provider-facts.md)
- 阻塞什么：Core admission 与 Harbor resource health 对齐。
- 当前状态：草案待决策。
- 后续归属/下一步：Core admission 与 Harbor resource lifecycle 联合决策。

## PD-0005

- 问题：最小 provider validation evidence 格式是什么？
- 来源 ADR：[0002. Profile、Session 与 Provider 事实](0002-profile-session-and-provider-facts.md)
- 阻塞什么：provider facts 的可审阅证据格式。
- 当前状态：草案待决策。
- 后续归属/下一步：provider registry 或 provider evaluation ADR 中定义。

## PD-0006

- 问题：typing cadence 这类行为层 facts 属于 Harbor helper facts、Core action policy，还是 Lode capability requirements？
- 来源 ADR：[0002. Profile、Session 与 Provider 事实](0002-profile-session-and-provider-facts.md)
- 阻塞什么：行为层自动化事实的归属边界。
- 当前状态：草案待决策。
- 后续归属/下一步：Core action policy 或 Lode resource requirement 决策时处理。

## PD-0007

- 问题：启用 provider 前，哪些 provider license 和 binary facts 必须存在？
- 来源 ADR：[0002. Profile、Session 与 Provider 事实](0002-profile-session-and-provider-facts.md)
- 阻塞什么：不再阻塞生命周期合同；具体 provider 仍需提交 enablement facts。
- 当前状态：resolved by [ADR 0009](0009-provider-lifecycle-management.md)。
- 后续归属/下一步：每个 managed/system/external provider Work Item 提供来源、许可、版本、OS/arch、完整性材料和启动验证。

## PD-0008

- 问题：第一阶段实现应先支持 `local_dedicated_profile`、`remote_browser_session`，还是两者都支持？
- 来源 ADR：[0003. 本地 Chrome 与远程浏览器边界](0003-local-chrome-vs-remote-browser-boundary.md)
- 阻塞什么：Harbor runtime MVP provider 顺序。
- 当前状态：草案待决策。
- 后续归属/下一步：首版 runtime implementation plan 中决定。

## PD-0009

- 问题：使用 `local_user_chrome` 前需要哪种精确用户授权？
- 来源 ADR：[0003. 本地 Chrome 与远程浏览器边界](0003-local-chrome-vs-remote-browser-boundary.md)
- 阻塞什么：local user Chrome provider 的启用条件。
- 当前状态：草案待决策。
- 后续归属/下一步：App approval 与 Harbor provider policy 决策时定义。

## PD-0010

- 问题：用户控制期间 Harbor 应如何 lock 或 pause automation？
- 来源 ADR：[0003. 本地 Chrome 与远程浏览器边界](0003-local-chrome-vs-remote-browser-boundary.md)
- 阻塞什么：handoff control ownership 状态机。
- 当前状态：草案待决策。
- 后续归属/下一步：handoff/recovery ADR 中定义。

## PD-0011

- 问题：哪些 remote session TTL、persistence、file 和 download facts 是必需字段？
- 来源 ADR：[0003. 本地 Chrome 与远程浏览器边界](0003-local-chrome-vs-remote-browser-boundary.md)
- 阻塞什么：remote browser provider facts schema。
- 当前状态：草案待决策。
- 后续归属/下一步：remote browser driver schema 草案中定义。

## PD-0012

- 问题：Viewer 支持应先从本地浏览器窗口、noVNC-style remote viewer，还是两者开始？
- 来源 ADR：[0003. 本地 Chrome 与远程浏览器边界](0003-local-chrome-vs-remote-browser-boundary.md)
- 阻塞什么：App/Harbor viewer MVP。
- 当前状态：草案待决策。
- 后续归属/下一步：Viewer MVP 决策中定义。

## PD-0013

- 问题：第一版 Snapshot/RefMap contract 应是 AX-first、DOM-first、semantic text，还是 provider-native？
- 来源 ADR：[0004. Snapshot、RefMap 与证据捕获](0004-snapshot-refmap-and-evidence-capture.md)
- 阻塞什么：Snapshot/RefMap 首版 contract。
- 当前状态：Stage 2 docs v0 已由 [ADR 0007](0007-page-scene-reference-facts-v0.md) 固定为 AX-first，DOM / simplified HTML 作为 locator fallback，semantic text 为派生事实，provider-native metadata 仅作 adapter-local/ref source；API/schema 和 runtime 实现仍后续决策。
- 后续归属/下一步：Runtime API/schema 或 Snapshot/RefMap implementation Work Item 中定义字段细节与验证。

## PD-0014

- 问题：第一版 Harbor API 必须包含哪些 evidence refs？
- 来源 ADR：[0004. Snapshot、RefMap 与证据捕获](0004-snapshot-refmap-and-evidence-capture.md)
- 阻塞什么：Evidence Store 与 Runtime API 首版字段。
- 当前状态：Stage 2 docs v0 已由 [ADR 0007](0007-page-scene-reference-facts-v0.md) 固定最小 refs：`snapshot`、`refmap`、`source_trace` 默认允许，`screenshot`、`console_summary`、`network_summary`、`diagnostic` 由 policy 开启，`trace` / `HAR` / `video` / `raw_payload` 默认不进入 MVP。
- 后续归属/下一步：Evidence Store schema 草案中定义具体 API 字段、storage 和 access policy。

## PD-0015

- 问题：本地 evidence 的默认 retention 和 encryption 规则是什么？
- 来源 ADR：[0004. Snapshot、RefMap 与证据捕获](0004-snapshot-refmap-and-evidence-capture.md)
- 阻塞什么：本地 evidence 存储安全默认值。
- 当前状态：Stage 2 docs v0 已由 [ADR 0007](0007-page-scene-reference-facts-v0.md) 固定隐私默认：只公开 ref/metadata/redaction/retention policy，raw sensitive evidence 默认本地-only 或拒绝 export；具体 TTL、encryption-at-rest 和 deletion implementation 仍待 Evidence Store policy。
- 后续归属/下一步：Evidence Store policy 决策中定义具体期限、密钥/加密和清理实现。

## PD-0016

- 问题：Playwright trace/HAR/video 应在什么情况下开启，由谁请求？
- 来源 ADR：[0004. Snapshot、RefMap 与证据捕获](0004-snapshot-refmap-and-evidence-capture.md)
- 阻塞什么：高敏 evidence capture policy。
- 当前状态：Stage 2 docs v0 已由 [ADR 0007](0007-page-scene-reference-facts-v0.md) 固定为默认关闭；只有显式 high-sensitivity evidence policy、source binding、redaction、retention 和 export 边界都存在时才能生成 ref。
- 后续归属/下一步：Evidence policy 或 Core request policy 中定义谁可请求、审批、TTL 和审计字段。

## PD-0017

- 问题：stale RefMap failures 应如何表达，才能让 Core 安全 retry 或 resnapshot？
- 来源 ADR：[0004. Snapshot、RefMap 与证据捕获](0004-snapshot-refmap-and-evidence-capture.md)
- 阻塞什么：Core 使用 RefMap 的错误处理 contract。
- 当前状态：Stage 2 docs v0 已由 [ADR 0007](0007-page-scene-reference-facts-v0.md) 固定分类：`refmap_stale`、`snapshot_stale`、`selector_unstable`、`source_unavailable`、`capture_denied`、`missing`；Core 必须重新 snapshot/refmap 或进入人工/authoring path，不得静默复用旧 ref。
- 后续归属/下一步：Snapshot/RefMap implementation Work Item 中定义机器字段、retry hints 和测试 fixtures。

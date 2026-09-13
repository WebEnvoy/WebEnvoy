# 受管浏览器文件闭环 V1：#523 实施合同

> 状态：Accepted / #523 实现合同已冻结；固定 Provider 资格门、正式 installed/live 验收和真实 Agent 短闭环均已通过，证据以本节及 Issue/PR readback 为准。
> 版本：v1.0；日期：2026-09-13。
> Owning Work Item：[#523](https://github.com/WebEnvoy/WebEnvoy/issues/523)，parent [#497](https://github.com/WebEnvoy/WebEnvoy/issues/497)，M23；消费 #474，环境 #471，安装 #477，最终验收 #482。
> 基线：`95b415bc6924529adc25d9129e678ad0a2d67212`；以实际最新 main 集成，不降版。
> 依据：canonical v1.4、ADR0012、Browser Runtime Capabilities V1 §10、现有 Page/Navigation、Grant/Plugin/Run 合同。本文件不扩大完整 V1，也不将全部 Files 组压缩成本切片。

## 1. 用户结果、范围与非目标

用户经可信 owner 入口交付文件并批准任务。真实 Agent 经已安装 Plugin，在明确 Profile 的原任务页中上传这一份文件，重新观察网页接收/处理的事实，再从该页普通下载链接取得一个真正完成、可由用户导出的受管结果。关闭 App 不影响已批准的普通路径；接管、撤销和丢响应不造成越权、替换现场或重放。

首个正式支持组合只取已核验的 macOS arm64、当前 Codex、原版 Camoufox Python 0.5.6 / browser 152.0.4-beta.30 / Playwright 1.60.0。#519/#522 只证明其已交付任务页能力，不自动证明本文件能力。#516/#518 的 Chrome 共存不意味着 Chrome Files 已支持；本批不做双 Provider Files 同等级验收。

本批支持两条普通路径：

1. 主文档中能由现有语义观察产生可信目标的标准单文件 `input[type=file]`。以正常可见控件为首批验收对象；无法可靠发现或关联的隐藏控件不靠猜 selector 处理。
2. 同一已登记 Page 中，观察到确定 HTTP(S) href 的普通下载链接，点击后由原生浏览器 GET 下载；redirect 仍逐跳按现有 guard 核验。

每次一个文件；上传为 **1 byte 至 10 MiB（10,485,760 bytes）**，不是至少1 MiB。下载可为空，成功提交/导出内容上限同为10 MiB。允许 PNG、JPEG、PDF、UTF-8 TXT、UTF-8 CSV；格式判断区分声明的 MIME、扩展名及有界内容识别，冲突拒绝。文本不得有 NUL/无效 UTF-8；空文本下载可依批准类型和后缀表示空报表。格式检查不是杀毒、秘密检测或内容可信证明。

本批不做目录、多文件、批量、视频、压缩包、可执行文件、文件内容转换、blob/data 下载、不透明 POST/JS 导出、跨 frame/closed-shadow、特殊拖放上传、通用文件管理器、任意系统文件访问、Agent 文件正文读取、完整 JS/native dialog 平台、真实站点交易或网站 SKILL。不得因遇到 popup/跨窗/offscreen 就扩充本批成功门；#510/#521 和现有不可见窗口限制仍单独承接。其余 V1 Files/Dialog 要求仍在 #497。

## 2. 来源核查及 G0 资格门

公开接口依据：
- https://playwright.dev/python/docs/input#upload-files ：标准 `locator.set_input_files`。
- https://playwright.dev/python/docs/api/class-download ：download 事件仅表示开始；公开 `page`、`url`、`save_as`、`failure`、`cancel`；Context 关闭会删除浏览器临时下载文件。

这些资料只证明上游公开接口存在，不证明当前固定组合已通过。禁止把其他版本网页文档的新参数直接用于固定1.60；以本机固定包的公开接口签名和实际行为核对。

完整实现、正式兼容承诺和昂贵打包前，worker 在已有原版安装、专用无账号 Profile、两个受控页面上完成三项最小反例。直接探针仅为 qualification，不能算正式 installed/Agent 消费。

| 门 | 实际结果 |
|---|---|
| G0-U | 通过。原版固定组合使用公开 `request.post_data_buffer` / `locator.set_input_files`；受控服务收到 PNG，源/服务端 SHA-256 均为 `431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460`；正式请求 guard 始终启用。 |
| G0-D | 通过。已登记同页 link 先监听后单击；真实 `download.page`/URL 通过核对，CSV 保存成功；Runtime/Context 关闭后受管副本 hash 仍为 `6d4ddc85515525576304235af892cbec19e7bd2ff8eea3c72018d146dc585da2`；未授权 redirect 在目标服务收到请求前拒绝。 |
| G0-I | 通过。专用 profile/无账号受控页面下无权限放宽；未知 popup 维持局部拒绝，独立普通读取不受影响；无上游/Provider/私有协议修改、归属猜测或系统下载目录扫描。拒绝计数：未授权 origin redirect 1、未知关系 1、缺失 frame 未归属 1。 |

G0 证据由固定来源、配置快照、包/应用 SHA-256、请求计数和类型化结果组成，保存在任务主机的临时证据目录（`g0-evidence.json` 与 `g0-i-evidence.json`）；文件正文不进入仓库或 Core Run。固定来源与实际运行配置为：原版 Camoufox 0.5.6、browser 152.0.4-beta.30、Playwright 1.60.0，browser zip SHA-256 `3b43e766574f286a6a63296cf58b660b7a3120952086c869b4df4c9a71604bc3`，Camoufox wheel SHA-256 `b906836cd952376a466f0e55445f139b8a65adfb9f18ab55cb2cd0c727b11561`，Playwright wheel SHA-256 `39b5420ba6145045b69ced4c5c47d4d9fe5bddfc8ff816c518913afcb25ec7a5`。G0 只证明固定上游公开能力和本 Driver guard 适配，不替代最终 installed/live Agent 现场验收。

G0-U/D/I全部成立才连续进入实现。范围内的 WebEnvoy Driver 适配缺口可修；不能修改 Camoufox/CSS/Juggler/Playwright、构建修改副本、monkey-patch、升级/换Provider或关闭guard。若无法成立，保留第一份反例、具体缺口和排除项，#523不完成；不自行缩成只上传、不要反复堆新探针。局部暂停不影响已完成#519/#516。

## 3. 材料 owner、入口与存储

### 3.1 唯一数据归口

Harbor 新增完成本切片必要的受管文件材料组件，拥有字节、私有定位、完整性、材料生命周期和原生下载关联；沿用现有存储/锁/receipt设施，不另建服务或数据库。位置为现有Runtime data root内独立的 `harbor/files`，不属于Profile浏览器目录、App包、宿主配置或SKILL库。

Core拥有授权、Run、幂等和结果；只存必要摘要和owner refs，不把原文件、base64或本地路径存入Run。Plugin仅投影，不直连Provider、不建立材料副本真相。两层需要不同记录时通过原operation/material ref关联，不重复维护业务终态。

现有 `localFileReferences.ts` / `ProtectedWorkbenchStore` 可复用格式验证与明确选择的经验，但其App私有localRef不是此处上传授权；本批不搬迁旧store、不把App加密状态变成Runtime常驻前置。现有任务输入“raw content stays with owner”的边界保留。Lode不保存用户文件或现场。

### 3.2 可信 owner 入口

已安装CLI固定提供 `files import`、`files inspect`、`files export`、`files revoke`、`files delete`，经现有本机可信owner/API鉴权，不新增App工作台。CLI可接受owner明确给出的源/目标路径，但不能让普通Agent操作请求携带这些路径，也不得公开owner凭据。协议内部运输格式复用现有owner模式，不能把一个普通参数 `owner=true` 当认证。

import只处理一个明确文件：拒绝目录、设备、socket、符号链接及路径逃逸；按打开的真实对象验证并有界复制、计算摘要、原子提交不可变副本；防止检查A后读到被替换的B。显示“导入时副本”、文件名、实际大小/类型、hash和expiry。源文件以后变更不自动更新材料；源文件永不被写入/删除。import不自动扩大Grant或授予上传。

export仅owner使用，复制可用材料到本次明确目的地；拒绝已有目标、路径逃逸和symlink，不自动打开/执行。收到网页的建议文件名不能直接拼进磁盘路径。普通Agent不提供导出任意路径或读正文接口。

### 3.3 引用与最小记录

`file_ref = attachment:runtime/<UUID>`，由owner随机生成，不基于文件名/URL/内容哈希猜测或合并。记录至少包含 schema_version、file_ref、profile_ref、来源import/download、size、sha256、声明/识别类型、消毒后的display_name、created_at/expires_at、材料状态、相关operation；下载另含原Page及创建Principal的关联。内容摘要不是权限令牌；ref不能跨Profile自动共享。

物理文件使用独立随机名、受限权限；新建目录0700/文件0600。副本遭修改/缺失时准确不可用，不回源文件补齐，不返回未经核验内容。私有哈希和名称只按当前授权/历史摘要规则投影；未知ref不泄漏其他主体材料是否存在。

### 3.4 生命周期和容量

每个data root最多32个保留材料、100 MiB已提交内容；容量在写入前保留，满额局部拒绝，不自动驱逐有效材料。操作不得以文件名覆盖任何已有文件。

有效期从成功提交起固定7天，非访问续期；到期禁止新使用/导出，随后在下一次Runtime启动、文件管理动作或owner delete中清理该功能自建副本。不承诺Runtime关闭时准点删除，不删除用户原文件、旧验收材料或Profile。仅保留原Run策略允许的历史元数据/删除事实。

**撤销Grant只撤销该Agent权限，不撤销owner对自己材料的管理权。** `files revoke`禁止材料继续被Agent使用；owner在未到期/未删除前仍可inspect/export/delete。到期/删除不改写历史上传/下载是否曾经发生。

下载完成后必须脱离浏览器临时目录。正常Context/Runtime重启不丢已完成材料；中断在途项按真实证据failed/unknown，不自动重新打开网页或重触发下载。未完成临时文件启动时清理，不能伪装完整结果。

## 4. 单一授权模型

在既有ManagedGrant增加可选：

```json
{
  "file_scope": {
    "upload_refs": [],
    "allowed_mime_types": ["image/png", "image/jpeg", "application/pdf", "text/plain", "text/csv"],
    "max_file_bytes": 10485760
  }
}
```

upload_refs只接受本owner登记的精确ref，无路径/通配符；最多32项。MIME数组为上述非空子集；max_file_bytes是1..10485760的整数。字段缺失或空权限不推出Files授权，旧Grant不自动升级。Core仍使用单个有效Grant，不拼接其他Grant的文件或origin范围。

`file.upload`和`file.download`分别进入allowed_operations及Profile ceiling。现有browser task_scope沿用operations/profile_refs/origins；仅文件动作增加file_refs：upload恰好为本次[file_ref]，download为空数组（输出尚不存在）。非文件旧请求不必新增字段，未知字段仍按各自合同拒绝。

上传有效条件：主体/连接/Grant/任务 ∩ Profile上限 ∩ 精确上传ref ∩ 文件归属/有效状态 ∩ 类型/大小更窄限制 ∩ Page/document/目标新鲜度 ∩ Instance控制权。注册文件不授权发送，页面/点击权限不授权发本地文件；set_input_files触发change即可发生外传，不以“尚未提交表单”降低风险。

下载触发须有单独file.download授权、明确Profile/原Page/target和更窄类型/大小限制。新下载结果先归原Principal/Profile/Run；返回受管摘要不授予读正文、跨主体访问或再次上传。再次上传只有owner明确将该ref加入相应Grant才可能获准，不能由“这是我下载的”自动推导。

每次新操作重新核对有效期/撤销。检查与派发之间撤销或控制变化应阻止派发；已派发不能宣称网站收到的内容被撤回。异步完成及历史query必须准确保留旧事实，不得为了重新检查权限而把已发生动作改写成从未派发。

新Grant字段/存储读取器必须版本兼容或明确拒绝；遇不认识字段不能清空授权store或回退宽松权限。旧文件库缺失时按空库，不影响现有浏览器/技能能力；坏库仅局部拒绝并给owner诊断，不自动删材料重建。

## 5. 最小公共消费接口

本批不增加独立MCP工具；通过现有 `webenvoy_operation` 提供两项操作，连接由Plugin注入。owner文件管理不投影给普通Agent。

| 操作 | 新输入 | 行为 |
|---|---|---|
| file.upload | 既有idempotency_key、grant_id、browser task_scope、profile_ref、runtime_session_ref、origin、page_ref、document_generation、observation_ref、target_ref；另加file_ref | 核对后向当前标准单文件控件交付该不可变副本一次。 |
| file.download | 同上但不带file_ref或任意URL | 已观察的普通HTTP(S)下载link；一个Run内先监听后点击一次，核对真实事件和请求链，完成保存后返回输出ref。 |
| webenvoy_query | 既有原Run/key查询 | 查询operation/receipt和关联材料可用状态；不重新读网页、上传、下载或执行文件。 |

各层复用当前公用envelope和页面输入字段，不能另外建一套Task/Run。若已有target字段分组形式与表的概念字段不同，保留既有wire结构映射并在schema准确说明；operation名称及产品语义不由执行者另选。

Agent不提交selector、脚本、原生句柄、原始路径、bytes、headers/body或任意传输参数。语义观察增加标准file-input/下载link的固定安全元数据与opaque target即可，不返回raw DOM，也不从测试页预置ID生成可信对象。

已有文件的控件返回 `file_input_not_empty`；本批不隐式追加/清空/替换。标准控件支持仍需真实当前对象，失效后不按相同label重新认领。download link的href变更则要求新观察。对非支持下载目标在派发前返回 `download_target_unsupported`。

## 6. 传输、结果与恢复

### 6.1 上传事实层次

文件结果使用 `webenvoy.browser-file-result/v1`。复用Run已有status、dispatch_state和operation_ref；最小文件投影包含原Profile/Instance/Page、输入或完整输出file_ref、安全name/type/size/hash、observed_at和相关观察ref。不要输出Provider临时路径、原始网络载荷或owner信息。

上传单独表达 `browser_delivery`、`page_receipt`、`page_processing`、`business_commit`：
- public set_input_files返回，最多证明交给浏览器控件；固定只读input.files回读可证明当前控件中的name/size/count。
- 网页接收/处理需后续既有snapshot/read/wait的可信观察；看不到就unknown/not_observed，不把HTTP200、文件选择或Agent自报当成业务成功。
- 站点业务判断仍由Agent/SKILL和现有结果核对链承担。本批没有通用站点处理成功识别器、任意验证JS或让Agent写入verified的接口。
- 本批受控页面用正常可见结果和独立服务端摘要证明实际收到处理；Runtime不认识测试端点/标记，也不硬编码小红书逻辑。
- 不自动点击保存/发布、清空控件或第二次上传。确认上传不等于批准后续业务提交。

### 6.2 下载事实层次

在同一已授权动作内登记期待后点击，不要求Agent先点再订阅。每个Instance最多一个在途Files派发，复用现有控制/派发串行机制，不增加新tab租约。与人工/其他动作的控制竞态按当前规则处理。

download事件只表示开始。必须有真实Page对象、事件URL与获准请求链的对应；不能只依据时间/文件名/磁盘文件出现、拿第一个事件、或一个“期待”就推导因果。无法唯一关联或多候选则准确失败/unknown，不冒认。已有guard对每个外部请求先授权，download.page不能替先发出的请求补授权。

Provider完成+有界保存+size/hash/格式校验+原子提交后才发布结果file_ref。建议文件名是不可信输入，磁盘路径不由它决定。输出只到受管材料目录，再由owner明确export。

未声明/额外下载不自动成为当前Agent结果；在本受管自动化Instance内未获准保留的下载通过上游cancel/delete进行有限清理，不认领系统下载目录中的文件，不干预其他浏览器。无法可靠归属不以暂停整个所有Profile作为默认处理。

10 MiB是成功受管文件及导出上限，不是“浏览器从未收过额外字节”的保证。对浏览器临时下载目录做有界空间监测/时间限制和取消；超限/磁盘不足/错误类型时不发布ref，原已收字节/请求事实如实记录。不得为硬凑零超调改浏览器网络栈。所需存储/取消手段若不能安全工作，在G0或实施中准确保留阻断。

每项传输上限120秒；等待Provider事件/完成而不是随机sleep。没有事件且click已派发，保留dispatched/unknown；成功开始后失败使用真实failure。取消不等于撤销网站侧操作。

### 6.3 不重放

Core在派发前持久化原Run/幂等请求；Harbor保留对应操作结果/原生传输关联。重连、RPC重试或同key必须对账原动作，不能再次set_input_files/click/goto。相同key不同请求拒绝。未知不能通过新key重做、重新打开页面或删除记录变成成功。

query允许在既有历史读取权限内取得原receipt及单独的当前材料可用状态；不得覆盖终态来掩盖材料后来过期/删除，也不得经query重新导出/读取正文。当前页面后续观察与原操作结果分开关联，不自动回写一段未经证明的业务成功。

必要拒绝至少包括 file_scope_required、file_ref_unavailable、file_integrity_mismatch、file_type_unsupported、file_limit_exceeded、file_input_not_empty、download_target_unsupported、download_relation_unavailable、download_failed；已有Grant/origin/stale/control/idempotency错误沿用。具体枚举和schema随实现精确定义，不破坏已有reader语义。

## 7. 实际实现复用点与设计义务

已核对可复用的结构：
- `apps/desktop/src/electron/localFileReferences.ts` 与 `protectedWorkbenchStore.ts`：明确文件选择、拒绝symlink和私有定位经验；不是Runtime权威库，不直接升级已有ref权限。
- `packages/core/src/task-turn-input.ts`：Core存owner refs不存文件内容。
- `packages/core/src/managed-access.ts`：单一Grant/ceiling/task、原子存储和严格reader；在此扩窄file_scope，非新权限服务。
- `packages/core/src/managed-browser.ts` 及API/Plugin：现有operation/Run/query链。
- `services/harbor/packages/runtime-api/src/camoufox-upstream-driver.py` / `.ts`：已采用原版SDK/guard/Page事实，新增自身Driver适配而非上游改写。
- `managed-observation.ts` / 当前interaction/snapshot实现：有界新目标与现有失效机制。
- `xhs-media-action.ts`：只参考上传后核验、unknown等既有经验，不复制站点action ID或业务状态机。

Design Obligations：
- DO-PLUGIN-EXPOSURE：triggered；固定file.upload/download及摘要/失效。
- DO-GRANT-WIRE：triggered；file_scope/task新增字段、旧Grant无新增权及严格reader兼容。
- DO-NETWORK-CONTRACT：triggered；文件外传/下载请求归属、拒绝与派发事实，不新增任意网络body读取。
- DO-CONSOLE-CONTRACT：初始not-triggered；若改变公共事件则如实更新。
- DO-PROVIDER-PRIVATE-SCHEMA：初始not-triggered；不改Provider环境bundle/浏览器格式。Harbor材料格式属于本组件正式合同，不借此省略定义。
- DO-APP-IA：not-triggered；固定owner CLI与原接管入口，不新建App区域。

实现同PR已更新本文件为Accepted及 schema/fixture、Plugin/Grant/Network、specs/contracts 索引和必要引导。是否有 Files 接口、是否获授权、是否 Provider 能执行、是否已验证四层分开；未完成 installed/live 现场前不得仅凭代码或 G0 声称 `plugin_verified`。

## 8. 固定验收和最小执行顺序

先G0，再最小实现和确定性检查，再正式安装客户端，最后一个真实Agent短用户任务。G0和实现都由worker负责，资格通过即继续，不逐轮请批；真实Agent不代替状态机验收器。

测试服务器专用：静态根仅包含明确生成测试资产，配置/凭据/Run/Profile目录物理分离；未知路径404，无目录列表、无symlink跟随。上传处理/下载response是固定测试endpoint，不是通用读文件服务。服务端记录有限计数/size/hash，不输出文件正文或任何凭据。不操作日常Chrome/Camoufox默认目录，不按应用名隐式启动。

正常材料：生成一个固定非敏感PNG作为input，受控网页读取该文件并真实发送给服务；服务返回可见“接收/处理完成”与摘要，再显示普通GET的CSV回执下载link。网页行为是测试环境，不向Runtime注入授权/观察/成功。Agent只获得任务说明和owner授权file_ref，不获得selector/坐标/内部完成标志。

最终完成门：
1. 正式owner import/最小Grant；source不变、副本完整；普通Agent无owner权限/任意路径/正文读取。App退出后的普通文件操作可用。
2. 真实Codex经安装Plugin观察→file.upload→读取页面处理证据→file.download→query摘要；独立比较上传接收与下载导出bytes/hash，不能只看模型回答。
3. 同原Instance人工持有时输入/文件派发拒绝；明确交还后旧target拒绝、新观察继续。使用已批准的安全UI自动化可以证明操作链，但不冒充真人体验。标准上传无需弹系统picker；本批不建设通用dialog处理。
4. 确定性测试覆盖跨Principal/Profile/文件ref、旧文档/控件替换、未授权origin/redirect、错误类型/超限/磁盘失败、symlink/TOCTOU、本地副本篡改、恶意文件名、多个/未期待下载、撤销/过期、并发与相同key冲突。失败只影响对应资源；P2/普通管理仍可用。
5. 分别丢一次上传已派发响应和下载触发响应，查询原操作，计数不增加；未知与真实派发事实保留。故障矩阵由确定性安装客户端执行，不塞进真实Agent长回合。
6. 关闭浏览器及Runtime重启后，成功文件仍能owner检查/导出，历史/撤销保持；中断项不重放；到期/delete只清本功能副本，原件/Profile/历史不删除。
7. 最终exact-head的适用checks、packaged no-release、真实安装代码树/资产、独立review和main回读。复用未变证据须写明来源/影响分析，不把旧探针当最终安装验证。

类型支持由确定性样本逐类验证；PNG/CSV为主live，不额外扩成真实网站、真实账号、全格式解析或全平台任务。

### 8.1 最终 installed/live 与真实 Agent 证据

以下记录对应最终正式测试安装（构建时仓库 `47d95ea491bd12d27682ffa7e72d7e0f114ff328`、tree `c024e98b435ae5b20e3a89dd95528e00f6f69ec2`），不把临时验收脚本或测试客户端当作产品状态。机器可读的最小 provenance/hash 摘要持久化于 [`docs/verification/browser-files-v1-installed-live-v1.json`](../verification/browser-files-v1-installed-live-v1.json)；下列临时路径是现场原件定位，不是唯一事实来源：

- 固定来源为 `/Users/claw/.webenvoy/providers/camoufox/sources/official-0.5.6-152.0.4-beta.30/`，Camoufox 0.5.6、browser 152.0.4-beta.30、Playwright 1.60.0；browser zip、Camoufox wheel、Playwright wheel SHA-256 分别为 `3b43e766574f286a6a63296cf58b660b7a3120952086c869b4df4c9a71604bc3`、`b906836cd952376a466f0e55445f139b8a65adfb9f18ab55cb2cd0c727b11561`、`39b5420ba6145045b69ced4c5c47d4d9fe5bddfc8ff816c518913afcb25ec7a5`。G0 原始 PNG/CSV hash 分别为 `431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460`、`6d4ddc85515525576304235af892cbec19e7bd2ff8eea3c72018d146dc585da2`；拒绝计数为未授权 origin redirect=1、未知关系=1、缺失 frame 未归属=1。G0 证据：`/var/folders/zd/dh222wbn5bz92d2rg9p708pm0000gn/T/webenvoy-523-g0-2oz8hxvz/g0-evidence.json`（SHA-256 `f8a04c08b419e06fb69e6ad27d3abcc56057bcb78f7f8bb6721eb0dbd34deb3d`）和 `/var/folders/zd/dh222wbn5bz92d2rg9p708pm0000gn/T/webenvoy-523-g0-i-lc53jspe/g0-i-evidence.json`（SHA-256 `bc57206957d06092292d9230eb6d78a9c03b860d1a572974f440d934908bca07`）。
- 最终安装为 `/var/folders/zd/dh222wbn5bz92d2rg9p708pm0000gn/T/webenvoy-523-originfix-wdQoAN/WebEnvoy-523-47d95ea.app`，独立 data root 为 `/private/tmp/webenvoy-523-originfix-data-PbltJl`；安装 status asset digest 为 `2029c8000c61b8bd23326add28239d4d33c960893d608417288c2977ca283733`，agent manifest SHA-256 为 `d57b0e38c0c4f0a6b55442d010fd4babbd393ce14f9fa82323ba4a344ba46ccb`，skill-assets manifest SHA-256 为 `ddcc8bf912379ed9731b3f7fb6b7ea19b39b716e428a8b64887c9fb97dfb3b4d`，已安装 SKILL SHA-256 为 `36581c5056bfc27896ea96663200497c52ee71463f85a780701882d32ae8f5d2`。受控 live origin 为 `http://127.0.0.1:50794`，服务端 metrics 文件为 `/var/folders/zd/dh222wbn5bz92d2rg9p708pm0000gn/T/webenvoy-523-final-620e42d.C0wmIeMcGn/site/metrics-agent.json`（SHA-256 `62df58393d88c1eab1b1dd94d5d8f4b891326eeb96e9384929e4559f86ef5c61`）：`uploads=1`（PNG SHA-256 `0a64b890a8453691dda8c30b75b48f3d0723ceb9377ebabeba5812c034a1a2b3`）、`downloads=1`（CSV SHA-256 `c66edb8c595edcc4b598dcf6aa20fc2a808b5ae6418a2be9dd77607057e60715`）、`unexpected=[]`。这里的 installed PNG hash 与 G0 原始 PNG hash 不同，不能混写；旧 `webenvoy-523-final-620e42d` 目录仅是受控站点现场原件定位，不是当前安装或源码身份。
- 真实 Codex 线程/session `01a09853-06d6-7c10-9277-4fddef763251` 使用当前安装 Plugin 完成唯一短闭环：fresh `page.list`/`instance.observe`/`instance.snapshot` 后，`file.upload` 一次、fresh snapshot/read 确认实际 receipt、同页 `file.download` 一次；上传 Run 为 `managed-4b48333ab41647b1400e2e6ce3944bf993f1dc5cfcaf8aa22524305499123f47`，下载 Run 为 `managed-14d01a539a6796102c9b90798583016ee8eb97136bf64519581f3e22714cc576`，下载输出 `attachment:runtime/bfa080df-7d7c-431d-9d4c-e85ad91af37c`，15B，SHA-256 `c66edb8c595edcc4b598dcf6aa20fc2a808b5ae6418a2be9dd77607057e60715`；owner 独立 export `/private/tmp/webenvoy-523-originfix-owner-export-receipt.csv` 同 hash。页面 receipt 为 `PNG upload received:67:0a64b890a8453691dda8c30b75b48f3d0723ceb9377ebabeba5812c034a1a2b3`；原 Run query 未重放、服务端计数未增加。完整 MCP 调用及结果保留在 `/private/tmp/webenvoy-523-final-agent-v3/codex-resume/sessions/2026/09/13/rollout-2026-09-13T09-12-53-01a09853-06d6-7c10-9277-4fddef763251.jsonl`（SHA-256 `8805c8734a6a70534327b8cac7e9e31468a3c24f40511168f6a9428f4a3f70f8`）。
- 确定性 installed/client 验收各门均通过；当前 47d95ea/c024e98b 正式安装的 packaged `camoufox-upstream-driver.test.js` 以 13/13 通过重新核对 origin scope 收窄、replacement ElementHandle 旧 target fail-closed、wrong/multiple/late download 归属、10 MiB 与 browser `downloads_path` 临时产物监测/取消/清理及 120 秒 deadline（测试文件与 driver SHA 固化于机器可读证据）。同一固定 Camoufox/Playwright 组合的真实公开 `downloads_path` 10 MiB+1 取消/删除 probe 已通过，摘要与 SHA 固化于 [`docs/verification/browser-files-v1-downloads-path-probe-v1.json`](../verification/browser-files-v1-downloads-path-probe-v1.json)（`5134fc95ab023201281dd6d7c4fc71e67fc989838c7933c1a3fc6bcdef0a29ac`）；该 probe 支持 Provider/API 前提，不冒称 WebEnvoy MCP 或 Agent 证据。620e42d/da9894 的正式安装材料另以 Harbor component tree `388ade70a0892feab88e2ea70ef485feb4158bbf`、source driver blob `24c9486c6804049c6020f82135a5ff5b001d8626` 和 packaged driver SHA `351ea13b5d665ff498de39a32b72261e00cc03b31d9ebbae16e84c645e2e71fc` 建立可适用性等价；其 full source identity 仍明确标为 620e，不冒称 47d。旧 v4 原件的安装身份是 b2d30b23/tree `bd75fe0453e6b9c17a6eeb397c94a0045cdfe27d`、Harbor `8acc0bdee6845296ceae19193c96ea331d759c6e`，只保留为历史/故障诊断，不能作为 f0、620e 或 47d 当前门证据。fresh observe 只用稳定 `page_id`；当前 47d 真实 Agent 仍单独证明 upload/download 页面 receipt、query 不重放和 owner export。所有 source/tree、component、安装/skill/metrics hash、证据角色与复用边界固化于 `docs/verification/browser-files-v1-installed-live-v1.json`。响应丢失后的页面 receipt 首次等待未由外部 metrics 轮询推进，正式 `instance.read`/`snapshot` 后同一既有 upload 才完成 Page 事件队列；该首反例和诊断保留于 `/var/folders/zd/dh222wbn5bz92d2rg9p708pm0000gn/T/webenvoy-523-formal-v4.UGgMni/deterministic-acceptance-v4-fifth-upload-metrics-timeout.json`（SHA-256 `e50267067c0abcbcb5c51bbacfafb49f6304586297fb433fa928c1719166d922`）及 `/var/folders/zd/dh222wbn5bz92d2rg9p708pm0000gn/T/webenvoy-523-formal-v4.UGgMni/diagnose-upload-drop-v4-evidence.json`（SHA-256 `741f6e3e8c9f577faf38ca57c294f7b3415fc56e256f97134b318a5cd279572c`），无 upload 重放。wait parser 离线形状/唯一 key selftest 通过 (`/var/folders/zd/dh222wbn5bz92d2rg9p708pm0000gn/T/webenvoy-523-formal-v4.UGgMni/deterministic-acceptance-v4-selftest-evidence.json`，SHA-256 `826add95d937ae193114ec51cecd3ec7bc525d607cdf4878a01e637319e37587`)。
- 当前安装的三个测试 Grant（`grant:b3cbd33e-553f-49ee-aa77-c9bd3c2373af`、`grant:17ab0555-f6e9-4e01-a0df-1a378b31564f`、`grant:784402b9-eb34-4159-8e01-3ef94d8a613b`）均已 owner revoke；两个测试 Principal（`principal:b6f98790-bd9e-455a-a124-aa69cec038a2`、`principal:53f5134c-06e7-4426-bdd4-ae8e02287c10`）及七个测试连接亦已撤销。持久 owner readback 摘要为 [`docs/verification/browser-files-v1-originfix-owner-readback-v1.json`](../verification/browser-files-v1-originfix-owner-readback-v1.json)（SHA-256 `c683e2f8a2f16664b740c9aaaaec84c55ba20556b83f2a595f30be674d177b73`），最终 readback `active_grants=0`、`active_principals=0`、`active_connections=0`。当前安装 Runtime 已由 owner CLI `stop --data-dir` 停止，受控 site 由任务进程停止；安装包、Profile、Agent rollout、G0 与首异常材料保留，未触碰 #418 Electron。

因此第8节 1–7 项的运行时门由当前 47d packaged focused tests、当前 47d 安装身份/真实 Agent readback，以及明确标注为 620e component-equivalence 的安装材料共同覆盖；旧 b2d 原件不计入当前门。上述复用只建立在实际 component/driver 内容等价和不变合同上，不改变固定 Provider、权限门或验收标准。保留的 harness 顺序/CLI 路径和 Page event-loop 诊断为验收过程证据，不是产品失败或范围变更。

## 9. 权限、进入条件、停止及收口

授权实施本仓代码/文档/测试、独立测试安装、已核验原版组合、专用无账号Profile、本地生成材料和受控HTTP传输、正式owner最小授权及相关GitHub写入。全部门满足后可按仓库保护和独立审查合并本WI主PR并Done。无release/deploy、用户日常材料操作或新系统权限授权。

Worker subagent必须宿主实际接受GPT-5.6-luna/max；独立reviewer必须GPT-6 Astra/low且未参与实现。不能仅角色名冒充配置，不能声称后台未暴露模型信息。单账号允许顶级APPROVE；旧head批准不覆盖新head。

原版不具备安全能力、需要扩大权限/新软件/换Provider/补浏览器、或者需要改变本文件产品范围时停止相应动作，保留准确反例，不偷偷降级。正常实现细节（内部helper/测试布局）自主完成，不把产品范围交给worker重新选择。

#523完成只表示本切片；#497/#474/#471/#477/#482仍open。#510/#521、不可见输入、其他文件/弹窗形式、Agent正文读取均留在原归口，不自动开工。测试Grant正式撤销、仅停止登记的任务进程，保留要求留存的包/Profile/证据；本文件自动清理只对新组件副本有效，不能追溯清理旧验收材料。

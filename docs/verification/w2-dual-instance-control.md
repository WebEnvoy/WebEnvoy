# W2 无 App 双实例监督与控制证据

日期：2026-09-23。范围：[W2 #569](https://github.com/WebEnvoy/WebEnvoy/issues/569)，owning FR [#473](https://github.com/WebEnvoy/WebEnvoy/issues/473)。本记录是固定候选证据，不是全部 Provider／平台、完整 FR 或正式 Release 的完成声明。

## 候选与安装身份

运行候选为 `7cd52c0fd2bd61bda0af9cea092f031cb5671133`，manifest SHA-256 `6ac1bd410d5db5d129acc10f5c00ecba31ca7e6b4dbc11b6be057b6cf18aa9fa`，archive SHA-256 `0104c3b55937a6f6498987342a7f0cb408b76843e67fe0a4b9226a347a53e297`；`check:standalone` 完整性通过，`release:false`。环境固定为 macOS arm64、Node 24.14.0、Camoufox Python 0.5.6／Browser 152.0.4-beta.30／Playwright 1.60.0、同 UID `trusted_local`（无 OS 进程隔离）。在独立临时目录复制并校验 standalone-runtime 包，安装 owner Runtime 与短命 Agent CLI 客户端；两个新 Profile 只访问本地 127.0.0.1 无账号受控页面。未安装或打开 WebEnvoy Desktop App，未操作外部站点或真实账号。

## 代码与 fixture 检查

`pnpm build`、`pnpm typecheck`、`pnpm -r test`、`pnpm lint`、`pnpm conformance`、`pnpm smoke`、`make py-compile` 通过；Core/API 检查使用 runtime-source-lock 固定的 Lode `88615079e6292a6a5254ce4ab5fde2ebd189a072`。全量检查完成后仅收敛 service／CLI 故障修复与相应回归；最终运行包重新构建并通过安装检查，App 测试已重跑：44 通过、0 失败、2 个官方来源 fixture 用例因未配置其专用材料入口而跳过；固定 Provider 安装材料另由下节 live setup 核验。新增服务测试最后补充 Agent status 不泄露 `harbor_ready` 的断言后又单独通过。覆盖：

- 只按可信 `admission.runtime_session_binding` 关联 A/B；未核验请求 ref 和任意结果 ref 不认领，保留实际 control_owner／session_use。
- 六种待处理状态分别返回；终态历史排除。owner credential／Agent route 边界、摘要字段投影、损坏 Run 记录导致完整查询 unavailable。
- CLI 在 Core 503 时保留 Harbor Profile／Page／控制事实；控制命令不查询 supervision。`service-boundary.test.mjs` 运行生产 service／CLI，使用 fixture supervisor 与 Core／Harbor 子进程，覆盖 Core 退出后 owner 控制、Agent 拒绝和 replacement server 不收到请求；真实生产 supervisor 的覆盖来自下节安装现场。
- Harbor 既有控制 fixture 覆盖旧观察、控制代数、接管与交还，不将 fixture 冒充 live Provider。

六种待处理 Run 的展示来自 fixture；真实短命操作同步完成后 live supervision 为空，只证明该候选安装路径可查询空清单，不声称真实 pending／unknown 业务事故已演练。

## 真实 Provider 与已安装 CLI

复现入口：`node apps/desktop/scripts/standalone-dual-instance-check.mjs <standalone-package> <fixed-materials-pointer> --require-supervision`。材料指针指向已核验的固定官方 Provider 安装与来源包；脚本不下载、替换 Provider 或使用生产 Profile。setup 的管理策略配置通过正式 owner API，操作、查询、接管、交还、撤权、停止通过包内 CLI。

脚本返回 `passed`；A/B 的 list／inspect 均明确 `supervision: available, runs: []`。独立 session 与 Profile 身份如下：

| 实例 | Profile | 原 Runtime Session | 原浏览器 PID |
| --- | --- | --- | --- |
| A | `profile_fad0cb4547d64bf082fbf714` | `session_9c76e3a1-cc4c-4065-9a68-d6bca7fdd1b2` | 30954 |
| B | `profile_b5273f17413e39518ff8a495` | `session_468eaf91-bea9-486a-8d3c-13f851f06916` | 31006 |

A 接管后新输入 `control_lock_conflict/not_dispatched`，owner CLI 退出后 user lease 保持，B 继续输入。A 交还后旧 observation 输入 `managed_interaction_observation_stale/not_dispatched`；按稳定 `page_id` 重新观察原任务页，取得轮换的新 `page_ref` 后成功输入。同实例 Help 页保持另一个 Page，不替代任务 A。

按原 key 查询返回相同 Run，前后页面输入计数均未增加；例如 A 交还后输入 `managed-ebddadedbc99e8addccda100e978518835be7cc7b1bec2f2f921a1bb41327419`，B 在 A 停止后的输入 `managed-aca79e7db651b8bb6a106361ef4c97eca8d412f6c00920a4c4d9f32f02169a0c`。撤销 A 专用 Grant 后，新只读 observe 被 `managed_access_grant_unavailable/not_dispatched` 拒绝，A 进入 locked。owner 显式停止 A 后原 PID 30954 退出；B 原 PID 31006 仍存活并成功输入，控制代数不受 A 变化影响。最后显式停止 B、专用 Runtime 和本地 origin，原 PID 均确认退出。

宿主缺席的边界为：没有启动持续 Agent host 进程，只有一次性安装客户端；owner 控制不需要恢复它，也不读取 Agent key。本检查不把这一点冒充真实第三方宿主崩溃或模型消费。

另在同一运行候选的独立安装现场终止专属 Core PID 30512：原 Harbor PID 30513 继续存活，owner diagnose 为 `ready:false, harbor_ready:true`；list／inspect 保留两个原实例并明确 supervision unavailable。随后 owner CLI takeover A 返回 user、handback 返回 none、stop A 返回 closed，B 仍为 active；Agent connect 退出 8／`runtime_child_exited`。验证后显式停止 B、Runtime 和本地 origin。此结果证明真实 Core 子进程退出后的局部独立控制，不承诺 Core 不可用时仍能撤销 Grant 或执行 Agent 业务。

## UI 自动化与输入影响

基线 `e6c9e69f69e3d75f8d982416d94e447e913bac02`（manifest SHA-256 `82f7c3c1ddb46219a1c3b2473a1af0e3039a5dca9c36b1c7fc9fca288fe8ce89`）上先做原窗口 UI 自动化调查，未由真人操作：

- 前台 A 的 Page 对象级输入成功回读，但 AX 仍可能显示地址栏焦点，不能据此推断原生键盘路由。
- owner 接管后，一次 AX 元素点击没有取得字段焦点，原生输入进入地址栏；未提交导航，Escape 恢复。用截图坐标点击并核对 AX 字段焦点后，原生键盘输入才正确进入 A。这个事件是 UI 自动化焦点限制，不记录为 WebEnvoy 对象级输入成功。
- 最小化动画后对象级输入成功；后续截图重新显示完整窗口，不能证明持续最小化或 capture 不会恢复窗口。原生新窗口曾停留 about:blank，未证明原因；关闭该新窗口后，正式 page.open 在同实例建立 Help 页。
- 原生 UI 在 Help 输入标记并保持焦点；交还后无 Page selector 的 observe 拒绝为 `page_selection_required`，指定原 A 稳定 `page_id` 后 fresh observe／input／read 成功，Help 标记保持。`page_ref` 在控制变化后会轮换，不能代替稳定 Page 身份。
- Help 位于前台、任务页被遮挡时，A 和另一个实例 B 的 Page 对象级输入分别落在原任务页；Help 的 AX 焦点／文本与采样截图中的鼠标位置保持。该结果只覆盖采样时刻，不是连续系统焦点／鼠标追踪。

最终运行候选重新建立专用 A/B 原窗口，UI 自动化确认 Raise A 后正式对象级输入成功；在 owner 接管后的 Help 页，AX 点击取得 Message 字段焦点，原生输入 `W2 final Help viewer marker` 正确显示。交还后无 selector 的 observe 明确 `page_selection_required`；使用原 A 的 `page_object_0f0b75b4-42a3-4961-b83c-981dea0e7cc8` 重新观察，输入并回读 `W2 final original task after Help`（Run `managed-7d6cd15a58408c4e7c1dd5d15445c31c247c31a7301fa0b5b941b6918d971e3d`）。随后 B 回读 `W2 final nonforeground B`（Run `managed-21af0c44b0592bbcaaf0840a9f77b897c883735878d24f8af379523f3a8bc8b5`）；前后 Help 窗口 AX 焦点、标记与画面保持。最终复验没有重做最小化或原生新窗口导航；上述基线失败／限制不外推成新候选成功。全局剪贴板未读取或修改，前后值未验证；未证明任意前台应用不受干扰、持续最小化、零干扰、真人验收、第三方模型消费或 `plugin_verified`。原生 UI 的输入落点必须先核实焦点，不能用截图成功替代控制事实。

## 交付边界

未合并、未发布、未关闭 W2 或 owning FR。版本获取与发布、其他 Provider／平台、更丰富观看布局和容量、真实账号操作不在本次证据范围。所有临时原实例与 Runtime 在采集后显式停止；只保留脱敏结论与可复现脚本，不提交凭据、Profile 数据或原始画面。

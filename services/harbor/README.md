# Harbor

Harbor 让 Agent 可以长期、稳定、可接管地使用真实浏览器账号。

很多 Agent 浏览器自动化的问题，不是“能不能打开 Chrome”，而是账号和环境不连续：这次登录了，下次又丢了；这次用一个代理，下次换了环境；验证码出现时没人接管；任务失败后只剩一堆截图和日志。对真实网站来说，这种临时、割裂的浏览器会话很容易变得不稳定。

Harbor 的目标，是让每个账号都有一个长期可维护的浏览器身份。它管理 Profile、登录态、Cookie、代理、指纹、浏览器会话、人工接管和运行证据，让 Agent 不再像一次性脚本那样临时打开浏览器、临时登录、临时失败。

## Harbor 面向谁

Harbor 面向需要让 Agent 或自动化系统复用真实浏览器账号的开发者、团队和本地执行环境。

对人类用户来说，Harbor 应像一个面向 Agent 时代的 Profile Browser：可以创建、分组、登录、配置和接管浏览器身份。对 Agent 来说，这些身份又可以通过 API 被稳定调用。

## 隐身性和浏览器环境

Harbor 追求浏览器身份的隐身性，并尽量降低自动化特征和异常暴露。

即使底层 provider 是 Chrome Official，Harbor 也不应只是裸启动浏览器。它应尽量让 Agent 使用长期 Profile、合理浏览器上下文和可解释的浏览器身份，减少临时自动化会话特征。更高级的指纹伪装和浏览器内核级反检测能力可以由专门 provider 提供，但隐身性仍然是 Harbor 要追求和管理的产品目标。

Harbor 不直接判断“某个 provider 是否适合某个任务”。它输出 provider、Profile 和 Runtime Session 的客观能力事实；具体任务是否需要更强环境，应由 WebEnvoy、Lode 能力声明、用户策略或上游系统判断。

## Harbor 解决什么问题

Harbor 关注的是“Agent 使用真实浏览器账号时，账号和环境是否连续”。这里的浏览器账号不只是登录账号，还包括 Profile、登录态、Cookie、代理、指纹、会话历史和运行证据。

它要解决的问题包括：

- 每次任务都像临时浏览器会话，登录态、Cookie 和 storage 难以长期复用；
- 账号和代理、地区、语言、时区、浏览器指纹之间缺少稳定绑定；
- 使用 Chrome Official 时，如果 Harbor 只裸启动浏览器，仍可能保留临时自动化会话特征；
- Agent 可以操作浏览器，但人类用户无法方便地观察、暂停、接管和恢复；
- 验证码、登录异常、访问受限和环境异常出现时，自动化流程容易继续误跑；
- 任务失败后缺少运行现场、错误状态和证据；
- 上层系统直接依赖某个浏览器 provider，未来替换 Chrome Official、CloakBrowser、Camoufox 或远程浏览器时成本很高。

## Harbor 适合什么场景

Harbor 适合那些需要让 Agent 使用真实浏览器账号的场景：

- 需要长期保持登录态，而不是每次任务重新登录；
- 需要把账号和固定环境绑定，例如代理、地区、语言、时区、浏览器指纹；
- 需要让 Agent 使用真实浏览器完成任务，同时人类可以观察和接管；
- 需要通过 CDP、Viewer 或远程会话把浏览器暴露给上层系统；
- 需要保存运行证据，知道一次任务是在什么环境下失败或成功的；
- 需要未来替换浏览器 provider 时，不影响上层任务。

## 用户能用它做什么

长期目标下，用户可以通过 Harbor：

- 创建和维护 Agent 可使用的浏览器 Profile；
- 让一个站点账号绑定稳定的浏览器环境和网络环境；
- 复用真实登录态，让 Agent 不必每次重新登录；
- 启动、连接、观察、接管和关闭浏览器会话；
- 为 WebEnvoy Core 或其他上层系统提供可连接的 Runtime Session；
- 保存截图、日志、网络摘要、错误状态和关键运行证据；
- 在不改变上层任务逻辑的情况下替换底层浏览器 provider。

## Harbor 不是什么

Harbor 不负责理解具体网站业务，也不决定一个任务应该怎样完成。它不会替用户设计发布策略、运营账号或编排业务流程。

Harbor 负责的是浏览器账号和运行环境：这个账号用哪个 Profile、哪个代理、哪个浏览器、哪个会话，Agent 如何连接，人类如何接管，执行后留下哪些证据。具体网站任务由 WebEnvoy Core 执行，normalized result schema 由 Lode 定义。Harbor 只提供 raw_payload_ref、source_trace 和 evidence_ref，不解释站点业务字段。

Runtime API 的 owner-clean 读取入口是 `GET /runtime/sessions/{runtime_session_ref}/runtime-facts`，返回现有 `harbor-core-runtime-facts/v0` provider/session/viewer/control facts 与 refs。旧的 `/site-resource-facts` 和 `/read-operations` 路径仍保留为显式兼容适配，供迁移和回滚使用；其中的 XHS/BOSS admission、Lode pin、`public_summary` 和 normalized output 不是 Harbor owner truth，待 Core #342/#343 的兼容证据完成后再退役。

## 本仓库包含什么

本仓库承载 Harbor 的浏览器身份和运行时能力。这里的模块说明是实现视角，用来帮助开发者理解代码边界：

- Profile：浏览器数据、Cookie、storage、扩展、代理、语言、时区和 user_data_dir；
- Execution Identity：站点账号、登录态、历史状态、风险事件、资源约束和可用通道；
- Runtime Session：一次可连接、可观察、可接管、可释放的浏览器会话；
- Browser Drivers：连接 Chrome Official、CloakBrowser、Camoufox、Remote CDP 或其他 provider；
- CDP / VNC / Viewer：让 Agent、上层系统和人类用户连接、观察和接管浏览器；
- Evidence Store：保存运行证据、错误状态、raw_payload_ref、source_trace 和关键运行事实；
- Runtime API：向 WebEnvoy Core、Agent、CLI、MCP、SDK 和 WebEnvoy App 暴露稳定能力。

当前 Runtime API 已提供本地身份环境管理的最小实现：可创建或导入小红书 / BOSS 等站点身份环境，维护本地 Profile、Cookie / storage 登录态状态、代理、地区、语言、时区和指纹一致性摘要。公共输出只暴露状态和脱敏引用；password、cookie value、token、raw storage 和 raw profile data 不会被接受为输入或输出。

## 与 WebEnvoy / Lode 的关系

Harbor 管浏览器账号和运行现场，不理解具体网站业务。

- WebEnvoy 负责让用户和上游系统调用网站工作能力，并组织执行过程和结果；
- WebEnvoy App 可以呈现 Harbor 的 Profile、Runtime Session、Viewer 和人工接管界面；
- Lode 负责沉淀可复用的网站经验、能力包、原子动作、任务封装、输出契约和测试样例；
- Harbor 负责提供可持续使用的浏览器身份、可连接的运行会话、人工接管入口、raw_payload_ref、source_trace 和运行证据。

## 文档

- [愿景](VISION.md)
- [路线图](ROADMAP.md)
- [架构决策记录](docs/adr/0001-record-architecture-decisions.md)

## 许可证

本仓库采用 [GNU Affero General Public License v3.0](LICENSE)。

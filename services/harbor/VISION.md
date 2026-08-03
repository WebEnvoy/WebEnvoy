# Harbor Vision

Harbor 的长期愿景，是让 Agent 拥有可以持续使用的浏览器身份。

对真实网站来说，一个账号不是孤立的用户名和密码。它和浏览器环境、Cookie、代理、地区、语言、时区、登录历史、风险状态和使用习惯绑定在一起。如果 Agent 每次都用临时浏览器会话执行任务，就很容易遇到登录失效、验证码、环境不一致或无法解释的失败。

Harbor 要解决的是这个问题：让每个账号都有长期维护的浏览器身份，让 Agent 可以复用它，让人类可以观察和接管它，让每次运行都有证据可查。

隐身性不是 Harbor 可以完全外包掉的目标。Harbor 可以依赖 browser provider 提供底层指纹、隔离和反检测能力，但必须把隐身性、环境一致性和身份连续性作为自己的产品结果来追求。即使 provider 是 Chrome Official，Harbor 也应尽可能减少临时自动化会话特征和不必要的异常暴露，避免让 Agent 像一个临时拼装出来的裸自动化客户端。

Harbor 面向需要让 Agent 或自动化系统复用真实浏览器账号的开发者、团队和本地执行环境。它既要让人类用户可以像使用 Profile Browser 一样管理账号环境，也要让 Agent 和 WebEnvoy 可以通过稳定接口调用这些浏览器身份。

## 一句话愿景

让 Agent 可以长期、稳定、可接管地使用真实浏览器账号。

## 用户今天的问题

Agent 使用真实网站账号时，最大问题不是能不能打开浏览器，而是浏览器身份不连续。这里的浏览器身份，不只是登录账号，而是账号、Profile、登录态、Cookie、代理、指纹、会话历史和运行证据组成的连续环境。

用户今天经常遇到的问题包括：

- 每次任务都像临时浏览器会话，登录态、Cookie 和 storage 难以长期复用；
- 同一个账号今天用一个代理和地区，明天又换了环境，网站侧看到的身份不连续；
- Profile、代理、指纹、Cookie、扩展、浏览器版本和运行会话分散在不同工具里；
- Agent 可以操作浏览器，但人类用户不容易观察、暂停、接管和恢复；
- 出现验证码、登录异常、访问受限或页面卡住时，自动化流程容易继续误跑；
- 任务结束后只剩截图、日志或错误文本，不知道当时用的是什么环境、在哪一步失败；
- 上层任务直接依赖某个浏览器 provider，未来切换 Chrome Official、CloakBrowser、Camoufox 或 remote CDP 时容易破坏能力。

Harbor 要把这些割裂的浏览器状态组织成一个可以长期维护的身份，而不是让 Agent 每次都从一次性会话开始。

## Harbor 给用户带来的变化

使用 Harbor 后，用户应该能够：

- 为每个站点账号维护稳定的浏览器身份；
- 把账号、Profile、Cookie、代理、指纹、语言、时区和浏览器状态绑定在一起；
- 让 Agent 复用真实登录态，而不是每次重新登录或导入临时 Cookie；
- 在浏览器运行时看到现场，必要时暂停、接管、处理异常，再交还给 Agent；
- 让每次运行留下足够证据，知道使用了哪个账号、哪个环境、哪个会话以及在哪里失败；
- 在替换底层浏览器 provider 时，尽量不影响 WebEnvoy 和上层任务。

Harbor 的产品价值不是“启动一个浏览器”，而是让 Agent 使用网站时具备连续身份、可观察现场和可追溯证据。

## 长期产品价值

Harbor 长期要交付的价值包括：

### Agent 可持续使用的浏览器身份

一个浏览器身份不只是 Profile 文件夹。它应包含账号、登录态、Cookie、storage、代理、地区、语言、时区、浏览器指纹、历史状态、风险信号和最近一次正常使用记录。

Harbor 要让这些信息形成长期一致的身份，让 Agent 看起来不是一次性自动化客户端，而是稳定、连续、可管理的浏览器用户。

### 人类可管理的 Profile Browser

Harbor 应覆盖 AdsPower-like Profile Browser 的基础体验：创建 Profile、分组标签、配置代理、导入 Cookie、管理扩展、启动浏览器、查看状态和人工使用。

但 Harbor 不能停留在普通 Profile 管理。它还要理解站点账号、资源要求、执行上下文和运行证据，让这些 Profile 可以被 Agent 和 WebEnvoy 稳定使用。

### 基础隐身与反检测能力

即使底层 provider 是 Chrome Official，Harbor 也应尽可能提供基础隐身和自动化暴露控制能力。

Harbor 不应把官方 Chrome 当成裸浏览器启动器。它应尽量减少临时自动化会话特征，维护合理的浏览器上下文，降低不必要的自动化暴露，并让账号长期使用稳定、连续、可解释的浏览器身份。

更深层的指纹伪装、浏览器内核级反检测和专门环境表达，可以由 CloakBrowser、Camoufox 或其他 provider 提供。但 Harbor 不应直接判断某个 provider 是否足以完成某个任务。Harbor 应暴露 provider、Profile 和 Runtime Session 的结构化能力事实，例如当前是否使用长期 Profile、是否支持代理、时区、语言、viewport、扩展、Cookie 持久化、CDP、Viewer，以及 provider 是否提供原生指纹控制或反检测能力。当前能力是否满足某个网站任务，应由 WebEnvoy Core、Lode 能力声明、用户策略或上游系统根据这些事实判断。能力事实模型草稿见 `docs/draft/runtime-capability-facts.md`。

### 可观察、可接管、可恢复的运行现场

真实网站任务不可能永远无人值守。验证码、登录异常、权限提示、文件选择、页面卡住和复杂交互都可能需要人类介入。

Harbor 应让人类可以看到浏览器现场，接管当前会话，处理异常，再把控制权交还给 Agent 或上层系统。

### Agent 可用的任务空间

Agent 不应该只能拿到一个裸 CDP endpoint。长期来看，Harbor 应提供 Execution Space / Task Space，让 Agent 在隔离的任务空间里打开页面、观察状态、执行动作、保留现场，并和人类用户互不打断。

### 低噪音页面观察

Agent 使用浏览器时，直接读取完整 DOM 或反复看截图成本高、噪音大。Harbor 长期应提供 Snapshot / RefMap，把页面状态压缩成结构化观察结果，并给可点击、可填写、可选择元素提供稳定引用。

### 代码式批量操作

Agent 不应该总是一条条发 CLI 或 CDP 命令。长期来看，Harbor 应提供 Agent Helper Runtime，让 Agent 可以用一段受控代码完成多步浏览器动作，减少往返成本，也更容易留下清晰证据。

### 证据引用，而不是数据归一化

Harbor 保存和暴露的是执行现场事实，例如 Runtime Session、Profile 状态、截图引用、Snapshot 引用、network 摘要、console 错误、raw payload 引用和 source trace。

Harbor 不解释站点业务字段，不定义 normalized result，也不判断某条结果是内容、评论、作者还是媒体资产。这些公共结果契约属于 Lode，运行时校验和封装属于 WebEnvoy Core。

Harbor 的价值是让上层可以追溯“结果来自哪个浏览器身份、哪个会话、哪些证据”，而不是把执行现场转成业务数据模型。

### 可替换的浏览器 provider

用户不应该因为底层浏览器 provider 改变，就重写上层任务。Harbor 应通过 Browser Driver 接入 Chrome Official、CloakBrowser、Camoufox、remote CDP 或其他 provider，同时保持 Profile、执行身份、会话和证据模型稳定。

Harbor 也必须管理 provider 的本机生命周期，而不只报告“已安装/未安装”。对于
WebEnvoy 可管理的 provider，用户应能完成检测、下载、安装、更新、修复和启动验证；
系统浏览器提供检测、定位和官方安装入口；外部 provider 提供绑定和连接验证。
这些事实由 Harbor 拥有，App 负责呈现和发送用户意图。

## 长期产品形态

Harbor 长期会有两类产品表面。

第一类是 Harbor 在 WebEnvoy App 中呈现的浏览器身份与运行现场界面，面向人类用户管理 Profile、账号环境、代理、指纹、Cookie、扩展、登录状态、运行会话和人工接管。

Harbor 也可以长期演进为独立的 Desktop / Local Console，但第一天不必作为独立用户入口出现。

第二类是 Server / Docker / Remote Runtime 形态，面向 WebEnvoy Core、WebEnvoy App、Agent 和自动化程序提供 Runtime API、Session API、CDP、Viewer、VNC、Evidence、健康检查和远程执行入口。

这两类形态可以共享同一套核心模型，但不应互相绑死。Harbor 的核心价值是连续身份和可接管运行现场，不是某一种桌面 UI 或某一种浏览器 provider。

## 与 WebEnvoy / Lode 的关系

Harbor 关注浏览器账号和运行环境，不理解具体网站业务。

- WebEnvoy 关注用户要完成的网站工作，以及结果、状态、失败原因和证据如何返回；
- Lode 保存可复用的网站经验、能力包、原子动作、任务封装和测试样例；
- Harbor 负责提供可持续使用的浏览器身份、可连接的运行会话、人工接管入口、raw reference、source trace 和运行证据。

Harbor 可以记录登录态异常、验证码出现、访问受限、浏览器崩溃、代理不可用和运行现场状态；具体网站任务如何继续处理，应由 WebEnvoy 和 Lode 中的能力定义决定。

## 我们长期坚持的原则

Harbor 的长期产品设计应坚持几条边界：

- Profile 不是最高层语义，账号和环境组成的连续身份才是；
- 人类接管是一等能力，不是调试附属功能；
- 隐身性是 Harbor 的产品目标，即使底层指纹、隔离和反检测能力由 browser provider 提供；
- Chrome Official 下也应提供基础隐身和自动化暴露控制，不应退化成裸浏览器启动器；
- Harbor 输出 provider、Profile 和 Runtime Session 的客观能力事实，不输出“是否适合某个任务”的黑盒判断；
- 浏览器 provider 可以替换，但用户身份、会话、能力事实和证据模型应保持可比、可检查；
- 运行证据应足够排查问题，但不默认外传 Cookie、token、完整 DOM、完整请求响应或业务数据；
- Harbor 不理解具体网站任务，也不把站点流程塞进 Runtime；
- Harbor 不负责数据归一化，不定义站点业务字段、collection item、comment item 或 dataset record。

## Harbor 不是什么

Harbor 不负责理解具体网站业务，也不决定一个任务应该怎样完成。

它不是站点能力解释器、任务编排器、页面流程脚本仓库、账号矩阵运营系统、内容发布策略系统或业务决策系统。Harbor 不替用户决定要发布什么、抓取什么、联系谁或如何运营账号。

Harbor 负责的是浏览器账号和运行环境：这个账号用哪个 Profile、哪个代理、哪个浏览器、哪个会话，Agent 如何连接，人类如何接管，执行后留下哪些证据。normalized result、collection item、comment item 和 dataset record 属于 Lode 与 WebEnvoy Core 的公共结果契约。

## 成功状态

当 Harbor 成功时，用户应该可以自然地说：

- 这个账号不是一次性会话，它有长期维护的浏览器身份；
- Agent 可以复用真实登录态，不需要每次重新登录；
- 账号的代理、地区、语言、时区、指纹和浏览器状态是连续的；
- 任务卡住或出现验证码时，我可以看到现场并接管；
- 执行失败后，我知道用的是什么环境、哪个会话、在哪一步出错；
- 我能看到当前浏览器身份、provider 和 session 具备哪些客观能力，并让上层系统据此判断是否满足任务要求；
- 我可以替换底层浏览器 provider，而不破坏 WebEnvoy 和上层任务；
- 浏览器运行证据足够排查问题，但不会默认外传完整 Cookie、token、DOM 或业务数据。

这就是 Harbor 的长期产品价值：让 Agent 具备可持续使用的浏览器身份，并让真实网站运行现场可观察、可接管、可追溯。

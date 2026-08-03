# 0009. 本机 Browser Provider 生命周期管理

## 状态

Accepted for Harbor #278/#279, 2026-07-14.

本 ADR 扩展 ADR 0006 的 provider facts，并 supersede ADR 0008 对 managed browser
binary/dependency install 的拒绝。检测和下载引导不足以构成用户可恢复的 provider
管理，Harbor 必须拥有检测、安装、更新、修复和启动验证的生命周期事实。本 ADR
同时解决 PD-0007 的最小 enablement facts；具体 provider 仍需由对应 Work Item 提供
来源、许可、版本和完整性材料。

## 背景

App 是人类使用浏览器身份和环境的操作台。当前 Harbor 可以检测 CloakBrowser 和
官方 Chrome，但 provider 缺失或损坏时主要返回下载引导和失败诊断。用户仍需离开
任务、猜测安装路径并手动刷新，无法形成开箱可用的恢复闭环。

Provider 负责实际浏览器内核、指纹、隔离和自动化能力；Harbor 负责统一管理它的
本机生命周期与客观能力事实。App 不应实现第二套 installer 或 provider truth。

## 决策

### Provider 管理类型

| 类型 | Harbor 生命周期责任 |
| --- | --- |
| `managed` | 检测、下载、完整性校验、安装、更新、修复、启动验证 |
| `system` | 检测、定位、版本/架构校验、启动验证、官方安装入口 |
| `external` | 用户绑定安装或连接信息，Harbor 验证可达性和能力 facts |

CloakBrowser 作为首个 `managed` provider。官方 Chrome 作为 `system` provider。
Remote CDP 等按 `external` provider 管理。

### 生命周期

```text
unknown -> detecting -> missing / ready / update_available / incompatible / damaged
managed: missing | incompatible | damaged
  -> downloading -> verifying -> installing -> launch_verifying -> ready
managed: ready | update_available
  -> downloading -> verifying -> installing -> launch_verifying -> ready
failure -> repairable / user_action_required / unsupported
downloading | verifying | installing | launch_verifying
  -> cancelling -> ready / missing / damaged
```

`system` provider 在缺失或不兼容时进入官方安装入口和重新检测；`external` provider
进入重新绑定、连接验证或外部管理入口。它们不得误走 Harbor-managed 下载/替换路径。

更新是带目标版本的安装；修复是重新校验并替换 Harbor-owned 安装内容。Harbor 不删除、
移动或重写用户其他浏览器 profile，也不自动接管系统浏览器安装。

每个变更操作记录开始前状态。只有下载、校验或可原子回滚的安装阶段可以声明
`cancellable=true`。取消后若开始前已有可用版本则回到 `ready`；首次
安装尚未写入时回到 `missing`；已经发生部分写入且无法完整回滚时进入 `damaged` 并提供
repair。不可安全取消的阶段必须返回 `cancellable=false`，App 不能显示虚假的取消命令。

### 安装来源与完整性

Managed provider 必须有明确的发布来源、版本、OS/arch、下载定位、完整性校验材料、
许可/分发边界和安装目标。缺少这些事实时返回 `install_source_unavailable`，不能从
任意镜像或搜索结果下载。

需要系统权限时，Harbor 返回明确的 `user_action_required`，由 App 触发系统授权；
不得静默提权。

### Runtime API

Harbor API 向 App/Core 暴露：

- provider 当前生命周期状态与版本；
- 当前操作、进度、开始前状态、可取消性和取消结果；
- 校验、安装和启动验证结果；
- 简洁可恢复错误和下一步动作；
- 用户主动展开时使用的诊断记录引用。

App 默认不需要路径、checksum、启动参数或探测日志。Core 只消费任务所需的 ready 和
能力 facts，不触发交互式 installer。

## 影响

- Harbor #201 的下载引导保留为历史能力，不再等于 provider recovery 完成。
- Harbor #218/#219 的 Runtime API 必须承载生命周期公共状态。
- App #234/#303 消费生命周期，不维护安装 truth。
- Provider 安装属于 Harbor operation catalog 声明的 `environment` 动作。App/CLI/API
  的明确用户意图进入 Core 统一 evaluator；Harbor 只消费有效授权决定，不把用户点击
  直接当作绕过 evaluator 的执行许可。

## 非目标

- 不建立 provider marketplace、排名或站点成功率模型。
- 不实现站点 task、Core 授权 evaluator 或 App UI。
- 不管理用户其他浏览器 profile、Cookie 或账号材料。

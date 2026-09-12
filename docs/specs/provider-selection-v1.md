# Provider Selection and Creation Default V1

状态：Accepted；版本：v1；owner：Harbor（偏好、选择解析与 Profile binding）、Core（Agent 授权、Run 与对账）、Desktop App（owner 确认入口）、Desktop Agent entry（MCP 投影）。产品归口：[Work Item #516](https://github.com/WebEnvoy/WebEnvoy/issues/516)，父项：[Provider／环境 FR #471](https://github.com/WebEnvoy/WebEnvoy/issues/471)。

## 四个独立事实

- 项目推荐来自 Provider catalog，只供人参考，不是用户设置或授权。
- 用户新建默认是 Harbor 管理状态中的可空本地偏好，只影响以后创建的 Profile。
- 本次显式选择只属于该次 create，不写偏好。
- Profile 实际 binding 在创建成功时持久化，后续启动、复用和重启只按 binding；改变仍需显式迁移。

创建解析固定为：本次显式选择 > 用户新建默认 > `provider_selection_required`。候选必须在当前 catalog 中受支持、可选、已安装且可启动，并通过当前主体的有效授权；不可用或未授权时局部拒绝，绝不改选项目推荐或其他 Provider。没有旧偏好记录即 `unset`，不得从已有 Profile、最近使用或推荐推断。

既有 Profile、Instance、Account、Environment、Grant 和 owner 明确固定 Provider 的创建模板不因默认变化而改变。固定模板拒绝任何请求级 `provider_id`；动态模板的 `provider_id=null` 才允许一次性选择或省略后使用用户默认。模板不是偏好，创建权和浏览器操作权不蕴含偏好修改权。

## Harbor 持久化与接口

Harbor 是唯一 owner。偏好不得写入浏览器 Profile、Plugin 安装目录、App localStorage 或 Core Grant store。当前读模型：

```json
{
  "schema_version": "harbor-browser-provider-preference/v1",
  "project_recommendation": { "provider_id": "cloakbrowser", "availability": "available", "unavailable_reason": null },
  "user_creation_default": { "provider_id": null, "availability": "unset", "unavailable_reason": null, "updated_at": null }
}
```

Harbor 提供 `GET /runtime/browser-provider-preference`、受 supervisor 保护的同路径 POST，以及 `GET /runtime/browser-provider-preference-mutations/{idempotency_key}`。POST 只接受 `{operation:"set",idempotency_key,provider_id}` 或 `{operation:"clear",idempotency_key}`。set 只接受当前有效 Provider；clear 回到 unset。`harbor-browser-provider-preference-mutation/v1` 返回 completed/rejected、写后 preference 与稳定 failure。原子写入成功后才发布新状态；失败保留旧值且不得报告成功。同 key 同请求回放原 receipt，异请求返回 `idempotency_conflict`。

已保存 Provider 后来失效时仍回读原 `provider_id`、`availability=unavailable|unsupported` 和原因；不能后台清除或替换。偏好文件属于 Harbor 管理 data root，0600 原子替换并随 Runtime／App 重启和安装更新继续存在。

## 创建快照、结果与并发

Harbor 在 create 的 raw request idempotency receipt lookup 之后读取一次当前默认并物化请求。解析结果不在执行中再次读取。成功的 `harbor-identity-environment-mutation/v1` receipt 附：

```json
{
  "provider_selection": {
    "schema_version": "harbor-provider-selection/v1",
    "source": "explicit_request",
    "selected_provider_id": "chrome_official"
  }
}
```

`source` 只能是 `explicit_request` 或 `user_default`；推荐不是 source。Profile 的既有 `provider_binding.selected_provider_id` 是最终实际事实。Core 将这个有界 selection 摘要随 Plugin create 结果和 receipt 对账结果返回。响应丢失或偏好随后变化时，同一 create key 只回读原 receipt，不能重新解析、换 Provider 或再创建 Profile。偏好 set/clear 的未知结果也只查原 receipt，不重发。

## App、Plugin 与 Grant

App 同时读取 catalog、preference 和 Profile binding。未设置时只展示可修改的推荐，select 保持未确认；真人明确选择后才创建。可用默认可作新建预选；失效默认保持显示并阻止静默创建。一次性选择不修改默认，默认管理只提供最小 set/clear/readback。

编辑只以被编辑 Profile 的实际 `provider_binding.selected_provider_id`（及其 admission facts）作为 Provider 初值；create 与 import 均不得读取历史 `selected`、当前选中 Profile 或最近使用值。import 的 Provider 必须在本次表单中明确选择，不能继承新建默认或任何历史状态。App 表单按 mode 与编辑对象隔离，切换 mode 或编辑对象时不得复用前一表单输入。

已安装 Plugin 复用 `webenvoy_operation`：`provider.preference.read`、`provider.preference.set`、`provider.preference.clear`，以及动态模板 create 的可选 `provider_id`。偏好 operation 的 task scope 使用当前 operation 和空 `profile_refs`/`origins`。Core 仍检查 Principal、Connection、单一有效 Grant、task scope 和执行策略，并将 `provider_preference` target 匹配到 `harbor://browser-provider-preference` resource requirement。

三项 preference operation 必须逐项出现在 `allowed_operations`；旧 Grant 没有权限。set/clear 是 write risk，read 不能推出修改权限。没有新增 Provider ID scope 或第二权限系统；动态模板本身表示 owner 允许在 create 时按本次选择或用户默认解析，但不赋予修改默认权。

## 兼容、失败与非目标

旧固定模板的 string `provider_id` 原样有效；新 reader 接受 string 或 null。旧 reader 不认识 null、新 operation 或新 MCP 字段时必须明确拒绝，不能忽略后继续。稳定失败至少区分 `provider_selection_required`、`provider_unavailable`、`idempotency_conflict`、`persistence_failed` 和模板冲突；局部失败不改变其他资源。

本规格不安装、启动、停止、迁移或删除 Provider/Profile，不定义 Provider marketplace，不改变许可与分发策略，不新增浏览器核心语义，也不把项目推荐升级为授权。

## 验收证据

最低覆盖 unset 真人确认、Agent selection_required、App/Plugin 同源回读、重启持久性、显式 B 优先默认 A、默认 A→B 不改旧 binding、clear、不可用/未授权/模板冲突/写失败、并发与响应丢失对账。fixture、真实 Provider、安装路径、真实第三方 Agent、真人和真实站点证据必须按 [Browser Runtime Capabilities V1](browser-runtime-capabilities-v1.md) 分别记录；安装测试客户端不能冒充 `plugin_verified`。

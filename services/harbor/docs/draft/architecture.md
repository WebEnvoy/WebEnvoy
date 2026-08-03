# Harbor 架构

- Status: pending
- Owner: GH-62
- Linked issue: #61, #64
- Exit condition: promote to an accepted layout ADR or implementation docs when Harbor creates its first code/package layout; remove if that implementation chooses a different structure.

Reading judgment: this still has independent value as a compact reminder of the intended module boundaries, but Stage 2 accepted no package layout and this repository currently has no code tree. Do not use it as implementation basis.

Harbor 的架构目标是同时支持 WebEnvoy App 中的浏览器身份区域、未来独立 Desktop / Local Console、Server / Docker Runtime 形态，以及面向 Core / Agent 的自动化 API。

## 建议目录结构

```text
apps/
  desktop/
  console/
  server/

packages/
  profile-manager/
  identity-manager/
  fingerprint-config/
  browser-launcher/
  browser-drivers/
    chrome/
    cloakbrowser/
    camoufox/
    remote-cdp/
  session-manager/
  cdp-gateway/
  vnc-gateway/
  proxy-manager/
  cookie-manager/
  extension-manager/
  evidence-store/
  automation-api/
  schemas/

cli/
docs/
examples/
```

## 主要模块

| 模块 | 职责 |
|---|---|
| profile-manager | Profile 元数据、分组、标签、user_data_dir 和浏览器配置管理 |
| identity-manager | Execution Identity、站点账号、登录态、风险事件和资源约束管理 |
| browser-launcher | 浏览器启动、停止、端口分配、进程生命周期管理 |
| browser-drivers | 连接不同浏览器或远程 CDP provider |
| session-manager | Runtime Session 创建、状态检查、释放和恢复 |
| cdp-gateway | CDP 连接、代理、页面上下文和调试入口 |
| vnc-gateway | VNC / noVNC、viewer_url 和人工接管 |
| evidence-store | 执行证据、截图、DOM 摘要、网络摘要、日志和验证结果 |
| automation-api | 面向 Core、Agent、CLI、MCP 和外部自动化程序的 API |

## 边界原则

- Harbor 不理解具体站点业务；
- Harbor 不替 Core 选择业务策略；
- Harbor 可以暴露 Runtime 能力，但不直接承载 Lode 的站点能力资产；
- 浏览器内核通过 driver 抽象，不绑定单一供应商；
- 敏感状态默认保存在用户环境中。

# WebEnvoy 路线图

本文档描述实施顺序，不代表已经完成。

## P0：仓库与契约初始化

- 建立 `WebEnvoy`、`Harbor`、`Lode`、`research`、`.github` 五个基础仓库；
- 明确 Core、Harbor、Lode 的职责边界；
- 起草 Runtime Contract；
- 起草 Capability / Task / Site Package 的初版 Schema；
- 提供最小 API Server / SDK / CLI / MCP 调用骨架。

## P1：最小能力闭环

- 支持一个示例站点的站点知识和站点能力；
- API Server 能接收站点能力和任务封装调用；
- Core 能读取 Lode 能力定义；
- Core 能向 Harbor 获取 Runtime Session；
- Harbor 能启动浏览器、暴露 CDP，并记录基础 Evidence；
- 完成一次读动作和一次写动作的前后验证闭环。

## P2：能力复用与调试

- Console 支持查看 Profile、Session、运行记录和 Evidence；
- Lode 支持能力版本、失效标记和测试样例；
- Core 支持结构化失败原因和站点变化摘要；
- Harbor 支持 VNC / noVNC 和人工接管。

## P3：公共库与同步

- 公共能力审核与分发；
- 用户私有修改叠加；
- 可选云同步；
- Hosted Runtime 或远程执行能力。

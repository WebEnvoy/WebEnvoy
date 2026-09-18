# WebEnvoy monorepo 路线图投影

组织级路线以 [WebEnvoy ROADMAP](https://github.com/WebEnvoy/.github/blob/main/ROADMAP.md) 和 [canonical v1 规范](https://github.com/WebEnvoy/.github/blob/main/docs/product-architecture-v1.md) 为准。本页只说明本仓如何服务当前与下一批，不维护 Issue 状态。

## 当前批：S0 待接受

先审查 [S0 #561](https://github.com/WebEnvoy/WebEnvoy/issues/561) 的浏览器基础设施定位、App 冻结与 V1 范围修订。规范合并前，CLI、受管站点脚本、主动 Network 与受控视觉的新语义仍是规划目标，不表示当前接口已经支持。

- Provider 候选先通过 [ADR 0012](docs/adr/0012-runtime-capability-plane-and-plugin-first.md) 的 Qualification Gate；必须由 WebEnvoy 补浏览器核心语义时停止采用，不把候选缺口变成 Runtime 新职责。
- Obscura 仅保留 [#511](https://github.com/WebEnvoy/WebEnvoy/issues/511) 的历史结论，当前愿景内不采用且不再验证；通用 Provider 选择与新建默认由 [#516](https://github.com/WebEnvoy/WebEnvoy/issues/516) 独立交付。
- 此边界对齐已合并的 [canonical 修订 .github#21](https://github.com/WebEnvoy/.github/pull/21)；不在本仓复制第二份 canonical。

## 后续已登记 Backlog

- [S1 #562](https://github.com/WebEnvoy/WebEnvoy/issues/562)：无 App 的 CLI、上游集成与可信用户控制。
- [S2 #563](https://github.com/WebEnvoy/WebEnvoy/issues/563)／[S3 #564](https://github.com/WebEnvoy/WebEnvoy/issues/564)：统一站点 SKILL、确定性执行、导入、OpenCLI 转化与修复。
- [S4 #565](https://github.com/WebEnvoy/WebEnvoy/issues/565)／[S5 #566](https://github.com/WebEnvoy/WebEnvoy/issues/566)：主动 Network 与受控视觉合同。
- [S6 #567](https://github.com/WebEnvoy/WebEnvoy/issues/567)：长期环境与隐身质量标准。

这些 Issue 的建立不授权功能开发，也不改变现有 wire。W1—W3 保持 Backlog并只依赖其直接 Spec。

## 后续

第二网站的可执行站点 SKILL 与 OpenCLI 转化由 [#475](https://github.com/WebEnvoy/WebEnvoy/issues/475)／[#476](https://github.com/WebEnvoy/WebEnvoy/issues/476) 在对应合同接受后验证。Desktop App 专属产品化冻结；无 App 的监督、接管和恢复继续由 #473/#474/#477 承接。

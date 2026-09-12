# WebEnvoy monorepo 路线图投影

组织级路线以 [WebEnvoy ROADMAP](https://github.com/WebEnvoy/.github/blob/main/ROADMAP.md) 和 [canonical v1 规范](https://github.com/WebEnvoy/.github/blob/main/docs/product-architecture-v1.md) 为准。本页只说明本仓如何服务当前与下一批，不维护 Issue 状态。

## 当前批

按完整 Runtime 与 Plugin 主入口目标继续交付 [#497](https://github.com/WebEnvoy/WebEnvoy/issues/497) 和 [#474](https://github.com/WebEnvoy/WebEnvoy/issues/474)，并由 [#482](https://github.com/WebEnvoy/WebEnvoy/issues/482) 汇合 V1 验收。

- Provider 候选先通过 [ADR 0012](docs/adr/0012-runtime-capability-plane-and-plugin-first.md) 的 Qualification Gate；必须由 WebEnvoy 补浏览器核心语义时停止采用，不把候选缺口变成 Runtime 新职责。
- Obscura 仅保留 [#511](https://github.com/WebEnvoy/WebEnvoy/issues/511) 的历史结论，当前愿景内不采用且不再验证；通用 Provider 选择与新建默认由 [#516](https://github.com/WebEnvoy/WebEnvoy/issues/516) 独立交付。
- 此边界对齐已合并的 [canonical 修订 .github#21](https://github.com/WebEnvoy/.github/pull/21)；不在本仓复制第二份 canonical。

## 下一批

根据 #497／#474 的真实消费缺口继续创建可独立验收的 Work Item；不按 Harbor→Core→Plugin 分层串行，也不为每个底层协议 method 建票。

## 后续

第二网站的 SKILL 扩展成本由 [#476](https://github.com/WebEnvoy/WebEnvoy/issues/476) 在 Runtime 和 Plugin 检查点成立后验证；完整 App／Viewer 产品化保留原 V1 验收，不被 Plugin-first 取消。

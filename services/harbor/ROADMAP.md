# Harbor Runtime 路线图投影

## 当前批

- 以 [Runtime FR #497](https://github.com/WebEnvoy/WebEnvoy/issues/497) 的公共能力基线交付 Provider 已具备能力的有界适配、实际支持事实和恢复。
- 候选 Provider 先区分接口差异、可接受能力差异和核心浏览器能力缺失；只有前两类进入适配或受限支持。
- 需要 Harbor／Driver 实现、模拟或长期补偿浏览器核心语义时立即停止候选；Obscura 已按 [#511](https://github.com/WebEnvoy/WebEnvoy/issues/511) 结束，不再验证、等待或跟踪。

## 下一批

- [#516](https://github.com/WebEnvoy/WebEnvoy/issues/516) 通过 Harbor owner 事实交付用户新建默认与显式选择，不改既有 ProfileBinding；本治理修订不预建其字段、Grant 或 Plugin operation。
- [#471](https://github.com/WebEnvoy/WebEnvoy/issues/471) 继续承接 Provider／环境长期一致性；configured／effective／pending／drift、身份归属、控制权和恢复仍按实际缺口交付。

实时多实例画面、复杂迁移矩阵和 Provider 自动修复保持后续主题。新 Provider 研究不是当前等待项，以后需新的显式产品决定才能启动。

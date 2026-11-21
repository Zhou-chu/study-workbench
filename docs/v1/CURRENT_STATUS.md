# Notebook 当前状态入口

这是既有资料的导航，不是新的平行功能台账或验收通过声明。

- 当前公开工作候选：[draft PR #1](https://github.com/Zhou-chu/study-workbench/pull/1)，分支 `publish/notebook-sanitized-20261114`。按该 PR 精确 head SHA 查 CI，不能把上一提交的通过结果转用到新提交。保持 draft，不代表 main、生产或部署已更新。
- UI 共同规范：[根 UIdesign.md](../../UIdesign.md)；[兼容路径](../design/shared-ui.md)与其完整字节一致，由文档契约测试防止漂移。[Notebook DESIGN.md](../../DESIGN.md)保留产品特有流程与历史设计。整页/正文禁玻璃与允许受控浮层不可混淆。
- 功能与操作库存：[SPA_ROUTE_COVERAGE.md](SPA_ROUTE_COVERAGE.md)。`implemented` 是源码/合成证据，不等于浏览器、真实模型或运行环境已验收。
- 计划中的浏览器用例：[SPA_BROWSER_CASES.json](SPA_BROWSER_CASES.json)与[SPA_ACCEPTANCE.md](SPA_ACCEPTANCE.md)。planned/not_run/blocked 不得改称 verified，保存用例目录也不等于执行。
- 历史功能验收：[ACCEPTANCE.md](ACCEPTANCE.md)及其链接；历史进度：[PROGRESS.md](PROGRESS.md)。这些按各自日期和环境解释，不能当当前服务可用性、当前字体截图或严格单元覆盖证明。
- 质量口径：[测试分层](../quality/test-layer-policy.md)、[完整严格门](../quality/strict-unit-total-gate.md)及 `docs/quality/` 各冻结检查点。混合集成回归、已审单元子集、完整严格单元门、静态检查与 Sonar 分别核验；完整生产分母保留。

当前完整严格单元 >90% 和全量 Sonar 验收仍未闭合；静态类型问题与未拆分 mixed 文件仍有缺口。单模块100%、混合回归通过或文档补齐不能替代这些门槛。未经重新验证，历史运行/截图结果不代表当前部署；本页不授权部署、数据变更或加密迁移。

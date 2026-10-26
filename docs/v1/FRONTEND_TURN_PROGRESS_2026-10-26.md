# F1 前端操作身份进度：2026-10-26

按[分阶段计划](../superpowers/plans/2026-10-26-frontend-turn-ownership.md)实施。当前只完成 Task 1 基础边界，尚未完成用户界面的操作身份/恢复功能，不以本页替代浏览器验收。

## Task 1：上下文与最终请求发送保护

- 非敏感 context 只含 epoch、浏览器可见 API 目标/模式/协议与 ready 状态；实际目标变化或显式本地退出/本人撤销意图同步推进 epoch。普通认证恢复、同目标 readiness 变化不据此丢弃未来的未决 capture。
- 配置 reset 只暂停发送并推进配置请求 generation；迟到的旧请求不能覆盖或返回新配置之前的可用结果。
- 既有 Axios fetch adapter 的受约束请求，在异步 policy 解析后及最终 native fetch 前重新校验目标、上下文和认证状态。使用单一稳定 fetch gate，不为每次请求创建会被依赖缓存保留的闭包；内部非敏感 metadata 在 native fetch 前移除。
- 仅承认本地 WeakSet 标记的 RequestNotDispatchedError（及其被包装的本地 cause），不相信服务端同名文本/标志。
- 新参数暂时可选，旧 StudyWorkbench、JobsPanel 和 root layout 未改；后续 Task 2/3 才接入 registry、matcher、hook 与恢复界面。TurnRequest 不再包含阅读位置，dispatch_receipt 仍为 opaque unknown。
- 纯 browser-target 模块共享 URL 规范化，避免 config 与 transport 新增循环依赖。

独立审查发现并经两轮复审修复的同类缺口：受约束请求拒绝非默认 request/response transforms、validateStatus、函数 withXSRFToken/parseReviver，以及偏离已捕获平台默认值的 env 替换（包括 Request/Response/fetch）。普通请求保留既有自定义行为。真实安装的 Axios adapter 与合成 native fetch 证明这些回调不能改写目标或在已发送后伪造“未发送”；不宣称抵御任意脚本替换浏览器原生全局对象。

## 新鲜验证与范围

被测本地提交 `3abca4ae9a75c347636a6945153f173f993bc9d2`，tree `760f1dc49b9484e2d34f427b9ce20021cc6ffdd5`。

| 检查 | 结果 |
| --- | --- |
| 定向生命周期/config/真实 adapter/会话竞态 | 188 通过，7 文件 |
| 全前端单元测试 | 1,499 通过，95 文件 |
| artifact 单元测试 | 25 通过 |
| TypeScript | 通过 |
| lint | 0 错误，7 个既有警告，改动文件无新增警告 |

行为 RED 包括配置/退出时序与实际 fetch adapter 的目标变化窗口；使用合成 native fetch 而非真实网络。最初新模块尚未创建导致的加载失败仅是脚手架前置失败，不计作行为 RED。

本批未运行生产 build、浏览器、服务、数据库或提供方；最终集成后仍需新鲜构建和产物身份校验。上一个后端验证独立保留，不冒充本批重跑。未修改 main 或部署。

## 明确限制与下一步

exact-target 仅指浏览器可见的模式/API endpoint，不证明同 URL 背后的服务器未更换，不建立稳定的人类账户身份，也不固定服务端默认模型。root provider registry、同 key/body 恢复、保守完成证据和编辑器所有权尚待 Task 2/3。

决策：API context 参数先可选，令基础批次可独立编译和验收；代价是旧界面尚未使用此 guard，不能据此宣布 F1 重复提交风险已经消除。

决策：受约束请求只接受已捕获的默认平台环境和指定默认转换/状态验证回调，代价是这类内部调用不再支持任意自定义 Axios hook；普通请求不受此限制。

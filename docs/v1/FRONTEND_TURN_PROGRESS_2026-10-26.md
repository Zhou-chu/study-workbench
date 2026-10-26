# F1 前端操作身份进度：2026-10-26

按[分阶段计划](../superpowers/plans/2026-10-26-frontend-turn-ownership.md)实施。当前完成 Task 1 基础边界与 Task 2 核心/Provider，尚未完成用户界面的操作身份/恢复功能，不以本页替代浏览器验收。

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

exact-target 仅指浏览器可见的模式/API endpoint，不证明同 URL 背后的服务器未更换，不建立稳定的人类账户身份，也不固定服务端默认模型。此处为 Task 1 时的限制；Task 2 核心现已在下节记录，实际同 key/body 恢复界面与编辑器所有权仍待 Task 3。

决策：API context 参数先可选，令基础批次可独立编译和验收；代价是旧界面尚未使用此 guard，不能据此宣布 F1 重复提交风险已经消除。

决策：受约束请求只接受已捕获的默认平台环境和指定默认转换/状态验证回调，代价是这类内部调用不再支持任意自定义 Axios hook；普通请求不受此限制。


## Task 2：有界操作身份、匹配与根 Provider

- 每个 notebook 保留一个不可变请求，最多 8 槽与合计 1 MiB 请求 JSON 的 UTF-8 字节；不以 TTL/LRU 丢弃未知操作，不承诺整个 JavaScript 堆大小。没有网络、timer、凭据、答案正文、原始错误或 UI callbacks 存入 registry。
- 初次提交、显式重试、检查同步占用同一个 busy latch；operation/context/attempt 全匹配才接受回执。未知结果不会被后来未发送抹除；已知原任务 ID 后只检查，不把重复 POST 当 worker restart。
- 匹配只接收 workspace/history 数据；唯一真实父任务通过 key、session、notebook、完整规范化请求与已知 ID 后可绑定身份，即使尚无答案。只有可信成功父 result 与 canonical turn 一致才能 complete；缺答案不重新提交。
- 根 Provider 位于 I18n 内、ConnectionGuard 外。跨路由保留 capture；显式 epoch 失效/根卸载释放 registry 引用，迟到结果不能复活。普通 readiness/auth 恢复保留身份，新动作仍需 ready/authenticated。
- `reconcileTurn` 显式接收第四个已知 receipt 参数；pure POST projector 只返回安全枚举/ID。Google connection_id 仅是观察到的标签，不作账户连续性证明。

独立审查发现并修正了真实引用的 nullable metadata 兼容问题：后端普通引用 `independent_support:null` 原本被误拒绝，造成完成结果永久保留在 unknown。现按 boolean/null 类型接收，保持 reference_validity 原值与精确引用一致性，不把任何 flag 当作独立佐证证明。

最终 Task 2 源码 `edff3d2134185ea8cc254a1ae3edfcb3ae236408`，tree `44836ff0067f053ad04abd737f6419ec167ddb68`；定向 202 通过，全前端 1,701 单元 + 25 artifact 通过，类型/lint 通过（7 个既有警告）。独立复审关闭 P1；一处 nominal fixture 的 block_id 细节留待 Task 3 使用真实生产形状修正，不作为运行验收。

与关联读取修复组合后，后端 2,778 通过 / 128 跳过，前端及静态/OpenAPI 再次通过。仍未运行 build/浏览器；StudyWorkbench/hook/JobsPanel 的实际接入属于尚未完成的 Task 3，不能宣称当前按钮已具备整套恢复能力。

决策：将父任务身份绑定和答案完成分开，避免已找到真实任务却仍提供重复 POST；代价是尚无可读答案的任务继续保守等待。已知 receipt 独立传入 matcher，Task 3 必须明确传递。

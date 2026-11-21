# F1 前端操作身份进度：2026-10-26

## 最终源码与构建验收：2026-10-26 UTC

**F1 本轮实现、整项独立审查及修复复审、离线测试、生产构建与产物关联校验均已完成。不是上线或实际浏览器验收。** [机器可读验证记录](FRONTEND_TURN_VERIFICATION_2026-10-26.json)保存精确身份和边界。

受测源码 `152250609b142b12aa86dc0e7f1f2cc2436ef0f5`，tree `53ade43f81b08759ff445434023c030b92409981`。随后只更新仓库文档/验证记录，不改变构建输入。

- Ask/Outline 已接入不可变原请求、同步 latch、原 key 显式恢复和只读结果检查；普通认证恢复、路由返回或定时器不自动重新 POST。
- 完成判定需真实匹配父任务、result 和 canonical answer；失败/取消/未知标签不解锁。隐藏 Studio 中关联任务也不会经 generic job GET 意外派发。
- 新输入和新笔记保留自己的所有权；迟到 ACK/提纲不得覆盖。已确认答案会刷新普通 workspace 历史，覆盖三种离开/返回时序。
- 最终整体审查另复现 UUID 能力缺失/抛错导致整页崩溃。现显式保留非 owner 状态、禁用并在 handler 拦截新 Ask/Outline，历史/笔记阅读编辑保存仍可用，旧结果不能取得新编辑器所有权；没有不安全随机或共用 ID 回退。原审查探针两项由红转绿。能力恢复后需真正 remount 才重新准入。
- 全范围 EOF whitespace 问题已关闭，整段 committed diff 检查通过。独立 scoped 复审确认原两项均解决，没有新 scoped finding。

| 新鲜检查 | 结果 |
| --- | --- |
| 前端定向回归 | 407 通过 / 8 文件 |
| 完整前端单元测试 | 1,739 通过 / 99 文件；根任务独立重跑通过 |
| synthetic artifact 工具测试 | 25 通过，不代替真实 build |
| TypeScript / lint | 通过；0 错误、7 个继承 lint 警告 |
| 整合后端离线测试 | 2,778 通过 / 128 跳过 / 2 警告 |
| Ruff / format / mypy / OpenAPI | 通过；318 个 Python 源文件 |
| 正式生产构建 | `npm run build` 通过，使用已有依赖、本地字体、净化环境；未安装依赖或请求远端字体 |
| 独立产物复核 | `build-artifact.mjs --verify` 通过，与构建输出身份完全一致 |

后端新鲜检查发生于最后四文件前端修复之前；后端/契约源码未变。不把继承 warning 或跳过项算作已解决，不将当前测试替身/合成组件检查冒充真实数据库、worker 或浏览器。

### 审查裁定与代价

1. **严格受约束传输，而非重建 HTTP 栈：** 保留默认平台环境与指定回调，拒绝会改写最终请求或伪造未发送证明的自定义 hook。代价是受约束内部调用不支持任意 Axios hook；普通请求保持兼容。
2. **父任务绑定与答案完成分离：** 确认真实父身份后只检查，不重复 POST。代价是没有可信答案的未知/失败工作可能长期占用有界槽；没有自动 worker restart 或 exactly-once 承诺。
3. **精确 workspace active refetch：** 当前 token/context 确认完成后刷新历史。代价是有观察者时增加一次普通读取；不调用 generic job GET，不自动应用旧提纲。
4. **UUID 故障安全降级：** 保留笔记/阅读，拒绝新 turn；代价是该挂载期间不能新提问/生成提纲，恢复能力后需 remount。没有降低请求 ID 安全性。
5. **防御性 notebook tagging 暂缓：** hook 若未来同实例直接切换 notebookId，应补标记与 prop-switch 回归。当前唯一产品路由已 keyed remount，审查确认此路径不可达；不是已知当前跨 notebook 泄漏。
6. **真实运行范围未扩大：** 本轮未启动浏览器、数据库、API/worker、提供方或 CI，未重试被拒绝的 netlink 操作，未修改 main、部署或原用户数据。实际浏览器/运行期验收仍是单独门槛。

恢复仅在当前 document 内存，reload/crash/关 tab/sign-out/根 Provider 替换会丢失 capture，但不证明远端未执行。8 槽 / 1 MiB 请求 JSON 限制不等于 JavaScript 总堆限制。浏览器 endpoint 相等不证明同 URL 后端、人类账户或 Google 账户连续性，服务端默认模型也未固定。现有能力未因此升级为自动研究、OCR、PPT 结构化解析或全库语义综合。

### 实际构建产物身份

本轮构建标识 `4876fd5d-8638-424f-87f8-12428a4fa267`。

- authored source SHA-256: `ba1db0c0a7783be853cde9f79bd88df42e79dcb8e16347b7af051496a4f62853`
- served artifact SHA-256: `d35d66d8395d6d8cf5799530535c0a0eeab8271ea3dcaa1619fd45b1e76be3f2`
- manifest SHA-256: `adfc375c6d648cbf68a1fa2177cdfa46407caa7a8b083d39e6c69988822300a8`

这是源文件/产物关联和新鲜度证明，不是可复现构建、依赖供应链认证或运行验收。源码与脱敏记录按既定私有分支同步；临时构建产物不是持久发布库，源码备份也不是用户笔记/数据库备份。

## 分阶段历史（以下“最终审查/构建待执行”为当时状态）

按[分阶段计划](../superpowers/plans/2026-10-26-frontend-turn-ownership.md)实施。**当前 Tasks 1–3 已实现并分别通过独立任务审查，包括 Ask/Outline、恢复 hook 和真实 JobsPanel 的接入。** Task 3 的完成读取/缓存新鲜度 P2 已修复并通过独立复审。整项功能的最终独立审查正在另行进行；生产 build 与真实产物关联尚待执行。此为分阶段源码检查点，不是浏览器、运行期或部署验收。

## 当前检查点：Task 3 集成与完成历史新鲜度

受测源码提交 `1f7bb9518fd6e4f65af05b0e550d5de67ffe3ffc`，tree `afbfba281185d890e30555313651cfc6984d069f`；本页及总进度随后仅作脱敏文档更新，不改变应用源码。

- Ask/Outline 同步占用 registry 的同一 notebook 槽和 busy latch；显式恢复发送原 session/key/body/target，不自动生成新操作。挂载、认证恢复、focus、online、timer 不发 POST；已知父任务只允许读取检查。未决/失败/取消标签本身不授权释放。
- Check 强制读取捕获目标的 workspace 与 canonical history，并传入已知 receipt；不以普通缓存或 generic job GET 证明完成。真实 JobsPanel（包括 CSS 隐藏的 Studio）按窄 turn fence 禁用关联/身份不确定任务的 generic GET 和轮询；无关任务行为不变。
- 原挂载的 question generation 与 editor session/revision 控制 UI 所有权；迟到 ACK/完成不能覆盖新挂载、新输入或新笔记。保留原引用/scope，现有显式 Save Answer 与笔记保存/冲突语义不变。
- 独立审查发现的 P2：已确认答案可能只存在于短暂 Check 结果，普通 workspace 缓存却在生产五分钟 staleTime 下仍 fresh 且为空。最终修复在再次确认当前 token/context 后、mounted-only guard 前，仅对捕获 notebook 的精确 workspace key 作 active-refetch invalidation；完成证明仍来自新鲜标记读取，不来自该普通缓存。
- 回归覆盖全部三种顺序：完成时视图不在场；原视图在场完成后重新挂载；替代视图已挂载、旧 Check 随后完成。均断言实际答案与可用 Save Answer、恰好一次 POST、一次 canonical-history Check、零 generic job GET；替代视图的新草稿不被覆盖。隐私 epoch 或目标已退役的结果不触发 invalidation 或普通 workspace refresh。
- 两轮行为 RED 先证明缺陷（包括被否决的 none-only invalidation 无法刷新已挂载替代视图），最终五条生命周期回归全绿。独立复审另以原 absent-view 探针确认答案/Save Answer；P2 关闭，无待修 Task 3 必选项。

| 最终 Task 3 源码检查 | 结果 |
| --- | --- |
| 定向 integration/core/provider/locales | 401 通过，8 文件 |
| 全前端单元测试 | 1,733 通过，99 文件 |
| synthetic artifact identity 单元测试 | 25 通过（不等于真实构建产物验收） |
| TypeScript | 通过，无诊断 |
| lint | 0 错误，7 个继承警告 |
| 独立任务审查 | Tasks 1–3 通过；Task 3 修复复审关闭 P2 |
| 整项功能最终独立审查 | 正在独立进行，尚无最终结论 |
| 生产 build / 真实产物关联 | 待执行 |

本次文档/发布不重跑测试或构建；以上来自该冻结源码的新鲜任务证据。关联读取组合后的后端 2,778 通过 / 128 跳过是 Task 2 阶段的独立既有证据，不冒充 Task 3 后端重跑。没有新的浏览器、服务、数据库、worker、提供方、CI 或部署验收，不修改 main 或上游仓库。

## 当前边界与剩余门槛

- exact-target 仅约束浏览器可见模式/API endpoint，不证明同 URL 背后服务器未更换，不建立稳定人类账户身份，也不固定服务端默认模型。Google `connection_id: notebooklm` 只是观察到的 provider label，不证明 Google 账户连续性；原观察目标恢复后也只重新允许显式同 key POST，不自动发送。
- 恢复仅保留于当前 document 内存。reload、crash、关 tab、sign-out 或根 Provider 替换会丢失本地 capture；丢失不证明或停止远端工作。没有持久 journal、跨 tab 恢复或 TTL 驱逐；释放引用不是安全擦除，也不能撤回已发送字节。不宣称 exactly-once、可靠 dispatch 或完整重复执行风险消除。
- 唯一保留的轻微 P3 是 hook 在**同一实例**直接切换 notebookId 时的防御性 read tagging；实际唯一产品路由以 notebookId 作 key、强制重新挂载，因此本检查点不受该路径阻塞。若未来复用同一实例，须补 notebook 标记和 prop-switch 回归。
- 待整项最终独立审查、生产 build 与真实产物身份关联完成后另记结论；这些离线门槛仍不替代浏览器/运行期/部署验收。

## 历史阶段记录（以下限制与测试数不是当前状态）

下方保留 Tasks 1/2 当时的证据与决策。诸如“旧界面尚未接入”“Task 3 待实现”“未具备恢复能力”均描述当时阶段，已由上方 Task 3 当前状态取代。

## 历史 Task 1：上下文与最终请求发送保护

- 非敏感 context 只含 epoch、浏览器可见 API 目标/模式/协议与 ready 状态；实际目标变化或显式本地退出/本人撤销意图同步推进 epoch。普通认证恢复、同目标 readiness 变化不据此丢弃未来的未决 capture。
- 配置 reset 只暂停发送并推进配置请求 generation；迟到的旧请求不能覆盖或返回新配置之前的可用结果。
- 既有 Axios fetch adapter 的受约束请求，在异步 policy 解析后及最终 native fetch 前重新校验目标、上下文和认证状态。使用单一稳定 fetch gate，不为每次请求创建会被依赖缓存保留的闭包；内部非敏感 metadata 在 native fetch 前移除。
- 仅承认本地 WeakSet 标记的 RequestNotDispatchedError（及其被包装的本地 cause），不相信服务端同名文本/标志。
- 新参数暂时可选，旧 StudyWorkbench、JobsPanel 和 root layout 未改；后续 Task 2/3 才接入 registry、matcher、hook 与恢复界面。TurnRequest 不再包含阅读位置，dispatch_receipt 仍为 opaque unknown。
- 纯 browser-target 模块共享 URL 规范化，避免 config 与 transport 新增循环依赖。

独立审查发现并经两轮复审修复的同类缺口：受约束请求拒绝非默认 request/response transforms、validateStatus、函数 withXSRFToken/parseReviver，以及偏离已捕获平台默认值的 env 替换（包括 Request/Response/fetch）。普通请求保留既有自定义行为。真实安装的 Axios adapter 与合成 native fetch 证明这些回调不能改写目标或在已发送后伪造“未发送”；不宣称抵御任意脚本替换浏览器原生全局对象。

## 历史 Task 1 验证与范围

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

## 历史 Task 1 限制与当时下一步

exact-target 仅指浏览器可见的模式/API endpoint，不证明同 URL 背后的服务器未更换，不建立稳定的人类账户身份，也不固定服务端默认模型。此处为 Task 1 时的限制；Task 2 核心现已在下节记录，实际同 key/body 恢复界面与编辑器所有权仍待 Task 3。

决策：API context 参数先可选，令基础批次可独立编译和验收；代价是旧界面尚未使用此 guard，不能据此宣布 F1 重复提交风险已经消除。

决策：受约束请求只接受已捕获的默认平台环境和指定默认转换/状态验证回调，代价是这类内部调用不再支持任意自定义 Axios hook；普通请求不受此限制。


## 历史 Task 2：有界操作身份、匹配与根 Provider

- 每个 notebook 保留一个不可变请求，最多 8 槽与合计 1 MiB 请求 JSON 的 UTF-8 字节；不以 TTL/LRU 丢弃未知操作，不承诺整个 JavaScript 堆大小。没有网络、timer、凭据、答案正文、原始错误或 UI callbacks 存入 registry。
- 初次提交、显式重试、检查同步占用同一个 busy latch；operation/context/attempt 全匹配才接受回执。未知结果不会被后来未发送抹除；已知原任务 ID 后只检查，不把重复 POST 当 worker restart。
- 匹配只接收 workspace/history 数据；唯一真实父任务通过 key、session、notebook、完整规范化请求与已知 ID 后可绑定身份，即使尚无答案。只有可信成功父 result 与 canonical turn 一致才能 complete；缺答案不重新提交。
- 根 Provider 位于 I18n 内、ConnectionGuard 外。跨路由保留 capture；显式 epoch 失效/根卸载释放 registry 引用，迟到结果不能复活。普通 readiness/auth 恢复保留身份，新动作仍需 ready/authenticated。
- `reconcileTurn` 显式接收第四个已知 receipt 参数；pure POST projector 只返回安全枚举/ID。Google connection_id 仅是观察到的标签，不作账户连续性证明。

独立审查发现并修正了真实引用的 nullable metadata 兼容问题：后端普通引用 `independent_support:null` 原本被误拒绝，造成完成结果永久保留在 unknown。现按 boolean/null 类型接收，保持 reference_validity 原值与精确引用一致性，不把任何 flag 当作独立佐证证明。

最终 Task 2 源码 `edff3d2134185ea8cc254a1ae3edfcb3ae236408`，tree `44836ff0067f053ad04abd737f6419ec167ddb68`；定向 202 通过，全前端 1,701 单元 + 25 artifact 通过，类型/lint 通过（7 个既有警告）。独立复审关闭 P1；一处 nominal fixture 的 block_id 细节留待 Task 3 使用真实生产形状修正，不作为运行验收。

与关联读取修复组合后，后端 2,778 通过 / 128 跳过，前端及静态/OpenAPI 再次通过。仍未运行 build/浏览器；StudyWorkbench/hook/JobsPanel 的实际接入属于尚未完成的 Task 3，不能宣称当前按钮已具备整套恢复能力。

决策：将父任务身份绑定和答案完成分开，避免已找到真实任务却仍提供重复 POST；代价是尚无可读答案的任务继续保守等待。已知 receipt 独立传入 matcher，Task 3 必须明确传递。

# 2026-10-24 架构与 code smell 审查

## 结论与证据边界

**保留模块化单体，先修边界语义，不做微服务、重写或全仓目录搬迁。** 目前最值得修的是异常公开边界、任务状态竞争、客户端对宽松响应的错误假设，以及开发入口与安全约束不一致；文件大、测试多、目录不完全统一，本身不构成缺陷。

基线：`e8c5c5726741a2568615fe0d51f40c568724b61c`，tree `07eaf90fff51b3851ef57e051092cde93d7d86d7`。本报告合并后端、Web 客户端和仓库边界三份独立源码审查，并核对关键调用点。下文行号均针对该基线；测试名称是覆盖依据或待新增验收，**不是本轮通过记录**。未运行应用、测试、构建、浏览器、数据库或提供方，也未安装依赖。旧验收不充当当前证据。

用户已要求自行审查、修订计划后继续推进，不再等待逐项审批。以下具体架构选择是**执行方的提案与取舍**，不表述为用户逐条同意。执行清单见[分批修复计划](../superpowers/plans/2026-10-24-architecture-boundary-repair.md)。本检查点只改文档，源码发布、主分支合并、部署、数据备份是不同事项。

## 合理的现状：应保留什么

| 边界 | 当前合理选择 | 不应顺手改坏的约束 |
|---|---|---|
| 应用组成 | `frontend/` 独立 Node 锁文件；`api/`、`open_notebook/`、`commands/` 共用 Python 依赖图；API 与 worker 分进程 | 没有证据要求微服务或第二套依赖管理；启动 API 会迁移数据库，worker 会消费任务 |
| 后端职责 | router 直接调用 domain/repository 是 `open_notebook/AGENTS.md` 明确惯例；共享/长流程放 service；已有 store/bridge 注入点 | 不强加所有请求经过空壳 service 的机械分层；保留异步、参数绑定、事务/CAS 与任务所有权 |
| 长任务与一致性 | 持久任务、显式提交不确定回执、笔记原生 revision、源处理 claim/token/owner、取消优先级 | 不把 unknown 当作安全重试；不把未确认提交当作未提交；不改 hash/ID 规则 |
| Web 状态 | 一个 `apiClient`、共享浏览器传输/认证恢复；Query 管服务器数据，少量 store 管认证/偏好 | 不建万能全局 store；不把 BFF 凭据交给组件；不自动重放认证恢复前的写请求 |
| 兼容性与证据 | `contracts/v1/` 明示契约边界；响应保留扩展、未知枚举、null/缺字段；证据读取有请求内副本和有界批处理 | transport 不是持久化 schema；不收紧服务端序列化来掩盖前端假设；读取上下文不得跨请求/用于写操作 |
| 运维边界 | 默认 `make` 只显示帮助；旧生命周期/发布入口 fail closed；根 Compose 无服务；Docker 候选与验收分开 | 不恢复隐式部署/发布，不把静态 Docker 断言当运行验收 |

依据包括 `AGENTS.md`、`open_notebook/AGENTS.md`、`frontend/AGENTS.md`、`api/personal_contracts.py:53–178`、`api/evidence_reads.py:1–44`、`api/personal_store.py:50–103`、`open_notebook/database/source_attempt_repository.py:1–90`。

## 已确认源码缺陷与优先级

P1 表示隐私/任务正确性优先；P2 表示健壮性或运维误导。它们是修复排序，不是已发生生产事故的声明。

| 编号 | 优先级 / 具体问题 | 源码证据与影响 | 首批处理 |
|---|---|---|---|
| B1 | P1：DB 异常文本进入公开响应 | [`open_notebook/domain/notebook.py:54–79`](../../open_notebook/domain/notebook.py#L54-L79)、[`open_notebook/domain/base.py:100–103`](../../open_notebook/domain/base.py#L100-L103) 把底层异常包装为 `DatabaseOperationError`；[`api/main.py:463–468`](../../api/main.py#L463-L468) 又输出 `str(exc)`。workspace / models 调用链可达。证明任意错误文本可流出，不证明某个真实秘密已泄漏 | 专用固定 500 handler；不替换所有 typed error，不损坏 409/503 等结构化回执 |
| B2 | P1：底层日志绕过外层脱敏 | [`open_notebook/database/repository.py:126–274`](../../open_notebook/database/repository.py#L126-L274)、[`open_notebook/domain/base.py:96–237`](../../open_notebook/domain/base.py#L96-L237)、[`open_notebook/domain/notebook.py:54–505`](../../open_notebook/domain/notebook.py#L54-L505) 输出原始错误/traceback | 只在这三个共享边界改为固定事件、受限异常类型与现有等级；不输出参数、内容或 traceback |
| B3 | P1：入队 ACK 失败覆盖更新后的任务 | [`api/personal_service.py:80–120`](../../api/personal_service.py#L80-L120) 成功分支锁内重读，失败分支却用旧 queued 快照写回；`PersonalStore.put` 是 `UPSERT ... CONTENT`。worker/取消先写的新结果、attempts、不确定性或取消字段可能丢失 | 失败分支也在项目锁内读最新记录；已推进状态直接保留，缺记录不复活 |
| F1 | P1：Ask/Outline 的未知 ACK 后新 key 风险 | [`StudyWorkbench.tsx:137–151`](../../frontend/src/components/workbench/StudyWorkbench.tsx#L137-L151) 每次生成随机 key，仅成功后保留 receipt；后端按 session+key 去重（[`api/personal_service.py:76–102`](../../api/personal_service.py#L76-L102)）。手动重试可产生第二个 job。传输层可能先暂停认证恢复，但恢复后仍无原始操作身份；不是自动重放的证据 | **明确留待下一批安全修复**，不混入本次只读投影；风险优先级没有降低 |
| F2 | P1/P2：前端假定比服务端保证更多 | [`tests/test_v1_workspace_response_contracts.py:17–115`](../../tests/test_v1_workspace_response_contracts.py#L17-L115) 明确保留 `remote_source_ids:null`、opaque version。[`StudyWorkbench.tsx:53–302`](../../frontend/src/components/workbench/StudyWorkbench.tsx#L53-L302) 的 merge/length/排序、[`WorkbenchSourcesList.tsx:27`](../../frontend/src/components/workbench/WorkbenchSourcesList.tsx#L27) 的 slice 可失败；[`SourceProvenance.tsx:11–14`](../../frontend/src/components/evidence/SourceProvenance.tsx#L11-L14) 把非 web 一律当 derived | 小型容错读投影；未知/不完整选择不授权动作；未知 provenance 不冒充人类派生证据 |
| R1 | P1/P2：检查入口绕过隔离测试协议 | [`Makefile:143–147`](../../Makefile#L143-L147) 使用裸 `uv run pytest`，绕过 [`scripts/offline_pytest.py`](../../scripts/offline_pytest.py) 的环境白名单、临时目录和网络 tripwire；`npx` 可在工具缺失时解析外部依赖，也没有完整静态检查 | 显式已准备解释器/cache，仅委托离线 runner；准确列出未执行 gate |
| R2 | P2：缓存清理越界 | [`Makefile:133–142`](../../Makefile#L133-L142) 遍历整个树并删 `*.pyd`；后者是原生扩展，不是缓存，也未排除依赖/运行目录 | 首批直接 fail closed；不执行旧清理、不实现新递归删除器 |
| R3 | P2：当前文档入口仍指向失效操作 | [`README.dev.md:5–11`](../../README.dev.md#L5-L11)、[`development-setup.md:9–71`](../7-DEVELOPMENT/development-setup.md#L9-L71)、[`.github/RELEASE_PROCESS.md:69–147`](../../.github/RELEASE_PROCESS.md#L69-L147) 仍宣传禁用命令/旧默认凭据/发布流程；Node 要求和 CI 表述也漂移 | 入口改指 V1 runbook，旧页顶端明确历史/非操作指南，不改写历史验收 |

源码链接指向仓库内具体文件；行号是基线定位，不随后续修复自动更新。

### B3 必须保留的限制

**队列 dispatch ACK 不确定，不等于提供方提交不确定。** `run_turn` 将 `submission_unknown` 当终态；机械替换 queued 为该状态反而可能阻断已被队列接收的工作。首批只消除“旧快照覆盖新状态”，不实现 outbox、不承诺跨进程 exactly-once。

若重读后仍是完全未推进的初始 queued 快照，现有 `WORKER_UNAVAILABLE`/failed 路径需要单独特征化并明确保留其限制：入队异常不证明队列回滚，已接受但尚未启动的工作仍可能受影响。修改这项语义必须另行扩展方案与测试，不能偷偷混进 race 修复。

## 明确的后续债务，不冒充本轮已解决

1. **F1 操作身份与手动恢复**：保存不可变 key/payload/目标及同步 admission guard；覆盖 Ask 与 Outline、丢 ACK 后再次点击、同 tick 连点、编辑中作用域变更、认证恢复不重放、late outline 与未来状态。恢复是否允许显式同 key POST，需先证明服务端幂等路径；不引入隐式新 key 或浏览器持久化。
2. **提供方错误分类器安全（P1/P2）**：[`open_notebook/utils/error_classifier.py:116–123`](../../open_notebook/utils/error_classifier.py#L116-L123) 仍传出/记录部分原始 SDK 文本；截断不是脱敏。B1/B2 完成后也不得声称全系统错误都安全。
3. **测试替身契约（P2）**：`tests/test_v1_personal_service.py:8–35` 的 `create_only` 被忽略、锁为空；`tests/test_v1_evidence_ingest.py:18–57` 却执行真实内存锁/重复创建检查；测试模块又充当共享 helper。先契约测试再抽 `tests/support`，故障替身保持显式。`frontend/src/test/setup.ts:41–48` 的全局 useAuth mock 也落后于真实接口。不能据此宣称所有测试无效。
4. **依赖方向与编排（P2）**：[`open_notebook/database/source_snapshot_repository.py:7–13`](../../open_notebook/database/source_snapshot_repository.py#L7-L13) 向上依赖 API identity/errors，[`open_notebook/graphs/grounded_chat.py:12`](../../open_notebook/graphs/grounded_chat.py#L12) 向上依赖 `EvidenceService`；worker 导入 API-owned application services。后续先移动纯 identity/非 HTTP error 并保留兼容导出，再加窄 protocol/导入边界测试；不是已证实 import crash。不要盲目合并不同摘要算法。
5. **Web 职责与缓存（P2）**：`StudyWorkbench` 密集承担提交、轮询、阅读器、笔记冲突；先有行为测试再逐个抽 turn/editor/presentation。classic/workbench note/source 缓存失效范围不一致（`frontend/src/lib/hooks/use-notes.ts:64`、`frontend/src/lib/api/query-client.ts:31`），另加 seeded QueryClient 测试；不动编辑器草稿。旧 `docs/7-DEVELOPMENT/frontend.md` 的跳转/清 token 描述也应单独纠正。
6. **部署/工具证明（P3）**：Docker 最终 serving artifact manifest、镜像 digest 与真实 readiness/restart 仍待专门验收；Next 与 ESLint preset 主版本不同仅是兼容性检查项，非已证实漏洞。旧 Compose override 指南另做有界清理。`.worktreeinclude` 的环境文件传播声明需要核实消费者，不能推断已经复制秘密。

本次审查仅覆盖当前 Web/API 树；不对另行维护的原生客户端分支、签名包或设备验收作结论。

## 方案比较与执行门槛

- **选择：四个可独立审查的小边界补丁。** 保留 wire/API 状态、存储语义与历史兼容；每批有先红后绿测试、新鲜证据和独立提交。共享 `CHANGELOG.md`/进展由集成者顺序整理。
- **暂不选：先抽通用 job/service/read-model 大框架。** 会把行为修复与职责移动混在一起，增加回归归因难度；只有本地纯读投影是本轮必要新边界。
- **不选：微服务、重写、全仓改目录。** 当前证据不支持其成本，也不能直接修复上述错误语义。

先发布审查/计划文档检查点，再按计划落地。每批只据最终候选的实际命令记录 PASS/FAIL/BLOCKED/NOT RUN、skip、commit/tree 与受测源码；缺少环境不安装、不替代为旧结果。任何云端源码检查点都需核对目标分支与完整提交/tree；**推送成功不等于 CI、运行验收、部署或用户数据备份成功**。

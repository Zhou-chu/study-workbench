# Architecture Boundary Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用四个独立补丁修复 DB 错误公开/日志边界、个人任务 ACK 竞争、Web 宽松响应读取和开发入口安全性，不改变产品架构。

**Architecture:** 保留模块化单体、现有 API/worker/store 边界与 Query 状态归属。先加回归测试，再做最小变更；仅新增纯日志元数据 helper 和 Web 读投影，不做微服务、通用任务框架或目录迁移。这是执行方提出的方案，不是用户对具体实现逐项背书。

**Tech Stack:** Python `>=3.11,<3.13`、FastAPI/Pydantic、SurrealDB；Next.js/React/TypeScript/TanStack Query、Vitest；GNU Make。Node 遵循现有 `frontend/package.json`：`>=22.13.0 || >=24`；不更改锁文件或安装依赖。

**Spec:** [架构与 code smell 审查](../../v1/ARCHITECTURE_REVIEW_2026-10-24.md)，尤其 B1–B3、F2、R1–R3 及明确排除项。

## Global Constraints

- 基线 `e8c5c5726741a2568615fe0d51f40c568724b61c` / tree `07eaf90fff51b3851ef57e051092cde93d7d86d7`；执行在新隔离 worktree，读根及组件 `AGENTS.md`。不复用旧源码/结果作新验收。
- 不启动 API/worker/DB/浏览器，不调用模型/Google/网络，不读用户私有数据，不安装依赖，不合并 main、不部署。缺依赖/缓存则精确记录 BLOCKED；不切换路径绕过既有权限限制。
- 保留 typed status、unknown 回执、`retry_safe:false`、取消优先级、同 key 幂等、hash/ID、所有权/CAS、证据身份和归属检查；不自动重试写操作。
- 保留 unknown/opaque/null/缺字段的服务端兼容契约；纯读取不得 PATCH、不得重写历史或改变认证凭据托管。
- 日志不得包含原始错误/原因文本、repr/args、traceback、查询/参数、模型内容、URL 或用户控制 ID/标题；日志级别与异常传播/重试语义不变。
- 所有 npm 命令显式设置 `NPM_CONFIG_OFFLINE=true NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_AUDIT=false NPM_CONFIG_FUND=false NEXT_TELEMETRY_DISABLED=1`，不安装依赖。若另行执行前端构建，只用已准备的严格离线 artifact 流程并核验产物身份，不启动 browser/runtime。
- 新 UI 文案走现有 i18n 全语言形状；优先复用 `workbench.unavailable` 等现有键；不改设计 token/布局。
- 每个用户可见变更在唯一的 `CHANGELOG.md` Unreleased 对应类别追加条目；不重复类别。若代码实施确立新结构决策，随该批添加 `docs/7-DEVELOPMENT/decisions/ADR-0XX-<slug>.md`，不抢占最终编号。
- 四批独立提交/审查；共享文档由集成者串行合并。当前文档 checkpoint 不含应用修复、测试通过或远端已发布的声明。

## Review Focus

1. 底层 DB/模型校验错误带合成敏感哨兵：响应与 DEBUG 到 CRITICAL 日志均不能出现；任务 1 覆盖真实 wrapper。
2. worker/cancel 在 enqueue 报错前或等待锁期间推进：最新持久记录必须原样保留，缺记录不能 UPSERT 复活；任务 2 覆盖事件控制交错。
3. queued ACK 丢失与 provider unknown 不能混淆：任务 2 固定无进展分支的现有行为/限制，不宣称可靠队列恢复。
4. null/非数组选源、缺日期/ID、future provenance：任务 3 安全展示、不猜身份/最新版、不自动写回，也不默默扩大作用域。
5. 环境未准备或恶意清理树：任务 4 只对复制 Makefile + 记录 stub 执行，拒绝安装/服务/删除；成功输出不冒充全仓通过。

## 执行与证据约定

以下命令中的 `PYTHON` 和 `TOKEN_CACHE` 必须由集成者指向**已准备**的解释器和已核验 cache；值只进入本地执行记录，不提交机器路径。统一后端命令：

```sh
"$PYTHON" scripts/offline_pytest.py --tiktoken-cache "$TOKEN_CACHE" -- <本批测试路径> -q
```

runner 已包含环境白名单、临时数据目录、源码定位与 Python 网络 tripwire；它**不是 OS 防火墙**。不得改为裸 pytest/`uv run`。每批记录新鲜 red → green、最终源码 commit/tree、命令、退出码和范围。既有测试引用不等于重跑；本计划未执行任何应用验收。

---

### Task 1: DB 公开错误与有界日志（B1/B2）

**Files:**
- Modify: `api/main.py`（异常 imports 与 424–468 附近 handler）。
- Create: `open_notebook/utils/boundary_logging.py`（仅固定元数据，不依赖 API）。
- Modify: `open_notebook/database/repository.py:126–152,228–274`、`open_notebook/domain/base.py:96–237`、`open_notebook/domain/notebook.py:54–79,386–389,466–505` 的相关日志点。
- Create: `tests/test_database_error_boundary.py`、`tests/test_boundary_logging.py`。
- Regression: `tests/test_error_message_sanitization.py`、`tests/test_typed_exceptions_reach_handlers.py`、`tests/test_domain.py`、`tests/test_repository_config.py`、`tests/test_repository_insert.py`、`tests/test_v1_source_snapshot_routes.py`、`tests/test_async_command_submission.py`。
- Modify: `CHANGELOG.md`（Security/Fixed 现有类别，按实际变更选择）。

**Interfaces:**
- Consume: `DatabaseOperationError` 及其子类、既有 `_cors_headers(request)`；保持 `Notebook.get_sources()`、`ObjectModel.get_all()` 等签名。
- Produce: `async database_operation_error_handler(request: Request, exc: DatabaseOperationError)` 返回 `JSONResponse(status_code=500, content={"detail":"Database operation failed"}, headers=_cors_headers(request))`。
- Produce: `log_boundary_failure(operation: str, exc: BaseException, *, level: str = "ERROR") -> None`。operation/level 必须来自模块内静态 allowlist，非法值降为固定 unknown/ERROR；类型名限制为最多 80 个 ASCII 标识符字符。事件固定，不附加 exception/stack 信息。

- [ ] **1. 写失败测试。** `test_workspace_db_wrapper_has_fixed_public_detail` 经真实 `Notebook.get_sources` 包装，mock 最底层 `repo_query` 抛带合成 host/token/path/document 哨兵的异常；不 mock 掉被测 wrapper。同样覆盖 `Model.get_all`、直接 DB error 与 `SnapshotCommitRejected` 子类。使用无 lifespan 的 ASGI app/handler，不启动迁移。
- [ ] **2. 写日志矩阵并观察 red。** `test_boundary_logs_exclude_exception_payload` 参数化 repo query/create/delete/insert、domain get/get_all/save/delete/relate、notebook sources/notes/insights/status/progress；捕获所有等级及异常 cause。断言哨兵、用户 ID、验证输入与 traceback 均缺席，固定事件/类型/等级存在。`repo_query` 的现有 RuntimeError DEBUG 和 insert 冲突 DEBUG 不变；不要把所有 RuntimeError 重分为同一重试类型。以统一离线命令跑两个新文件，失败必须命中待修行为而非环境问题。
- [ ] **3. 最小实现。** 注册专用 DB handler，不改兜底 `OpenNotebookError` 消息、不改其他专用 handler。三个共享模块的错误日志换为 helper；相关 DEBUG ID 日志也改固定事件，避免同一失败路径先泄露 ID。保留/补全 `raise ... from exc`，不改变异常类型、重复跳过条件、事务重试、连接关闭、NotFound/InvalidInput 分支与现有返回值。
- [ ] **4. Green 与兼容检查。** 跑上述新文件及 Regression 文件。增加/保留断言：404/400/401/415/422/429/502/501 原有 typed 映射；笔记 409/428；队列未知 409（`COMMAND_SUBMISSION_UNKNOWN`、`retry_safe:false`、已有资源回执）；上传未知 500（`UPLOAD_COMMIT_UNKNOWN`、保留 ID）；snapshot 409/503 结构不变；CORS 仍走现有规则。不得因新 handler 吃掉更具体的回执。
- [ ] **5. 审查并提交。** 逐点确认 helper 无 exception payload；聚焦 red/green 和非变更静态回归记录齐备后提交 `fix(errors): bound database error responses and logs`。明确 provider classifier、其他模块日志仍不在本批“安全”声明范围内。

### Task 2: enqueue 失败时保留最新任务（B3）

**Files:**
- Modify: `api/personal_service.py:66–121`，只改 `submit_turn` 入队异常分支。
- Create: `tests/test_v1_personal_enqueue_reconciliation.py`（本文件局部、深拷贝且真实 `asyncio.Lock` 的 store；不批量重构旧假对象）。
- Regression: `tests/test_v1_personal_service.py`、`tests/test_v1_personal_response_contracts.py`、`tests/test_v1_api_contract.py`、`tests/test_v1_workspace_response_contracts.py`。
- Modify: `CHANGELOG.md`。

**Interfaces:**
- Consume: `store.get("job", identity)`、`store.put(..., create_only=...)`、`store.project_lock(notebook_id)`，保持 `async submit_turn(self, chat_session_id, request)` 和 route 的 `job_id/turn_id/state` receipt。
- Produce: enqueue 抛异常后在同一项目锁内重读；只有与初始 queued 快照相同的记录才允许走现有失败写入。任何更新过的完整记录保留并返回；不存在则 `NotFoundError("Job not found")`，绝不重建。

- [ ] **1. 写确定性失败测试。** `test_enqueue_error_preserves_advanced_job` 参数化 succeeded/running/cancelled_local/submission_unknown/failed 和未来未知状态；submit stub 先持久化含 result/attempts/worker_job_id/cancel_requested/remote_may_continue/error/扩展哨兵的新记录，再抛 `TimeoutError`。断言返回和持久内容等于最新值、没有多余 put。同 key 再调用只读回执，submit 总次数仍为 1。
- [ ] **2. 加锁与缺失边界并观察 red。** `test_enqueue_failure_rereads_after_project_lock` 用 Event 控制另一协程持锁更新，再允许失败分支取得锁，禁止靠 sleep 猜时序；`test_enqueue_failure_does_not_recreate_deleted_job` 断言 NotFound 与无 UPSERT。局部 fake 明确检查 create-only、读写副本和锁串行。跑新文件，确认旧代码在竞争断言失败。
- [ ] **3. 最小实现。** 保持 enqueue 在锁外；异常分支取得项目锁→读 latest→缺失报错→若 latest 与未变动初始快照不同则返回 latest→否则基于 latest 写现有 `failed`/`WORKER_UNAVAILABLE` 并抛原 `InvalidInputError`（保留 cause）。不抹除字段，不再提交，不新增 provider unknown，不改成功 ACK 分支或 `run_turn`。
- [ ] **4. 特征化限制并 green。** `test_unadvanced_enqueue_error_keeps_existing_failure_contract` 固定完全未推进记录仍失败、现有 HTTP 400/code 不变；另明确测试 accepted-but-still-queued 也不能靠本补丁识别。断言 queued 不被机械标为 `submission_unknown`，不声称 outbox、exactly-once 或已解决已接受未启动工作丢失。跑新文件和 Regression 集；保留 fast-worker 成功 ACK 与取消优先级回归。
- [ ] **5. 审查并提交。** 检查所有异常写入在锁内、读取不是旧缓存、无缺记录复活；提交 `fix(jobs): preserve latest state after enqueue acknowledgement failure`。记录尚未解决的无进展 ACK 策略和前端 fresh-key 风险。

### Task 3: Web 容错只读投影（F2）

**Files:**
- Create: `frontend/src/lib/utils/workbench-read-model.ts`、相邻 `.test.ts`（纯函数，无 React/HTTP/存储/i18n）。
- Modify: `frontend/src/lib/types/personal.ts`（只区分 workspace opaque DTO 与已验证 UI view，保留其他已有明确类型）。
- Modify: `frontend/src/lib/api/workbench.ts`、`frontend/src/lib/hooks/use-workbench.ts`（读取类型与轮询消费保持一致）。
- Modify: `frontend/src/components/workbench/StudyWorkbench.tsx`、`WorkbenchSourcesList.tsx`、`frontend/src/components/evidence/SourceProvenance.tsx`。
- Modify/Create tests: `frontend/src/components/workbench/StudyWorkbench.test.tsx`、`frontend/src/components/workbench/WorkbenchSourcesList.test.tsx`、`frontend/src/components/evidence/SourceProvenance.test.tsx`、`frontend/src/lib/api/workbench-contract.test.ts`（已有文件）。
- Create: `contracts/v1/fixtures/workspace-read-compatibility.json`（仅公开合成 fixtures），Modify: `tests/test_v1_workspace_response_contracts.py` 以证明对应 fixture 仍属接受的 wire 形状，不收紧响应。
- Modify: `CHANGELOG.md`；如新增文案则 `frontend/src/lib/locales/` 全语言同步。

**Interfaces:**
- Consume: workspace 的 `selection: Record<string, unknown> | null`、`sources[].versions: Record<string, unknown>[]`；原始响应仍保留在 Query 数据中，不将投影伪装成服务端原文。
- Produce: `projectWorkbenchSelection(value: unknown): WorkbenchSelectionView`，字段为 `engine: unknown`、`selection_origin: unknown`、`source_version_ids: string[]`、`remote_source_ids: string[]`、`reading: ReadingPosition | null`、`supported: boolean`。原有 engine/origin guard 对 unknown 窄化后才能构造现有写请求。完整 null selection 沿用“尚未选择”的默认空界面；某字段 null/非数组不能悄悄变成被支持的 scope。
- Produce: `projectWorkbenchVersion(value: unknown): WorkbenchVersionView`，只提供当前 UI 用到的可空 string 字段（ID、日期、origin/status/original_status）及 `provenance: unknown`，不伪造 sha256/size/身份。
- Produce: `newestSelectableVersionId(versions: readonly WorkbenchVersionView[]): string | null`。只有可证明日期次序、唯一有效 ID 的最新版可自动选；缺/无效日期或并列无法判别时返回 null，保留手动选有效 ID 的能力。
- 原始数据与投影分开；projection 不产生请求。用户显式修改选择时才由组件构造已支持字段的写请求；未知 engine/origin 未被明确更换前不能写回成默认值。不修改服务端 serializer/schema。

- [ ] **1. 写合成 fixture 与失败测试。** 覆盖 null/缺失/non-array/mixed-type remote/local IDs，opaque reading，unknown/null/object engine/origin，缺 date/ID 的版本，future/opaque provenance，nullable/native-only note。分别验证服务端仍保留原文、纯函数不突变原值、组件不抛错、不调用 turn/selection PATCH。所有无效 ID 数组整体 unsupported，不只筛掉坏项而缩小后授权。
- [ ] **2. 运行 red。** 从 `frontend/` 用 `npm run test:unit -- src/components/workbench/StudyWorkbench.test.tsx src/components/workbench/WorkbenchSourcesList.test.tsx src/components/evidence/SourceProvenance.test.tsx src/lib/utils/workbench-read-model.test.ts`；使用已存在本地依赖，不用 npx/安装。先确认旧 UI 的 null length/缺日期路径失败，未实现导入错误不算行为 red。
- [ ] **3. 实现最小投影并接线。** read fields 先检查再消费；保留未知值供安全文本/fallback，未知字段不渲染为 React 对象。无效选择禁 Ask/Outline/作用域搜索；空选源不是全选。reading 仅接受有效非空 ID、非负安全整数页及可选 string evidence ID，不能猜引用身份。SourcesList 缺日期显示 unavailable、缺 ID 禁选/禁读；Select All 不猜最新。`SourceProvenance` 仅识别明确 web/derived kind，当前消费字段逐项守卫，未知/畸形 provenance 显示 unavailable，不归类 human/独立证据。保留原始 opaque 对象，不扩成完整 provenance schema。
- [ ] **4. Green 与回归。** 新增 `does_not_dispatch_or_patch_on_unsupported_selection`、`does_not_guess_latest_version_without_dates`、`unknown_provenance_is_not_human_derived`；保留已有正常新版选择、未知 engine/origin、笔记冲突、late outline、认证恢复与 note 草稿测试。跑上述前端文件、`src/lib/api/workbench-contract.test.ts` 及统一后端命令中的 `tests/test_v1_workspace_response_contracts.py`；再跑 frontend `npm run lint`、`./node_modules/.bin/tsc --noEmit`、全量 `npm run test`。构建另记实际结果，不当作本批自动通过。
- [ ] **5. 审查并提交。** 检查初始渲染/轮询没有写回；wire fixture 的 null、absence、扩展仍逐项保留；请求 DTO 不被宽松 view 污染。提交 `fix(web): project opaque workspace fields safely`；必要时补本次只读投影边界 ADR。本批**不实现 F1 turn identity 恢复或大组件拆分**。

### Task 4: 安全 Make 入口与操作文档（R1–R3）

**Files:**
- Modify: `Makefile:133–147`、`README.dev.md`、`docs/7-DEVELOPMENT/development-setup.md`、`.github/RELEASE_PROCESS.md`、`docs/7-DEVELOPMENT/testing.md`。
- Modify: `tests/test_safe_operation_entrypoints.py`；Regression: `tests/test_offline_test_runner.py`。
- Modify: `CHANGELOG.md`。

**Interfaces:**
- `make v1-check OFFLINE_PYTHON=<existing executable> TIKTOKEN_CACHE=<existing prepared directory>` 只执行 `"$(OFFLINE_PYTHON)" scripts/offline_pytest.py --tiktoken-cache "$(TIKTOKEN_CACHE)"`；缺任一显式值即非零并给指南，不自动寻找/安装。cache 内容校验由 runner 负责。
- `make clean-cache` 无 prerequisite，打印 Blocked + `docs/v1/ENTRYPOINTS.md` 并退出 2；不删除任何东西。默认 `make` 与现有禁用入口不变。
- 结果明确为 backend offline gate；Python 静态检查、frontend lint/types/tests/build、coverage、DB/runtime/CI 均注明 **NOT RUN by this target**，不能输出全仓通过。

- [ ] **1. 写静态/复制入口失败测试。** 先文本检验 recipe，避免对旧清理逻辑执行。复制 Makefile 到临时合成树，recording stubs 覆盖 Python/uv/npm/npx/node/docker/网络/删除命令；测试缺 interpreter/cache 在任何调用前失败、已配置 argv 只到 runner、runner 非零向上返回且不打印成功。新增清理 sentinels：`.venv/module.pyd`、缓存、runtime、symlink；目标必须零文件变化。
- [ ] **2. 跑 red。** 统一离线命令跑 `tests/test_safe_operation_entrypoints.py tests/test_offline_test_runner.py`。不调用真实仓库 `clean-cache`、不执行旧 `v1-check`，不得为了 red 真删依赖。
- [ ] **3. 最小修改。** Make 入口按接口收窄，无 shell include/全局 process kill/自动 setup。README.dev 主入口改 V1 ENTRYPOINTS/RUNBOOK；旧开发/发布页首加明确“历史，非当前操作步骤”及有效相对链接；旧 Node/CI 表述标历史或纠正，不暗示 CI、Docker 候选已验收。testing 页写明窄 gate 与其余独立命令，不扩大入口为全自动流水线。
- [ ] **4. Green 与文档检查。** 重跑两个测试；缺配置/失败 runner/含空格路径/成功作用域标签均有断言；cleanup 前后 sentinel 内容一致。人工确认默认开发 landing page 不再推荐已禁命令，所有新增相对链接存在。源树 `git diff --check` 通过；历史文档警示不能仅靠链接检查代替。
- [ ] **5. 审查并提交。** 提交 `fix(tooling): make offline checks and cleanup fail safely`。未实现 owned cleanup helper、未清理历史 override 全文、未升级依赖；均保留为后续有界事项。

## 集成验收、发布与停止条件

- [ ] 先由独立审查者核对 docs checkpoint 的文件范围、源码引用和本计划自审，再发布文档。实现者不得把本计划复选框当已执行证据。
- [ ] 每批独立 gate：新回归确实 red→green、相应静态检查、差异审查、CHANGELOG 和实际限制；一批失败不影响其他批独立审查。共享文档冲突由集成者合并后重验。
- [ ] 最终候选在准备好的环境重新跑全量离线 pytest、Ruff check/format-check、mypy、前端 lint/types/tests/build，以及既有 API/OpenAPI 契约检查；记录准确命令与返回状态，不用旧数目填表。coverage、opt-in DB、浏览器、Docker/提供方/原生客户端 gate 单列，本任务禁止的运行验证保持 NOT RUN/BLOCKED。
- [ ] 按授权将已审查 commit 推送既有私有进展分支，由发布者核对远端 commit/tree。不要上传运行目录、原始审查笔记、环境配置、凭据、数据库或用户材料；不更改 main 或部署。发布有阻碍就记录 action/target/reason/outcome，不声称已保存到云端。
- [ ] `docs/v1/PROGRESS.md` 只记录本次实测范围及下一批；四批结束不代表整个审查清单清零。后续优先 F1 fresh-key 重复风险与 provider classifier；其次统一 fake 契约、队列无进展 ACK 策略、依赖方向/编排提取与跨界面缓存。扩展前另写有界计划，不把“继续推进”变成架构重写。

## 计划自审（2026-10-24，文档检查，不是代码验收）

- [x] Spec coverage：B1/B2→任务 1，B3→任务 2，F2→任务 3，R1–R3→任务 4；高优先级 F1/提供方泄漏明确后续而非遗漏。
- [x] Step scan：每批有明确文件、接口、red/green、保护性断言和提交；没有要求实现者猜重试策略或把纯 mock 通过当真实 DB 通过。
- [x] Type consistency：raw DTO 与 view 分开；unknown engine/origin 必须窄化才发请求；handler 不吞具体 typed receipt；任务间无新生产接口依赖。
- [x] Review Focus：五项均归属具体测试；补入缺记录、锁等待交错、未推进 queued 限制、未知 provenance、缺日期 Select All 和 no-op lock 风险。
- [x] Proportion/scope：不写完整函数体，不全局清理日志/目录/测试；不假造审批、测试、云端推送或运行验收。用户已免去等待审阅，下一 gate 是集成者独立审查，不再提出重复审批问题。

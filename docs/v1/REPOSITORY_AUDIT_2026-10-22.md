# 全仓库风险、架构与功能缺口审查

审查日期：2026-10-22。源代码基线：私有分支 `feat/research-workspace-v2` 的 `cf2144f6f869388a2f2d7b133b84c5c99dfdcce5`，tree `1d9afd8ed7a1403b9539a746b8b1da4a0bf2c9f1`。整改在独立分支进行，不代表当前测试实例已经升级。

## 结论和证据口径

当前已经有可工作的文档学习工作台，但不能称为完整 NotebookLM 替代品或可迁移的多端正式部署。最高优先级是消除假成功、错误路由、数据迁移和衍生索引的并发风险，然后补齐真实集成与多端功能。

- 全仓清单包含 1,115 个跟踪路径；深入检查了后端数据/任务/模型边界、前端状态与异步操作、部署入口、契约、测试和交付脚本。没有逐行人工检查每个文件、每个第三方 SDK，也没有进行生产负载测试或全仓秘密内容扫描。
- 清单中选取的后端代码/配置 178 个文件，前端代码 250 个、前端测试 77 个、Python 测试 115 个。文件数量不是覆盖率或正确性证明。
- “有代码”“离线回归通过”“真实服务通过”“用户实际使用通过”是不同状态。默认跳过的真实数据库测试、未执行的 Docker/移动构建，不能被总测试数掩盖。
- 历史真实浏览器/数据库验收只属于对应历史版本。当前新空测试实例的公开样例鉴权、解析和原件下载验收，不等于恢复了原用户数据，也不等于新版整改代码已上线。
- 可见历史不足以可靠区分每个问题源自上游还是新增功能，不作无证据归责。

## 已确认的正确性与安全问题

下表状态以本次整改过程为准；“已纳入”仍需要最终合并回归，不能当作运行环境验收。

| 编号 | 优先级 | 问题与影响 | 代码证据 | 整改状态 |
|---|---|---|---|---|
| B01 | P1 | 通用任务列表恒为空、取消恒成功，实际任务继续运行 | `api/command_service.py`、`api/routers/commands.py` | 已纳入明确 501 和稳定 unsupported code；真实列表/通用取消仍未实现 |
| B02 | P1 | 锁定 SDK 忽略后续 SQL 语句 ERR，迁移可能仍推进版本 | `database/async_migrate.py` | 已纳入逐语句 raw ACK 校验；异常不推进版本 |
| B03 | P2 | 数据库 signin/use 失败或取消时未清理连接 | `database/repository.py:db_connection` | 已纳入 setup/body/failure/cancellation 清理与异常保持 |
| B04 | P1 | 迁移版本读取故障被当成空库，可能重放旧迁移 | `database/async_migrate.py:get_latest_version` | 已纳入错误传播；仅成功空结果视作版本 0 |
| B05 | P1 | Source 向量先删后生成；并发插入重复，失败清理可能删除另一任务结果 | `commands/embedding_commands.py:embed_source` | 已纳入受内容/身份保护的原子替换；隔离数据库并发/回滚/未知 ACK 验收通过 |
| B06 | P2 | Note 正文 CAS 不保护衍生向量，旧任务可覆盖新版向量 | `commands/embedding_commands.py:embed_note` | 已纳入条件发布与编辑时失效；隔离数据库旧/新 revision 竞争验收通过 |
| B07 | P1 | 已绑定凭据读取失败后回退环境配置，可能把内容或费用路由到非预期账户/端点 | `open_notebook/ai/models.py`、podcast 调用链 | 已纳入绑定失败拒绝与选定播客配置快照，独立复查通过；未发现实际泄露证据 |
| B08 | P2 | Model.get 的临时数据库异常被改成永久配置错误 | `open_notebook/ai/models.py:ModelManager` | 已纳入缺失记录/临时数据库异常分类，并保持播客调用链类型 |
| B09 | P2 | async 入口直接调用同步队列提交，数据库慢时阻塞事件循环 | `api/command_service.py`、`domain/notebook.py:Note.save` | 下一批隔离修复进行中；需有界原生异步 adapter，未知提交结果不得盲重试 |
| F01 | P1 | Classic Chat 跨会话/笔记本的迟到结果、初次发送重复建会话及缓存竞态 | `frontend/src/lib/hooks/use-notebook-chat.ts` | 已纳入真实 QueryClient 延迟回归并通过独立复查；不声称远端请求被取消 |
| F02 | P2 | 设置保存期间编辑导致基线/dirty 状态失真 | `frontend/src/components/settings/SettingsForm.tsx` | 已纳入确认响应基线及待保存草稿重放，独立复查通过 |
| F03 | P2 | 普通问答迟到成功或大纲成功清掉新问题草稿 | `frontend/src/components/workbench/StudyWorkbench.tsx` | 已纳入草稿 revision 所有权；大纲不清问题输入 |
| F04 | P3 | 凭据错误提示显示翻译 key 而不是可读文案 | `frontend/src/lib/hooks/use-credentials.ts` | 待补翻译与错误态测试 |
| D01 | P1 | Makefile 用全局 pkill，可能误停其他 checkout/测试实例 | `Makefile:worker-stop,stop-all` | 已禁用无所有权的旧入口；使用现有 owning-terminal 前台启动器 |
| D02 | P1 | Git 忽略的 *.secret 仍可能进入 Docker 构建上下文 | `.dockerignore`、根 `Dockerfile` | 已纳入递归排除及静态回归；未运行镜像 canary 检查 |
| D03 | P1 | 默认 Compose 指向上游浮动镜像，并带宽接口端口和示例密钥 | 根 `docker-compose.yml` | 已将根清单设为空服务并禁用上游发布入口；显式 V1 候选仍待 Docker 验收 |
| D04 | P2 | local_check 固定端口、HTTP404 也被当 ready，可能验收错实例 | `scripts/v1/local_check.py` | 待实例身份、子进程存活、端口预检与 owned cleanup |
| T01 | P1 | live-check 未执行/失败也可退出 0，形成假绿 | `scripts/v1/live_check.py` | 已纳入成功 0、失败 1、未 opt-in 2、不完整 3；未授权不导入 provider |

表内 `database/`、`domain/` 路径均位于 `open_notebook/` 下。位置描述以审查基线为准，修复后行号会变化。

### 修复边界不能扩大解释

Source 原子发布当前限 2,000 块、8 MiB 序列化参数，超限在写入前拒绝，不能据此声称无限规模索引。迁移 ACK 和版本读取修复尚不解决 schema 与版本标记的跨连接原子性、并发迁移锁或崩溃恢复。取消的 UI 所有权围栏不等于已提交的远端模型调用停止。删除一个 fallback 分支不等于所有第三方 SDK 的环境变量行为均已验证。

## 架构、可维护性与验收债务

1. **个人层查询缺少数据库过滤与分页。** `api/personal_store.py:list` 读取整个 kind 表后在 Python 过滤；workspace 汇总版本、历史 turn/job，前端仅在任务/解析活动时每 2 秒轮询。应先加入作用域查询、索引、分页/增量结果，再测大库，不凭静态代码编造延迟或 OOM 数字。
2. **Evidence 读取为 N+1。** `api/evidence_service.py:list_evidence` 逐个 await evidence，底层每次 repository 查询建立连接。纯内存抽取探针证实 64 条记录产生 64 次串行 evidence lookup；未测真实耗时。应批量按所选版本读取，保持 provenance、顺序和失效规则。
3. **依赖方向混杂。** `open_notebook/database/source_snapshot_repository.py` 引用 API store/contracts，grounded graph 引用 API evidence service。建议逐步把应用服务/共享契约放到不依赖 HTTP 层的位置，采用窄 store protocol；不是已经证实循环导入，更不需要全盘重写。
4. **事务与进程所有权分散。** Makefile、native launcher、local_check、supervisor 各有生命周期实现，已出现全局 kill/owned process group、固定/可配端口、弱/严格 readiness 的分叉。抽取小型共享生命周期能力，避免新建庞大框架。文件锁方案依赖共享文件系统；不能未经验证扩展成多宿主、独立数据卷的并行 worker。
5. **多端契约不完整。** 43 个 personal HTTP operation 中，36 个 2xx JSON schema 为 `{}`。已有 OpenAPI 字节漂移检查，但不能检查未声明字段。优先补 workspace/job/turn/note/error 响应模型、SSE/下载边界与兼容 fixture，再生成客户端。
6. **CI 与交付文档不一致。** 当前发布的源码没有 `.github/workflows`，此前有意排除了上游自动化。不能宣称远端 CI 已运行，也不能直接恢复可能有发布权限的上游流程。需明确最小权限、本项目专用门禁和启用边界。
7. **默认测试不完全隔离。** conftest 可加载仓库 `.env`，普通 API 测试默认关闭鉴权；全局前端 auth/navigation mocks 不能证明实际认证和布局接线。应采用 synthetic 环境、禁 dotenv/默认网络、按测试启用 mock，以及独立 auth-enabled 集成层。
8. **验收未绑定制品身份。** local_check 可复用旧 standalone；覆盖率汇总未验证源码新鲜度。应记录源码 tree、锁文件、构建摘要和必需 gate 状态，漂移/缺失时标记 incomplete。覆盖率阈值必须有依据，不能代替行为测试。
9. **运行健康仍薄弱。** API lifespan 已等待迁移完成，不能误报“迁移前 readiness 成功”；真正缺口是运行期 DB/worker 消费健康、联动重启和恢复验收。静态容器检查仍有过时的编译 rewrite 断言，需要与 runtime App Routes 对齐。
10. **大文件并非天然缺陷。** portable service 同时承担格式、安全校验、文件 staging 与事务发布，值得按边界渐进拆分；已有未知提交结果保留文件等保护不能在重构中丢失。向量任务全量文本/块/向量驻内存的峰值需实测与预算限制。

## 产品功能的真实状态

| 能力 | 当前判断 | 下一验收条件 |
|---|---|---|
| 文档导入、原件/版本、PDF/MD/TXT 提取、引用定位、笔记、备份恢复 | 已有实现及历史本地实测；新空实例部分公开样例已验证 | 新整改版本的集成回归与独立恢复，不把源码备份当用户数据备份 |
| 阅读优先界面、独立设置页、保存成果变同笔记本资料 | 已实现；有自动回归与部分历史浏览器证据 | 当前版本用户操作体验、错误恢复与无草稿丢失 |
| 网络发现、结果预览、选中导入 | 代码与离线合同已实现；keyless 模式已启用测试 | 至少一次真实搜索和选中导入成功；此前真实搜索 502，不能标完成 |
| 独立模型问答与大纲 | grounded 调用与范围/引用合同已有 | 授权端点上的中文 gold questions、引用准确性与费用/失败行为 |
| Google 列表/同步/音频桥接 | adapter/state machine 与 fake 测试已有 | 实际账户能力逐项验证；登录入口不是已经可用 |
| Google 严格选源问答 | **尚未实现可用路径**，ask 明确拒绝 | 证明非破坏性新会话隔离，不删除历史、不伪装独立模型为 Google |
| 前后端 Docker 与 worker/DB 分离 | 四服务定义已有 | 真正 build/run、镜像身份、权限、流式、卷、重建和完整恢复 |
| 多端设备认证 | 代码受 gate 保护，legacy 仍是当前默认 | 安全入口、设备撤销/刷新、联动重启后再启用 |
| Android、iPadOS、HarmonyOS 6 | **尚无原生客户端工程交付** | 已选 React Native 共享 Android/iPad 核心与 ArkTS 鸿蒙；各平台分别构建/模拟器/真机验收 |
| 视频/扫描文档深度学习流程 | **未完成个人工作台集成** | 先一个最小 OCR 或视频时间码切片，保留原件、派生文本和引用定位 |
| 长期托管、Sites 入口、耐久数据 | **未验证** | 受支持入口和持久化/恢复证明；当前临时云电脑不可作为唯一数据存储 |

## 整改顺序与退出标准

首批整合结果：[机器可读验收记录](evidence/repository-audit-2026-10-22/summary.json)。后端 1,965 通过/60 跳过，另独立执行其中 14 项一次性真实数据库验收；其余 46 项不算通过。前端 1,207 项/78 文件通过，类型/生产构建通过，lint 为 0 错误/7 个既有警告；Python 全量 Ruff/格式/mypy 通过。新代码未自动部署，也未把真实模型、Google、搜索或 Docker 标为已验收。

执行更新见 [缺口闭环计划](GAP_CLOSURE_PLAN.md)。先修确认的风险，再补可用功能；每项必须有失败复现、修复回归、独立复查、集成证据。需要账户、工具链或宿主条件的门槛单独保留，不以占位客户端或模拟返回值替代。

本报告不启用远端 CI、不修改账户权限、不生成新凭据、不重启用户正在使用的实例。运行版本升级必须与源码验证分开记录。

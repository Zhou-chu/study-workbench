# NotebookLM 开源工作台 V1：云电脑开发计划书

**交付对象：GPT dot / 在云电脑中工作的编码 Agent**  
**版本：1.0｜编制日期：2026-10-18｜文档性质：开发规格与执行计划，尚未实施**  
**建议项目代号：StudyWorkbench。实施时可调整产品名，不影响功能和数据格式。**

> 本文可单独交给开发 Agent，执行不依赖之前的聊天记录。用户要开发可运行的第一版；本文件负责冻结范围、规定接口、安排任务和定义验收。
>
> 执行者收到本文件后，先执行 T00 环境核验，然后进入开发。若环境已经具备相应授权，可持续完成后续任务，不要每完成一步就停下来重新询问是否继续。遵守执行环境现有权限；人工登录、明确的新支出和不可逆操作按实际需要处理。若环境提供 Superpowers，可用其计划执行与代码审查技能；没有该技能也可以直接按本文执行。
>
> 将本文件复制到项目的 docs/v1/DEVELOPMENT_PLAN.md。所有实施中发现的偏差写入 docs/v1/DECISIONS.md，不要悄悄改写验收定义。

## 0. 项目目标与已经确定的决策

### 0.1 用户已确认的事实

- 用户目前拥有 **Google AI Pro 个人订阅**，权益来自个人 Google 账号。
- 用户希望继续有效使用 NotebookLM，同时逐步拥有自己的资料、界面和服务能力。
- 当前交付目标是让 GPT dot 在云电脑中开发第一版。
- 将来获得算力后，希望切换到自己部署的模型，并进一步提供类似 NotebookLM 的独立服务。
- 当前没有提供可用的独立模型 API、GPU、托管平台、域名或新增支出预算。不要将这些条件假定为已有。

### 0.2 冻结的技术路线

**以 Open Notebook 为基础做小范围分支开发；以 notebooklm-py 建立个人 NotebookLM 连接；自己保存原件、引用和工作成果；保留独立模型通道。**

| 决策 | V1 采用方式 |
|---|---|
| 应用底座 | Open Notebook；固定实际提交，沿用其前后端、数据模型和部署结构 |
| 前端 | 沿用项目的 Next.js、React、TypeScript、现有 UI 与国际化方案 |
| 后端 | 沿用 FastAPI、现有服务层和认证机制 |
| 数据与任务 | 沿用 SurrealDB、SQLite 聊天检查点、文件目录、surreal-commands |
| 原件与引用 | 新增不可变原件版本、页级证据记录、受保护的阅读入口 |
| 默认问答通道 | NotebookLM 个人连接，使用实际登录账号可用的权益 |
| 独立问答通道 | 接入 Open Notebook 已有模型配置；有授权端点时实测，没有时明确待配置 |
| Google 接入 | 优先 notebooklm-py 公共 Python SDK；Web 登录方式，单账号、专用 profile |
| 部署形态 | 单人私有网页，浏览器访问；先使用现有云电脑可用的资源 |
| 新增数据库/队列 | 不新增。V1 不迁移至 PostgreSQL，不引入 Redis、Celery 或 Kubernetes |
| 模型框架 | 保留上游已使用的 Esperanto / LangGraph，不另造框架，也不为“简化”删除现有框架 |
| 开源策略 | 保留上游版权与许可证；新增独立代码建议采用 MIT；记录第三方依赖及许可 |

上游现有架构和扩展约定见 [S1]、[S2]。Open Notebook 主项目使用 MIT，但其依赖不因此都变成 MIT；例如 SurrealDB 有自己的许可条款。V1 记录依赖，未来面向他人提供服务前再按实际部署模式核对许可，不把本计划当作法律判断。[S3][S4]

### 0.3 “使用订阅”与“迁移资料”的准确含义

个人订阅继续属于 Google 账号。V1 通过非官方连接器使用该账号当前可用的 NotebookLM 服务，**不把订阅兑换为任意模型 API，不将个人账号配额包装为面向公众的推理服务**。

Gemini API 是另一个项目、凭据与计费体系。Google 当前列出 AI Pro 对应的每月 10 美元 GenAI / Cloud 开发权益，但领取、项目绑定、可用余额和付款条件需要另行核对。V1 不自动开通计费、充值或开启自动补款，也不把这笔权益计作已经可用的 API 余额。[S5][S6][S7]

资料迁移分为三类：

| 内容 | V1 如何处理 |
|---|---|
| 用户自行上传的 PDF、MD、TXT 原件 | 保存真实字节、文件哈希、版本和解析结果，可完整导出 |
| Google 端可取得的 notebook、来源信息、文本和成果 | 用户选定后导入可取得的内容，记录来源、抓取时间、能力边界和缺失项 |
| 连接器无法取得的原件、历史或资产 | 明确标记缺失，允许用户补传原件；不承诺完整迁移或捏造已备份 |

Google 连接属于可替换外部依赖，不能成为自有资料阅读、笔记、搜索、导出和恢复的前置条件。

## 1. V1 产品范围与完成定义

### 1.1 核心使用流程

1. 用户通过受保护的网页进入工作台，创建本地 notebook。
2. 用户上传资料，看到逐文件解析进度；解析过程无需先配置收费模型。
3. 用户可以直接阅读、检索、记笔记。
4. 用户连接个人 Google 账号，选取一个已有 NotebookLM notebook，或明确点击创建新的远程 notebook。
5. 用户选择需要同步的原件，确认目标 notebook 后同步；已在 Google 的资料也可先关联和查询。
6. 用户选择问答引擎和资料范围，提问、追问、点击引用返回证据。
7. 用户保存答案为笔记、生成学习提纲；NotebookLM 能力可用时，可以显式发起一次音频概览。
8. 用户导出项目，在干净的数据目录中恢复，原件、笔记、历史引用继续可访问。

### 1.2 功能要求

| 编号 | V1 必须实现的行为 | 主要验收 |
|---|---|---|
| R01 | 单人私有访问，保护页面、API、原件、任务和导出 | A01、A02 |
| R02 | 本地 notebook、PDF/MD/TXT 上传、逐文件状态；无需模型即可解析 | A03、A04 |
| R03 | 原件版本与稳定证据；PDF 物理页定位，可靠时高亮原文 | A05、A06 |
| R04 | 可持久保存的选源、引擎和多轮记录；历史回答保留当轮范围 | A07、A08 |
| R05 | 个人 Google 登录、失效恢复、真实连接与能力状态 | A09 |
| R06 | 关联已有远程 notebook；明确创建/同步；导入范围与缺失报告 | A10、A11 |
| R07 | NotebookLM 真实问答，引用映射可核验，不扩大选源范围 | A12、A13 |
| R08 | 独立模型问答接口与页面可用；已有授权端点时完成真实验证 | A14、A15 |
| R09 | 笔记、Markdown 学习提纲；NotebookLM 音频概览任务和下载 | A16、A17 |
| R10 | 所有长任务可查询；写入幂等；未知提交状态不盲目重试 | A18、A19 |
| R11 | 项目导出、全新目录恢复、清晰的数据覆盖范围 | A20、A21 |
| R12 | 外部访问、重启验证、运行说明、状态报告和可复现源码 | A22、A23、A24 |

R08 的实现和模拟契约测试属于 V1；在用户未配置独立模型时，**独立模型真实问答**保持待配置，不阻止以 NotebookLM 为默认引擎交付个人可用版本。R09 的音频实测依赖真实账号能力和一次明确的生成操作；受阻时须单列，不宣称全项完成。

### 1.3 明确延期的内容

V1 不实现完整视频理解、逐帧图表解读、复杂 OCR/公式识别、完整 PPT 视觉还原、多说话人精细时间对齐、自托管 TTS、实时语音对话、多租户、团队权限、收费体系、组织 SSO 或 Kubernetes。

V1 不新增通用 Google Takeout 解析器。取得真实用户导出样本后，在 V1.1 建立格式适配与完整性核对。V1 已有“按实际能力导入远程内容”和“导入本平台导出包”。

音频概览是 V1 唯一新增的专门 Studio 生成类型。测验、闪卡、视频概览、幻灯片、信息图和思维导图放到后续版本。已有上游功能可以保留，但本项目不得把未经验证的原有入口算作新版本验收通过。

### 1.4 完成状态必须分层

| 状态 | 判定 |
|---|---|
| 实现完成 | 代码、迁移、界面、错误分支和相关本地测试完成 |
| 模拟测试通过 | 使用 fake adapter 或固定响应验证契约；没有证明外部服务可用 |
| 真实验证通过 | 使用实际文件、账号、服务或部署地址执行并核对结果 |
| 尚未验证 | 功能已实现，但没有足够运行证据 |
| 受阻 | 凭据、用户登录、网络、运行环境或上游能力阻止验证 |
| 明确延期 | 列入本文的后续范围 |

最终必须分别报告：核心数据工作台、Google 默认问答、Google 音频、独立模型通道、远程访问和持久化。不能用一个“全部完成”覆盖受阻部分。

## 2. 云电脑约束与环境决策

### 2.1 T00 必须核验的项目

将结论写入 docs/v1/ENVIRONMENT.md；记录能力和路径，不记录密钥或会话内容。

| 项目 | 需要取得的证据 |
|---|---|
| 运行时 | OS、Python、Node、包管理器；实际固定版本所需范围 |
| 容器或原生服务 | Docker Compose 是否能运行；不能时是否允许用户态长驻进程 |
| 资源 | 可用 CPU、RAM、磁盘和配额；不要根据“云电脑”三个字推定存在 GPU |
| 网络 | 依赖仓库、Google NotebookLM、用户指定模型端点是否可达 |
| 人工登录 | 能否打开用户亲自操作的专用可见浏览器，并把 Web profile 供运行时使用 |
| 外部访问 | 平台提供的受保护 HTTPS 地址、反向代理、端口与休眠条件 |
| 存储 | 原件、SurrealDB、SQLite、配置、Google profile 各存哪里；生命周期分别是什么 |
| 交接 | 源码能否留在用户控制的位置；能否下载构建说明和项目备份 |

参考起点可以按 4 vCPU、8 GB RAM、20 GB 可用持久磁盘评估 CPU 开发环境；这是规划假设，不是最低要求或实测性能承诺。先评估现有环境，不自动购置资源。

### 2.2 环境分支

- **具备 Docker Compose：** 优先沿用上游部署方式。开发时保留独立 API、worker、frontend 进程，方便调试。
- **无 Docker，但允许原生进程：** 根据固定版本的开发文档运行 Python API、worker、Next.js 和受支持版本的 SurrealDB。记录实际可复现命令。
- **仅支持静态站点、浏览器沙箱或短时函数：** 可以完成代码和可验证的纯前端部分，但不能把这种环境当作已运行的完整后端。完成可复现部署包，明确需要长驻 Python、数据库和文件存储。
- **无法完成 Google 人工登录：** 完成连接器、界面、错误分支和模拟测试；Google 真实接入标为受阻，继续其他任务。
- **没有独立模型端点：** 继续资料、检索、引用、笔记、导出及 Google 通道；独立问答显示“待配置模型”。
- **没有长期外部地址：** 用现有安全预览地址完成可行测试，记录链接有效条件；不得将 localhost 当作交付网址。

不通过修改权限规则、公开数据库、暴露浏览器调试端口或自动启用付费服务解决环境限制。只有被阻塞的事项暂停，其他已授权工作继续。

### 2.3 持久化与访问保护

应用进程重启、容器重建、云工作区停止、云工作区删除，是四种不同事件。报告每一种实际可验证的保存能力，未知的写未知。

V1 至少证明应用重启后原件、笔记、聊天和连接配置仍可用；工作区存储若具有更强保证，引用平台说明并在可行时实测。项目导出必须可下载到云电脑以外。

只暴露受保护的网页入口。API、数据库、文件路径和浏览器 CDP 不直接对公网开放。平台统一身份保护可以作为外层，但必须实测未认证请求无法绕过 UI 直接读取 API 或原件。沿用并补齐上游认证；不要为单用户 V1 新建用户权限系统。

## 3. 架构与现有代码边界

### 3.1 运行关系

~~~mermaid
flowchart TD
    UI["私有网页工作台"] --> API["FastAPI 与权限检查"]
    API --> DATA["原件、证据、笔记与历史"]
    API --> JOB["现有后台任务"]
    API --> OWN["自有资料问答"]
    API --> BRIDGE["NotebookLM 个人连接"]
    JOB --> DATA
    JOB --> BRIDGE
    OWN --> DATA
    OWN --> MODEL["已配置模型；未来自部署"]
    BRIDGE --> GOOGLE["Google 账号当前权益"]
~~~

NotebookLM 连接是 notebook、来源、会话和成果级能力。它不符合通用文本生成模型的全部语义，不将它注册成假的 OpenAI-compatible provider。独立模型继续通过上游模型配置和 provision_langchain_model 接入。[S1][S2]

### 3.2 已核验的上游位置

以下路径依据调研时的 main 文档和代码。T00 必须对固定 checkout 再核验。不存在时按符号查找并更新映射，不在未检查的路径上臆造文件。[S1][S2][S8][S9]

| 上游位置 | 本计划中的用途 |
|---|---|
| open_notebook/domain/notebook.py 中的 Source | 复用来源身份；增加版本和证据关联 |
| api/routers/sources.py | 沿用上传、状态和受保护下载；保留 realpath 与上传目录边界检查 |
| api/models.py、api/main.py | 请求模型及路由注册 |
| open_notebook/graphs/source.py | 在原件页边界仍存在时接入证据提取 |
| open_notebook/graphs/chat.py、source_chat.py、ask.py | 检查已有对话与检索流程，复用合适部分 |
| open_notebook/ai/provision.py、provider_registry.py、models.py | 复用模型配置和调用 |
| open_notebook/utils/context_builder.py、chunking.py、embedding.py | 复用上下文和分块能力，加入选源/证据限制 |
| open_notebook/database/repository.py | 沿用数据库访问 |
| open_notebook/database/migrations/、async_migrate.py | 新迁移与显式注册 |
| commands/、commands/__init__.py | 新任务及 worker 注册 |
| frontend/src/lib/api/client.ts 中的 apiClient | 复用认证、请求地址及错误处理 |
| frontend/src/lib/api/、hooks/、types/ | 新增有类型的 API 与状态 |
| frontend/src/components/、app/ | 工作台、来源阅读、连接与任务 UI |
| frontend/src/lib/locales/ | 新增中文文本，并保持上游 locale key 一致 |

前端按 SourceDialog、ChatColumn、useNotebookChat、useFileUpload、useSourceStatus 等符号定位。上游文档和改名后的文件可能不同，不硬编码猜测的路由分组前缀。

上游资料文件通常在 ./data/uploads/，聊天消息的 SQLite 检查点通常在 ./data/sqlite-db/checkpoints.sqlite；SurrealDB 保存领域数据和相关元数据。**只备份 SurrealDB 会遗漏聊天与文件。** 实际位置以固定代码和部署配置为准。[S1]

### 3.3 拟新增文件及职责

下列是本项目计划新增的位置，不是声称上游已存在的文件。T00 检查命名冲突后确定。

| 新增位置 | 单一职责 |
|---|---|
| open_notebook/domain/evidence.py | SourceVersion、EvidenceRecord、EvidenceCitation 数据契约 |
| api/evidence_service.py | 版本创建、提取编排、证据查找与确定性引用核验 |
| api/routers/evidence.py | 来源版本、证据与历史版本下载接口 |
| commands/evidence_commands.py | 可重入的 CPU 提取任务 |
| open_notebook/graphs/grounded_chat.py | 独立模型的选源检索与有引用回答 |
| open_notebook/integrations/notebooklm/contracts.py | 与具体 SDK 无关的连接接口、状态和能力模型 |
| open_notebook/integrations/notebooklm/sdk_adapter.py | 唯一直接调用 notebooklm-py 的适配层 |
| open_notebook/integrations/notebooklm/fake_adapter.py | 测试专用，生产默认不能启用 |
| api/notebooklm_service.py、api/routers/notebooklm.py | 账号连接、映射、问答和任务编排 |
| commands/notebooklm_commands.py | 上传、音频、下载等持久任务 |
| api/portable_service.py、api/routers/portable.py | 版本化项目导出与恢复 |
| frontend/src/lib/api/evidence.ts、notebooklm.ts、portable.ts | 类型化客户端 |
| frontend/src/components/evidence/ | PDF/文本阅读与引用交互 |
| frontend/src/components/integrations/ | Google 连接、能力和恢复 UI |
| tests/test_v1_*.py | 按上游扁平目录惯例保存新功能测试 |
| frontend/e2e/v1/ | 有必要的核心浏览器流程测试 |
| docs/v1/ | 决策、接口、部署、验收和进度文档 |

不要把所有逻辑塞进一个大 router；也不要为了文件数量人为拆分简单函数。首先复用固定版本已有实现，再创建确有职责缺口的文件。

## 4. 数据契约：可迁移和可信引用的基础

本节是本项目的设计，不是上游已经存在的 schema。优先使用已有 notebook、source、note、chat_session 身份，新增必要的版本、映射和回答快照。

### 4.1 记录与字段

| 记录 | 必须保存的字段与语义 |
|---|---|
| SourceVersion | source_version_id、source_id、origin、original_status、sha256、mime_type、byte_size、受保护的相对文件路径、created_at；原件字节与身份不可变 |
| Extraction | extraction_id、source_version_id、parser_name、parser_version、schema_version、status、page_count、warnings、created_at |
| EvidenceRecord | evidence_id、source_version_id、extraction_id、locator、quote、quote_hash、evidence_kind；创建后不可覆盖 |
| RemoteNotebookLink | 本地 notebook_id、connection_id、remote_notebook_id、last_checked_at |
| RemoteSourceLink | remote_notebook_id、remote_source_id、可为空的 source_version_id、mapping_method、mapping_status、remote_metadata、last_checked_at |
| TurnRecord | turn_id、chat_session_id、engine、用户问题、scope_snapshot、实际证据 IDs、答案及引用、生成状态、模型/连接器版本、时间、usage |
| BridgeJob | job_id、worker_job_id、operation、idempotency_key、request_hash、请求快照、remote_task_id、submission_state、state、attempts、error、时间 |
| ImportedArtifact | artifact_id、origin、remote_artifact_id、类型、文件路径、sha256、byte_size、所用资料范围、下载时间 |
| ExportManifest | format_version、应用/上游版本、实体清单、文件与哈希、来源覆盖、缺失项、恢复要求 |

说明：

- origin 至少区分 upload、pasted_text、remote_text_snapshot；远程只有元数据时保留来源关联，source_version_id 为空。
- original_status 区分 available、missing、not_applicable。取得远程提取文本，不代表取得原 PDF。
- 来源有新字节时创建新 SourceVersion；同一原件重新解析时创建新 Extraction。旧证据和旧引用继续保留。
- 新版当前提取结果可以通过指针切换，不能覆盖历史引用指向的内容。
- 分块和向量索引是派生缓存。更换 embedding、chunk_size 或模型不改变旧 evidence_id 的含义。
- 新增 TurnRecord 保存 V1 回答的规范化快照；已有上游聊天历史继续保留其存储方式。导出需要覆盖两者，不清空已有 SQLite 历史。

### 4.2 定位约定

PDF locator 使用从 0 开始的 page_index；界面显示“PDF 第 page_index + 1 页”。有印刷页码时另存 page_label，两者不混用。

文本 locator 保存 block_id 和原提取文本中的 start_offset / end_offset，区间为左闭右开，单位为 Unicode 码点。前端不能直接用 JavaScript UTF-16 的 slice 假定二者相同。MD/TXT 使用段落、行号或标题位置，不能伪造页码。

bbox 仅在解析器实际返回、且已验证坐标转换时保存；V1 允许没有 bbox。不能根据答案或段落位置猜测框选区域。

原提取文本作为定位基准保留。为搜索建立的空白归一化、Unicode 归一化文本要与原文区分，并保留映射；不能把归一化后的偏移直接套用到原文。

### 4.3 引用对象示例

以下是本项目返回格式，字段名字固定；UUID 值只是格式示意。

~~~json
{
  "citation_id": "c1",
  "kind": "local_evidence",
  "evidence_id": "ev_example",
  "source_version_id": "sv_example",
  "source_title": "课程讲义.pdf",
  "locator": {
    "page_index": 7,
    "page_label": null,
    "block_id": "block_12",
    "start_offset": 24,
    "end_offset": 39,
    "bbox": null
  },
  "quote": "实际存在于该版本原文中的证据",
  "reference_validity": "verified",
  "remote_reference": null
}
~~~

kind 至少区分 local_evidence、remote_text_snapshot、remote_unmapped。remote_unmapped 可以展示真实返回的标题、原文片段和远程链接；其 evidence_id 与本地页定位可以为空。

**reference_validity = verified 只证明引用身份、范围和原文匹配通过检查，不证明模型的每一句推论都正确。** 语义支持度通过验收样本人工核对，不能把字符串匹配包装成事实正确率。

### 4.4 Google 引用映射

只有同时满足以下条件，Google 回答中的引用才能跳到本地页：

1. 已有可信的 remote_source_id 到 source_version_id 映射；
2. 该版本属于本轮选源快照；
3. 引用片段能在此版本证据中可靠定位；
4. 存在多个同文候选时，有实际信息消除歧义。

本应用刚上传并保存远程返回 ID 的文件可以建立明确映射。对 Google 已有资料，**同名文件不构成原件相同的证明**。用户可补传和确认关联；确定性文本匹配仍须单独执行，记录 mapping_method。

找不到或不能唯一定位时，展示远程引用及真实可用粒度。不能生成“第 8 页”之类的精确信息填补缺失。来自当前选源外的引用标为 out_of_scope，不作为已验证证据展示。

## 5. 问答、连接和任务接口

### 5.1 本项目新增 HTTP 契约

统一放在 /api/personal/ 命名空间；现有上传、来源状态、下载和普通管理接口继续复用。以下都是应用自有端点，**不是 Google 官方 API，也不是 notebooklm-py 的现成路由**。

| 方法与路径 | 输入 / 输出要点 |
|---|---|
| GET /api/personal/sources/{source_id}/versions | 当前及历史版本、提取状态 |
| GET /api/personal/source-versions/{source_version_id} | 版本信息、页数、证据摘要、警告 |
| GET /api/personal/source-versions/{source_version_id}/download | 受认证的对应版本原件；支持阅读器实际需要的下载行为 |
| GET /api/personal/evidence/{evidence_id} | 原文证据及定位；保持版本绑定 |
| POST /api/personal/chats/{chat_session_id}/turns | 统一 TurnRequest；返回 turn_id、任务/事件入口 |
| GET /api/personal/chats/{chat_session_id}/turns | V1 规范化历史、当轮范围与引用 |
| GET /api/personal/turns/{turn_id}/events | SSE：阶段、可用时的文本增量、最终答案或错误；可恢复查询终态 |
| GET /api/personal/connections/notebooklm | 连接状态、脱敏账号标识、最后真实验证时间 |
| POST /api/personal/connections/notebooklm/connect | 启动有期限的人工登录流程，返回 flow_id |
| GET /api/personal/connections/notebooklm/connect/{flow_id} | 人工登录/网络验证进度 |
| POST /api/personal/connections/notebooklm/reconnect | 同一 profile 的重新连接流程 |
| DELETE /api/personal/connections/notebooklm | 清除本应用持有的连接材料；不删除 Google 资料 |
| GET /api/personal/notebooklm/capabilities | 操作支持情况、SDK 版本、最近验证及原因 |
| GET /api/personal/notebooklm/notebooks | 分页列出远程 notebooks |
| POST /api/personal/notebooklm/notebooks | 用户明确创建一个远程 notebook；要求幂等键 |
| GET /api/personal/notebooklm/notebooks/{remote_notebook_id}/sources | 分页来源清单 |
| POST /api/personal/notebooks/{notebook_id}/notebooklm-link | 关联选定远程 notebook |
| POST /api/personal/notebooks/{notebook_id}/imports/notebooklm | 导入选定远程内容；返回 job_id 与最终 import_report |
| POST /api/personal/notebooks/{notebook_id}/sync/notebooklm | 同步明确选定的本地版本；返回 job_id |
| GET /api/personal/notebooklm/notebooks/{remote_notebook_id}/artifacts | 列出实际可读取的成果 |
| POST /api/personal/notebooks/{notebook_id}/artifacts/audio | 明确发起音频任务；返回 job_id |
| POST /api/personal/notebooklm/artifacts/{remote_artifact_id}/download | 将选定成果下载为受保护的自有资产 |
| GET /api/personal/jobs/{job_id} | 领域任务状态，关联现有 worker_job_id；无需新队列 |
| POST /api/personal/jobs/{job_id}/cancel | 按实际支持程度停止本地等待，返回远程是否仍可能运行 |
| POST /api/personal/notebooks/{notebook_id}/exports | 生成项目导出任务 |
| POST /api/personal/imports/portable | 导入本平台项目包；先校验，再原子地提交或回滚 |

POST 的跨站请求保护、权限校验和参数验证与部署认证方式配套。不得仅靠前端隐藏按钮控制权限。下载、导出和静态文件的缓存也要避免向未认证用户泄露内容。

### 5.2 TurnRequest 与范围快照

~~~json
{
  "engine": "notebooklm",
  "message": "解释这几份资料对该问题的不同看法",
  "selection_origin": "local",
  "source_version_ids": ["sv_a", "sv_b"],
  "remote_notebook_id": "remote_nb",
  "remote_source_ids": [],
  "idempotency_key": "client-generated-unique-key"
}
~~~

- engine = notebooklm 或 independent；测试 adapter 不是第三个生产引擎。
- selection_origin = local 时，后端根据明确映射解析 remote_source_ids；存在未映射或未就绪来源就返回可处理错误，不能扩大到整个远程 notebook。
- selection_origin = remote 时，必须明确提交远程来源 IDs；本地版本可以为空。界面标识“资料原件尚未保存在本平台”。
- independent 只接受实际可检索的本地版本或明确导入的文本快照。
- 不把空选源默认为“全部资料”。用户选择“全部”时，要在提交时展开成当时的完整 ID 清单，并保存快照。
- 后端保存引擎、来源版本、远程 IDs、映射版本、会话和 scope_hash；前端刷新不会改变历史范围。
- 追问可利用对话理解指代；独立模型不能把前一轮模型回答当作原始证据。
- 收到范围外或无法解析的引用时，返回明确的未验证状态；不静默把不合格引用显示为绿色通过。

NotebookLM 的实际会话隔离能力需按固定 SDK 验证，包括 source_ids、conversation_id 与历史上下文的组合语义。保存远程会话的 scope_hash；**资料范围变化，或旧会话的历史范围无法确认时，只有能建立不含已排除资料历史的非破坏性上下文，才提交严格选源问题。** 做不到时返回 SCOPE_ISOLATION_UNAVAILABLE，提示使用经验证的新会话、用户明确创建的专用 notebook，或已配置的独立引擎；不能仅加提示后继续原会话。关联、导入和原件阅读仍可继续，外链跳转至 Google 网页不计作本平台问答通过。

应用“新建聊天”不得调用具有删除历史副作用的 ask --new。独立引擎换范围时也要重新构建历史上下文，移除已排除来源的证据和旧答案正文；无法明确解析的追问请用户补充问题，不能依赖旧资料补出答案。[S10]

### 5.3 NotebookLMBridge 接口边界

contracts.py 定义以下能力；参数和返回值均使用本应用类型。SDK 版本差异只在 sdk_adapter.py 内转换。

~~~python
class NotebookLMBridge(Protocol):
    async def verify_connection(self) -> ConnectionStatus: ...
    async def capabilities(self) -> CapabilityMatrix: ...
    async def list_notebooks(self, cursor: str | None) -> NotebookPage: ...
    async def list_sources(self, remote_notebook_id: str,
                           cursor: str | None) -> RemoteSourcePage: ...
    async def create_notebook(self, request: CreateNotebookRequest) -> SubmissionResult: ...
    async def upload_source(self, request: UploadSourceRequest) -> SubmissionResult: ...
    async def fetch_source_text(self, request: FetchTextRequest) -> RemoteTextResult: ...
    async def ask(self, request: BridgeAskRequest) -> BridgeAnswer: ...
    async def list_artifacts(self, remote_notebook_id: str) -> list[RemoteArtifact]: ...
    async def generate_audio(self, request: AudioRequest) -> SubmissionResult: ...
    async def get_artifact(self, remote_notebook_id: str,
                           remote_task_id: str) -> RemoteArtifact: ...
    async def download_artifact(self, request: DownloadRequest) -> DownloadedAsset: ...
~~~

上述是要实现的 Protocol，不声称 SDK 已有同名方法。T00/T06 应逐项核对公共签名、参数和返回结构，记录实际映射。基线候选为已经发布的 notebooklm-py v0.8.5；不得把 main 中的未发布功能当作该版本保证。若必须升级，给出具体原因并重新锁定版本及相关契约测试。[S11][S12]

优先通过公共 NotebookLMClient 生命周期使用 SDK，避免依赖 notebooklm._* 私有模块。CLI 仅用于其公开支持的登录/诊断等适合操作；如需子进程，用参数数组和受控路径，不拼接含用户输入的 shell 命令。

GPT dot 在开发期间能调用的 NotebookLM 工具、MCP 或浏览器，不自动成为部署应用可以调用的服务。必须说明真实运行进程、调用链、凭据位置和重新登录机制。

### 5.4 连接与能力状态

连接状态统一为：

~~~text
disconnected
awaiting_user_login
verifying
connected
needs_reauth
unavailable
~~~

配额状态独立于连接状态。读取不到额度时是 unknown 或 null，不能显示成 0、无限额度或订阅剩余金额。

每个 capability 保存 name、support、last_verified_at、sdk_version、adapter_version、reason。support 至少包含 available、unsupported、temporarily_unavailable、unverified。首次连接通过只读操作验证，不自动生成所有成果来“探测能力”。

前端必须区分“本地服务在线”“Google 登录有效”“该操作已经真实验证”三件事。健康检查响应和 Cookie 文件存在都不能单独证明 Google 已连接。

### 5.5 任务状态与重复提交

BridgeJob 的 state 至少包括：

~~~text
queued
running
waiting_remote
succeeded
failed
needs_reauth
submission_unknown
cancelled_local
~~~

submission_state 另存 not_submitted、confirmed 或 unknown。Google 成果 ID 和本地 worker ID 不混用。

必须执行以下规则：

1. 在发出远程写入前，持久保存操作、参数快照、幂等键和 request_hash。
2. 同一幂等键及同一请求返回同一 job；同一键对应不同参数返回冲突。
3. 取得远程任务 ID 后立即保存。超时或重启后查询原 ID，不重新生成。
4. 请求可能送达、但没有返回 ID 时，进入 submission_unknown。可以查询远程候选帮助核对；相似名称和时间不是确定性成功证明。
5. 无法确定是否已经提交的写入不自动重放。界面说明可能已消耗额度，并让用户在查看结果后决定是否另行提交。
6. 只读查询可做有限退避重试；鉴权失败、额度不足、未知 schema 分别处理。不要把所有异常吞成空列表。
7. 上游 worker 默认重试逻辑必须逐操作设置；创建、上传和生成不能直接继承无限或不加区分的自动重试。
8. 取消本地等待不等于 Google 已取消任务，返回 remote_may_continue 并在界面说明。
9. 浏览器断连不丢失任务。重新打开页面可以继续查询，已下载资产可直接再次读取。
10. NotebookLM chat 也可能改变远程会话并消耗额度；回程丢失时同样避免自动重复提问。

**并发与等待的边界：** 单账号并发限制作用于短时远程调用或明确的会话临界区，不作用于整个音频任务生命周期。取得并保存 remote_task_id 后释放账号调用槽和后台执行槽，持久化 waiting_remote 及下一次检查时间；后续用可恢复的短任务查询。不能用长时间 sleep / wait 占住唯一 worker。问答的 conversation_id 更新按 remote_notebook_id 串行保护；只读轮询与长文件下载不得长期饿死交互请求。使用现有任务设施实现，不新增队列服务。

这些要求落实在既有 worker 上。SDK 的稳定性文档也明确区分已确认提交与未知提交；适配器需要按固定版本验证实际机制。[S12]

## 6. 第一版用户体验要求

### 6.1 布局

桌面主工作台沿用三栏：左侧资料与范围，中间问答/阅读，右侧笔记与成果。列宽可调整；窄屏切换为“资料 / 对话 / 笔记”标签，不强行挤三栏。

顶部显示当前 notebook、引擎、实际选中资料数量和连接状态。Google 连接、模型配置与产品内部资料导入分开显示，避免用户误以为配置 API key 才能使用个人订阅。

### 6.2 必须处理的交互状态

- 上传逐项显示等待、提取中、可检索、需 OCR、不支持或失败；一份失败不阻止其他文件。
- 资料已选但未同步至 Google，提供明确的同步动作和目标 notebook；不能静默上传。
- 选择过多资料、上下文不足或来源未就绪时，展示实际原因与可操作的下一步。
- 引用可打开对应版本，并显示原文片段；高亮定位失败时保留真实页定位和片段。
- 答案使用 Markdown；中文、表格、代码块和数学表达应正常显示；对不可信 HTML 做清理。
- NotebookLM 返回完整答案时，可以展示等待阶段。只有上游实际支持时才显示逐 token 流，不通过打字动画伪装流式能力。
- 答案可保存到笔记；保存的是内容、引用和资料范围快照，不只是失效链接。
- 重新登录入口不清空资料，不删除 Google notebook。
- 音频任务可见状态、播放、下载；刷新页面不丢任务。
- 测试假数据只能在显式开发模式出现，显示“模拟数据”；生产启动默认禁止 fake adapter。

设计目标是使资料范围、引用和任务状态更清楚。不要为第一版大量重画已可用的上游界面。

## 7. 执行计划与阶段门槛

每个任务都要形成可复查的变更、验证结果和进度记录。依赖满足后自动进入下一任务；不要把所有任务拖到最后才第一次启动应用。

### 7.1 阶段顺序与工作量估算

| 阶段 | 任务 | 可交付结果 | 规划工作量 |
|---|---|---|---|
| M0 | T00、T01 | 固定版本、能启动的私有基础应用、已记录的环境限制 | 0.5–1.5 个工程工作日 |
| M1 | T02、T03 | 原件上传、版本、阅读、页级证据；无模型也能使用 | 2–3 个工程工作日 |
| M2 | T04、T05 | 可控选源、独立问答接口、多轮与引用；模型实测单列 | 1.5–3 个工程工作日 |
| M3 | T06、T07、T08 | 个人 Google 连接、关联/同步、真实 NotebookLM 问答 | 2–4 个工程工作日 |
| M4 | T09、T10 | 笔记/提纲/音频、项目导出恢复 | 1.5–3 个工程工作日 |
| M5 | T11、T12 | 核心端到端验收、远程运行、可复现交接 | 1–2 个工程工作日 |

这是按一名开发执行者配合编码 Agent 的工程量估算，总量约 9–17 个工程工作日，部分可并行。不是 GPT dot 的运行时长或完成承诺；登录、环境限制和上游协议变化可能延长日历时间。优先使用阶段验收判断进度。

T06 可以在 T01 之后与 M1/M2 并行；契约、迁移编号、共享认证和 API 入口由主执行者统一管理，避免多个 Agent 同时修改。

### T00 — 固定代码与检查环境

**依赖：** 无。  
**读取：** 本计划、目标目录的 AGENTS.md、上游 README、开发/架构/安全文档、锁文件。  
**产出：** docs/v1/ENVIRONMENT.md、UPSTREAM.md、DECISIONS.md、PROGRESS.md；固定提交的工作分支。

- [ ] 检查工作区和 git 状态，保护已有用户文件与未提交改动。需要时创建独立目录或工作分支。
- [ ] 获取 Open Notebook 的实际可用版本，固定完整 commit SHA；记录 URL、tag、SHA 和基础依赖版本。
- [ ] 固定 notebooklm-py 基线并核对 SDK 公共方法。若选择非候选版本，记录差异原因。
- [ ] 执行第 2 节环境检查，分别判断运行、存储、外部访问、人工登录和模型条件。
- [ ] 通过符号搜索确认第 3 节所有要改动的上游位置，记录真实路径。
- [ ] 运行一次上游最小构建/测试基线。已有失败与本项目引入的失败分开记录。
- [ ] 建立接口文档 docs/v1/API_CONTRACTS.md，复制本计划固定字段，补充各请求的必填项、错误码和分页规则。
- [ ] 记录实际执行命令、环境限制和下一任务；不要在此阶段重写产品范围。

**核验命令示意：**

~~~bash
git status --short
git rev-parse HEAD
rg -n "SourceDialog|ChatColumn|useNotebookChat|useFileUpload|useSourceStatus" frontend/src
rg -n "LANGGRAPH_CHECKPOINT_FILE|OPEN_NOTEBOOK_PASSWORD|INTERNAL_API_URL" .
rg -n "submit_command_job|AsyncMigrationManager|class Source" api open_notebook commands
~~~

这些命令要在正确目录逐项执行。不要输出 .env、Cookie、密钥或私有上传内容。

**完成标准：** 已知哪些工作能真实验证、哪些外部条件缺失；分支可复现；下一任务无需猜测现有文件。

### T01 — 启动私有基础应用与准备变更边界

**依赖：** T00。  
**修改：** 实际部署配置、环境示例、认证/代理必要位置。  
**新增：** docs/v1/RUNBOOK.md、配置示例；第 3.3 节契约文件骨架。

- [ ] 沿用上游启动方式，运行数据库、API、worker 和 frontend。
- [ ] 生成独立应用密码和加密密钥，使用受保护的运行时配置；只在示例文件保存变量名。
- [ ] 配置前端同源代理，数据库与内部 API 保持私有访问边界。
- [ ] 验证匿名访问页面、API、文件、任务和导出均被拒绝；不只测试登录页。
- [ ] 确认数据目录的实际挂载与权限，登记重启与工作区生命周期。
- [ ] 定义统一错误格式与引用/连接类型，前后端共享字段含义。
- [ ] 检查新迁移编号；新增 N.surrealql 与 N_down.surrealql，并在 async_migrate.py 显式注册。
- [ ] 在空数据库和含少量旧数据的测试数据库上验证迁移。回滚只在隔离测试库演练，不对用户数据试验。

**验证：** A01、A02；基础应用启动检查；迁移升级后已有来源仍可读取。  
**完成标准：** 存在受保护的真实基础应用；若公网/预览能力缺失，记录受阻而非跳过认证工作。

### T02 — 原件保存、版本与不依赖模型的证据提取

**依赖：** T01。  
**修改：** Source 模型、来源上传和提取接入点。  
**新增：** domain/evidence.py、evidence_service.py、evidence_commands.py、tests/test_v1_evidence_ingest.py。  
**消费 / 产出：** 上传真实字节 → SourceVersion + Extraction + EvidenceRecord。

- [ ] 复用原件存储和安全下载；写入完成后计算 sha256，记录 MIME、字节数和版本。
- [ ] PDF/MD/TXT 提取默认不触发摘要、LLM 转换或 embedding。检查上游默认流程，明确绕过依赖缺失的步骤。
- [ ] PDF 优先复用已有按页文本能力；若没有，新增轻量 CPU 提取实现，优先评估 pypdf 并锁定依赖。V1 不为此引入整套 OCR 服务。
- [ ] 每页保留提取文本和页序；段落划分不能丢失所属页。MD/TXT 保留编码错误提示与段落/行定位。
- [ ] 文本为空的扫描页标记 needs_ocr；混合 PDF 记录成功页和未解析页，不能宣称整份已完整解析。
- [ ] 新版本、新提取与旧证据共存；重复执行同一提取任务不会制造重复证据。
- [ ] 在 commands/__init__.py 注册任务，沿用 worker 状态查询。
- [ ] 文件页数、大小和处理时间有可配置上限；超限返回明确错误。

**验证：** A03–A06；两份不同 PDF 上的相同短语不会串页；重新解析后历史引用仍指向旧提取。  
**完成标准：** 没有任何模型凭据也能上传、解析、检索原文证据和下载同哈希原件。

### T03 — 来源阅读器与引用交互

**依赖：** T02。  
**修改：** 实际 SourceDialog、ChatColumn、资料列表与国际化文件。  
**新增：** evidence router、前端 evidence API/类型/组件、关键组件测试。  
**消费 / 产出：** evidence_id → 对应版本、页或段落、原文片段。

- [ ] 先检查上游阅读器，复用可满足要求的部分；需要 PDF.js 时加入固定版本依赖。
- [ ] 阅读器通过受认证接口读取原件。不能将上传目录变成开放静态目录。
- [ ] 点击引用打开正确文件版本和物理页，展示引用片段。
- [ ] 只有确定匹配时高亮；无法匹配时显示页与片段，并说明未完成精确高亮。
- [ ] 支持旧版本引用、MD/TXT 段落定位和远程未映射引用。
- [ ] 保存资料选择与阅读位置；刷新后恢复，历史问题仍展示当轮范围。
- [ ] 验证中文、长标题、空状态、错误状态、深浅主题和窄屏布局。
- [ ] Markdown 渲染清理不可信 HTML；引用点击不执行来源文本中的指令。

**验证：** A05–A08、A13；关键浏览器用例必须有实际页面操作记录。  
**完成标准：** 从真实引用可以回到真实内容；没有猜测页号和虚假高亮。

### T04 — 可控选源与检索

**依赖：** T02；T03 可并行。  
**修改：** 上游上下文/检索接入点。  
**新增：** 有必要的证据检索模块、tests/test_v1_scoped_retrieval.py。  
**消费 / 产出：** 问题 + 版本 ID 白名单 → 按相关性排序的 EvidenceHit 列表。

- [ ] 所有检索先按本轮来源版本白名单过滤，再排序；不能先检索全库再仅在 UI 过滤。
- [ ] 无 embedding 时提供真实的词法检索。检查现有 BM25 对中文和短语的效果；必要时在同一模块增加中文字符/短语匹配，避免新建搜索服务。
- [ ] 有已配置且授权的 embedding 时可复用上游索引，但不能将其作为上传和阅读的依赖。
- [ ] EvidenceHit 包含 evidence_id、score、retrieval_method 和实际原文；下游不依赖某个向量数据库 ID。
- [ ] 基于模型实际上下文配置管理系统提示、历史、证据和输出预算。无法精确计数时使用保守估计并记录，不能默默截掉大部分来源。
- [ ] 没有选源、来源未就绪和检索无结果分别返回明确状态。
- [ ] 来源更新不自动改变旧轮次范围；更换索引不破坏历史引用。
- [ ] 记录所选来源数、实际检索来源数及证据数量，便于判断回答覆盖程度。

**验证：** A07、A08、A14；使用预先标注的中文检索题检查命中页，不能只验证内部函数返回了自己构造的结果。  
**完成标准：** 无模型情况下，真实原文检索可用；资料范围在后端生效。

### T05 — 独立模型问答与统一回答记录

**依赖：** T04。  
**修改：** 对话入口、现有模型配置和必要的历史适配。  
**新增：** grounded_chat.py、统一 turns 路由、tests/test_v1_grounded_chat.py。  
**消费 / 产出：** TurnRequest + EvidenceHit → TurnRecord + 引用。

- [ ] 使用已有 provision_langchain_model 和凭据管理，不新建重复的模型设置系统。
- [ ] 提示词明确来源是证据数据，不是系统指令；不得让文档内容触发上传、删除、shell 或模型配置修改。
- [ ] 模型可以引用当前证据清单中的 ID；服务器核验 ID、版本、选源和片段。
- [ ] 无证据或无法支持的问题返回不足说明；对于未验证内容保留明确标记。
- [ ] 支持追问和指代，保存每轮完整 scope_snapshot。引擎切换时不混淆两个服务的会话。
- [ ] 使用流式输出时，最终引用必须经过核验才进入最终记录；中间文本不提前标成已验证。
- [ ] 模型配置缺失、服务超时、额度不足、上下文超限分别处理；禁止悄悄切换到收费备用模型。
- [ ] 可用真实端点来自用户已有配置或明确授权；没有端点就完成 fake-model 测试，真实验证状态保留待配置。

**验证：** A08、A14、A15；无依据问题、伪造引用、来源中的提示注入、范围切换和调用失败。  
**完成标准：** 统一回答管线和配置界面可运行；独立模型是否真实通过单独记录。

### T06 — NotebookLM SDK 与人工登录

**依赖：** T01，可与 T02–T05 并行。  
**新增/修改：** notebooklm contracts、sdk_adapter、fake_adapter、连接服务和 UI、依赖锁文件、tests/test_v1_notebooklm_auth.py。  
**消费 / 产出：** 单一专用 Web profile → 经过真实验证的 ConnectionStatus。

- [ ] 在固定版本中核对 notebooklm-py 公共 API 和 CLI；记录能力表，不从 main 示例臆测签名。
- [ ] 登录材料放在受保护、可持久化的专用目录，权限只给运行该服务的账号。目录不属于上传、静态资源或源码目录。
- [ ] 使用公开支持的 Web 登录机制，由用户在专用浏览器中亲自登录 Google。不要在聊天或应用表单收集密码、验证码、原始 Cookie 或 master token。
- [ ] connect 只创建一个有期限的登录流程；同一账号并发登录请求返回现有流程，防止相互覆盖。
- [ ] 登录后做真实网络鉴权，再执行一次只读 notebook list。按固定版本检查 auth check --test --json 等诊断结果；status 命令不能替代鉴权。[S10][S13]
- [ ] 在运行应用的实际环境验证会话可读取，不把开发 Agent 自己的浏览器登录当成应用已经登录。
- [ ] 登录过期进入 needs_reauth；用户重新连接后恢复任务查询，不能清空资料或重新生成成果。
- [ ] 断开连接先阻止新调用并关闭旧 SDK 客户端，再清理本平台会话，防止正在运行的刷新逻辑重新写回凭据。已有远程任务保留历史状态，不因此重提交。不删除 Google 数据；说明这不代表撤销 Google 全账户所有会话。
- [ ] 如果云环境不能提供人工登录，展示真实受阻原因；不要改用 Android/master token 或公开 CDP 作为默认补救。[S14]
- [ ] fake_adapter 通过测试依赖注入，不在生产错误时自动启用。

**验证：** A09；有效格式的过期会话、缺少文件、网络失败、未知响应、取消登录和真实只读请求。  
**完成标准：** 连接管线可运行；只有实际网络验证通过才能显示 connected。

### T07 — 已有 NotebookLM 导入、关联和原件同步

**依赖：** T02、T06。  
**新增/修改：** notebooklm_service、router、RemoteNotebookLink/RemoteSourceLink、导入页面、任务命令、tests/test_v1_notebooklm_sources.py。  
**消费 / 产出：** 用户选择的远程 notebook / 本地版本 → 映射、可取得内容及导入报告。

- [ ] 实现远程 notebook/source 列表和分页，避免只导入第一页却显示全量成功。
- [ ] 允许把本地 notebook 关联到选定远程 notebook；创建远程 notebook 必须由明确操作触发。
- [ ] 导入前展示清单：可取得元数据、文本、成果、原件缺失情况；用户选择导入范围。
- [ ] 只调用该版本和账号实际支持的读取方法；未知格式与不支持项写入 import_report，不丢弃记录。
- [ ] 下载可取得的文本时注明 remote_text_snapshot、取得时间和完整性状态。没有原 PDF 就保留 original_status = missing。
- [ ] 用户明确选择原件版本和目标后，提交同步任务；完成后保存实际 remote_source_id 并等待远程来源处理完成。
- [ ] 上传映射按版本和目标绑定；重复点击同一任务不再次上传。未知提交状态按第 5.5 节处理。
- [ ] 远程来源被修改、删除或无法访问时标记 stale / missing；不删除本地原件或覆盖旧证据。
- [ ] 为远程已有来源提供补传原件、用户确认关联与文本核验；同名不自动标为相同。
- [ ] 导入报告保存 requested、imported、skipped、failed、missing_originals、unsupported 和分页完成状态。

**验证：** A10、A11、A18；多页清单、部分成功、重复上传、同名不同文件、服务端已接收但回程丢失。  
**完成标准：** 已有资料可按实际能力进入自己的工作台；原件缺失和远程依赖可见。

### T08 — 默认 NotebookLM 问答与可核验引用

**依赖：** T03、T05 的统一记录契约、T07。  
**新增/修改：** SDK chat 适配、统一 turns 服务、引擎选择 UI、tests/test_v1_notebooklm_chat.py。  
**消费 / 产出：** 明确资料范围 + 用户问题 → 远程答案 + 保留原始粒度的引用 + 本地回答快照。

- [ ] 提问前验证连接、操作能力、选源映射、远程处理状态和上下文参数。
- [ ] 使用实际 source IDs 和 conversation_id，并验证其历史隔离语义；更换选源或无法确认旧范围时，建立非破坏性新上下文。能力不足就返回 SCOPE_ISOLATION_UNAVAILABLE，不替换为全 notebook 查询，也不只提示后继续旧会话。
- [ ] 保存远程回答的必要规范化字段和引用；调试信息脱敏，不能保存完整网络日志或 Cookie。
- [ ] 按第 4.4 节映射到本地证据；无法映射时显示真实远程引用。
- [ ] 明确区分本地 UI 会话与 Google 服务端会话；不调用删除历史的快捷参数。
- [ ] 前端展示实际处理阶段；没有 token stream 时等待完整答案后显示。
- [ ] Google 登录过期、额度不足、服务变更、范围外引用和超时分别返回可操作状态。
- [ ] 问题或回答不能自动触发上传、资料生成、删除或分享。
- [ ] 用真实选定 notebook 完成问答与追问；无实际登录时仅记录模拟测试通过。

**验证：** A07、A08、A12、A13、A19；实际请求参数、答案证据、资料切换、异常恢复。  
**完成标准：** 默认个人订阅问答真实可用或明确受阻；不要求额外配置 Gemini API 来替代这一验收。

### T09 — 笔记、学习提纲与一个音频生成闭环

**依赖：** T08；笔记本地功能可提前。  
**新增/修改：** 现有 notes / Studio UI、artifact 适配和任务、tests/test_v1_artifact_jobs.py。  
**消费 / 产出：** 已生成答案或明确选源 → 笔记 / Markdown 提纲 / 音频资产。

- [ ] 回答一键保存为笔记，保留引用、范围和时间；后续改动原件不改写历史笔记证据。
- [ ] “学习提纲”使用当前选择的引擎与来源，形成可编辑 Markdown 笔记。
- [ ] 提纲显示来源清单和生成方式，不声称覆盖了未解析页、未选择文件或全学期内容。
- [ ] 音频按钮展示将使用的远程 notebook、来源数量、语言和实际支持的选项；语言优先中文，SDK 不支持则明确提示。
- [ ] 生成音频只在用户点击后提交一次，持久保存远程任务 ID 后释放执行槽；用持久化的短任务按原 ID 轮询，不阻塞普通问答。
- [ ] SDK 不支持所需选源或该账号不可用时禁用并说明原因；不悄悄使用额外资料生成。
- [ ] 完成后下载真实音频，依据实际 MIME 与扩展名保存，计算哈希，提供受保护播放与下载。
- [ ] 已有远程音频也可选择导入；不能取得的资产记录为未取得。
- [ ] 限制下载大小和来源，使用已验证的 artifact 身份；不接收用户提供的任意内网 URL 作为下载目标。
- [ ] 取消仅停止本地等待时明确标识；重开页面能找到原任务。

**验证：** A16–A19；实际音频可播放/下载，模拟提交回程丢失时生成调用数为 1。  
**完成标准：** 笔记和提纲可用；音频实现、模拟验证和账号真实验证分别报告。

### T10 — 可移植项目导出与全新环境恢复

**依赖：** T02–T09 的数据契约；可先对基础数据开发，再补音频。  
**新增：** portable_service、router、导出/恢复 UI、tests/test_v1_portable_roundtrip.py、docs/v1/PORTABLE_FORMAT.md。  
**消费 / 产出：** 一个本地 notebook 的真实数据 → 无应用凭据的项目包 → 干净目录中的恢复项目。

V1 使用带 format_version 的 ZIP，建议结构如下：

~~~text
manifest.json
notebook.json
sources.json
versions.json
extractions.json
evidence.jsonl
turns.jsonl
remote-links.json
import-reports/
originals/
text-snapshots/
notes/
artifacts/
README.md
~~~

- [ ] 导出先建立项目一致性快照。V1 默认使用项目级短时写入屏障，覆盖笔记保存、聊天最终落盘、来源变更和成果登记；等待已进入提交阶段的写入完成后，固化实体与文件清单到暂存区。禁止在打包过程中不断追读变化的最新状态。
- [ ] 大文件打包在释放短时写入屏障后进行，但快照引用的原件/成果必须保持不可变并禁止提前清理。所有引用在快照内闭合；未完成任务列入报告，不混入半成品。读到跨存储不一致就明确失败，不能给出成功下载件。
- [ ] manifest 记录每个文件的 sha256/长度、实体数量、软件版本、缺失原件与不支持项。
- [ ] 导出原件、版本、提取文本、引用、笔记、相关聊天记录、已保存成果和必要映射。
- [ ] 以应用级格式导出，不把原始数据库文件直接装进普通项目包。现有 SQLite 聊天通过适配器导出规范化消息，忽略模型运行时内部检查点。
- [ ] 对原有普通聊天可导出可见历史；没有原生精确定位的老引用保留其实际粒度，不伪造新证据。
- [ ] Markdown 笔记使用可读引用清单和包内相对文件链接；单独打开也能看到来源名、原文片段和真实页码/段落信息。
- [ ] 应用管理的密码、API key、Google 会话、加密主密钥和临时签名 URL 不进入项目包。模型只导出非敏感名称与配置提示。
- [ ] 导入先检查格式、文件哈希、大小上限和引用完整性；拒绝路径穿越、符号链接逃逸和异常膨胀压缩包。
- [ ] 导入到新 notebook，处理 ID 冲突并维护完整映射；出错回滚或隔离半成品，不破坏现有项目。
- [ ] 在全新数据库、SQLite 与文件目录中恢复；不能继续访问原目录来冒充成功。
- [ ] 恢复后原件哈希、笔记和历史引用一致。embedding 可重建；Google 和模型凭据需要重新配置，恢复数据成功与在线问答恢复分开验收。
- [ ] 恢复的远程映射先标为未验证，任务记录作为历史保留。重新绑定当前账号后才能查询真实远程任务；恢复绝不自动重放创建、上传、问答或生成。上游内部 LangGraph 执行现场不属于可移植格式，后续对话使用恢复的规范化历史重建上下文。

运维手册另行说明整实例备份的范围：SurrealDB、SQLite、原件/成果目录及必要配置；凭据单独保管。这类备份属于敏感管理材料，不混入普通项目导出。

**验证：** A20、A21；加入测试用凭据标记，确认应用管理的秘密没有进入包内；修改包中文件应被校验拒绝。  
**完成标准：** 用户可以带走项目，且在不依赖原环境的情况下恢复和核对资料。

### T11 — 稳定性、访问与实际运行验证

**依赖：** T08–T10。  
**修改：** 已实现模块的必要缺陷，不增加范围。  
**新增：** 核心 E2E、故障注入用例、运行与备份说明。

- [ ] 上传、解析、问答、Google 作业、导出都能从页面找到进度和终态。
- [ ] 为创建、上传和生成验证幂等键、进程重启、超时和未知提交状态。
- [ ] 运行必要的认证、下载路径、跨站请求和不可信 Markdown 用例。
- [ ] 浏览器测试优先复用已有框架；若新增 Playwright，将 frontend/e2e/v1/ 与 Vitest 收集路径显式隔离，避免两类测试互相误收集。
- [ ] 记录真实外部 HTTPS 地址和访问条件；从外部浏览器验证登录与核心流程。
- [ ] 用原件哈希及数据计数验证应用进程重启；根据环境能力验证容器重建/工作区停止，不擅自销毁唯一环境做实验。
- [ ] 记录构建、上传/解析耗时、问答耗时、音频生成耗时及样本大小；不承诺没有测过的吞吐量。
- [ ] 关闭生产 fake 模式和开发公开调试入口；日志只保留必要状态、时长、错误类型与 ID。
- [ ] 对本项目改动运行相关测试；最终运行必要的上游回归与前端构建，已有问题单列。

**验证：** A01–A24 的相关状态矩阵。  
**完成标准：** 没有未说明的核心故障；未解决的外部条件有准确描述和可继续的下一步。

### T12 — 可复现交付与续做说明

**依赖：** T11。  
**产出：** 源码变更、固定版本、运行说明、验收报告、项目示例包与下一步列表。

- [ ] 提供私有运行地址或明确的运行命令；写清链接过期/休眠条件。
- [ ] 提供完整源码分支与变更提交。若不能推送到用户指定仓库，生成可下载源码包，包含锁文件与部署文档。
- [ ] 源码包不包含 .env、Google profile、真实私有资料、依赖缓存或构建缓存。
- [ ] docs/v1/ACCEPTANCE.md 按 A01–A24 记录命令/操作、环境、结果、时间和证据位置。
- [ ] docs/v1/RUNBOOK.md 说明启动、停止、重新登录、模型配置、备份、恢复和协议变更后的更新方法。
- [ ] docs/v1/PROGRESS.md 写明最后完成任务、当前提交、剩余阻塞和下一条实际操作。
- [ ] 列出上游与新增依赖的许可证；保留上游版权。公开发布或正式多人部署属于后续动作。
- [ ] 最终报告逐项说明真实验证与模拟验证，不能用测试截图替代可运行代码和真实地址。
- [ ] 若仍需人工登录或配置，将对应页面/流程准备好后再提出具体操作；此前继续完成所有不受影响的工作。

**完成标准：** 另一个编码 Agent 可根据文件继续运行和维护；用户能清楚判断自己现在能用什么。

## 8. 配置、资源与恢复策略

### 8.1 可配置的 V1 默认限制

以下是开发默认值，应写入配置示例并允许调整；它们不是 Google 套餐限额。

| 项目 | 默认策略 |
|---|---|
| 单文件大小 | 50 MiB，前后端一致校验 |
| 单份 PDF 页数 | 300 页；超限明确提示，不能只处理前 300 页后显示完整成功 |
| 一轮选源数量 | 20 份；明确显示已选择和实际就绪数量 |
| 本地提取并发 | 2；按 M0 实际内存下调 |
| 单 Google 账号短时远程调用并发 | 1；拿到音频任务 ID 后释放执行槽；会话更新按 notebook 串行 |
| 检索证据数量 | 初始最多 12 段，按相关性和上下文预算选取，记录实际覆盖 |
| 模型上下文 | 按实际模型/用户配置计算，预留输出空间；不假定所有模型都有长上下文 |
| 只读失败重试 | 最多 3 次，带退避；登录失效和明确配额不足停止 |
| 远程写入重试 | 由提交确定性决定；unknown 不自动重放 |
| API 新增支出 | 默认 0；用户配置授权服务后按其预算执行，不自动充值或换收费服务 |
| 自动生成成果 | 默认关闭；每次由用户明确触发 |
| 导出包上限 | 根据磁盘与代理能力配置；同时限制压缩后、解压后大小和文件数量 |

若用户以后调整 Google 计划，应用通过真实能力和错误响应反映变化，不把某个套餐数字硬编码成永久规则。

### 8.2 数据发送范围

页面用简短文字说明一次操作将发送什么：

- NotebookLM 问答：问题、显式选定来源 IDs，以及该服务实际所需的上下文。
- 原件同步：选定原文件发送至所选 Google notebook。
- 独立模型：问题、必要历史和检索到的证据片段发送到用户配置的端点。
- 普通阅读、词法检索、笔记编辑与项目导出：在本平台处理。

不要把上传原件、后台爬取网页或启动研究任务当作提问的隐含动作。

### 8.3 五类必须验证的失败模式

| 失败类 | 例子 | 必须表现 |
|---|---|---|
| 无结果 | 没有选源、扫描 PDF 无文本、来源不含答案 | 清楚说明，保留其他资料可用；不生成虚假成功 |
| 格式或类型不符 | 损坏 PDF、未知 Google 响应、缺失引用字段 | 类型化错误或明确降级，不吞成空列表 |
| 依赖失败 | DB/worker 断开、模型不可达、Google 登录失效 | 有恢复入口；不清空资料、不自动收费切换 |
| 中途失败 | 上传已接收但回程丢失、音频等待超时、导入中断 | 持久状态、幂等与核对；避免重复写入 |
| 控制或信任问题 | 范围外引用、来源含指令、下载路径逃逸、未认证访问 | 在后端阻止或标为未验证，记录必要诊断信息 |

## 9. 测试材料与验收矩阵

### 9.1 可复现测试材料

在 tests/fixtures/v1/ 保存自行编写、无隐私和可再分发的固定材料，并记录生成方法与 sha256。不要上传用户其他 notebook 的资料来做开发测试。

| 材料 | 需要覆盖的情况 |
|---|---|
| fixture_a.pdf | 3 页可提取的中文文本，含一个明确定义和一个参数；人工标注物理页 |
| fixture_b.pdf | 4 页文字，包含与 A 相同的短语，但另有不同参数；同一短语可在两页出现 |
| fixture_scanned.pdf | 至少 1 页没有可提取文本的扫描型 PDF，预期为需 OCR |
| fixture_course.md | 中文标题、表格、代码、数学表达、长段落和可定位引用 |
| fixture_invalid.pdf | 非法或截断文件，预期可控失败 |
| fixture_untrusted.md | 在资料正文中放置无效的操作指令，验证它不会变成执行命令 |

建立 20 道 gold 问题：16 道有明确原文依据的问题，覆盖单来源、多来源和范围切换；2 道资料中没有答案的问题；1 道重复短语定位问题；1 道不可信来源指令测试。标注答案要点和有效证据位置，不用 Google 的回答自动充当标准答案。

建议作为小样本回归门槛：

- 所有实际渲染的“已验证”引用都通过身份、范围和原文校验。
- 10 条人工选定的页/段落定位全部正确；歧义情况不得猜测定位。
- 16 道有依据问题中至少 14 道达到人工标注的答案要点与证据要求。
- 2 道无依据问题均不捏造资料支持；范围切换和来源指令测试全部通过。
- 两个问答引擎分别评估。未配置的引擎记未验证，不按 0 分或通过处理。

这些数字是 V1 测试集门槛，不代表在用户全部资料上的总体准确率。

Google 实测使用用户指定的测试 notebook，或在用户明确触发后创建一份包含上述公开材料的测试 notebook。首次连接默认只读。生成音频需要明确的一次操作，不在设置页加载时执行。

### 9.2 验收编号

| 编号 | 验收项目 | 最小合格证据 |
|---|---|---|
| A01 | 私有页面 | 未登录不能进入用户工作台，登录后可用 |
| A02 | API 与文件保护 | 未认证直连来源、原件、任务、导出均被拒绝，路径逃逸无效 |
| A03 | 无模型上传 | 不配置模型，也能导入并提取真实 PDF/MD/TXT；原文件下载哈希一致 |
| A04 | 解析降级 | 扫描/损坏文件如实显示；部分成功有页数与警告，不显示完整成功 |
| A05 | 精确定位 | 10 条已知引用打开正确文件版本与物理页/段落；高亮有依据 |
| A06 | 版本稳定 | 更新文件、重新解析、重建索引后，历史引用仍指向对应旧内容 |
| A07 | 选源持久化 | 刷新后保留当前选择，历史轮次保存自己的范围快照 |
| A08 | 多轮与范围切换 | 先只用 A 提问，再只选无答案的 B 追问；隔离旧证据后回答不足，或明确阻止不支持的严格选源请求；不得沿用 A 的事实 |
| A09 | Google 登录 | 实际应用运行时网络鉴权和只读请求通过；过期会话显示需重连 |
| A10 | 远程导入清单 | 分页完整；导入报告的成功、失败、缺失原件与实际数据一致 |
| A11 | 创建/同步 | 明确选择的原件进入正确远程 notebook；实际远程 ID、版本映射和状态可查 |
| A12 | 真实 NotebookLM 问答 | 使用用户实际账号完成真实问题和追问，记录来源范围及引用 |
| A13 | 远程引用诚实 | 可匹配才定位；同名/歧义/缺少原件时不伪造页码或绿色校验 |
| A14 | 独立通道 | 真实词法检索和协议测试通过；已有模型端点时实测并核对 gold 题 |
| A15 | 模型失败与资料指令 | 无模型、超时、上下文超限可恢复；来源正文不触发工具副作用 |
| A16 | 笔记与提纲 | 可编辑、保存和导出；保留来源及实际覆盖，不声称未处理内容已覆盖 |
| A17 | 音频生成与导入 | 分别验收：生成须明确触发、真实提交及 ID、原任务轮询、下载播放；已有音频导入只证明导入链路，不能替代生成通过 |
| A18 | 幂等写入 | 双击、代理重试、响应丢失和 worker 重启不会盲目重复创建/上传/生成 |
| A19 | 任务恢复与并行使用 | 刷新后查询原任务，unknown 明确待核对；音频长期 processing 时普通问答、阅读和状态查询仍可用，生成调用数保持为 1 |
| A20 | 一致快照与全新恢复 | 并发保存笔记/问答/成果时导出形成闭合快照或明确失败；在新数据库/目录恢复后哈希与引用一致，不重放远程任务 |
| A21 | 导出完整性与秘密 | 缺失内容如实列出；篡改包被拒绝；应用管理的密钥/会话不在项目包 |
| A22 | 远程访问与生命周期 | 外部浏览器访问真实 HTTPS 地址；重启后资料保留，其他生命周期限制清楚 |
| A23 | 可复现代码 | 固定提交、锁文件、配置示例、运行命令能启动；源码交付不含秘密 |
| A24 | 诚实验收报告 | 每一项都有真实通过/模拟通过/未验证/受阻/延期状态与证据 |

A09 通过，表示 Google 连接及基础读取已真实验证；A09 与 A12 通过，表示默认 NotebookLM 问答已接通。A11 单独证明远程创建/原件同步能力；写入未验证不撤销已取得的连接和问答证据，也不得因此自动执行写入。只有模拟测试时，不得写“订阅已导入”或“Google 已接通”。

A14 的独立模型实测在未提供端点时允许保留待配置；只要真实 NotebookLM 通道通过，仍可交付个人可用版本。A17 音频受阻时，说明已可用的核心功能与未完成的音频，不宣称所有 V1 功能已经真实验证。

### 9.3 测试命令与运行规则

固定 checkout 的实际命令优先。上游文档提供的常见开发入口如下，实施者应核对后写入 RUNBOOK；这些命令在编制本计划时没有被执行。[S15][S16]

~~~bash
# 仓库根目录：安装锁定的 Python 依赖；修改依赖后更新并提交锁文件
uv sync --frozen

# frontend 目录：存在匹配 package-lock.json 时使用
npm ci

# 仓库根目录：按 Makefile 在相应独立终端运行
make database
make api
make worker-start
make frontend

# 仓库根目录：新增测试与最终必要回归
uv run pytest tests/ -k v1
uv run pytest tests/

# frontend 目录：按实际 scripts 核对参数
npm run lint
npm run test -- --run
npm run build
~~~

开发 API 的上游入口是 uv run --env-file .env run_api.py，应通过实际 Makefile/文档确认；不要臆造 python -m api.main。上游开发文档中的宿主机数据库连接和容器内连接不同，按实际网络配置。配置 OPEN_NOTEBOOK_PASSWORD、OPEN_NOTEBOOK_ENCRYPTION_KEY 和 INTERNAL_API_URL 时只写非敏感示例值。[S16]

**鉴权测试须单独启用真实认证。** 上游默认测试配置会关闭应用密码，并可能加载仓库 .env；因此普通 pytest 通过不能证明访问控制有效。A01/A02 使用明确开启密码的独立测试进程或实际部署入口；测试数据和配置隔离，不能让模拟测试意外读取用户真实凭据或调用外部服务。[S15]

为交接新增并验证以下便捷入口，名称若冲突可调整，但必须在 RUNBOOK 写清：

| 入口 | 行为 |
|---|---|
| make v1-check | 新增相关测试、必要类型/格式检查及前端构建；不调用收费模型或 Google 写入 |
| make v1-e2e | 固定测试数据、测试 adapter 的核心浏览器流程；输出真实本地测试结果 |
| make v1-live-check | 只执行已配置并授权的外部验证；默认只读，受阻与跳过可见 |
| 项目导出/恢复页面 | 执行 A20 的端到端恢复，使用隔离数据目录 |
| docs/v1/RUNBOOK.md | 记录与当前实际版本一致的启停、模型、登录与恢复步骤 |

不为纯样式修改编写大量镜像测试。重点测试数据边界、引用、任务恢复、鉴权和外部适配。解决具体风险并满足验收后，停止无目的扩大测试。

## 10. 进度、交接与开发 Agent 的行为约定

### 10.1 每阶段记录格式

docs/v1/PROGRESS.md 至少包含：

~~~text
当前阶段 / 任务：
当前代码提交：
已完成的功能：
本次实际运行的检查及结果：
真实服务已验证项：
模拟测试项：
当前受阻项与原因：
缺少的具体用户输入或环境能力：
下一条可直接执行的操作：
~~~

如额外提供 progress.json，字段与上面一一对应。不得把“写了测试”当作“测试已运行通过”。

每个阶段至少提交一次可复现的本地变更；若执行环境不允许 git commit，保存准确补丁/源码与状态说明。不要提交密钥、Google profile 和真实私有资料。

### 10.2 中断后续做

新的 Agent 先读 DEVELOPMENT_PLAN.md、PROGRESS.md、DECISIONS.md 和当前 diff，确认实际代码状态；从下一未完成任务继续。已经有证据通过的任务无需从零重做，只有版本变化或具体风险需要时才重复验证。

常规实现选择由执行者按本计划完成并记录。以下情况需要针对性的人类操作，但都不应阻塞无关工作：

- Google 实际要求用户登录或身份验证；
- 平台权限不允许必需的运行、浏览器或存储方式；
- 新增付费资源/启用计费所需的明确决定；
- 真实测试需要用户选择 notebook 或确认发送的文件；
- 确定会删除或覆盖用户数据的动作。

提问时给出已准备好的页面/文件、准确阻塞原因和需要做的具体动作；不要笼统说“请提供所有配置后我才能开始”。

### 10.3 最终交付报告模板

~~~text
1. 本次实现范围与所用上游提交。
2. 实际访问地址，登录方式，地址的休眠/失效条件。
3. 现在可用的核心操作。
4. 真实 Google 问答、音频、独立模型分别是否验证通过。
5. A01–A24 状态矩阵和证据。
6. 原件、数据库、聊天记录实际保存位置与已验证的生命周期。
7. 源码、锁文件、运行说明、项目导出示例的可取得位置。
8. 现有问题、受阻事项及下一条具体操作。
9. 下一阶段建议；不把它计入已经完成的功能。
~~~

## 11. 获得算力后的演进路线

V1 为未来独立服务保留的是可迁移数据、证据身份、统一问答接口和可替换的模型调用，当前不需要提前实现所有基础设施。

| 版本 | 新增重点 | 进入条件 |
|---|---|---|
| V1.1 | 对真实 Takeout 样本做格式适配；按来源/章节逐项处理的覆盖式学习综合；闪卡/测验；改进表格和 OCR | V1 数据与引用稳定，有实际样本和质量评估 |
| V1.2 | 视频转写、时间戳与关键帧，PDF 图表/公式；多模态证据 | 有代表性资料、资源上限和可评估的解析方案 |
| V2 | 自部署语言模型、embedding、reranker、ASR/TTS；在同一 API 和证据体系内切换 | 已有算力，模型及运行许可明确，完成质量/延迟/成本实测 |
| V3 | 用户、组织、租户隔离、配额、任务公平调度、运维与服务计费 | 独立推理能力已验证，开始为多名真实用户提供服务 |

V2 可评估 Ollama / vLLM 一类模型运行方式，复用上游已有 provider 或其兼容接口；按实际硬件选择模型，不在 V1 下载大模型作为占位。云电脑没有 GPU 时不做吞吐量承诺。

V3 必须重新设计并实测服务端租户隔离、对象存储隔离、任务归属与资源限制。单人共享密码不能直接当作多人 SaaS 权限系统。面向他人的默认推理应来自自己的模型或明确授权的服务；个人 Google 连接保留为个人伴随能力。届时再核对数据库和模型许可，并依据实际需要评估存储迁移。

## 12. 直接发送给 GPT dot 的开工指令

将本文件作为附件上传，并发送下面这段话。若 GPT dot 已经能读取文件路径，直接指定该文件。

---

请按附件《NotebookLM 开源工作台 V1：云电脑开发计划书》开发第一版。

我的现有权益是 Google AI Pro 个人订阅。你需要在当前云电脑中执行开发，目标是交付真实可运行的私有网页、可保留的源码和资料，以及清楚的验收报告。

已经确定使用 Open Notebook 做小范围分支开发，以 notebooklm-py 连接我的个人 NotebookLM，保存原件、版本、证据和工作成果，保留独立模型通道。请先完整阅读计划及环境现有说明，执行 T00，固定上游提交、核验云电脑能力并记录现有测试基线，然后持续推进 T01–T12。

先交付无模型也能使用的上传、解析、阅读和引用，再接通个人 Google 问答、笔记、音频与导出恢复。T06 连接器可以与资料模块并行。按照附件处理任务依赖；常规实现选择由你决定并写入 DECISIONS.md，不必每一步都重新问我要不要继续。

默认没有新增支出授权。不要把 AI Pro 当作已经拥有通用 API 凭据或无限调用额度，不自动开通收费、充值、购买 GPU，也不把开发期间你能调用的工具当成部署应用已具备的运行时能力。

Google 登录需要我操作时，先把实际连接流程准备好，让我在可见的 Google 登录页面完成；不要向聊天索取密码、验证码或 Cookie。登录或模型条件受阻时，继续其他不依赖它们的任务，标明受阻或未验证。

请认真完成引用核验、范围切换、远程写入幂等、未知提交状态处理，以及全新数据目录恢复。模拟测试通过与真实服务通过必须分别报告，不能用假数据宣称接通。

每个阶段更新 docs/v1/PROGRESS.md，保存可复现变更。最终提供实际地址或准确运行方式、源码与固定版本、运行手册、A01–A24 验收矩阵、持久化说明和剩余人工步骤。若某个能力受阻，给出具体证据，完成其余已授权工作。

---

## 13. 一手资料与核验边界

调研日期为 2026-10-18。下列链接用于核对已存在的产品、代码与文档事实；本计划提出的新增接口、数据表、任务、默认限制与验收门槛属于设计决定。main 链接会变化，实施者应把实际依赖锁定到 tag/commit，并把关键源文件对应地址记入 UPSTREAM.md。

| 引用 | 资料 | 主要用途 |
|---|---|---|
| S1 | [Open Notebook 架构][S1] | 服务结构、模型管线、数据位置、任务 |
| S2 | [Open Notebook 扩展手册][S2] | 路由、任务注册、迁移、前端扩展方式 |
| S3 | [Open Notebook LICENSE][S3] | 主项目许可证 |
| S4 | [SurrealDB License][S4] | 数据库独立许可边界 |
| S5 | [Google Developer Program Plans & Pricing][S5] | AI Pro 开发权益信息 |
| S6 | [Google Developer Program Benefits][S6] | 权益领取与使用条件 |
| S7 | [Gemini API Billing][S7] | 独立 API 计费、预付与赠额条件 |
| S8 | [Open Notebook Source 数据模型][S8] | 现有 Source 所在文件 |
| S9 | [Open Notebook 来源路由][S9] | 上传、状态与下载 |
| S10 | [notebooklm-py CLI Reference][S10] | 登录诊断、选源、会话与操作行为 |
| S11 | [notebooklm-py v0.8.5][S11] | 调研时已存在的 SDK 基线候选 |
| S12 | [notebooklm-py Stability][S12] | 公共接口与兼容/提交状态边界 |
| S13 | [notebooklm-py Installation][S13] | Web 登录与安装方式 |
| S14 | [notebooklm-py Security][S14] | 会话目录、凭据与 CDP 边界 |
| S15 | [Open Notebook Testing][S15] | 现有测试入口 |
| S16 | [Open Notebook Development Setup][S16] | 开发启动与运行时配置 |
| S17 | [Open Notebook Frontend][S17] | 前端组织与界面扩展 |
| S18 | [Open Notebook Content Processing][S18] | 导入、转换与 embedding 流程 |

本文没有登录用户账号、创建远程 notebook、调用真实模型、生成音频、运行项目测试或完成应用部署。上述动作是交给实施者执行并提供证据的开发任务。

[S1]: https://github.com/lfnovo/open-notebook/blob/main/docs/7-DEVELOPMENT/architecture.md
[S2]: https://github.com/lfnovo/open-notebook/blob/main/docs/7-DEVELOPMENT/change-playbooks.md
[S3]: https://github.com/lfnovo/open-notebook/blob/main/LICENSE
[S4]: https://surrealdb.com/license
[S5]: https://developers.google.com/program/plans-and-pricing
[S6]: https://developers.google.com/profile/help/benefits
[S7]: https://ai.google.dev/gemini-api/docs/billing
[S8]: https://github.com/lfnovo/open-notebook/blob/main/open_notebook/domain/notebook.py
[S9]: https://github.com/lfnovo/open-notebook/blob/main/api/routers/sources.py
[S10]: https://github.com/teng-lin/notebooklm-py/blob/main/docs/cli-reference.md
[S11]: https://github.com/teng-lin/notebooklm-py/releases/tag/v0.8.5
[S12]: https://github.com/teng-lin/notebooklm-py/blob/main/docs/stability.md
[S13]: https://github.com/teng-lin/notebooklm-py/blob/main/docs/installation.md
[S14]: https://github.com/teng-lin/notebooklm-py/blob/main/docs/security.md
[S15]: https://github.com/lfnovo/open-notebook/blob/main/docs/7-DEVELOPMENT/testing.md
[S16]: https://github.com/lfnovo/open-notebook/blob/main/docs/7-DEVELOPMENT/development-setup.md
[S17]: https://github.com/lfnovo/open-notebook/blob/main/docs/7-DEVELOPMENT/frontend.md
[S18]: https://github.com/lfnovo/open-notebook/blob/main/docs/7-DEVELOPMENT/content-processing.md

# Notebook 内嵌 RAG 选型研究（2026-11-02）

## 结论

**如需新增一个可内嵌的开源检索/RAG 项目，首选 txtai；但对此现有 Open Notebook 派生应用，先复用已有 SurrealDB 向量存储与 embedding 配置，更可能是增量最轻的路线。** 用户于 2026-11-02 19:15 UTC 选择“复用现有基础设施”，随后要求继续审查和改进并推送进展。选型方向已确定；详细接入设计与实现尚未完成。未安装 txtai、调用模型或修改业务代码。

已核验仓库源码：Python >=3.11,<3.13；已有 langchain/core/text-splitters/langgraph/esperanto/surrealdb/numpy；经典搜索调用 generate_embedding + SurrealDB fn::vector_search，按 notebook_ids 过滤；空 scope 代表全局。新工作台证据链当前词法检索，按不可变 source_version_id 白名单与 evidence/locator 身份约束。上述为固定仓库源码核验，候选项目资料则来自下列官方文档。

因此不能把工作台请求直接转到旧 search endpoint。空白名单必须拒绝/返回空，不得转换为旧 API 的“全库”。复用基础设施不等于复用其旧权限语义；需以不可变 evidence 构建派生索引/适配器。

## 候选比较（仅官方资料）

### 1. txtai：新增独立内嵌引擎的首选

- Apache-2.0：[LICENSE](https://github.com/neuml/txtai/blob/master/LICENSE)。
- Python Embeddings API 可进程内 index/search，无需强制单独服务器：[Embeddings](https://neuml.github.io/txtai/embeddings/)。
- 默认 Faiss 向量索引，content=True 时默认 SQLite；可选图模块，不必使用：[配置](https://neuml.github.io/txtai/embeddings/configuration/)。
- 支持字典元数据、SQL 绑定参数、dense/sparse hybrid。但 similar() 先取向量候选，再到关系库过滤；小 scope 可能召回不足。不能把 WHERE 元数据过滤等同于授权前置隔离：[Query Guide](https://neuml.github.io/txtai/embeddings/query/)。
- 标准安装默认带 GPU-support PyTorch。txtai_minimal 为零依赖基础包，实际 embedding 功能仍需要模型后端；CPU-only 安装可减少不必要依赖：[安装](https://neuml.github.io/txtai/install/)。
- 官方 latest 为 v9.14.0，10月6日发布，要求 Python 3.11：[releases](https://github.com/neuml/txtai/releases)。
- 对本应用的缺点：再加入 Faiss/SQLite 会增加第二套派生索引生命周期；不能因为 API 简洁就假设总体比现有方案轻。只把它用于候选召回，原权限和引用校验仍由应用掌握。

### 2. LlamaIndex core：需要更多 RAG 编排能力时的备选

- MIT：[core LICENSE](https://github.com/run-llama/llama_index/blob/main/llama-index-core/LICENSE)。官方 latest release v0.14.25（2026-09-21）；monorepo release 不代表所有子包同时同版本：[releases](https://github.com/run-llama/llama_index/releases)。
- 可仅装 llama-index-core + 必要 integration，在 Python 进程内工作；并非必须用 LlamaCloud/LlamaParse。默认内存存储，可 persist 到磁盘：[官方仓库](https://github.com/run-llama/llama_index)。
- 属于 RAG 框架而非必须替换现有数据库。SurrealDB 官方指南仍称没有现成 LlamaIndex adapter，演示自定义最小 VectorStore；生产 scope/provenance 适配不能靠示例保证：[SurrealDB 指南](https://surrealdb.com/docs/build/integrations/ai-frameworks/llamaindex)。
- 本项目已有 LangChain/LangGraph，再引入第二套编排抽象未必划算。若仅补语义召回，不推荐因此重写整个 grounding 管线。

### 3. LightRAG：不作为当前轻量嵌入的首选

- MIT：[LICENSE](https://github.com/HKUDS/LightRAG/blob/main/LICENSE)。官方 latest v1.5.7，9月2日：[releases](https://github.com/HKUDS/LightRAG/releases)。
- 有 Python Core API，并不强制单独 WebUI。但它是知识图谱+向量 RAG，需实体/关系抽取及图生命周期：[官方仓库](https://github.com/HKUDS/LightRAG)。
- 四种存储分别管理 KV、向量、图、文档状态。默认 JSON/NanoVectorDB/NetworkX 等整个数据驻进程内存，文件用于持久化；官方定位小规模测试/评估，生产推荐 PostgreSQL。可配置 workspace 隔离，但仍不等于应用的逐 source_version 授权：[Core 文档](https://github.com/HKUDS/LightRAG/blob/main/docs/ProgramingWithCore.md)。
- “Light” 是相对图 RAG 的定位，不应理解为比普通向量检索依赖更少。跨文档关系推理成为明确需求后再评估。

## 模型与框架分开选

多语言和同义改写召回来自 embedding 模型与检索设计，不来自项目名称。可把 **intfloat/multilingual-e5-small** 列为中文/英文初始基线：官方模型卡标 MIT、384 维、12 层，含中英示例；最多512 token；检索需 query:/passage: 前缀，非英文同样如此。[官方模型卡](https://huggingface.co/intfloat/multilingual-e5-small)

这不是已实测最佳模型，也不是必须下载的最终决定。应用如果已有符合隐私要求的多语言 embedding 配置，优先复用；若切换模型，旧向量不得混用，需要按模型版本/维度重建。常驻内存与延迟主要受实际 embedding/生成模型、精度、批量及语料规模影响，本文不虚构 RAM/性能数字。

## 接入边界建议（未实施）

1. evidence 原件和 source_version/locator 仍是权威；向量仅是可重建派生数据。索引条目绑定 evidence_id + source_version_id + chunk/locator + embedding model revision + chunker revision。
2. whitelist 在候选层之前尽量缩小可检索集合；禁止空列表退化为全库。不能依赖 LLM 自觉不引用越权材料。
3. 返回候选重新通过现有权限与版本校验，再从权威 evidence 取原文；由原引用构建器生成 citations，避免模型/框架自行编造定位。
4. 保留词法召回，再与语义召回融合。精确术语/人名/数字与同义改写都应覆盖。不要仅凭高语义分数宣称事实有依据。
5. 默认不上传私有材料；云 embedding/生成调用要遵守现有授权与配置。离线模型需预先获取与固定模型版本；“本地可运行”不代表安装默认绝不联网。
6. 验收集应覆盖中问英答材料、同义改写、精确术语、源版本更新后旧版本引用、删除/撤权、空 whitelist、很小 scope 的召回率、证据不足拒答；实测延迟/内存/索引大小再定最终选型。

## 完成状态与限制

已完成官方仓库/文档/模型卡的在线核验与研究笔记。无安装、无 credentials、无 live embedding API 调用、无业务代码修改、无拒绝或待审批动作。最新版本是本次检索中官方页面显示值，不承诺发布页无缓存延迟。许可证为事实记录而非法律意见；模型、第三方依赖和分发方式需分别复核。

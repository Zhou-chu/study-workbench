# StudyWorkbench RAG 完整性与用户旅程红队审查
日期：2026-11-02。目标：私有仓库 Zhou-chu/study-workbench，分支 `fix/audit-followup-20261022`。

## 先说结论
**可以把支持的资料导入工作台，建立本地证据记录，再由配置的独立模型进行限定选源问答；不能据此宣称已支持 RAGFlow 或任意外部知识库。** 工作台当前本地检索是词项匹配，不是语义向量检索。经典 Open Notebook 另有向量搜索，不能混为同一工作台能力。

**NotebookLM 适配器存在，但当前生产问答主动关闭。** 当前 SDK 路径无法确认无破坏性的会话历史隔离，`ask` 直接返回 `SCOPE_ISOLATION_UNAVAILABLE`；重新登录不会修复这个能力边界。界面列出某个引擎，并不等于它当前可用。[open_notebook/integrations/notebooklm/sdk_adapter.py:153–181](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/open_notebook/integrations/notebooklm/sdk_adapter.py#L153-L181)；[open_notebook/integrations/notebooklm/sdk_adapter.py:307–313](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/open_notebook/integrations/notebooklm/sdk_adapter.py#L307-L313)。

本轮建立 **3 项新增、可定位的源码体验缺陷**，另有检索质量/接入能力边界和待运行验证项。没有建立新的 P0/P1 安全漏洞；不为凑数量重开 10/28 已关闭问题。**真实服务端到端与当前浏览器舒适度尚未通过验收。**

## 身份与证据等级
- 通过 GitHub branches 只读列表核实分支 HEAD 为 `df94d8c18bfbae217aea5c9283b7a24d38844d24`；以下源码链接全部固定该 SHA。[受审提交](https://github.com/Zhou-chu/study-workbench/commit/df94d8c18bfbae217aea5c9283b7a24d38844d24)。
- 本报告的「源码确认」指代码分支、控件条件与契约能够建立的行为，不是实际点击复现。下文场景是待运行的复现步骤。
- 本轮另外执行了固定源码 AST 的隔离 lexical fixture 探针；仅 _terms/retrieve 与假版本、假存储、假引用校验，结果见本报告检索边界节。不是运行完整项目、真实数据库、worker、模型或浏览器。
- 已阅读 [docs/v1/PM_UX_AUDIT_2026-10-28.md:1–31](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/docs/v1/PM_UX_AUDIT_2026-10-28.md#L1-L31)。该报告的 1,959 前端/2,778 后端等历史数字均不是本轮重跑；其「浏览器及真实导入→问答→引用→保存未执行」限制仍有效。
- 没有启动设备或应用，没有访问 ZC_LAPTOP，没有登录 Google、连接实际模型、输入凭据、安装依赖、修改产品代码或仓库。

## 能力矩阵（按真实路径解释）

### 1. 内置工作台 RAG：已实现，但有清晰范围
上传支持 PDF、Markdown、UTF-8 TXT，保留原始字节、哈希、不可变版本；提取在有界进程中执行。纯文字解析不需要模型。扫描 PDF 不会被自动 OCR，空白页产生 NEEDS_OCR；混合 PDF 可以 partial。不是任意 Office/PPT/扫描件全自动入库。[api/evidence_service.py:47–103](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/api/evidence_service.py#L47-L103)；[api/evidence_service.py:275–341](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/api/evidence_service.py#L275-L341)。

「索引」为保留原文偏移的证据片段，段落最长约 1,600 字符；读取时对所选版本证据词项打分，默认取 12 条。支持中文双字词项及英文字母/数字词项；这里没有外部 KB dataset selector、embedding 检索或 reranker 调用。[api/evidence_service.py:148–169](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/api/evidence_service.py#L148-L169)；[api/evidence_service.py:668–712](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/api/evidence_service.py#L668-L712)。

问答只接收 independent + local，要求明确非空版本白名单，并核实每个版本属于当前 notebook。模型由既有默认 chat model/provisioning 配置提供，不自动找备用模型。[open_notebook/graphs/grounded_chat.py:60–87](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/open_notebook/graphs/grounded_chat.py#L60-L87)；[open_notebook/graphs/grounded_chat.py:356–377](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/open_notebook/graphs/grounded_chat.py#L356-L377)。

### 2. 经典 Open Notebook 搜索：另有向量路径
经典 `/search` 可选 text/vector；vector 需要 embedding model，可搜索 sources/notes 并传 notebook scope。**这不证明工作台 evidence search 已获得向量召回，也不代表 RAGFlow 联通。** [api/routers/search.py:26–61](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/api/routers/search.py#L26-L61)。

### 3. 外部知识库 / RAGFlow：当前未建立支持证据
完整树、引擎分发、设置面板与 integrations 边界中没有建立 RAGFlow 专用连接器、知识库认证/dataset 选择/同步状态的实现证据。引擎校验仅 independent/notebooklm，设置页也仅列这两种。[api/personal_service.py:43–48](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/api/personal_service.py#L43-L48)；[api/personal_service.py:205–217](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/api/personal_service.py#L205-L217)；[frontend/src/components/workbench/NotebookSettingsDialog.tsx:25–30](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/frontend/src/components/workbench/NotebookSettingsDialog.tsx#L25-L30)。

OpenAI-compatible 的 base URL 是**模型协议端点**配置；不能承诺把任意 RAGFlow URL 填进去就能列知识库、选择集合、执行其检索并保留引用。若外部系统额外提供兼容模型网关，只能另行验证该网关与当前结构化回答契约的兼容性，不能默认成立。[frontend/src/components/settings/CredentialFormDialog.tsx:47–52](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/frontend/src/components/settings/CredentialFormDialog.tsx#L47-L52)；[frontend/src/components/settings/CredentialFormDialog.tsx:233–258](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/frontend/src/components/settings/CredentialFormDialog.tsx#L233-L258)。

### 4. NotebookLM：专用适配能力，不是通用 RAG
有 notebook/source listing、文本快照导入、原件同步、音频/产物操作协议及确认 UI。远端文本快照不等于原 PDF，本地原件缺失明确提示。[open_notebook/integrations/notebooklm/contracts.py:167–187](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/open_notebook/integrations/notebooklm/contracts.py#L167-L187)；[frontend/src/components/integrations/NotebookLMPanel.tsx:61–71](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/frontend/src/components/integrations/NotebookLMPanel.tsx#L61-L71)；[frontend/src/components/integrations/NotebookLMPanel.tsx:110–140](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/frontend/src/components/integrations/NotebookLMPanel.tsx#L110-L140)。

但生产 ask 当前 unsupported；登录入口当前返回 unavailable，需要部署者提供获准可见的持久登录环境。其他操作的生产能力需有效连接与具体 capability，不能从适配器存在推断真实账号测试通过。[open_notebook/integrations/notebooklm/sdk_adapter.py:153–181](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/open_notebook/integrations/notebooklm/sdk_adapter.py#L153-L181)；[open_notebook/integrations/notebooklm/sdk_adapter.py:307–313](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/open_notebook/integrations/notebooklm/sdk_adapter.py#L307-L313)。仓库也明确记录真实 Google 调用尚未验证：[docs/v1/NOTEBOOKLM_SDK.md:1–20](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/docs/v1/NOTEBOOKLM_SDK.md#L1-L20)。

### 5. 过程、错误、引用与保存
- 工作台是提交任务 + 状态读取/轮询，不是逐 token 答案 streaming；独立模型使用 ainvoke，一次取得结构化输出。经典搜索另有 SSE，不能据此宣称工作台 token streaming。[frontend/src/lib/hooks/use-workbench-turn.ts:62–75](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/frontend/src/lib/hooks/use-workbench-turn.ts#L62-L75)；[frontend/src/lib/hooks/use-workbench-turn.ts:111–120](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/frontend/src/lib/hooks/use-workbench-turn.ts#L111-L120)；[open_notebook/graphs/grounded_chat.py:366–377](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/open_notebook/graphs/grounded_chat.py#L366-L377)。
- no-hit 直接生成中英双语「没有找到足够证据」并标 insufficient_evidence，不调用模型，随后该 turn 的执行状态为 succeeded。这是“请求完成但证据不足”，不是回答事实已经核验。[open_notebook/graphs/grounded_chat.py:199–210](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/open_notebook/graphs/grounded_chat.py#L199-L210)；[open_notebook/graphs/grounded_chat.py:231–279](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/open_notebook/graphs/grounded_chat.py#L231-L279)；[open_notebook/graphs/grounded_chat.py:280–295](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/open_notebook/graphs/grounded_chat.py#L280-L295)。
- 查询/范围代次、迟到结果、显式重查、未知提交避免自动重放等已有保护；不重开 10/28 的旧范围结果问题。[frontend/src/lib/hooks/use-workbench-evidence-search.ts:32–74](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/frontend/src/lib/hooks/use-workbench-evidence-search.ts#L32-L74)；[frontend/src/lib/hooks/use-workbench-turn.ts:77–108](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/frontend/src/lib/hooks/use-workbench-turn.ts#L77-L108)。
- 引用检查 evidence identity、版本白名单、quote；缺失引用标记会生成 invalid，verified 不表示每项推论正确。阅读器显示原文、验证含义、物理页和来源；远端无法映射时不编造本地页。[open_notebook/graphs/grounded_chat.py:236–279](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/open_notebook/graphs/grounded_chat.py#L236-L279)；[frontend/src/components/evidence/EvidenceReader.tsx:126–160](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/frontend/src/components/evidence/EvidenceReader.tsx#L126-L160)。
- 笔记保存保留 citations/scope；更新传 expected_revision，避免覆盖冲突。真实持久化/重新打开尚未本轮验证。[api/personal_service.py:335–357](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/api/personal_service.py#L335-L357)。

## 新增、可行动源码发现

### RAG-UX-01 · P2：未就绪资料仍可发起问答/搜索，混合选源会整次失败
**证据确定性：源码确认。** 资料 checkbox 只按是否有 version id 禁用；Ask 只检查选源数、模型/连接/引擎状态，没有提取状态。搜索 hook 同样只检查 scope/连接。后端遇任意 queued、extracting、needs_ocr、empty、failed 版本会 SOURCE_NOT_READY 拒绝，而不是返回其他 ready 资料的结果。
证据：[frontend/src/components/workbench/WorkbenchSourcesList.tsx:29–35](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/frontend/src/components/workbench/WorkbenchSourcesList.tsx#L29-L35)；[frontend/src/components/workbench/StudyWorkbench.tsx:131–153](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/frontend/src/components/workbench/StudyWorkbench.tsx#L131-L153)；[frontend/src/components/workbench/StudyWorkbench.tsx:421–434](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/frontend/src/components/workbench/StudyWorkbench.tsx#L421-L434)；[frontend/src/lib/hooks/use-workbench-evidence-search.ts:76–102](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/frontend/src/lib/hooks/use-workbench-evidence-search.ts#L76-L102)；[api/evidence_service.py:682–688](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/api/evidence_service.py#L682-L688)。

**场景：** 已配置模型，选择一份 ready 文件和一份扫描 PDF/刚上传文件，点击「向选定资料提问」或搜索。按钮可提交，但整个本地检索拒绝；搜索 hook 将具体原因统一为 error，用户难以知道哪份资料拖住了请求。既有测试明确要求后端拒绝未就绪而不是静默省略：[tests/test_v1_scoped_retrieval.py:45–49](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/tests/test_v1_scoped_retrieval.py#L45-L49)（仅阅读测试，未重跑）。
**修复方向：** 保留后端 fail-closed；提交前列出未就绪的具体资料及状态。等待提取、移除该项、查看 OCR/重新导入指引由用户显式选择，绝不悄悄缩小已选范围。
**验收：** ready+queued、ready+needs_ocr、ready+failed、全部ready分别覆盖；阻塞时说明准确资料，Ask/search 不发请求；状态恢复后解除；明确移除才改变范围，模型调用次数可核对。

### RAG-UX-02 · P2：合法 empty 提取状态退化成「不可用」，而不是可恢复的空文本说明
**证据确定性：源码确认。** 空白但非零字节 TXT/Markdown 可成功上传，parse_text_bytes 返回 empty 与 EMPTY_TEXT；stateKeys 没有 empty；资料列表对未映射状态显示 unavailable。此项不是此前已修复的「搜索零匹配误写成无文本」问题。
证据：[api/evidence_service.py:91–103](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/api/evidence_service.py#L91-L103)；[frontend/src/lib/utils/workbench.ts:27–29](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/frontend/src/lib/utils/workbench.ts#L27-L29)；[frontend/src/components/workbench/WorkbenchSourcesList.tsx:20–33](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/frontend/src/components/workbench/WorkbenchSourcesList.tsx#L20-L33)。

**场景：** 上传只含空格/换行的 UTF-8 TXT。资料区无法用本地化状态区分“提取完成但为空”和“未知/不可用”；如果继续选中提问，还会触发 RAG-UX-01。
**修复方向：** 增加 empty 的中英文状态与可操作提示：文件中无可检索文字，请上传含正文的新版本；与 OCR、未完成提取、解析失败、未知状态保持区分。
**验收：** 空白 TXT/MD、零字节拒绝、扫描 PDF、正常正文四种输入有不同反馈；未知未来状态仍安全 fallback，不擅自标 ready。

### RAG-UX-03 · P2：凭据显隐按钮不进入 Tab 顺序，且中文界面仍硬编码英文
**证据确定性：源码确认；真实键盘/读屏测试未运行。** API key Show/Hide button 写了 `tabIndex={-1}`，没有看到替代键盘入口；按钮文本硬编码 'Hide'/'Show'，不走 i18n。
证据：[frontend/src/components/settings/CredentialFormDialog.tsx:199–224](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/frontend/src/components/settings/CredentialFormDialog.tsx#L199-L224)。
**场景：** 键盘用户从 API key 输入框按 Tab，希望显示并核对刚输入的凭据，会跳过显隐控制；中文 onboarding 又出现英文操作。
**修复方向：** 恢复正常键盘焦点与可见 focus；提供本地化可访问名称/状态，不自动显示密码。保留密码默认遮蔽与不回填已有密钥的行为。
**验收：** 中英各一轮 Tab/Shift+Tab、Enter/Space 操作与读屏状态；输入值不因切换丢失；关闭/重新进入应符合明确的遮蔽策略。

## 检索完整性边界：不是把“关键词找不到”解释为“知识库没有答案”
工作台 lexical 的同义词、跨语种和概括问法召回存在结构性限制。本轮对固定源码 _terms + retrieve 做了隔离 fixture 执行：
- 英文原词 voltage drop、中文原词 潮流计算的控制组各命中 1；
- 英文 voltage drop 对中文“线路阻抗会导致电压下降”：0；
- “汽车”对“这辆轿车采用电驱动”：0；
- “总结这些资料”对“牛顿法采用雅可比矩阵计算节点电压”：0。

探针文件：[可重跑探针](evidence/redteam-2026-11-02/lexical_probe.py) 与 [结果](evidence/redteam-2026-11-02/lexical_probe.json)。这是特定反例与控制组，不是 general retrieval benchmark、全套新测试或模型验收。代码依据：[api/evidence_service.py:158–169](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/api/evidence_service.py#L158-L169)；[api/evidence_service.py:668–703](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/api/evidence_service.py#L668-L703)。实际问答 no-hit 会直接走上述 insufficient_evidence 分支，LLM 不会获得机会做语义补救。

**P2 能力/预期管理缺口，而非声称现有向量实现出错：** 在搜索/问答空状态说明“当前按关键词检索，可尝试原文术语；这不证明资料不存在相关答案”。通用总结应引导到已有独立 outline 入口；它会取有界 selected_overview，仍明确不是全文覆盖。[open_notebook/graphs/grounded_chat.py:174–198](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/open_notebook/graphs/grounded_chat.py#L174-L198)。如果将来选择做语义检索，先单独确定产品范围和中英标注集，不在本次审查擅自实现或接入外部服务。

## 隐私与舒适度复核
- “本地版本”描述的是资料范围，不保证模型推理在本机：独立模型可由配置的 provider 执行，所选证据进入 prompt。建议问答入口显示实际模型/provider 与数据去向的简洁说明；这是透明度建议，未建立越权发送漏洞。[open_notebook/graphs/grounded_chat.py:303–337](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/open_notebook/graphs/grounded_chat.py#L303-L337)；[open_notebook/graphs/grounded_chat.py:356–377](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/open_notebook/graphs/grounded_chat.py#L356-L377)。
- Google 同步/导入/音频有明确目标与选源确认，未把自动登录或自动调用当成“更舒适”。缺少生产问答隔离时继续 fail-closed 是应保留的安全取舍。
- 模型“已配置”与“可用”已分开，当前文案明确未发测试问题，不能复报“配置等于连通”的旧问题。[frontend/src/components/workbench/StudyWorkbench.tsx:133–140](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/frontend/src/components/workbench/StudyWorkbench.tsx#L133-L140)；[frontend/src/lib/locales/workbench.ts:214](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/frontend/src/lib/locales/workbench.ts#L214)。
- 视觉保持现有阅读优先、来源/阅读问答/笔记结构。此次没有新像素证据，不能确认对比度、44px 命中区、缩放、移动键盘、焦点顺序或长引用实际溢出已通过；10/28 的源码修复不重复列为未修缺陷。
- 证据覆盖提示、引用真实含义、原件缺失、任务未知状态比装饰性改版更影响信任；优先打通“为什么现在不能问、缺哪份资料、下一步能做什么”。

## 下一轮运行验收（未执行）
在获准隔离环境中，使用合成资料而非真实笔记：
1. 无凭据冷启动→上传正常 TXT/PDF→观察 queued/extracting/ready→配置测试 provider（显式授权）→选定版本；
2. exact/同义/跨语种/无答案四类问题→过程反馈→最终答案与 coverage；
3. 点击每个引用→原文/版本/物理页/无原件→保存为笔记→重新打开核对 scope/citations/revision；
4. 夹入扫描、空白、失败资料→混合选源被清晰阻止，不静默改变范围；
5. 断网/认证到期/未知提交→不自动重试付费调用，明确只读核查与恢复动作；
6. 中英、浅深主题、360/390/768/1024/1280/1440px、键盘/触控/读屏、200%缩放，检查上述完整旅程。
NotebookLM ask 的 unsupported 必须按产品边界验收为“清楚地不可用”，不能通过绕过隔离保护把按钮点通。

## 阻塞与停点
- **目标动作：** 启动当前版本并执行浏览器/真实导入→问答→引用→保存验收。
- **目标：** 获授权的独立测试环境，不是 ZC_LAPTOP，也不是用户现有项目/真实笔记。
- **原因：** 用户已批准台式机独立测试工作区，但平台任务访问尚未开放；桌面 connected 但 is_authorized_for_tasks=false。没有把连接状态当授权，没有重试或绕过。
- **已完成：** 分支固定、当前源码/前后端契约/相关测试源码/历史报告审阅、能力边界、3项新源码缺陷与验收方案；本轮另有上述隔离 lexical fixture。
- **结果：** 源码审查完成；当前真实服务及浏览器结果 **未执行/待平台任务访问**，不是通过也不是实际失败。外部 RAGFlow **未建立接入支持**；NotebookLM 生产 ask **源码确定不可用**。


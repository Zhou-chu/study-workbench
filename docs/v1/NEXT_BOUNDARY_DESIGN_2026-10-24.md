# 下一阶段边界设计草案（记录日期：2026-10-24 UTC）

**状态：设计草案，未实现；不是修复测试通过记录。**
本文整理当前源码约束与拟议回归矩阵，不授权或执行服务、数据库、浏览器、提供方请求或安装。
[第一阶段完成记录](ARCHITECTURE_PHASE_ONE_2026-10-24.md)保持有效；其源码、产物及历史证据不被本草案改写。
已发布的阶段总结为 [`ec710165`](https://github.com/Zhou-chu/study-workbench/commit/ec7101651d22fa5d6c6ea1eb86a609acf444f291)；本页是其后的独立文档增量。

## F1：Ask / Outline 操作身份与恢复

### 源码事实与不可推导的结论

- `api/personal_service.py` 按 chat session + key 定位任务；完整请求参与一致性检查。原记录存在时，相同 key/body 返回旧任务，改变 body 产生冲突。
- `api/routers/evidence.py` 在去重前验证 notebook / source versions；删除材料后，相同 key 的 POST 也可能被拒绝，不能换 scope/key 绕过。
- 请求默认值（如 `model_id:null`）和数组顺序必须纳入匹配；不要在浏览器复制后端 hash 算法。
- Google 路径另有同 key 的 NotebookLM 子任务；只按 key 匹配会误认父任务。
- 已存在的 HTTP 400 `WORKER_UNAVAILABLE` 可发生在队列已接受之后；`failed`、`not_submitted`、零 attempts 不证明拒绝，也不授权新 key 重试。
- 同 key 返回失败父任务不是 worker 重启；本设计不改变当前失败终态、重放或队列策略。
- 通用 `GET /personal/jobs/{id}` 可以调度 NotebookLM / maintenance 任务，不能冒充纯读取恢复。
- 当前 workspace 与 turn history 路径可用于本特性的读取检查；不据此宣称整个应用 GET 都无副作用。

### 推荐的最小前后端边界

先明确后端 dispatch 不确定性的公开证据，再实现受保守约束的前端捕获；不要宣称前端单独修复即可安全判定所有失败已结束。
推荐在原 unchanged-queued enqueue 异常路径增加最小结构化 **dispatch uncertainty receipt**：
保留现有状态/code，显式记录 dispatch ACK unknown，携带原父 `job_id`、`turn_id` 与 `retry_safe:false`；同 key 响应保留该标记。
旧记录缺标记仍为未知，不升级为 rejected；不能把队列 ACK unknown 改称 provider submission unknown。
这个建议不是 outbox、可靠 dispatch、worker restart 或 exactly-once；具体实现仍需独立测试与审查。

前端采用一个 turn 专用的页面 document 生命周期操作所有者，不引入通用任务框架：
- 在点击边界同步 admission，Ask / Outline 共用同一 notebook 槽；先校验支持的 scope、目标、可用性和大小，再保留身份，之后才能 await / mutate。
- 一次捕获并复制不可变的 session、key、精确 DTO、目标、原 mount 标识和 question/editor revision；后续不从新草稿、locale、link 或 selection 重建 body。
- 请求中保留原字段及省略方式；不夹带 reader position，不保存凭据、原始 Axios 错误、DOM、回调或无关草稿。
- 小型 root-owned 内存 registry 跨同一 document 的路由 remount 保留未决身份；不是全局进程 singleton、Query 缓存身份或持久化 Zustand。
- 拟议上限为 8 个未决 notebook 槽与 1 MiB 捕获请求总量，并遵守现有 message / ID 数量限制；这些数字是待审查设计常量，不是用户需求。
- 达上限时拒绝新 admission，不通过 TTL / LRU / 普通 dismiss 淘汰未决请求；同 tick 连点与恢复连点只能进入一次。

### 检查与显式恢复必须分开

**检查原请求**只读 captured notebook workspace / canonical history，不 PATCH、不 POST、不 cancel、不调用通用 job GET。
接受匹配需唯一的 live parent `operation:chat`，notebook/session/key、规范化请求和已知 receipt IDs 一致；排除子任务、恢复归档任务和 replay-disallowed 记录。
无匹配、重复、畸形、矛盾或未知状态均保持未决；缺记录不是未提交证明。

**恢复原请求**是明确标识的写尝试：通过现有 client，以同 session、同 key、同 captured DTO 执行一次 POST。
若原记录不存在，它可能提交工作；因此不是“仅检查状态”。必须展示原目标/范围，不能以当前已编辑草稿替换。
不得由认证成功、重连、轮询、focus、remount 或计时器自动触发；保留既有认证传输与 `retry:false`。
捕获目标失效时保持检查/解释，不暗中换引擎或连接。已有 receipt 后优先检查，不把重复 POST 当作重新启动任务。
第一次且唯一一次本地已证实未 dispatch 的尝试可显式放弃；更晚的 not-dispatched 不能抹掉更早的未知提交。
`failed`、`needs_reauth`、`cancelled_local`、future state 与缺字段都不能仅凭标签解除 fence；不得用 `!activeJob` 证明安全。
成功也需绑定到原父任务及可信完成证据；缺答案是读取问题，不是再次 POST 的理由。

### 隐私、生命周期与编辑器所有权

普通原地认证恢复保留 capture，但不重放写入；明确本地登出/撤销应同步使 registry context 失效并释放载荷引用。
后端目标/模式切换是独立上下文边界；现有 session metadata 不是稳定 account principal，不能声称跨账号连续身份。
迟到 promise 只能更新仍存在的同 operation/context/attempt，不能在登出或新操作后复活私有内容。
Ask 只在原 mount 与 question revision 都一致时清空原问题；编辑后又改回也不能被旧 ACK 清空。
Outline 仅在原 mount、editor session/revision 和绑定成功 turn 全匹配时自动应用；否则留在 history，不能覆盖新编辑器。
不改变 note base revision、citation、scope、冲突及未知保存保护；Outline 不拥有问题框。
完整刷新、崩溃、新 tab、登出或 root provider 替换会丢失本地恢复能力；丢失 capture 不证明请求失败。
不增加 localStorage / IndexedDB / 跨 tab journal；释放引用不是安全内存擦除，也不能取消已发请求。

### 拟议先红后绿矩阵与停止条件

1. 同 tick Ask/Ask、Outline/Outline、混合点击与恢复双击；捕获后数组、文本、locale、scope/link 改动不改变原请求。
2. ACK 丢失后编辑与认证恢复：零自动 POST，显式恢复仍同 key/body；后续本地未发送不能降级原不确定性。
3. 路由 remount、登出、上下文切换、迟到结果及 revision 重置：不泄露旧载荷、不清新问题、不覆写新 editor。
4. workspace 匹配排除同 key 子任务、重复/错 body/错 ID/恢复记录；未知状态、缺记录与 queued ACK 丢失不能解锁新 key。
5. 后端接受后抛错得到原 IDs + 不安全重试回执；同 key 不二次 enqueue，fast-worker / cancel 竞争仍保留最新记录。
若当前契约无法证明某种结束状态，就保留阻塞并报告限制，不靠 UI 文案、隐藏重试或收紧历史 serializer“修好”。

## 提供方分类与选定日志边界

拟议生产范围仅六个文件：`utils/error_classifier.py`、`utils/boundary_logging.py`、`api/routers/search.py`、`api/routers/source_chat.py`、`ai/models.py`、`utils/graph_utils.py`（省略前缀者均位于 `open_notebook/`）。
用固定消息替代 classifier 的 model-not-found、raw configuration 与 unmatched 原文透传；截断不是脱敏。
沿用 tuple 接口、关键词优先级、异常类别/HTTP status、现有 retries 与 caller `raise ... from` 原因链；不把任意 ValueError 文字视作可信 domain 消息。
仅替换 unmatched WARNING、两个 SSE failure ERROR、default-model fallback ERROR 与 rollback cleanup traceback 日志为受限元数据。
保留 SSE event shape、既有 typed error 原对象/属性、default-model 返回 None、best-effort rollback 顺序及原异常身份。
不靠通用 typed-error 重建丢失关键字参数或 uncertainty receipt；内部 cause 保留不等于允许下游重新渲染它。

**已执行的是缺陷特征化，不是修复验收：8 个纯合成探针确认当前泄露行为。**
探针覆盖三条 classifier 原文分支、真实 Ask wrapper/cause、两个 SSE generator、default-model 日志和 rollback 原因链；断言现有缺陷成立，未修改生产代码。
拟议回归通过真实 wrappers、registered handlers 与真实 Loguru sink，外部 model / DB / checkpoint seams 使用替身；不调用服务。
矩阵包括 auth/rate-limit/configuration/connect/read-timeout/context-length/payload/overload/fallback 与混合关键词优先级；长短合成敏感哨兵均不得进入公开消息或选定日志。
同时断言 typed domain 对象、结构化 unknown 回执、retry 分类、日志级别、单次调用及原 cause 不变；SSE 错误后不伪造 complete。

## 分开处理的缺口与实施门槛

Embedding 重试日志、search 的显式 DatabaseOperationError 文本及 SSE typed-error 旁路不由上述六文件方案全部解决。
Model/provision 对象 repr、凭据/上下文日志、其他 router/worker/SDK sink 也需独立边界；NotebookLM classifier 与 mutation uncertainty 不混改。
因此只可声称“经 LLM classifier 的原始错误与选定日志被收窄”，不可宣称全局提供方/错误/日志安全。
两项设计均需先证明行为 RED，再做最小实现、独立审查与新鲜组合 gates；现有静态/构建 PASS 不替未来代码背书。
若需改变 worker replay、引入新存储/通用框架、扩大到其他 SDK 或运行真实服务，应停止当前窄批次，先明确新的范围与证据。
浏览器 netlink BLOCKED、主分支/部署、DB/Docker/native/Harmony、提供方预算及用户数据恢复限制均不因本草案改变。

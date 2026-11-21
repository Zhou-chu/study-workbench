# NotebookLM 关联记录读写对齐：2026-10-26

## 缺陷与修复

修复前，关联接口用 `link_<uuid5(notebook_id)>` 写入，workspace 却按原 notebook_id 读取；PersonalStore 对不同物理身份分别哈希，没有别名。因此接口成功后工作台仍可显示“需要关联”。通过真实 route、PersonalStore 和 workspace（仅外部 SQL/提供方接缝为替身）的串联测试复现。

共享 `api/notebooklm_links.py` 保持原写入 ID、远端验证和锁/写入顺序不变，读取使用既有 get_many 的两个精确身份：canonical 与 notebook-key legacy。保留原始 row envelope，以区分缺行和已存在的 payload:null；不扫描列表选第一条记录。

读取验证 owner、ID、provider label、非空 remote target。严格活动标记防止 null/字符串被当成合法布尔值；requires_rebind、restored_history、replay_allowed 及明确历史 origin 标记均按计划处理。有效 legacy 仅作为兼容；冲突、错 owner 和损坏数据使用固定错误拒绝。inactive canonical 不回退复活旧关联。

备份恢复生成的随机 link ID 不会被当作当前关联。显式重新关联可建立 canonical live 记录，同时保留历史行。无迁移、删除、读取时写入或提供方重验证；connection_id='notebooklm' 只是标签，不是 Google 账户身份或持续可用性证明。

## 验证

- 原始物理键/实际 wire RED：92 个预期失败，3 通过；后续 null-row RED 验证原 get 的歧义。
- 最终完整离线后端：2,778 通过，128 opt-in 跳过，2 个既有警告；Ruff/格式/mypy（318 文件）及 OpenAPI 通过。
- 独立审查批准；审查者另跑定向 204 通过、1 跳过、1 既有警告，没有重跑或冒称真实 DB/提供方验收。
- 与修复后的前端 Task 2 合并后再次验证：后端 2,778 / 128 跳过；前端 1,701 单元 + 25 artifact；类型、lint（7 个既有警告）、后端静态/OpenAPI 全部通过。

独立工作树源码提交 `225b54b4f0a4f9205f2e457e95ef30a48bf22cba`；合入提交 `eeb9c048e33ac9cc3ff9c30ba7433fdbdd02684c`，组合 tree `964fbfb1d5742a7bd76ce5ac7b45027b1ac66470`。

决策：使用原始 get_many 精确身份批读取代替两个 get，避免把 payload:null 当成缺失而启用 legacy；代价是测试替身必须实现真实 row-envelope 契约。保留严格冲突拒绝，代价是歧义旧数据可能需要人工处理，不自动挑选远端目标。

未执行真实账户、网络、数据库、浏览器、Docker/原生、CI 或部署验收；不表示 Google 连接已经可用。main、凭据与历史数据均未改变。

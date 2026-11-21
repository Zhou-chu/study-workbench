# 代码与工程质量跟进审查：2026-10-26

本轮基线为已发布 `ed58c6e5b766ee7a1444ea90062f697b963b3b2a`（本地 `9eeb160`，tree `2150f26c9f0b8d4e841c034e1d6baaca2e1df4a5`）。继续采用模块化单体，不为目录整洁或测试数量进行大规模重构。

## 已实现：新失败记录的持久化错误边界

修复前的基线中，`EvidenceService.extract` 与 `EvidenceMaintenanceService.run` 会把原异常文本截断后保存；随后成功的 job/version-detail 读取接口会直接返回它们，因此绕过了已有 HTTP 异常处理器和 LLM 分类器。

本批只修改两个生产文件的诊断字段：新 extraction.error 固定为 `Source extraction could not be completed.`；新 maintenance processing error 固定为 `EVIDENCE_MAINTENANCE_FAILED` / `Evidence maintenance could not be completed.`。不再使用任意异常类名作为该 processing 分支的公开 code，队列 `WORKER_UNAVAILABLE` 分支保持不变。

原始内部异常身份、状态/锁/写入顺序、失败重解析时保留旧可读 extraction/version、原文件与部分证据、取消/保存失败传播均未改动。历史已保存的任意 error JSON 不做静默清除或收紧；本批不是历史数据脱敏或全局日志清理。

| 检查 | 本次证据 |
| --- | --- |
| 原生产代码，真实读取边界 RED | 27 个预期失败，20 通过 |
| 定向 GREEN | 47 通过 |
| 完整离线后端 | 2,678 通过，128 opt-in 跳过，2 个既有警告 |
| Ruff / 格式 / mypy | 通过，316 文件 |
| 受保护的 OpenAPI 检查 | 通过 |
| 两生产文件 AST 对照 | 仅指定诊断字段及不再使用的异常绑定变化 |

被测本地提交 `33f2799aee391e30977028b7d9906680e7ca0974`，tree `532bfe886b87a2336cfee4ed02d7871d61d7cf18`。测试通过合成一次性异常、后续成功的失败记录写入以及实际 job/version-detail serializers，验证短/长敏感哨兵和异常类型名不会进入这些新公开诊断。未调用真实服务。

决策：以稳定操作 code 代替任意异常类名，代价是新记录诊断更粗；接口不再承诺该分支返回任意内部类型名。既有历史记录与队列错误 code 不改。

## 前端审查发现：尚未由本批修复

1. Ask/Outline 在每次 mutation 内生成新 UUID；丢失 ACK 或未知 HTTP 400 后，手动再次点击可能使用新 key。
2. polling 的 activeJob 谓词被当作完成证明；failed/submission_unknown/cancelled_local/未来状态会解除 composer 保护。旧组件测试还明确认可这一行为，必须先修正测试契约，不能只增加测试数量。
3. 组件 remount 丢失 pending 身份；Outline 仅凭 answer 文本及 editor revision 应用，缺少成功父任务证据校验。
4. 同步 admission、logout/revoke intent、实际 backend target 变化和最后一刻 dispatch 的边界需要联合验证；仅在 await 之前检查目标不充分。
5. generic job GET 可以推进任务；恢复检查应使用 workspace/history 纯读取，且不能无意中让后台 JobsPanel 轮询破坏该承诺或停掉正常任务进度。

以上为定向源码审查结论；前端修复与对应 RED 验证尚待实施，不报告为已修复。重跑的当前前端基线为 1,434 单元测试与 25 artifact 测试通过；它不证明这些错误契约正确，也不替未来代码验收。

## 工程质量与验收限制

未发现需要微服务拆分的新证据。现阶段应优先统一操作身份和读写边界；共享测试替身、依赖方向等已知债务不重复包装为新缺陷。

本批没有运行前端构建、覆盖率、真实 DB/worker/provider/browser/Docker/native/Harmony、CI 或部署。128 项跳过保持未验收；继承的历史浏览器证据链接缺失问题未被本批修复。main、凭据与隔离规则未修改。

# Personal turn 队列确认未知回执：2026-10-26

本批实现 [F1 设计](NEXT_BOUNDARY_DESIGN_2026-10-24.md)的后端回执部分，具体契约见 [ADR-022](../7-DEVELOPMENT/decisions/ADR-022-personal-turn-dispatch-receipt.md) 和[实施计划](../superpowers/plans/2026-10-26-dispatch-uncertainty-receipt.md)。前端跨 remount 操作身份/显式恢复尚未由本批实现。

## 行为

仅当 enqueue 抛错后，既有锁内重读确认原 queued 父任务仍未变化，才在原 failed 更新中增加 dispatch_receipt：dispatch_ack 为 unknown，保留原 job_id/turn_id，retry_safe 为 false。

首次 HTTP 400 保留 detail 字符串 WORKER_UNAVAILABLE，增加同级回执；同 key/body 再次 POST 返回既有 HTTP 200 任务投影及保留回执，不二次 enqueue。状态、submission_state、attempts、error code/message、锁、写入顺序、replay 与取消策略均未改变。worker 已推进、元数据更新、取消或删除的记录保持原处理，不补写回执覆盖它们。

生成边界只输出固定字段及分配的原 ID；保留数据读取采用 Any + key membership + exclude_unset，区分缺失和显式 null/false，并保留畸形/未来 JSON。缺失、畸形、冲突 ID，甚至历史 retry_safe:true，均不能授权重试。归档回执只是历史数据，恢复后仍禁止 replay。generic job GET 仍可能 dispatch，不可称为只读恢复。

## 本次验证

| 检查 | 本次结果 |
| --- | --- |
| 未修改生产代码 RED | 15 个预期失败，19 通过 |
| 最终定向 GREEN | 187 通过，1 opt-in 跳过，1 个既有警告 |
| 最终完整离线后端 | 2,647 通过，128 opt-in 跳过，2 个既有警告 |
| Ruff / 格式 / mypy | 通过，315 文件 |
| 受保护的 OpenAPI 检查 | 重新生成的快照与实际接口一致 |

覆盖 accepted-but-ACK-lost/无可观察接受证据、真实路由和注册处理器、同 key 去重/异 body 冲突、锁等待竞态、advanced/删除记录、保存本身失败、宽松 JSON 读取、workspace 无新增 dispatch、纯离线 portable 历史 ID 重映射及禁 replay。

被测本地提交 `d9e3307981cd8854e351abdb3cecb63a82db16b7`，tree `85d1f4167ec383a350795d573d3dde93aacae328`；后续纯文档修改不扩大其验收范围。额外文档链接检查仍发现一条继承的历史浏览器证据目录缺失链接，位于 UX_RED_TEAM_2026-10-21.md；该检查未通过，不将其计作通过，也不伪造缺失证据。

## 限制与决策

保存回执本身若失败，不能保证其持久存在；保持原异常传播，不报告“肯定未提交”。本批不是 outbox、可靠队列恢复、exactly-once 或可安全重试证明。

决策一：保留 detail 字符串，增加 sibling receipt，避免破坏旧消费者；代价是客户端需显式识别新增可选字段。
决策二：历史读取不套用严格生成模型，避免破坏可读数据；代价是客户端必须保守识别，不能相信任意保留的 retry_safe 字段。

未执行真实数据库/worker/提供方/浏览器/Docker/原生设备验收、前端构建或 CI；未改变 main、部署、凭据、缓存或隔离规则。此前运行期阻塞与前端恢复缺口保持独立未完成状态。

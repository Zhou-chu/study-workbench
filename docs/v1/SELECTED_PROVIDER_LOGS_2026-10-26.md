# 四处选定提供方日志边界：2026-10-26

本批承接[分类器修复](PROVIDER_CLASSIFIER_BOUNDARY_2026-10-26.md)，落实此前六文件方案中剩余的四个选定日志出口，不改变流式响应或错误传播语义。

## 修改

- Ask SSE 和 source-chat SSE 的失败 ERROR：改用受限元数据日志，保留原 event shape、顺序、typed 消息与错误后无 complete 的行为。
- 默认模型加载失败 ERROR：不记录原异常、模型类型或模型 ID；保留原 catch 类型与返回 None 的行为。
- 未回答消息回滚失败：移除 traceback 渲染，以受限 ERROR 记录；保持 best-effort 清理顺序、no-op 条件和原 invocation 异常身份/cause。
- 仅在既有日志 helper 增加四个允许的 operation；其他日志和控制流未修改。

具体[实施计划](../superpowers/plans/2026-10-26-selected-provider-logs.md)与[原设计](NEXT_BOUNDARY_DESIGN_2026-10-24.md)可追溯。生产 diff 为四个调用点、相关导入、cleanup 异常绑定与 allowlist。

## 本次新鲜验证

| 检查 | 结果 |
| --- | --- |
| 新用例、未修改生产代码 RED | 60 个预期失败，12 通过 |
| 最终定向 GREEN | 144 通过 |
| 最终完整离线后端 | 2,631 通过，128 opt-in 跳过，2 个既有警告 |
| Ruff / 格式 / mypy | 通过，314 文件 |
| 受保护的 OpenAPI 快照检查 | 通过 |

回归测试通过真实 generator、ModelManager 与 graph helper，外部接缝为合成替身；实际序列化 Loguru sink 开启 backtrace/diagnose，检查短/长合成敏感哨兵、模型/thread/message 标识以及异常原因链未进入选定日志。另验证 typed 错误、取消、调用次数和回滚身份，未改变对应生产行为。初次 mypy 发现新测试类型问题，修正测试注解/fixture 后重新运行了最终完整检查。

本批被测本地提交 `665f215fd4177393a7f1b042ba85a52e57c80280`，tree `4c54b823eb0b9c0355eb3d08d87e048b27bbb9f0`；基线为上一批源码加文档 `8ac44ed`，等价已发布 `c828657`。后续纯文档更新不扩大验收范围。

## 边界与下一步

截至本批，原六文件方案中的分类器和五个选定日志出口已完成代码修改与离线验证，不等于所有提供方错误/日志均已脱敏。typed SSE 消息来源、search 显式数据库错误文本、缺省模型/message-count 警告、embedding/model repr、凭据/上下文和其他 SDK/router/worker sink 仍需独立处理。

决策：日志批次不重定义 typed SSE 消息可信边界，避免顺带破坏既有客户端契约；代价是该公开消息来源仍是明确未解决项。

前端、覆盖率、真实 DB/服务/提供方/浏览器、Docker/原生/Harmony、CI、main 合并和部署均未在本批运行。128 项 opt-in 跳过仍为未运行；未开启真实服务、安装依赖或变更凭据/隔离规则。

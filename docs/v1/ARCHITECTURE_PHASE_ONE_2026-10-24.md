# 架构边界修复：第一阶段完成记录（2026-10-24）

四个有界补丁已完成独立审查、组合离线验证及私有源码发布；**不是运行验收、主分支合并或部署完成**。[原始审查](ARCHITECTURE_REVIEW_2026-10-24.md)与[原始计划](../superpowers/plans/2026-10-24-architecture-boundary-repair.md)保留为基线历史，不将其中待办自动解释为已经通过。

## 固定源码检查点

| 检查点 | 已核验私有提交 |
|---|---|
| 审查与计划文档 | [`c0a05369`](https://github.com/Zhou-chu/study-workbench/commit/c0a053696c374a270e3d2ca66ffd80330f151294) |
| Task 2：任务 ACK 竞争 | [`fd609cc9`](https://github.com/Zhou-chu/study-workbench/commit/fd609cc918eb3fd2ee2ea57234fee22bdc88ef9d) |
| Tasks 1 + 4：DB 边界与开发入口 | [`a3758a8b`](https://github.com/Zhou-chu/study-workbench/commit/a3758a8b41428db83eba0e60384d496f63515375) |
| Task 3 加入后的四项组合源码 | [`abcc5084`](https://github.com/Zhou-chu/study-workbench/commit/abcc5084a420e8dd407cc5592c368d8acaa97fa4) |

上述第四个源码检查点 tree 为 `b82d6e88ee0a2ed2583fcbdda01eb855bfe0fd9e`，与本地受测提交 `03c7c1da96f3035e27ac6f07020e1750af33fcf4` 完全相同；本页后续文档提交不改变这个固定映射。集成仅合并相邻 changelog 条目，保留已审查生产代码与测试原文。

## 实际修复与边界

| 审查编号 | 已实现 | 未扩大为的保证 |
|---|---|---|
| B1 | DB 专用固定 HTTP 500 响应，沿用 CORS；保留更具体的 typed 回执 | 不代表所有 SSE、搜索、嵌入或其他错误出口都已脱敏 |
| B2 | repository、ObjectModel 与选定 notebook 读取/状态日志采用固定事件和受限元数据；保留等级、异常传播、重试及清理语义 | 不覆盖全仓日志、提供方分类器、SDK、ambient sink/context 或持久化错误内容；见 [ADR-020](../7-DEVELOPMENT/decisions/ADR-020-database-error-and-logging-boundary.md) |
| B3 | enqueue 异常后在项目锁内重读，保留推进后的完整任务，缺记录不复活 | 完全未推进的 queued 仍保留旧 `WORKER_UNAVAILABLE` 策略；ACK 丢失不证明队列拒绝，不是 outbox 或 exactly-once |
| F2 | 原始宽松 wire 数据与只读投影分离；未知/不完整选择不授权动作、不自动写回；不猜最新版本或证据来源，状态键只认自有属性 | 不修复 Ask/Outline 操作身份恢复，也不把投影变成完整服务端 schema；见 [ADR-021](../7-DEVELOPMENT/decisions/ADR-021-workspace-read-projection.md) |
| R1 | Make 离线入口要求显式已准备解释器路径与 token cache，仅委托离线 runner | 不安装工具，不代表该目标运行前端、静态、coverage、DB/runtime 或 CI |
| R2 | 旧递归 cache 清理直接 fail closed；合成树/stub 回归证明不删除 | 未实现新递归清理器；未执行旧危险 cleaner |
| R3 | 开发 landing page 指向有效 V1 指南，旧开发/发布程序标为历史非操作步骤 | 不代表所有历史 override 文档都已清理，或 Docker/发布流程已获运行验收 |

## 本次新鲜验证

- 精确组合源码：后端离线 **2519 通过 / 128 跳过 / 2 条既有依赖弃用警告**；完整 mypy **312 个源码文件**、Ruff、format-check、非写入 OpenAPI 契约检查通过。跳过项不是通过项；runner 的 Python 网络 tripwire 不是 OS 防火墙证明。
- 前端 **94 个文件 / 1434 个测试通过**，另有 **25 个产物身份测试通过**；types 通过，lint **0 错误 / 7 条既有警告**。使用已准备的本地工具，没有安装依赖。实际 Node 为 **v24.22.1**，不沿用历史版本标签。
- 单次严格离线生产构建及独立官方关联复核通过。构建使用清空环境、隔离网络命名空间和降权边界，没有启动应用或配置 loopback；物理依赖副本构建前后身份未变。组合源码使用核验后的真实 receipt 与生成资源，未伪造回执或重建。

### 产物身份（不是可重现构建或浏览器证明）

- 产物标识：`IUxGTu`；build ID：`b54757b2-9e4e-4f17-a5f5-d88f4e92c7e2`。
- 官方源码 inventory SHA-256：`2ef3f43e09dee2fd984c8b71d798a908b4177cc1bc777af5e3ad87ad62281d68`，**404 文件**。
- 整个 inventory 对象的 digest：`7c78c5f0571570fb15c394bacdf8d1faaa13e7aed8e6d1c0a2ca907fb3e590b7`；与上一字段含义不同。
- Canonical manifest：`baf8db8e9e72aa9e2baf0f89c2df88af505d6e75a98c09deb8aaccebcd84037b`。
- 完整 artifact：`94cdceecd2a6bb5533ee6c6e941b2d749e81a0e6fa478699a99d8467b09909bc`，**2561 条目**。
- PDF 生成资源：`52d6dbf123c1155f4ecf503800bea441b5473eaadfb3378c303edd079642711d`，**200 文件**。
- 真实 receipt SHA-256：`135c03bb070a09cafbb814034d0719670ac33c43abc809b8467cb673f61626ce`。
- 静态产物核验保留 **7 字体 / 3 份完整许可 / 13 个 font-face**；12 个正常根布局页面各有 3 个 preload，global-error 为 0。它们是输出文件断言，不是视觉或辅助技术验收。

## 尚未关闭

优先后续仍为 **F1 Ask/Outline 不可变操作身份捕获与显式恢复**、**提供方错误分类器及其他泄露边界**，目前仅只读设计，不是已修复。新识别的部分 SSE、搜索和嵌入路径也需单独收窄；不能宣称全局错误/日志脱敏。无进展 queued ACK 策略、测试替身契约、依赖方向及跨界面缓存仍在后续清单。

本轮没有浏览器、真实 DB、提供方或应用 runtime 验收，不复用旧 PASS。既有浏览器准备的 netlink **BLOCKED** 未重试、未解除；离线构建成功不证明该运行能力可用。主分支、部署、CI、Docker 运行、Harmony/原生客户端与用户数据恢复仍未验收；既有提供方预算/权限限制不因本阶段完成而重置。

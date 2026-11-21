# 原生原型分支对齐审查（记录日期：2026-10-24 UTC）

**本记录为有界源码审查，不是新的原生测试、构建或设备验收。**
核对两个私有分支的实际 head、完整树、定向源码与当前组合契约；未改变应用或发布配置。
[第一阶段 Web/API 验证](ARCHITECTURE_PHASE_ONE_2026-10-24.md)与[下一阶段设计](NEXT_BOUNDARY_DESIGN_2026-10-24.md)各自保持原有范围。

## 分支关系与事实

- Core：`feat/mobile-fixture-core`，核验提交 [`e1e3d71f`](https://github.com/Zhou-chu/study-workbench/commit/e1e3d71f18045f4733b25c7e433725f63e5bdaf5)。
- UI：`feat/mobile-native-ui`，核验提交 [`0ae994bd`](https://github.com/Zhou-chu/study-workbench/commit/0ae994bd18d6073c5465dfeeaf9f0909034f25ff)。
- 比较结果 UI **ahead 1 / behind 0**，merge base 为 Core；这是叠加切片，不是两套分叉的移动业务实现。
- 两者共享相同 domain tree `58ad25132beb9873c0a6e2b858bc1a8b92d2506b` 与 fixture tree `b5f6715d8a44b2d7ce53fc0042a9aa2fbf46f9b6`。
- 在这两个已检查分支中均未找到 `clients/mobile/android/`、`clients/mobile/ios/`、`clients/harmonyos/` 或 `packages/api-client/`；此结论不覆盖其他历史原生/Harmony 产物，也不能用当前 Web 树缺目录推断从未有移动端工作。

## 原型的正确边界

[`clients/mobile/README.md`](https://github.com/Zhou-chu/study-workbench/blob/0ae994bd18d6073c5465dfeeaf9f0909034f25ff/clients/mobile/README.md)明确是 React Native 源码与 JavaScript 测试切片，不是可安装、已连接、已认证或持久化应用。
`App.tsx` 将一个 fixture session 放在 navigation 之上，workspace、submissions 与 jobs 存于内存；模拟文本阅读器不是 PDF/source version，queued receipt 不伪造生成结果。
Android/iPad 的方向为共享 RN 源码；Harmony 方向为独立 ArkTS/ArkUI，而非 APK 复用。
缺少平台 scaffolds、安全存储、真实文件/PDF adapter 与进程死亡恢复是已声明的范围，不据此断言现有原型回归。
历史源码/types/JS 测试报告不证明原生构建、运行布局、无障碍或设备通过，本次未重跑或重验依赖版本兼容性。

## 契约对齐及覆盖缺口

下列 Git blob 在两个远端 head 与本次当前组合源码中完全一致：

| 文件 | Blob SHA |
|---|---|
| `api/personal_contracts.py` | `b7e2b8cd68ff733a75f87ef18c569c9cd2c9af7f` |
| `contracts/v1/openapi.json` | `5eb901511745cd58e1851a877e8d5e5497c9f732` |
| `contracts/v1/fixtures/workspace.json` | `f36acd30dceae59a4187f4551c2d20de1a9785e0` |

`api/routers/evidence.py` 整文件不同；仅已检查的 TurnRequest 字段、默认值和限制相同，不宣称整个 router 或运行语义等价。
移动端 `domain/contracts.ts` 是公开声明的手写子集/view，保留 nullable/absence、opaque 扩展与原始状态，不是完整 decoder/SDK，也不与 Web DTO 机械互换。
[`fixture-workflow.test.mjs`](https://github.com/Zhou-chu/study-workbench/blob/0ae994bd18d6073c5465dfeeaf9f0909034f25ff/clients/mobile/test/fixture-workflow.test.mjs)包含 canonical workspace、未知状态和保存所有权案例；这些是覆盖定位，不是本次测试通过证据。
较新的 `workspace-read-compatibility.json` 在这两个分支中均缺失，尚未证明新宽松响应矩阵的原生兼容；这是覆盖缺口，不是已确认 DTO 漂移。

## 接入真实系统前的架构事项

1. [`FixtureSession.ts`](https://github.com/Zhou-chu/study-workbench/blob/0ae994bd18d6073c5465dfeeaf9f0909034f25ff/clients/mobile/src/session/FixtureSession.ts)当前由 `Pick<FixtureRepository,...>` 定义 port，适合此原型的注入；接真实传输时应提取 application-owned 窄接口，以独立 fixture/HTTP adapters 实现，不让 demo reset/模拟文本成为真实 API 契约。
2. 当前 SaveAttempt 依赖 pending 对象身份，callbacks 绑定 epoch/repository/operation。持久化需要新的 durable ownership token 与 reconciliation 设计；序列化原对象或复用 demo epoch key 不等于进程死亡/多设备恢复。
3. 保持单一 `contracts/v1` owner，以生成 transport 类型加审查过的各端投影对齐；共享 RN domain 与平台 adapter 分工，不复制 DOM 客户端，不要求 ArkTS 直接导入任意 TS/npm。
4. UI 相对 Core 还包含 `scripts/v1/prepare_canonical_publication.py`、相关测试与 `CANONICAL_PUBLICATION.md` 变更。集成必须按目标切片审查，不能用旧分支整树覆盖当前后端、修复和兼容 fixture；publisher 改动应单独审查。

本次未建立新的高置信度生产结构缺陷；下一步是有界 port/contract/identity 接入，不是重排全仓或每设备另建后端。
未执行新 build/tests/toolchain/device/runtime/DB/provider 验收；不复用旧 PASS，不重试受限 Harmony/netlink 操作。原生入口认证、保护性持久化与设备验收仍是独立未完成门槛。

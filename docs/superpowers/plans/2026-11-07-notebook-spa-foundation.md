# Notebook SPA Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付独立可测试的公开契约、Node BFF、无 UI 领域规则及浏览器 transport，保留全部当前安全语义。

**Architecture:** 现有 FastAPI 业务不搬家；新增稳定只读投影，旧 workspace 保留。将 Next 里的受测代理提取到独立 Node HTTP 服务，浏览器仍同源请求；在独立包中隔离纯状态与浏览器状态。

**Tech Stack:** Node 24 原生 HTTP/Web Streams、TypeScript、Vitest、Pydantic/FastAPI、现有 Python 离线 runner；npm workspaces。

**Spec:** `../specs/2026-11-07-notebook-spa-redesign-design.md`，执行前同时阅读总计划 `2026-11-07-notebook-spa-redesign.md`。

## Global Constraints

- 本项目不重写 FastAPI 业务、数据库、任务执行器、NotebookLM 集成、引用身份或 portable 格式。
- 第一次生产切换以当前 legacy_password 行为兼容为准，不捆绑 device_sessions 的实际启用。
- 新 SPA 不把旧 opaque JSON 当成自动可操作的数据。
- 对这类端点关闭 prefetch、通用 retry、离线自动恢复和焦点并发刷新。
- BFF 不把入口 Cookie 或任意客户端认证头转发给 FastAPI。

## Review Focus

1. 编码路径、重复 header、HEAD/OPTIONS 和重定向绕过 route allowlist；A2 固定测试。
2. HTML 认证页、分片 UTF-8/JSON、chunked 大文件和迟到 abort；A3 固定测试。
3. BFF/API 认证模式不一致及刷新回执丢失；A2/A3 固定测试。
4. 历史 null/缺失/未知枚举、内部 file_path 与派生 lineage；A1 固定测试。
5. A→B→A 与请求队列准备期间身份变化，旧任务不得绑定新身份；A4 固定测试。

---

## 文件与公共接口地图

每个示例中的 harness/fixture helper 由该任务 Step 1 在对应 test 文件或所列 test/fixtures 文件实现，只包装真实被测接口；不是留给后续任务的未定义产品 API。所有 test、typecheck、build、lint 脚本必须随该包首次建立，使用已锁定工具，不能依赖 npx 临时下载。

新建根 `package.json`、`package-lock.json`、`tsconfig.base.json`；workspaces 只含 apps/*、packages/*，旧 frontend 暂保持独立。apps/bff 是独立 Node 服务；packages/contracts 是公开 DTO/解码；packages/domain 是无 DOM 纯状态；packages/web-transport 是浏览器请求/会话协调。不得跨包 import 源码绝对路径或 legacy 前端内部模块。

### Task A1: 公开读模型与兼容基础

**Files:**
- Create: `api/workspace_view_contracts.py`, `api/workspace_view_projection.py`, `api/source_upload_limits.py`
- Modify: `api/routers/evidence.py`, `api/personal_contracts.py`（只在复用现有类型必要时）、`contracts/v1/openapi.json`
- Create: `contracts/v1/fixtures/workspace-view-v1.json`, `tests/test_workspace_view_v1.py`
- Create: `package.json`, `package-lock.json`, `tsconfig.base.json`, `packages/contracts/package.json`, `packages/contracts/tsconfig.json`, `packages/contracts/src/workspace-view.ts`, `packages/contracts/src/operation.ts`, `packages/contracts/src/index.ts`, `packages/contracts/src/workspace-view.test.ts`
- Create: `docs/v1/SPA_DEPENDENCIES.md`, `docs/v1/SPA_BASELINE.md`
- Modify: `CHANGELOG.md`（本任务唯一新增所属条目，不造重复段落）。

**Interfaces:**
- Consumes: `PersonalService().workspace(notebook_id)` 的现有 wire；使用 jsonable_encoder 保留当前日期语义；旧 GET `/api/personal/notebooks/{id}/workspace` 不变。
- Produces: GET `/api/personal/notebooks/{id}/workspace-view`，返回 `WorkspaceViewV1`，包含 `schema_version: "workspace-view-v1"`、notebook、sources、notes、turns、jobs、selection、link、legacy_history。Python `project_workspace_view(value: dict[str, Any]) -> WorkspaceViewV1`；TS `parseWorkspaceView(value: unknown): WorkspaceViewV1`。
- `WorkspaceViewV1` 下的 `SourceView/SourceVersionView/NoteView/TurnView/JobView/SelectionView/EvidenceCitationView` 按现有受支持字段显式 allowlist，API wire 使用既有 snake_case。未知 engine/origin/state 保留字符串；缺失/null 不强制归一。不存在权威版本的来源保留兼容身份，不能捏造 source_version_id。
- 另新增 authenticated GET `/api/personal/client-capabilities`，返回 `ClientCapabilitiesV1 = { contract_version: "client-capabilities-v1"; supported_contracts: ["workspace-view-v1"]; limits: { source_upload_max_bytes: number; portable: PortableLimitsPublic } }`，只描述真实 API 能力，无任务派发；SPA 登录后读取它再放行新协议写入。BFF 自报版本不能替代 API 能力。`PortableLimitsPublic` 来自现有 get_portable_limits().public()；新增 `get_source_upload_max_bytes() -> int` 将 evidence.upload 中现有大小计算移到 api/source_upload_limits.py 并在上传与能力回执共用，默认50×1024×1024，不自行改变限制。
- `OperationReceipt = { job_id: string; turn_id?: string; state?: string }`；`OperationState = 'idle'|'submitting'|'accepted'|'running'|'succeeded'|'failed'|'unknown'|'canceled_locally'` 仅用于本地 UI，不回写服务器原 state。

- [ ] **Step 1: 写失败测试。** 固定 Python `test_workspace_view_allowlist_preserves_compatibility` 和 TS `preserves_unknown_fields_as_non_actionable_values`：同源/外 notebook 访问沿旧校验、内部路径不泄漏、合法引用与派生 lineage 不丢、旧 endpoint 不改、没有 version 的旧 source 仍可见；capabilities 只读返回真实版本，旧 API 缺少它不能误报兼容。
```python
def test_workspace_view_allowlist_preserves_compatibility():
    raw = fixture_with_internal_path_and_unknown_engine()
    view = project_workspace_view(raw)
    assert view.schema_version == "workspace-view-v1"
    assert "file_path" not in view.model_dump_json()
    assert view.selection.engine == "future-engine"
    assert view.model_dump(exclude_unset=True)["sources"][0]["versions"][0]["provenance"] == raw["sources"][0]["versions"][0]["provenance"]
```
- [ ] **Step 2: 运行 RED。** `PYTEST tests/test_workspace_view_v1.py -q`；预期新 projector 缺失造成失败，而不是网络/环境失败。为 TS package 配置最小 test/typecheck/build 以运行 `npm -w @study/contracts test -- src/workspace-view.test.ts`，预期 parser 缺失失败。
- [ ] **Step 3: 实现精确接口与 workspace setup。** 从当前锁文件复用 React/TS/Vitest 等精确版本及 integrity；新增 Vite 直接依赖以已准备锁中的兼容版本为准。React Router 选官方 registry 发布的最新稳定 7.x、校验 Node/React peer 后锁定，记录来源/实际版本；不得把未核验补丁号当事实。只有获准安装时才准备新依赖。投影为纯函数，route 调用现有 service；逐字段审查，不做递归黑名单代替 allowlist。公开 DTO 明确定义 restore/history 的安全只读分支；TS parser同时导出 parseTurnView/parseJobView/parseSourceVersionView 供现有详情/任务端点适配，不把这些旧端点称作已全面脱敏；不把未知字段散入可操作 payload。
- [ ] **Step 4: 运行 GREEN。** 以上两组测试、`PYTEST tests/test_v1_workspace_response_contracts.py tests/test_v1_api_contract.py -q`；用当前 `scripts/v1/export_contract.py` 的只读 check 模式检查实际 schema；`npm -w @study/contracts run typecheck && npm -w @study/contracts run build`。schema 快照更新走该工具受支持模式，不启动 API。预期全部通过，旧 fixtures 未改变。
- [ ] **Step 5: 本地提交。** `git add package.json package-lock.json tsconfig.base.json packages/contracts api/workspace_view_contracts.py api/workspace_view_projection.py api/source_upload_limits.py api/routers/evidence.py contracts/v1 tests/test_workspace_view_v1.py docs/v1/SPA_DEPENDENCIES.md docs/v1/SPA_BASELINE.md CHANGELOG.md && git commit -m "feat(contracts): add stable workspace view for new clients"`；若改 personal_contracts.py 单独检查后加入，禁止 git add .。

### Task A2: 独立 BFF 路由与认证代理

**Files:**
- Create: `apps/bff/package.json`, `apps/bff/tsconfig.json`, `apps/bff/src/server.ts`, `apps/bff/src/http-adapter.ts`, `apps/bff/src/config.ts`, `apps/bff/src/proxy.ts`, `apps/bff/src/policy.ts`, `apps/bff/src/session-store.ts`, `apps/bff/src/public-config.ts`
- Create: `apps/bff/test/http-adapter.test.ts`, `apps/bff/test/proxy-parity.test.ts`, `apps/bff/test/policy.test.ts`, `apps/bff/test/session-store.test.ts`
- Reference, do not delete: `frontend/src/lib/api/session-proxy.ts`, `session-proxy-policy.ts`, `bff-session-store.ts` 及其 tests；`frontend/src/app/config/route.ts`。

**Interfaces:**
- Consumes: A1 endpoint 与 schema_version；现有 `createSessionProxy(config, options)`/`dispatchApiRequest(req, legacyPath?)` 的方法、path、header 与错误契约。
- Produces: `createBffHandler(config: BffConfig): (request: Request) => Promise<Response>`；`createBffServer(config: BffConfig): import('node:http').Server`，不自动 listen；CLI 是唯一启动入口。
- `RuntimeConfig = { apiUrl: ''; auth_mode: 'legacy_password'|'device_sessions'; web_session_protocol: 'bff-memory-v1'|null; client_contracts: readonly string[]; ui_transport_protocol: 1 }` 作为 packages/contracts 公开类型，保留当前 wire字段名，SPA固定同源。
- `BffConfig` 从现有安全 config 类型迁移，不重新猜 env 名称；新增公开 `GET /config` 的 `client_contracts: ['workspace-view-v1']` 和 `ui_transport_protocol: 1`，保留 apiUrl/auth_mode/web_session_protocol 当前字段，apiUrl 固定当前同源而非接受浏览器指定 upstream。此公开配置只声明 BFF 自身支持，不声称 API 已支持；新增 client-capabilities GET 也必须经过明确 policy，登录后取得实际 API 回执。

- [ ] **Step 1: 写失败测试。** migration parity 直接复用旧 route/method corpus 加新 workspace-view GET；覆盖 legacy/device 模式不匹配、混合认证、Host/Origin、编码路径、HEAD/OPTIONS 和未知 endpoint；native HTTP adapter 覆盖重复 Set-Cookie 处理、不接受伪造 forwarded headers。
```ts
it('never forwards ingress cookies to API', async () => {
  const { handler, upstream } = makeProxyHarness('legacy_password')
  await handler(new Request('https://study.test/api/notebooks', {headers: {Cookie:'CF_Authorization=fixture', Authorization:'Bearer fixture'}}))
  expect(upstream.lastHeaders.get('cookie')).toBeNull()
  expect(upstream.lastHeaders.get('authorization')).toBe('Bearer fixture')
})
```
- [ ] **Step 2: 运行 RED。** `npm -w @study/bff test -- test/http-adapter.test.ts test/proxy-parity.test.ts test/policy.test.ts`，预期独立 handler/adapter 不存在失败。
- [ ] **Step 3: 提取代理及 HTTP adapter。** 去除 Next/server-only 框架标记，靠 package exports 和 browser bundle 检查守边界；保留已测 protocol/store 算法。Node IncomingMessage→Request 保留 raw path 与 abort，使用原生 streaming body/duplex；Response→ServerResponse 保留背压及 multi-value header，不缓冲业务 body。进程信号仅停止本服务拥有的 server，不杀别的进程。认证 JSON 8 KiB、列表/探测 256 KiB 限制沿当前协议。
- [ ] **Step 4: 运行 GREEN。** 全部旧 proxy/store/policy 回归移植到新包后执行 `npm -w @study/bff test && npm -w @study/bff run typecheck && npm -w @study/bff run build`。编译产物无 next/react import；新服务在合成固定 upstream 的真实本机 HTTP 测试中通过。旧前端继续可构建，未激活新服务。
- [ ] **Step 5: 本地提交。** `git add apps/bff CHANGELOG.md && git commit -m "feat(bff): extract standalone guarded browser proxy"`。

### Task A3: 流、大文件与会话恢复等价

**Files:**
- Create: `apps/bff/test/streaming-http.test.ts`, `apps/bff/test/private-ingress.test.ts`, `apps/bff/test/auth-loss-hops.test.ts`, `apps/bff/test/fixtures/upstream.ts`
- Modify: `apps/bff/src/http-adapter.ts`, `apps/bff/src/proxy.ts`, `apps/bff/src/public-config.ts`
- Reference: `frontend/src/app/api/_sse-proxy.ts`, portable route、source chat route、`docs/v1/STREAM_DOWNLOAD_PROTOCOL.md`、`DEVICE_SESSION_PROTOCOL.md`。

**Interfaces:**
- Consumes/produces: A2 `createBffHandler/createBffServer` 不变；JSON、SSE、multipart、download、auth/public 路由由同一 policy 分派，不存在绕过认证的“特例代理”。
- Defines: `classifyIngressResponse(status: number, contentType: string|null, location: string|null): 'expected'|'ingress_reauth'|'unavailable'`，只分类，不跟随外部重定向、不读取 Cookie/密码。

- [ ] **Step 1: 写失败测试。** split UTF-8 和 split JSON；长时间流先收到首段而非结束才输出；下游取消使上游停止读取；multipart boundary/原文件 SHA-256 保持；auth 超限拒绝但业务文件不受 8 KiB 限制；HTML login 和外部 Location 不被当成功。device 模式覆盖 API→BFF refresh 回执丢失与 BFF→browser 回执丢失的不同恢复。
```ts
it('delivers the first SSE chunk before upstream completion', async () => {
  const run = await startStreamingHarness()
  expect(await run.readFirstChunk()).toContain('data:')
  expect(run.upstreamFinished()).toBe(false)
  await run.cancelClient()
  expect(await run.upstreamWasCanceled()).toBe(true)
})
```
- [ ] **Step 2: 运行 RED。** `npm -w @study/bff test -- test/streaming-http.test.ts test/private-ingress.test.ts test/auth-loss-hops.test.ts`；测试必须使用真实 Node HTTP body 适配，不只 fetch mock。
- [ ] **Step 3: 补齐 transport 行为。** 配置允许的 body/idle budgets 取现有协议；固定跨源 redirect:error；完整多值 Cookie/响应头测试；只 auth JSON bounded buffer，业务流按既有 API 限制。兼容现有同源入口 Cookie 补丁，不将入口 Cookie传到 API。device store 进程内、单实例、刷新单飞及未知结果保守处理不变。
- [ ] **Step 4: 运行 GREEN。** `npm -w @study/bff test`；流式完整性、取消、输入超限、redirect 及两种认证模式全通过；测试只用合成凭据。记录读取分块事件与字节 hash，不用宽松 timing sleep 冒充 streaming。不得启用真实 device 模式。
- [ ] **Step 5: 本地提交。** `git add apps/bff CHANGELOG.md && git commit -m "fix(bff): preserve streaming and private ingress recovery"`。

### Task A4: 浏览器 transport 与无 UI 状态边界

**Files:**
- Create: `packages/domain/package.json`, `packages/domain/tsconfig.json`, `packages/domain/src/index.ts`, `packages/domain/src/operation.ts`, `packages/domain/src/editor.ts`, `packages/domain/src/scope.ts`, `packages/domain/src/navigation.ts`, `packages/domain/src/operation.test.ts`, `packages/domain/src/editor.test.ts`
- Create: `packages/web-transport/package.json`, `packages/web-transport/tsconfig.json`, `packages/web-transport/src/index.ts`, `packages/web-transport/src/client.ts`, `packages/web-transport/src/session-coordinator.ts`, `packages/web-transport/src/dispatch-context.ts`, `packages/web-transport/src/endpoint-policy.ts`, `packages/web-transport/src/client.test.ts`, `packages/web-transport/src/recovery.test.ts`
- Reference: legacy `frontend/src/lib/workbench/{turn-context,turn-operations,turn-reconciliation}.ts`、`lib/api/{browser-transport,client}.ts`、`lib/auth/session-coordinator.ts` 与对应已测边界。

**Interfaces:**
- `DispatchContext = Readonly<{ epoch: number; target: Readonly<{ mode: 'legacy_password'|'device_sessions'; apiBase: string; protocol: string|null }>; ready: boolean }>` 精确保留现有 TurnContext/TurnTarget 形状。它是目标与本地隐私边界，不是人类或 Google 账户身份；adapter 另外保留 sessionCoordinator generation 检查，禁止从 URL 派生账户 identity。
- `RequestSpec = { method: string; path: string; body?: BodyInit|null; signal?: AbortSignal; context: DispatchContext; operationKey?: string }`。
- `WebTransport.send(request: RequestSpec): Promise<Response>`；`createWebTransport(config: RuntimeConfig): WebTransport`，调用者负责 DTO decode，不暴露 token。
- `reduceOperation(state: OperationModel, event: OperationEvent): OperationModel`；`reduceEditor(state: EditorModel, event: EditorEvent): EditorModel`；类型在对应文件导出。OperationModel 持冻结目标、幂等键、receipt/unknown；EditorModel 持基 revision、内容、脏状态、保存结果。先复用现有算法再缩小接口，不改其重试/授权语义。
- `endpointPolicy(method,path): { retry: false; prefetch: false; dedupeKey?: string }` 对写与 job GET；真正无副作用 GET 可配置有界重查，默认仍 false。

- [ ] **Step 1: 写失败测试。** A→B→A、body preparation 中 target 变化、queued old selection、双击操作、unknown 保存后再按保存、晚到成功不覆盖新草稿。验证同源 Cookie 用 same-origin，跨源禁止请求而非仅 omit 凭据。
```ts
it('blocks an old operation after an identity round trip', () => {
  const pending = captureOperation(contextA, 'key-1')
  const current = transitionIdentity(contextA, 'B', 'A')
  expect(canDispatch(pending, current)).toBe(false)
})
```
- [ ] **Step 2: 运行 RED。** `npm -w @study/domain test && npm -w @study/web-transport test`；预期缺失新导出而失败。测试 helper captureOperation/transitionIdentity/canDispatch 作为对真实 reducer/context 的包装定义在该测试内；其中 transitionIdentity 表示现有隐私/认证边界变化，不宣称验证了人类身份。
- [ ] **Step 3: 实现包。** 迁移核心状态与最末 native fetch 前的捕获检查；auth-store 只允许在 browser adapter 内部，feature 不能读取。保留当前 legacy 凭据生命周期，不创建新持久密码存储。纯 domain 不 import React/window/storage。取消等待与取消远端分开，GET job 观察者单实例去重。
- [ ] **Step 4: 运行 GREEN。** 两包全量 test/typecheck/build；迁移原 turn/context/recovery 回归；import-boundary 测试证明 contracts/domain 不依赖 DOM/Node/React，Web 不包含 server config。旧 API wire 与任务幂等结果相同。
- [ ] **Step 5: 本地提交。** `git add packages/domain packages/web-transport CHANGELOG.md && git commit -m "refactor(client): isolate transport and operation state"`。

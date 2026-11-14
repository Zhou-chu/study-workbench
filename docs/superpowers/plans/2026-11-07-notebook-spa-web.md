# Notebook Monochrome Web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建借鉴用户博客纸墨排版、而适合学习工作流的全新 Notebook Web，完整替换旧界面。

**Architecture:** Vite React SPA，纯领域规则和 browser transport 取自 A4；公开 workspace-view 取自 A1。页面只通过 data adapter 调用应用 API，不读 token、不直连模型或 Google；旧前端在最终验收前保留。

**Tech Stack:** React 19、TypeScript、Vite、React Router 7、TanStack Query、Radix、现有 i18n/Markdown/PDF 工具、Vitest/Testing Library；字体与视觉详见 B1。

**Spec:** `../specs/2026-11-07-notebook-spa-redesign-design.md`；总计划和 foundation 分计划是接口前提。

## Global Constraints

- 新导入资料不自动改变已有问答范围。
- 阅读操作不改变问答选源。
- 本次默认保留内存草稿，不增加浏览器磁盘资料缓存或离线写队列。
- 关键触控目标至少 44×44 CSS px。
- 正文和按钮文字对比度 ≥4.5:1，适用的大字 ≥3:1，必要非文字边界 ≥3:1。
- 原始资料中的图片、图表和媒体保持原色，不为界面美学篡改内容。
- 所有 UI 字符串进入当前 locale registry 的所有语言；不靠静默英文 fallback 宣称覆盖。

## Review Focus

1. 灰阶下“错误、危险、未确认、焦点、选中”看起来相同；B1 状态语义与对比测试，C2 实测。
2. 主题切换、身份重新认证、设置弹层、Back/Forward 导致草稿和 File 消失；B1/B2 测试。
3. 中文 IME 和重复点击导致误发；B5 测试，C2 手机键盘实测。
4. 引用重用 c1、同日多版本、手动翻页与迟到请求竞争；B4/B6 测试。
5. 全局/经典历史中缺少新证据版本的来源被悄悄藏掉；B3/B8 覆盖与路由清单测试。

---

## 文件与公共接口地图

本文件以 apps/web 为当前包目录：Files 中 src/、scripts/、public/ 相对路径均指 apps/web 下的确切位置；docs/、frontend/ 与 packages/ 为仓库根路径。每个 test 示例使用的 render/harness/helper 必须由本任务 Step 1 在所列 test 文件或 src/test 内定义，包装真实组件，不是未定义产品接口。

`apps/web/src/app` 持 provider/router/layout；`features/{notebooks,sources,chat,reader,studio,library,settings}` 按功能共置 component/state/test；`data` 只做已授权 transport 与 DTO 的适配；`ui` 是黑白灰 primitives；`theme` 是本机外观偏好；`i18n` 迁移当前 locale 内容；`test` 只含合成 fixture。

普通 feature 文件不得 import old frontend 或 apps/bff。所有跨功能事件通过 domain 的身份和 draft/operation controller，不把一个 500 行 StudyWorkbench 重建回来。

### Task B1: 黑白灰设计系统、主题与应用骨架

**Files:**
- Create: `apps/web/package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/app/providers.tsx`, `src/app/router.tsx`
- Create: `src/theme/tokens.css`, `src/theme/theme.ts`, `src/theme/ThemeControl.tsx`, `src/theme/theme.test.tsx`, `src/ui/{Button,Dialog,Tabs,StatusBadge,EmptyState}.tsx`, `src/ui/semantics.test.tsx`, `src/app/WorkspaceLayout.tsx`, `src/app/layout.test.tsx`, `src/app/styles.css`
- Create: `src/i18n/index.ts`, `src/i18n/locales/`（迁移完整 registry）、`src/i18n/parity.test.ts`, `src/test/render-app.tsx`, `src/test/fixtures.ts`
- Reference: 当前 `frontend/src/lib/locales/`、现有 UI primitives、用户截图与公开博客；不复用旧屏幕布局。

**Interfaces:**
- `ThemePreference = 'light'|'dark'|'system'`；`resolveTheme(preference, systemDark): 'light'|'dark'`；`setThemePreference(value: ThemePreference): void`；本机 key `study-workbench.appearance.v1` 仅存偏好。
- `WorkspaceLayout({ sources, conversation, studio, reader, readerOpen, activeSection, onSectionChange })`；`activeSection: 'sources'|'conversation'|'studio'`。≥1280 三功能区；打开 reader 时先收 studio，不能四栏；900–1279 双栏/资料 drawer；<900 单区与全屏 reader。
- `StatusBadge({state,label})` 的 state 为 success/warning/error/pending/unknown；icon+文案始终可访问。生产样式无 global grayscale/filter。
- `renderApp(options)` test helper 包装真实 providers/router，参数含 `route?: string, transport?: WebTransport, workspace?: WorkspaceViewV1`，不伪造全局认证身份。fixtures 从 A1 合成 fixtures 派生。

- [ ] **Step 1: 写失败测试。** 主题首帧初始化、手动偏好优先、storage 拒绝仍可当前页切换、切换不 remount 工作区；状态用图标与文案区分；触控目标、焦点/选中语义、locale parity。
```tsx
it('keeps draft and mounted reader while toggling theme', () => {
  render(<ThemeHarness initialDraft="待保存笔记" initialPage={7} />)
  fireEvent.click(screen.getByRole('button', {name:'深色'}))
  expect(screen.getByRole('textbox')).toHaveValue('待保存笔记')
  expect(screen.getByLabelText('页码')).toHaveValue(7)
  expect(readerMountCount()).toBe(1)
})
```
- [ ] **Step 2: 运行 RED。** `npm -w @study/web test -- src/theme/theme.test.tsx src/ui/semantics.test.tsx src/app/layout.test.tsx src/i18n/parity.test.ts`；最小 runner 配置纳入该任务，不单独开“脚手架任务”。
- [ ] **Step 3: 实现设计系统与骨架。** 起始纸墨 tokens：light 背景 #EEEEEB、surface #FFFFFF、主字 #151515、次字 #5A5A55；dark 背景 #121212、surface #191919、主字 #E8E8E4、次字 #A3A39D。细线与近直角（0–4px），主操作反白。交互边框 light #70706C、dark #777771；装饰细线可更淡但不承担必需识别。标题栈 `"Noto Serif SC", "Songti SC", "STSong", serif`，工具栏/表单用系统 sans，编号/时间用 mono。首页标题 32–40px，工作台标题20–24px，正文16px/约1.65行高；不搬博客63px hero、不加建筑照片。优先系统/既有本地许可字体，无远程字体依赖；跨平台 fallback 进入 C2 验收。主题 head bootstrap 只读上述偏好、设置 root theme 后 mount；外观切换不涉及 React key。新 UI 字符串翻译同步。
- [ ] **Step 4: 运行 GREEN。** 上述测试＋`npm -w @study/web run typecheck && npm -w @study/web run build`；对比度脚本检查实际 token 配对，样式测试仅为源规则证据。支持浏览器中展示浅深样式与代表性长内容，记录待 C2 完整像素验收，不提前称通过。
- [ ] **Step 5: 本地提交。** `git add apps/web CHANGELOG.md && git commit -m "feat(web): add monochrome workspace shell and themes"`。

### Task B2: 登录、恢复与草稿导航

**Files:**
- Create: `src/features/auth/{LoginPage,ReauthLayer,ConnectionState}.tsx`, `src/features/auth/auth.test.tsx`, `src/app/WorkbenchSession.tsx`, `src/app/UnsavedNavigationDialog.tsx`, `src/app/navigation.test.tsx`, `src/data/config.ts`
- Modify: `src/app/providers.tsx`, `src/app/router.tsx`, `src/i18n/locales/*`
- Reference: 旧 use-auth/auth-store/session recovery 的状态语义，A4 transport。

**Interfaces:**
- `WorkbenchSession` 保持按 notebookId/editorSession 分隔的内存 DraftRegistry：`get(id): DraftState|undefined`、`update(id, patch): void`、`retireContext(epoch): void`；仅装载到当前认证上下文，不作为持久授权。
- `loadRuntimeConfig(signal?): Promise<RuntimeConfig>` 校验 A2 config/protocol，不能从 UI 输入生成 upstream；`loadClientCapabilities(context,signal?): Promise<ClientCapabilitiesV1>` 登录后读取 A1 authenticated endpoint。两边兼容才放行新协议写操作，API 404/不可用时保留草稿并阻止写，不错误登出或自动重发。
- `requestNavigation(intent: NavigationIntent): 'allow'|'confirm'|'blocked'` 使用 A4 EditorModel；pending/unknown 保存先核对，不通过通用“丢弃”绕过保护。

- [ ] **Step 1: 写失败测试。** 入口 HTML、应用401、Google NEEDS_REAUTH 分别提示；重认证 overlay 不卸载草稿/File；dirty 导航确认绑定原 editor/session，A→B→A 不复活；storage 只有外观信息；关闭页签提示但不虚称强退恢复。
```tsx
it('preserves file and note across reauthentication', async () => {
  const file = new File(['fixture'], 'notes.txt')
  const run = renderAuthenticatedWorkspace({file, note:'草稿'})
  await run.expireApplicationSession()
  expect(screen.getByRole('dialog', {name:'重新登录'})).toBeVisible()
  expect(run.selectedFile()).toBe(file)
  expect(run.noteDraft()).toBe('草稿')
})
```
- [ ] **Step 2: 运行 RED。** `npm -w @study/web test -- src/features/auth/auth.test.tsx src/app/navigation.test.tsx`，helper 使用真实 WorkbenchSession/transport。
- [ ] **Step 3: 实现接口。** mode 读取后选择已测 legacy/device adapter；不创建新凭据持久位置。跨隐私/认证边界冻结旧操作，不从相同 endpoint 推断账户连续性；登录、错误、更新不可用页全用 B1。路由确认取消时返回 opener，设置弹层不换主树；beforeunload 只提示未保存，不自动提交。移除上游版本 toast 的挂载入口，产品更新仅来自本产品实际版本能力。
- [ ] **Step 4: 运行 GREEN。** 定向与全部 auth/transport 回归，通过后执行 typecheck；验证应用重认证与入口登录区别，禁止自动重放 mutation。
- [ ] **Step 5: 本地提交。** `git add apps/web/src CHANGELOG.md && git commit -m "feat(web): retain drafts through authentication and navigation"`。

### Task B3: 笔记本首页、数据适配与完整路由清单

**Files:**
- Create: `src/data/notebook-api.ts`, `src/data/notebook-api.test.ts`, `src/features/notebooks/{NotebookHome,NotebookCard,CreateNotebookDialog,NotebookPage}.tsx`, `src/features/notebooks/notebooks.test.tsx`, `src/app/route-coverage.ts`, `src/app/route-coverage.test.ts`
- Create: `docs/v1/SPA_ROUTE_COVERAGE.md`
- Modify: `src/app/router.tsx`, `src/i18n/locales/*`

**Interfaces:**
- `createNotebookApi(transport: WebTransport): NotebookApi`，方法 `workspace(id,context,signal?) -> Promise<WorkspaceViewV1>`、`list(context,signal?) -> Promise<NotebookSummary[]>`、`create({name,description?},context) -> Promise<NotebookSummary>`。NotebookSummary 复用既有 notebooks API 成员，不改变 ID/时间格式。
- 路由：`/notebooks` 首页；`/notebooks/:id` 统一页面；旧 `/notebooks/:id/study` 保持 ID 的替代入口；`/sources(/:id)`、`/search`、`/podcasts`、`/settings`、`/settings/models`、`/transformations`、`/advanced` 全在清单里映射到后续组件，不假装占位即完成。
- `RouteCoverageEntry = { legacyPath: string; newPath: string; ownerTask: string; status: 'pending'|'implemented'|'verified'; coveredOperations: string[]; evidence?: string }`，数组显式列出所有旧 route/actions。

- [ ] **Step 1: 写失败测试。** 名称搜索/最近打开、创建后进入正确ID、空状态、刷新失败保留上次列表、旧链接不隐藏历史、未覆盖路线阻止 complete 判定。
```ts
it('does not count a placeholder route as completed coverage', () => {
  expect(isCoverageComplete([{...entry, status:'pending'}])).toBe(false)
  expect(isCoverageComplete([{...entry, status:'verified', evidence:'fixture'}])).toBe(true)
})
```
- [ ] **Step 2: 运行 RED。** `npm -w @study/web test -- src/features/notebooks/notebooks.test.tsx src/data/notebook-api.test.ts src/app/route-coverage.test.ts`。
- [ ] **Step 3: 实现首页与适配。** 数据加载经过 A1 parse；未知 scope 仍显示但不授权。新建只要求名称；不自动发 provider 请求。将所有当前页面和可见动作逐项录入 coverage 文档和常量，包括高级工具；清单是验收输入，不是靠扫描文件名自动推断。
- [ ] **Step 4: 运行 GREEN。** 定向 test/typecheck/build；fixture 包含原始、web、derived、无新版本的经典来源和历史，首页与 notebook 都可进入。
- [ ] **Step 5: 本地提交。** `git add apps/web/src docs/v1/SPA_ROUTE_COVERAGE.md CHANGELOG.md && git commit -m "feat(web): unify notebooks and preserve route coverage"`。

### Task B4: 资料、版本、上传与发现

**Files:**
- Create: `src/features/sources/{SourcesPanel,SourceRow,SourceDetails,AddSourceDialog,UploadStatus,DiscoveryPanel,RemoteImportPanel}.tsx`, `src/features/sources/source-selection.ts`, `src/features/sources/sources.test.tsx`, `src/features/sources/uploads.test.tsx`
- Create: `src/data/source-api.ts`, `src/data/source-api.test.ts`
- Reference: 旧 use-workbench-uploads/web-discovery/notebooklm/evidence API；新 UI 不复制旧版本卡片堆叠。

**Interfaces:**
- `SourceApi` 方法签名由既有 workbench.upload/evidence.version/webDiscovery/notebooklm DTO 适配；所有 mutation 加 `context: DispatchContext`，调用仍用现有 endpoints。`upload({notebookId,file,idempotencyKey,sourceId?},context) -> Promise<{source_id:string;source_version_id:string;job_id:string}>`。
- `SourceReadIntent = { source_version_id: string; evidence_id?: string; page_index?: number }`；`onRead(intent)` 不触发 saveSelection 的 source_version_ids 变化。
- `SelectionIntent` 沿既有 engine/selection_origin/source_version_ids/remote_source_ids/reading DTO，最多20；新资料仅显式 `includeImported(ids)` 才改变选源。

- [ ] **Step 1: 写失败测试。** 同名同日版本可区分、读取不勾选、导入不自动选源、20版本限制、IME 搜索不自动提交、上传未知保留同 key、换目标不借旧 key、双击只一次 POST、无 File 的恢复要求重选。
```tsx
it('does not change ask scope when reading another version', () => {
  const run = renderSources({selected:['v-old'], available:['v-old','v-new']})
  fireEvent.click(screen.getByRole('button', {name:'阅读 v-new'}))
  expect(run.selectionWrites()).toHaveLength(0)
  expect(run.readIntent()).toMatchObject({source_version_id:'v-new'})
})
```
- [ ] **Step 2: 运行 RED。** `npm -w @study/web test -- src/features/sources/sources.test.tsx src/features/sources/uploads.test.tsx src/data/source-api.test.ts`。
- [ ] **Step 3: 实现 source API 和界面。** 来源一行、版本在详情；read/select 分开。PDF/MD/TXT沿当前限制，预检取A1 capabilities.limits实际值而非硬编码；保存 File 对象到 B2 内存 registry。未知上传展示“核对结果”，不能复用通用 retry；web search 明确提交、选中导入，保留来源/时间/provenance；remote 操作要求 capability 和显式确认。导入后显示显式加入范围操作。
- [ ] **Step 4: 运行 GREEN。** 定向测试＋旧上传/selection/remote scope 回归迁移；浏览器在测试入口真实上传合成文本/PDF验证 1 个版本与1个任务，当前上传修复行为必须同样通过。
- [ ] **Step 5: 本地提交。** `git add apps/web/src CHANGELOG.md && git commit -m "feat(web): rebuild source selection and reliable imports"`。

### Task B5: 连续对话、提问与任务恢复

**Files:**
- Create: `src/features/chat/{ConversationPanel,Composer,Message,ScopeSummary,TurnStatus,TurnRecovery}.tsx`, `src/features/chat/chat.test.tsx`, `src/features/chat/turn-observer.ts`, `src/features/chat/turn-observer.test.ts`
- Create: `src/data/turn-api.ts`

**Interfaces:**
- `TurnApi.submit(sessionId, request: TurnRequest, context): Promise<OperationReceipt>`、`list(sessionId,context,signal?): Promise<readonly TurnView[]>`、`events(turnId,context,signal?): Promise<Response>`、`job(jobId,context,signal?): Promise<JobView>`、`cancel(jobId,context): Promise<JobView>`；TurnRequest/响应从契约包迁移现有 DTO；旧详情输出经A1 parseTurnView/parseJobView投影，不直接任意渲染opaque result。
- `observeTurn(receipt,context,onState): () => void` 单操作观察者，退订只结束本地等待，不能暗中 cancel 远端；操作模型用 A4。
- `onCitation(reference: EvidenceCitationView)` 与 `onSaveAnswer(turn: TurnView)` 交给 B6/B7，不推断引用身份。

- [ ] **Step 1: 写失败测试。** IME/229不发送、Enter与Shift+Enter、双击只提交一次、旧draft revision不得被清除、断流只重读已有job、Google不可用不自动切模型、历史答案不成为 source。
```tsx
it('does not send while composing Chinese text', () => {
  const run = renderConversation()
  fireEvent.keyDown(screen.getByRole('textbox', {name:'提问'}), {key:'Enter', isComposing:true, keyCode:229})
  expect(run.submitRequests()).toHaveLength(0)
})
```
- [ ] **Step 2: 运行 RED。** `npm -w @study/web test -- src/features/chat/chat.test.tsx src/features/chat/turn-observer.test.ts`。
- [ ] **Step 3: 实现连续列表和底部输入。** 文本清除绑定捕获draft revision与已接纳receipt；保持当前实际会话上下文能力，不凭消息样式增加服务端记忆。SSE 展示真实阶段，无虚构 token 打字；unknown 只提供核对。job GET 无 query-library默认 retry/prefetch/focus并发；错误/coverage贴对应消息。关键限制不能藏在折叠详情内。
- [ ] **Step 4: 运行 GREEN。** 上述 tests＋A4 operations；browser 测试入口提问→退到资料→返回→断线→恢复原任务，核对请求计数；不调用真实 provider 做未授权自动验收。
- [ ] **Step 5: 本地提交。** `git add apps/web/src CHANGELOG.md && git commit -m "feat(web): add conversation-first workflow and recovery"`。

### Task B6: 引用与独立阅读面板

**Files:**
- Create: `src/features/reader/{ReaderPane,ReaderHeader,PdfView,TextView,CitationContext}.tsx`, `src/features/reader/navigation.ts`, `src/features/reader/reader.test.tsx`, `src/features/reader/pdf.test.tsx`, `src/data/evidence-api.ts`
- Create: `apps/web/scripts/prepare-pdf-assets.mjs`（从已有受测脚本保留资源完整性/许可逻辑）、`apps/web/public/pdfjs/` 构建生成，不手造 vendored bytes。
- Reference: `frontend/src/components/evidence/`、现有 PDF 资源与 provenance 验证。

**Interfaces:**
- `openCitation(citation: EvidenceCitationView, origin: {turnId:string; focusKey:string}): ReaderIntent`；该 intent 同时捕获 notebook/version/extraction/evidence 和 generation。
- `ReaderPane({intent,onClose,onPositionChange})`；`onPositionChange({source_version_id,page_index,evidence_id?})` 只保存阅读位置，不改选源数组；位置语义复用现有协议。

- [ ] **Step 1: 写失败测试。** 两条均名c1但不同quote/locator、历史版本不可用、手动翻到4页后迟到引用不能跳回9页、主题切换不重载PDF、缩放只产生局部滚动、关闭返回原消息focus。
```ts
it('keeps the later manual page over a late citation response', async () => {
  const reader = startReaderWithDeferredCitation()
  reader.turnPage(3)
  await reader.resolveOldCitation({page_index:8})
  expect(reader.pageIndex()).toBe(3)
})
```
- [ ] **Step 2: 运行 RED。** `npm -w @study/web test -- src/features/reader/reader.test.tsx src/features/reader/pdf.test.tsx`。
- [ ] **Step 3: 实现阅读器。** 受保护字节与安全渲染沿既有证据校验；fit/100%/zoom、页码和文本搜索；无匹配/无提取/缺原件分开。桌面不替换对话，先收Studio；窄屏全屏，Back返回阅读上下文。PDF canvas尺寸变化在既有内存上限内重绘；不新增 remote font/CDN依赖，不给原始图表加灰度滤镜。
- [ ] **Step 4: 运行 GREEN。** 定向 tests＋资源hash/许可检查；browser 查看双栏PDF/公式/小图例、390px和1440px、切换主题和缩放，证据位置不变。单测canvas替身不能代替实际清晰度验收。
- [ ] **Step 5: 本地提交。** `git add apps/web/src apps/web/scripts apps/web/public CHANGELOG.md && git commit -m "feat(web): add contextual citation reader"`，提交前核对 public 只含合法构建资源、无用户文件。

### Task B7: 笔记、成果、音频和项目导出恢复

**Files:**
- Create: `src/features/studio/{StudioPanel,ArtifactCard,NoteEditor,NoteConflict,AudioArtifact,PortableDialog}.tsx`, `src/features/studio/notes.test.tsx`, `src/features/studio/artifacts.test.tsx`, `src/data/studio-api.ts`
- Reference: 当前 notes/source-snapshots/portable/notebooklm/artifacts DTO与API；A4 EditorModel。

**Interfaces:**
- `StudioApi.createNote(notebookId,payload:CreateWorkbenchNoteInput,context): Promise<WorkbenchNote>`；`updateNote(notebookId,noteId,payload:UpdateWorkbenchNoteInput,context): Promise<WorkbenchNote>`（expected_revision按既有型）；这些既有write DTO在A1 contracts按原形迁入，不能用只读NoteView代替写入回执；`promote({notebookId,origin:{kind:'note',id,revision}|{kind:'turn',id},idempotencyKey},context)`。
- audio/export/import/download方法沿现有 payload与路径；所有写明确幂等键及确认状态；返回实际 operation receipt，不返回伪造completed。
- `NoteEditor({noteId?,baseRevision?,draft,onSave,onClose})`；编辑状态独立于后台 query cache。

- [ ] **Step 1: 写失败测试。** 编辑器按需打开、409/428保留draft、unknown Save Answer不重复create、保存中迟到回应不盖新标题、dirty note不能promote、引用scope保留、音频取消文案诚实、portable导入不覆盖。
```tsx
it('keeps the draft after revision conflict without retrying', async () => {
  const run = renderNoteEditor({revision:7, draft:'new', responseStatus:409})
  fireEvent.click(screen.getByRole('button', {name:'保存'}))
  await screen.findByText('存在其他修改')
  expect(run.draft()).toBe('new')
  expect(run.saveRequests()).toHaveLength(1)
})
```
- [ ] **Step 2: 运行 RED。** `npm -w @study/web test -- src/features/studio/notes.test.tsx src/features/studio/artifacts.test.tsx`。
- [ ] **Step 3: 实现成果界面。** 列表默认不放空编辑器；NoteEditor显式保存与compare/reload；provenance/版本不可丢。音频任务与产物绑定，已存在音频能播放/下载；capability缺失不能假按钮。portable受保护上传/下载，结果按实际receipt；未接纳操作与unknown不同处理。
- [ ] **Step 4: 运行 GREEN。** 定向与旧note-conflict/portable/source-promotion回归；真实合成DB测试“保存 revision7→外部revision8→409→比较→明确重新编辑保存”，真实ZIP导出再导入到新ID；不使用用户笔记。
- [ ] **Step 5: 本地提交。** `git add apps/web/src CHANGELOG.md && git commit -m "feat(web): rebuild notes and research artifacts"`。

### Task B8: 全局资料、搜索和兼容历史

**Files:**
- Create: `src/features/library/{LibraryPage,SourcePage,GlobalSearchPage,LegacyHistory,PodcastsPage}.tsx`, `src/features/library/library.test.tsx`, `src/data/library-api.ts`
- Modify: `src/app/router.tsx`, `src/app/route-coverage.ts`, `docs/v1/SPA_ROUTE_COVERAGE.md`

**Interfaces:**
- `LibraryApi` 保留当前 sources/search/source-chat/podcasts API 方法与请求形状，经 A4 context适配；全局Ask与选源问答是不同明确入口，结果不自动传入选源scope。
- `LegacyHistory({sessions})` 展示已有role/content及可验证附件，未知来源身份只读说明；不得补造证据版本。

- [ ] **Step 1: 写失败测试。** legacy-only source出现在资料库和对应notebook；旧source detail链接可打开；全局搜索不偷偷改变本笔记本scope；既有podcast可播放/下载；没有任何新证据版本也不显示空白假成功。
```tsx
it('keeps a classic source without a version visible', () => {
  renderLegacyLibraryFixture({versions:[]})
  expect(screen.getByText('历史资料.txt')).toBeVisible()
  expect(screen.getByText('尚无可定位的证据版本')).toBeVisible()
})
```
- [ ] **Step 2: 运行 RED。** `npm -w @study/web test -- src/features/library/library.test.tsx src/app/route-coverage.test.ts`。
- [ ] **Step 3: 实现新界面覆盖。** 迁移旧API功能而非嵌入旧页面；保留当前添加/查看/编辑/删除与来源聊天等真实可用操作的确认语义。只有明确不支持的数据形态提供只读解释，不能一概把旧功能降级。补全每项动作在coverage的映射。
- [ ] **Step 4: 运行 GREEN。** 全部旧路由synthetic fixtures验收，含上传旧型来源、来源聊天、全局search/ask、播客重试；动作数与旧清单一一对应；不会冒用新选源范围。
- [ ] **Step 5: 本地提交。** `git add apps/web/src docs/v1/SPA_ROUTE_COVERAGE.md CHANGELOG.md && git commit -m "feat(web): preserve global library and historical workflows"`。

### Task B9: 设置、模型和高级工具完整迁移

**Files:**
- Create: `src/features/settings/{SettingsLayout,NotebookSettings,ModelsPage,ConnectionsPage,ApplicationSettings,TransformationsPage,AdvancedPage}.tsx`, `src/features/settings/settings.test.tsx`, `src/data/settings-api.ts`
- Modify: `src/app/router.tsx`, `src/app/route-coverage.ts`, `docs/v1/SPA_ROUTE_COVERAGE.md`

**Interfaces:**
- `SettingsApi` 复用当前 settings/models/providers/credentials/transformations/embedding/NotebookLM连接接口，DTO不自创；任何凭据输入只发送对应授权API，不进入query key、日志或draft registry。
- `NotebookSettings({notebookId,onClose})` 保持主工作区已挂载；全局设置路由导航受B2保护，不再靠额外开新页面避免丢状态。

- [ ] **Step 1: 写失败测试。** 设置开关不丢草稿/File；缺模型/未连接/额度/严格隔离不可用区别显示；敏感值不进console/cache；高级重建需要明确动作；旧不存在的GET models/{id}不能因新界面放行。
```tsx
it('does not unlock a denied endpoint while migrating model settings', async () => {
  const run = renderModelsSettings()
  await run.inspectModel('fixture-model')
  expect(run.requests().some(r => r.path === '/api/models/fixture-model')).toBe(false)
})
```
- [ ] **Step 2: 运行 RED。** `npm -w @study/web test -- src/features/settings/settings.test.tsx src/app/route-coverage.test.ts`。
- [ ] **Step 3: 实现所有当前设置动作。** 每类设置有加载/保存/失败和明确影响范围；NotebookLM连接使用当前手动登录/能力状态，不伪造connected；transformations编辑/试验、embedding维护和system information移入高级入口；不在此任务修改实际用户密钥或启用device模式。
- [ ] **Step 4: 运行 GREEN。** 新Web全量tests/typecheck/build、全部locale parity；coverage不再有pending页面/动作，但实际browser验证状态仍由C2填入。设置屏幕适配390px与keyboard，并检查危险动作在灰阶下仍明显。
- [ ] **Step 5: 本地提交。** `git add apps/web/src docs/v1/SPA_ROUTE_COVERAGE.md CHANGELOG.md && git commit -m "feat(web): migrate settings and advanced tools"`。

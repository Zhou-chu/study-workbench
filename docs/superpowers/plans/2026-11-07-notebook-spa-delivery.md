# Notebook SPA Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为独立 SPA/BFF 提供可验证构建、隔离的完整验收与保持数据安全的生产切换路径。

**Architecture:** 同一个受保护 origin 路由静态 Web 和 /api BFF，内部 BFF→FastAPI，API/worker共享已有受限数据根。以合成实例验证，不修改用户运行实例；所有生产变化在精确版本与授权确认后单独执行。

**Tech Stack:** 已选择的 Node/Vite 构建、现有 Python验证工具、五服务 Compose候选、受支持浏览器工具、既有受保护入口。

**Spec:** `../specs/2026-11-07-notebook-spa-redesign-design.md`；依赖 foundation A1–A4 和 web B1–B9。

## Global Constraints

- 五个逻辑服务：静态 Web/gateway、BFF、API、worker、DB。
- BFF 单实例；API/worker 延续已支持的单机共享数据根与文件锁边界。
- 本次不加 service worker，避免凭据和旧 bundle 缓存产生新边界。
- 单元测试、旧记录、颜色计算不能代替当前像素/触控验收。
- 设计批准不等于实际修改域名、入口安全设置、凭据、运行模式、数据库或生产切换授权。

## Review Focus

1. 旧 bundle/旧页签和新API契约不兼容，用户不应被强制刷新丢草稿；C1/C3测试。
2. 入口 Cookie、API响应与静态资源分流导致私密性或上传回归；C1/C2测试。
3. 字体fallback、手机软键盘、200%缩放和灰阶焦点在单测里不可见；C2像素与真实输入检查。
4. 新部署成功但回退代码/数据组合不一致；C3演练及清单。
5. 主题切换/并发请求和断线取消破坏未知操作身份；C2/C3请求计数与恢复检查。

---

## 文件与接口地图

各示例 helper 在该任务 Step 1 的 test 文件内实现；它们不是产品接口。真实浏览器操作不通过新测试脚本绕过受支持工具或授权边界。

`deploy/v1` 新增 web/bff 镜像和路由配置；`scripts/v1` 新增纯产物验证/合成实例工具；`docs/v1/evidence/spa-...` 只保存脱敏的版本与验证结果。保留旧 frontend Dockerfile 与可回退产物直到最终切换；不删除持久卷或用户文件。

### Task C1: 独立构建、同源路由和兼容握手

**Files:**
- Create: `apps/web/scripts/build-manifest.mjs`, `apps/web/scripts/build-manifest.test.mjs`, `scripts/v1/check_spa_artifacts.py`, `tests/test_spa_artifacts.py`
- Create: `deploy/v1/Dockerfile.web`, `deploy/v1/Dockerfile.bff`, `deploy/v1/web-gateway.conf`
- Modify: `deploy/v1/compose.yaml`, `.dockerignore`, `deploy/v1/env.example`, `deploy/v1/entrypoint.py`（仅必要的新服务配置检查）、`tests/test_v1_container_contract.py`
- Modify: `apps/web/src/data/config.ts`, `apps/web/src/app/providers.tsx`
- Create: `apps/web/src/app/compatibility.test.tsx`, `docs/v1/SPA_ARTIFACT_IDENTITY.md`

**Interfaces:**
- `SpaArtifactManifest = { schema_version: 'spa-artifact-v1'; source_commit: string; authored_digest: string; asset_digest: string; contract_digest: string; ui_transport_protocol: 1; supported_contracts: ['workspace-view-v1'] }`。分别为 Web/BFF记录产物hash；不把这叫可重现构建证明。
- CLI：`node apps/web/scripts/build-manifest.mjs --verify apps/web/dist`；`"$PYTHON" scripts/v1/check_spa_artifacts.py --web apps/web/dist --bff apps/bff/dist --contract contracts/v1/openapi.json`，纯文件检查、不连接服务。
- `evaluateCompatibility(localManifest, runtimeConfig, apiCapabilities): 'compatible'|'blocked'|'unavailable'`；blocked保留当前草稿并冻结写入，提供明确更新操作，不自动reload。A1 API capabilities 必须登录后实际读取；BFF build 自报支持不能覆盖旧 API 不支持的事实。

- [ ] **Step 1: 写失败测试。** 产物缺资源/改变字节/含秘密样例失败；BFF产物不得有Next/React依赖；/api不落SPA fallback；未知路由/静态缓存策略；协议不匹配或新BFF+旧API组合冻结写但不清draft；Compose只公开web回环入口、API/DB不公开。
```tsx
it('keeps the draft when a new runtime is incompatible', () => {
  const run = renderCompatibilityFixture({draft:'未保存'})
  run.receiveRuntime({ui_transport_protocol:2, client_contracts:[]})
  expect(run.canWrite()).toBe(false)
  expect(run.draft()).toBe('未保存')
  expect(run.reloadCount()).toBe(0)
})
```
- [ ] **Step 2: 运行 RED。** `node --test apps/web/scripts/build-manifest.test.mjs`；`PYTEST tests/test_spa_artifacts.py tests/test_v1_container_contract.py -q`；`npm -w @study/web test -- src/app/compatibility.test.tsx`。
- [ ] **Step 3: 实现构建和路由。** web静态镜像与bff镜像分别构建，API/worker仍同后端镜像；固定内部 upstream、禁止浏览器Host推导上游。index/config不长缓存、哈希资源可缓存；没有service worker。取现有正式基础镜像固定版本/摘要，新增静态server依赖须先核验官方来源/许可并锁定；不引入免费公共CDN。源、build、manifest、served资源的关联真实计算，不伪造旧Next receipt。所有秘密/数据/profile目录进入.dockerignore排除。
- [ ] **Step 4: 运行 GREEN。** 上述tests＋独立web/bff build/manifest verify；实际Docker build/Compose只在获准且具备工具的主机执行。缺少Docker时只标静态通过，不能把本机原生进程运行当Docker通过。静态包构建不需要API在线或真实凭据。
- [ ] **Step 5: 本地提交。** `git add deploy/v1 .dockerignore apps/web/scripts apps/web/src scripts/v1/check_spa_artifacts.py tests/test_spa_artifacts.py tests/test_v1_container_contract.py docs/v1/SPA_ARTIFACT_IDENTITY.md CHANGELOG.md && git commit -m "build(spa): separate artifacts and same-origin routing"`。

### Task C2: 隔离全旅程、浏览器与灰阶验收

**Files:**
- Create: `scripts/v1/spa_acceptance.py`, `tests/test_spa_acceptance_ownership.py`, `docs/v1/SPA_BROWSER_CASES.json`, `docs/v1/SPA_ACCEPTANCE.md`
- Create: `docs/v1/evidence/spa-acceptance-<build-id>/summary.json` 及必要脱敏截图索引；不要提交真实笔记/凭据。
- Modify: `docs/v1/SPA_ROUTE_COVERAGE.md`（实际通过后将对应行verified）、涉及修复的唯一责任任务文件。

**Interfaces:**
- CLI `"$PYTHON" scripts/v1/spa_acceptance.py prepare --run-root ABSOLUTE_ISOLATED_ROOT --fixture contracts/v1/fixtures/workspace-view-v1.json`，创建自有合成实例清单；`inspect --manifest FILE` 只检查本实例；`stop --manifest FILE` 只停止清单拥有且身份匹配的进程。prepare不指向生产root，不读取ambient credentials。
- `AcceptanceSummary = { source_commit; web_digest; bff_digest; api_commit; contract_digest; auth_mode; environment; cases: [{id,status:'passed'|'failed'|'not_run'|'blocked', evidence:string[]}]; limitations:string[] }`。
- Browser case JSON记录操作、预期、视口、语言、主题与证据，不内置登录密码或提供方密钥；浏览器执行使用受支持工具。

- [ ] **Step 1: 写失败测试。** root复用/落到用户数据/未知PID清理拒绝、无明示fixture不启动worker、secret环境不继承、过期manifest不会杀别的进程；矩阵中未运行项不得汇总为passed。
```python
def test_unrun_case_prevents_complete_acceptance():
    result = summarize_cases([{"id":"phone-ime", "status":"not_run"}])
    assert result["complete"] is False
    assert result["cases"][0]["status"] == "not_run"
```
- [ ] **Step 2: 运行 RED。** `PYTEST tests/test_spa_acceptance_ownership.py -q`；失败应来自不存在的ownership/summary规则。
- [ ] **Step 3: 实现有界实例工具与场景清单。** 复用现有owned launcher/fixture能力，不默认连DB或拉依赖；只在获准环境启动DB→API→worker→BFF→web，记录自己PID/group与构建身份。矩阵包含360/390/768/1024/1280/1440/1920、中文/英文、浅/深、keyboard/coarse、125%/200%；补平板分屏和手机软键盘，未具备真实条件的项单列受阻。主题：首次系统、手动覆盖、刷新持久、storage不可用、系统变化、切换不丢草稿/File/PDF页码。来源媒体原色保持，禁止全页面grayscale/invert。
- [ ] **Step 4: 运行 GREEN及真实旅程。** 全部包unit/types/lint/build＋后端受影响套件与契约；受支持浏览器执行新建→上传→解析→显式选源→提问→引用→保存重开→导出/导入，并覆盖B8/B9所有旧动作。注入丢回执/断线/401/409/HTML认证页，检查请求计数无重复写。使用合成provider验证协议；真实模型/Google按已有批准数据和预算另测，无权限不调用、不伪造完成。保存代表性浅深截图、焦点/滚动/布局尺寸与失败状态；用户对新界面体验的确认单列。
- [ ] **Step 5: 本地提交。** `git add scripts/v1/spa_acceptance.py tests/test_spa_acceptance_ownership.py docs/v1/SPA_BROWSER_CASES.json docs/v1/SPA_ACCEPTANCE.md docs/v1/SPA_ROUTE_COVERAGE.md docs/v1/evidence/spa-acceptance-<build-id> CHANGELOG.md && git commit -m "test(spa): verify isolated product and browser acceptance"`；实际替换build-id，不用通配符捕获其他证据；失败或未运行不填通过。

### Task C3: 有界切换、旧页签与回退

**Files:**
- Create: `docs/v1/SPA_CUTOVER.md`, `scripts/v1/spa_cutover_plan.py`, `tests/test_spa_cutover_plan.py`
- Modify only after approved cutover: 服务管理/路由配置的获准目标；最终 `AGENTS.md`, `frontend/AGENTS.md`, `docs/v1/ENTRYPOINTS.md`, `docs/v1/RUNBOOK.md` 与旧frontend入口声明。

**Interfaces:**
- CLI `"$PYTHON" scripts/v1/spa_cutover_plan.py --candidate MANIFEST --current CURRENT_MANIFEST --acceptance SUMMARY` 仅输出dry-run步骤和阻塞项，不改任何运行服务。
- `CutoverPlan = { candidate; current; backups_verified: bool; auth_mode; compatibility; blockers: string[]; ordered_actions: string[]; rollback_actions: string[] }`。没有 `--force` 绕过校验；脚本产物不构成用户授权。

- [ ] **Step 1: 写失败测试。** 缺备份/验收/已知Cookie补丁、auth模式意外变化、来源与部署hash不符、旧bundle不兼容均阻止“可切换”；新schema与旧回退不兼容时停止；unknown写入不得通过重启“清掉”。
```python
def test_mode_change_is_not_included_in_ui_cutover():
    plan = make_cutover_plan(current=legacy_manifest(), candidate=device_manifest())
    assert "AUTH_MODE_CHANGE_REQUIRES_SEPARATE_ACTIVATION" in plan.blockers
    assert plan.ordered_actions == []
```
- [ ] **Step 2: 运行 RED。** `PYTEST tests/test_spa_cutover_plan.py -q`。
- [ ] **Step 3: 实现dry-run和操作说明。** 明确当前source-access-cookie与后续上传补丁映射、数据卷/DB一致备份及恢复证据、旧构建保留、入口私密性、正在运行/unknown任务处理、用户工作保存窗口。第一次模式保持legacy。device后续若启用，BFF/API联动重启另行验收，不能以独立镜像推导可独立重启。旧页签运行时握手发现不兼容冻结新写、不自动刷新；提供用户主动保存/退出/更新步骤。
- [ ] **Step 4: 运行 GREEN并分层执行。** 先通过dry-run测试和合成实例候选→退回演练，证明无schema变更时不回滚用户内容。然后检查实际生产操作已有授权；不足则请求精确批准，不执行。获准后只按已验证步骤切入口，立即核对实际构建、登录/上传/问答/引用/笔记/导出及访问保护。失败即按相容回退，未知结果先查。停止旧Next运行仅在全覆盖验收和切换成功后；保留可回退源码/产物，不删除数据或旧历史。
- [ ] **Step 5: 本地提交并报告。** `git add docs/v1/SPA_CUTOVER.md scripts/v1/spa_cutover_plan.py tests/test_spa_cutover_plan.py CHANGELOG.md && git commit -m "docs(spa): add verified cutover and rollback procedure"`。实际入口/AGENTS/Runbook修改仅在发生后另提交准确状态；未部署时报告“候选已验收/等待批准”，不能写“已上线”。

# Notebook SPA Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Notebook 全部 Web 界面替换为黑白灰、可切换深浅主题的独立 React SPA，迁出独立 BFF，保留已有数据与安全协议。

**Architecture:** 浏览器静态 SPA 与独立 Node BFF 同源接入，FastAPI/worker/DB 继续负责业务。一个仓库、独立构建和契约兼容窗口；第一次切换保留当前 legacy_password 模式，不顺带启用 device_sessions。全部旧页面完成覆盖后才撤掉 Next 运行依赖。

**Tech Stack:** TypeScript、React 19、Vite、React Router 7、TanStack Query、现有 Radix/Markdown/PDF 工具；Node 24；现有 Python/FastAPI、SurrealDB、worker。具体已验证补丁版本和锁文件在 A1 固定，不更新未涉及依赖。

**Spec:** `../specs/2026-11-07-notebook-spa-redesign-design.md`，用户已确认总体设计，后续黑白灰、博客参考和深浅切换要求优先。

## Global Constraints

- 本项目不重写 FastAPI 业务、数据库、任务执行器、NotebookLM 集成、引用身份或 portable 格式。
- 第一次生产切换以当前 legacy_password 行为兼容为准，不捆绑 device_sessions 的实际启用。
- 新导入资料不自动改变已有问答范围。
- 阅读操作不改变问答选源。
- 本次默认保留内存草稿，不增加浏览器磁盘资料缓存或离线写队列。
- 关键触控目标至少 44×44 CSS px。
- 正文和按钮文字对比度 ≥4.5:1，适用的大字 ≥3:1，必要非文字边界 ≥3:1。
- 旧服务在验收期间保留，切换完成后不再依赖 Next 运行时提供任何正常用户功能。
- 不可将计划保存、设计批准或离线测试解释成安装、认证模式激活、入口修改或生产发布批准。

## Review Focus

1. Cloudflare Access 过期返回 HTML/重定向，用户应得到入口重新认证而不是上传失败；A3、B2 覆盖。
2. 中文 IME、移动软键盘和同一事件内双击，不能多发一轮或丢问题；B5、C2 覆盖。
3. 同名/同日不同版本、复用 citation_id 和迟到定位，必须仍打开准确证据且手动翻页优先；B4、B6 覆盖。
4. 灰阶主题下警告/失败/焦点不可只靠颜色，切换主题不能重建草稿与阅读器；B1、C2 覆盖。
5. 切换发布时已有旧页签/旧 bundle、未确认写入和 auth A→B→A，不能强刷丢草稿或在新身份重放；A4、C1、C3 覆盖。

---

## 分计划与依赖

此项目包含三个可独立评审的子系统，避免一个超长计划把平台迁移与 UI 混在一起。

1. **A，契约、BFF 与平台边界：** `2026-11-07-notebook-spa-foundation.md`。A1→A2→A3→A4，交付可通过 HTTP 契约测试的独立 BFF 和前端传输/领域包，不替换线上 UI。
2. **B，完整新 Web：** `2026-11-07-notebook-spa-web.md`。B1 可在 A1 后与 BFF 并行；B2 依赖 A4；B3→B4→B5→B6→B7 构成主旅程；B8/B9 可在公共接口冻结后分别推进。交付独立静态应用和全部路由覆盖。
3. **C，运行验收与切换：** `2026-11-07-notebook-spa-delivery.md`。C1 在 A3+B2 后可先准备；C2 依赖全部 A/B；C3 依赖 C2、备份与相应发布授权。交付可复核的候选版本、验收证据和有界回退操作。

默认建议逐任务实现、每任务独立评审，最后整体评审。不能同时修改共享契约或公共 locale 文件；分配唯一集成负责人。每个任务五步均有可观察结果，只有通过检查才做本地 commit；推送、合并与部署权限另外核对。

## 执行环境与基线

- 当前云端 `study-workbench` 是旧 checkout 且已有未提交文件，不可用作本计划实施工作树，更不能清理其改动。
- 执行时先用 `superpowers:using-git-worktrees` 在经核验的规范仓库建立独立 worktree。基线至少包含 91a92fa1，以及已修复上传的同源 Cookie 补丁与后续被确认的相关补丁。重新读取当前分支头，不假定计划日期的 HEAD 永远不变。
- 不从运行实例复制 .env、凭据、Google profile、业务数据或 caches 到源码。用普通文件 diff/树哈希核对已批准补丁，再加入已有 regression tests。
- 源码规则来自当前 AGENTS.md；所有 UI 字符串进入所有现有 locales。不要硬编码“14种语言”，从当前 locale registry 得出真实集合。
- 已观察 cloud Node 24.22.1、Python 3.12.14；这些不是允许执行者自动安装工具链的授权。缺少已准备环境时报告准确缺口。
- 合成测试使用独立数据根；API 启动有迁移、worker 会消费任务，严禁把 acceptance 指向用户数据库。

## 命令约定

A1 创建 npm workspaces，名称固定为 `@study/contracts`、`@study/domain`、`@study/web-transport`、`@study/bff`、`@study/web`，不把旧 frontend 的锁文件静默替换。各包脚本：test=vitest run、typecheck=tsc --noEmit、lint=使用已锁定ESLint的该包源码检查、build=对应构建；具体执行路径见子计划。

Python 命令中的 `$PYTHON` 与 `$TOKEN_CACHE` 必须由执行者检查为准备好的解释器绝对路径与 tokenizer cache 绝对路径。当前已读 runner 支持 -- 分隔 pytest 参数；执行基线变更后再核对。禁止 pip/uv 临时解析环境冒充已准备环境。先在执行 shell 定义下列函数，子计划中的 PYTEST 即为可运行的有界测试命令：

```bash
PYTEST() { "$PYTHON" scripts/offline_pytest.py --tiktoken-cache "$TOKEN_CACHE" -- "$@"; }
```

Browser 场景通过当前受支持、获准的浏览器工具执行，不能因为已有测试文件就安装/启动另一条浏览器控制通道。只对测试入口与合成数据执行，并记录当前像素；组件单测和静态 CSS 测试不能代替。

## 自查结论与交付边界

规格 1–4→A1/总约束；5→B3/B8/B9；6.1→B4；6.2→B5；6.3→B6；6.4→B7；6.5→A4/B2；7–8→B1/C2；9–10→A1/A4；11→A2/A3/B2；12→A3/A4/B4/B5/B7；13→C1/C3；14→各任务+C2；15→接口和权限边界。

计划已进行作者自查，修正了 API 真实能力握手缺口、将 DispatchContext 对齐既有 TurnContext（不虚构账户身份）、明确 test helper/相对路径和 PYTEST 命令：任务有文件归属、输入输出接口、RED/GREEN、提交边界；Review Focus 均有归属测试；没有未定义的共享类型或偷偷追加的生产操作。精确补丁版本以 A1 的已验证依赖记录为执行输入，不把现未查询的 registry 版本写成事实。

本计划尚未执行。设计的独立审阅通过不代表计划、构建或部署通过。实施前由用户确认计划与执行方式；若用户已有明确执行方式，继续其方式，不再让其重复选择。

# 实测测试覆盖率

2026-10-20 UTC 更新；保留 10-18 历史基线。覆盖率是自动化测试执行到的代码比例，不是功能完成率，也不证明真实 Google 或真实模型已经可用。

## 统计口径

- 后端：完整 pytest 套件，`pytest-cov` 开启分支覆盖率；范围为 `api/`、`open_notebook/`、`commands/`。其中混合了单元测试、注入式 fake、真实 CPU 解析和服务层测试，不把全部测试称为纯单元测试
- 前端：Vitest 4.1.9 + 已安装的 `@vitest/coverage-v8` 4.1.9；显式包含全部生产 TS/TSX，含未被测试导入的 0% 文件；排除测试文件、测试初始化和声明文件
- “全库”包含原有 Open Notebook；“V1 文件”仅为相对固定上游 `a0f6f3081ae06328f0a451b3a3ef2959ca25721d` 的新增/修改生产文件，但其中修改文件按整个文件计数
- 后端另给“V1 改动行”：只统计相对固定上游新增/替换的可执行行；被删除行不计。分支以其起始行是否被修改来归属
- 前端行覆盖率与 statement 覆盖率不同，不能互换。`TypeScript` 类型擦除后没有可执行逻辑；前端另保留排除 locale/type-only 的功能文件口径
- 真实 Firefox 浏览器和独立原生 SurrealDB 恢复另行跑过，但未接入本次覆盖率采集，**不会混入以下百分比**。因此包装层曾显示 0% 不等于该功能从未在真实浏览器中跑过

## 补测前基线（已于 09:03 UTC 告知用户）

| 范围 | 行覆盖 | 分支覆盖 | Statement 覆盖 |
|---|---:|---:|---:|
| 后端全库 | 7826/11929 = 65.60% | 1792/3282 = 54.60% | coverage.py 按可执行语句行统计 |
| 后端 V1 文件 | 2488/3197 = 77.82% | 676/1046 = 64.63% | 同左 |
| 后端 V1 新增/改动行 | 2287/2929 = 78.08% | 656/1008 = 65.08% | 同左 |
| 前端全库（233 个文件） | 1337/5354 = 24.97% | 1262/4482 = 28.15% | 1453/5816 = 24.98% |
| 前端 V1 文件 | 328/465 = 70.54% | 412/700 = 58.86% | 411/647 = 63.52% |
| 前端 V1 功能文件 | 312/449 = 69.49% | 412/700 = 58.86% | 395/631 = 62.60% |

基线对应后端 1157 passed / 1 默认跳过，前端 237 passed。原始报告分别保存在 `evidence/coverage/backend/baseline/` 和 `evidence/coverage/frontend/baseline/`，不会被补测后的结果覆盖。

## 最终结果与实际发现

后端 **1182 passed / 1 默认跳过**，前端 **266 passed**。新增的 25 个后端路由测试和 16 个前端 transport 测试之后，又补了 13 个恢复子引用的验证/组件用例。真实原生恢复单独跑 **39 passed**，不合并进覆盖率百分比。

| 最终范围 | 行覆盖 | 分支覆盖 | Statement 覆盖 |
|---|---:|---:|---:|
| 后端全库 | 7909/11931 = 66.29% | 1825/3284 = 55.57% | coverage.py 可执行语句行 |
| 后端 V1 文件 | 2571/3199 = 80.37% | 709/1048 = 67.65% | 同左 |
| 后端 V1 新增/改动行 | 2370/2931 = 80.86% | 689/1010 = 68.22% | 同左 |
| 前端全库（233 个文件） | 1393/5366 = 25.95% | 1296/4506 = 28.76% | 1516/5833 = 25.99% |
| 前端 V1 文件 | 384/477 = 80.50% | 446/724 = 61.60% | 474/664 = 71.39% |
| 前端 V1 功能文件 | 368/461 = 79.83% | 446/724 = 61.60% | 458/648 = 70.68% |

两项真实缺陷因此被发现并修复，分母也相应增加：

1. 上传幂等哈希遗漏 MIME 与文件名，修改解析类型后重用相同键会错误复用旧版本。现在将规范化 MIME 和文件名纳入哈希；变更会冲突，大小写/charset 的等价 MIME 仍正确重放同一个任务
2. 恢复后的有效“子引用”被前端要求与完整证据全文相等，可能退回第 1 页。现在以规范证据的 Unicode 码点范围核对引用子串，页/块来自规范证据，保留“未核验”状态；错误偏移不会仅因文字出现在别处而通过

重点 evidence HTTP 路由由 66/160 行、6/44 分支提高至 **149/162 行（91.98%）、39/46 分支（84.78%）**。前端 API 包装层改为实际执行 Axios 鉴权/序列化合同，而不只是组件 mock。其余未覆盖路径仍明确列出，不把补测后的数字称为全面覆盖。

前端中间 transport-only 快照（253 tests）保存在 `evidence/coverage/frontend/transport-pass/`；最终顶层快照包含子引用修复。前后 JSON 完整保留，可独立计算或比较。

## 有意义的补测范围

只补风险明确的缺口，不以 100% 为目标：

- 后端 HTTP 资料/历史引用绑定、跨笔记本选源约束、上传幂等冲突和原件保存后的排队失败、SSE 失败/未知提交/取消终态
- 前端真实 Axios 客户端的 URL 编码、鉴权 Blob、历史提取参数、上传字段、精确来源快照与幂等参数，以及拒绝自动重放提交

这些仍是本地测试，不会向真实 Google/模型发送请求。补测前 API 包装层 0% 的原因是组件测试主动 mock 了该层；新增测试用本地内存 adapter 执行真实 Axios 拦截器与序列化。

## 尚存重要缺口

- NotebookLMPanel、JobsPanel 等 UI 的失败/任务分支未全部覆盖；真实 Google 登录、限额、协议变化、远程生成都未实际验证
- SDK adapter 的一部分真实 SDK 行为只能做合同/fake 测试；不存在“覆盖到代码就等于调用成功”的推论
- 原生数据库提交/回滚与完整浏览器端到端有独立实测，但其代码执行未并入这份 pytest/Vitest 数值
- 部署启动脚本、SQL 迁移、第三方 PDF.js 内部代码、外部 HTTPS 和宿主生命周期不属于上述生产包覆盖分母
- 覆盖率无法证明没有安全问题；验证状态和功能缺口仍以 `ACCEPTANCE.md` 为准

## 复现命令

在项目根目录运行：

```sh
UV_CACHE_DIR=/tmp/sw-uv-cache uv run pytest -q \
  --cov=api --cov=open_notebook --cov=commands --cov-branch \
  --cov-report=term \
  --cov-report=json:docs/v1/evidence/coverage/backend/coverage.json \
  --cov-report=xml:docs/v1/evidence/coverage/backend/coverage.xml \
  --junitxml=docs/v1/evidence/coverage/backend/junit.xml
uv run python scripts/v1/summarize_backend_coverage.py
```

前端完整的本地 Node 命令、精确文件集合与 JSON 见 `evidence/coverage/frontend/`。不需要通过 npm 访问注册表来测量已经安装的依赖。原始 `coverage-final.json`、`coverage-summary.json`、`tests.json` 和 `v1-file-coverage.json` 可供独立复核。

## 2026-10-20 续开发最终实测

完整后端 **1211 passed / 1 opt-in skipped / 2 warnings**；前端 **289 passed**。独立原生恢复套件本轮另跑 **40 passed**（包含默认跳过用例）。后端显式启用分支覆盖率，前端继续包含未被导入的生产文件。真实 Firefox/原生服务端到端单独通过，不合并进覆盖率。

| 范围 | 行覆盖 | 分支覆盖 | Statement 覆盖 |
|---|---:|---:|---:|
| 后端全库 | 8085/12120 = 66.71% | 1875/3346 = 56.04% | 可执行语句行 |
| 后端 V1 文件 | 2747/3388 = 81.08% | 759/1110 = 68.38% | 同左 |
| 后端 V1 新增/修改行 | 2546/3120 = 81.60% | 739/1072 = 68.94% | 同左 |
| 前端全库 | 1459/5431 = 26.86% | 1424/4630 = 30.75% | 1596/5912 = 26.99% |
| 前端 V1 文件 | 450/542 = 83.03% | 574/848 = 67.69% | 554/743 = 74.56% |
| 前端 V1 功能文件 | 434/526 = 82.51% | 574/848 = 67.69% | 538/727 = 74.00% |

新增风险用例涵盖可信原件重解析对比、伪造归档/错误定位拒绝、幂等维护任务、状态轮询驱动的过期任务恢复、恢复历史禁止重放、失败重解析保留旧可读版本、锁内严格能力检查、排队问答取消后的 UI 解锁和已无效/越界引用不得被阅读器升级。重解析/重新核验 UI、更新版本后历史页定位、导入后核验、任务期间切换阅读器及刷新已在真实 Firefox 验证。

原始日志、JUnit、完整 coverage JSON、各口径汇总、浏览器截图和结构化结果：`evidence/continuation-2026-10-20/`。维护任务恢复由状态查询触发，测试包括路由连线与同任务并发恢复；未把它称为无人访问时的后台恢复，也未声称做过维护 worker 强杀实验。Google/模型/音频/公网 HTTPS 仍未实测。

## 2026-10-21 final backend continuation

Final integrated pytest: **1224 passed, 1 opt-in native skipped**, 2 existing dependency warnings. Measured with branch coverage over all production Python packages; isolated native/browser runs are separate and not merged.

- V1 new/changed production files: **2758 / 3393 lines (81.28%)**, **765 / 1112 branches (68.79%)**.
- All production Python: **66.77% lines / 56.18% branches**.
- Added/modified executable lines against pinned upstream: **81.82% lines / 69.37% branches**.

Raw coverage, JUnit and denominator summary: `evidence/continuation-2026-10-21/backend/`. Counts include upstream, mocks and local CPU/service tests; they do not prove model answer quality or real Google availability.

### Final frontend continuation

**292 tests passed, 48 test files**, with an explicit all-production-source coverage denominator, including files not loaded by tests. V1 new/changed files: **460 / 552 lines (83.33%)**, **589 / 864 branches (68.17%)**. All frontend production source: **1469 / 5441 lines (26.99%)**, **1439 / 4646 branches (30.97%)**. This is Vitest coverage, not screenshot coverage or evidence of real model calls. Raw JSON and summary: `evidence/continuation-2026-10-21/frontend/`.

## 2026-10-21 reliability follow-up (checkpoint b)

Full pytest coverage run: **1281 passed, 1 opt-in native skipped**, 2 existing warnings. V1 production Python files: **2780 / 3402 lines (81.72%)**, **780 / 1118 branches (69.77%)**. All production Python: **66.90% lines / 56.53% branches**. The offline exporter is tested but is developer tooling, not included in the API/commands/open_notebook production denominator.

Vitest: **313 passed across 49 files**, using the same explicit full-production-source denominator as the earlier checkpoint (tests, src/test and declarations excluded). V1 files: **480 / 562 lines (85.41%)**, **651 / 881 branches (73.89%)**. All frontend production: **27.31% lines / 32.18% branches**. No V1 production files were unreported.

Evidence: `evidence/continuation-2026-10-21b/backend/` and `frontend/`. Native audio/browser checks are separate, uninstrumented acceptance evidence, not merged into coverage or counted as real Google/model generation.

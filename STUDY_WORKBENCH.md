# StudyWorkbench V1

这个开发分支基于 Open Notebook 1.15.0，添加保留原件与证据的个人学习工作台。

入口：打开笔记本后选择“打开学习工作台”，或使用 `/notebooks/{notebook_id}/study`。

- [中文交付说明](docs/v1/DELIVERY_SUMMARY.zh-CN.md)
- [运行手册](docs/v1/RUNBOOK.md)
- [A01–A24 验收状态](docs/v1/ACCEPTANCE.md)
- [实际测试覆盖率](docs/v1/COVERAGE.md)
- [SDK 能力与 Google 问答限制](docs/v1/NOTEBOOKLM_SDK.md)
- [项目导出格式](docs/v1/PORTABLE_FORMAT.md)
- [固定上游及依赖](docs/v1/UPSTREAM.md)
- [公开示例项目](docs/v1/examples/README.md)

目前有真实本地 DB/API/worker/浏览器验证。Google 登录、严格来源隔离的 NotebookLM 问答、真实音频生成、独立模型实测和外部 HTTPS 部署仍有明确未完成项。请先看验收报告，不要把测试分支当作已经接通真实账号的生产部署。

原 Open Notebook README 和 MIT LICENSE 保持不变。

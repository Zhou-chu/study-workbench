# StudyWorkbench · 开发进度

> 本仓库展示开发中的 V1 源代码和已记录的验证结果，不代表完整验收或生产部署。
> 上传 GitHub 不等于部署应用，也不证明外部访问、真实 Google/NotebookLM 或模型能力已验收。

## 当前进度与验收边界

- [当前进度](docs/v1/PROGRESS.md)：最新检查点、测试结果及下一步。
- [验收矩阵](docs/v1/ACCEPTANCE.md)：真实验证、模拟测试、部分完成和阻塞项。
- [运行手册](docs/v1/RUNBOOK.md)：本地配置与复现。
- [开发计划](docs/v1/DEVELOPMENT_PLAN.md) · [验证证据](docs/v1/evidence/)
- [上游说明](README_UPSTREAM.md)：原始 README 字节保留，不作为本项目功能承诺。

测试数量及功能状态以以上文档中对应提交的最新记录为准；本次导出不重新运行测试，
也不把历史测试或 fake 注入结果当作当前线上能力证明。

## 快照来源与发布边界

源提交：`f66c6af199fc1c9749f6b2b90e97543db571861a`。仅以 `git archive` 导出该提交的已跟踪文件，无 Git 历史或未跟踪文件。
保留的源码、许可证、锁文件、静态资源、测试夹具及合成示例 ZIP 逐字节一致。
仅替换本首页，并将原 README 保存为 `README_UPSTREAM.md`。

排除上游 GitHub workflows、Dependabot、运行数据与敏感路径，避免意外自动发布。
省略浏览器截图和原始覆盖率文件；保留日志和摘要。历史文档中的部分证据链接因此可能不可用。
完整排除清单见 [发布清单](PUBLISH_MANIFEST.json)。这是路径过滤而非秘密内容扫描；发布前仍需人工审核。

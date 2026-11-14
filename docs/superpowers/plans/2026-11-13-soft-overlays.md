# Soft overlays implementation plan

**Goal:** 保留黑白研究工作台，浮层增加柔和玻璃质感，释放低频维护占位。
**Architecture:** 现有 React/Radix 弹窗与局部 CSS；主阅读底色不变，无新依赖。
**Spec:** DESIGN.md，本轮用户授权自主判断。

## Global constraints
- 仅浮层16px圆角、静态12px模糊、96%不透明底；控件边界与焦点独立。
- 不支持模糊、减少透明度、高对比模式使用实色。无动画或背景图。
- 维护状态、错误、结果未知必须主界面可见，关闭不取消/重放任务。

## Review focus
- 浮层透明底叠加极黑/白内容仍可读；测试最差合成对比。
- 移动端浮层不溢出且内部可滚动。
- Escape和关闭恢复焦点；后台任务状态持续。
- 用户切主题与减少透明度时保留实色降级。
- PDF页码/缩放和引用不搬进低频工具。

## Tasks
- [ ] 新增脚本测试浮层token、降级与最差合成文本对比，先运行失败。
- [ ] 修改 editorial.css，作用域仅dialog与notebook-menu-content；运行测试。
- [ ] MaintenanceControls低频说明/操作移浮层，保留状态；补回归。
- [ ] 更新DESIGN，运行lint/typecheck/web测试与构建。
- [ ] 独立review，三尺寸双主题浏览器验收，保存截图，静态发布不动数据。

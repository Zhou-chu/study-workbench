# Notebook / Study Workbench：视觉与阅读红队审查（2026-11-02）

## 结论先行

本次发现 **3 类值得进入下一轮修复的 P2 源码问题**：PDF 只适配整页、没有原位放大；证据搜索和同日版本选择隐藏了关键身份；自由文本的断行保护仍有消费者遗漏。另有一项阅读行长的 P3 视觉假设，必须在真实浏览器判断。建议保留 Quiet Green，不重做皮肤；优先补齐“看得清、选得对、长内容不破版”。

这不是截图审查或浏览器测试通过报告。未执行应用、测试、安装、部署或用户机器控制。仅从 GitHub 读取固定源码；本地新增本文仅为审查交付物。

## 固定证据身份与方法

- 2026-11-02 新鲜读取 `fix/audit-followup-20261022` 分支，HEAD 仍为 [`df94d8c18bfbae217aea5c9283b7a24d38844d24`](https://github.com/Zhou-chu/study-workbench/commit/df94d8c18bfbae217aea5c9283b7a24d38844d24)，tree `ab7a30ea8ad7c2c24d85e6683b00426156908b6a`。
- 已阅读 [10 月 28 日审查记录](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/docs/v1/PM_UX_AUDIT_2026-10-28.md)。不把已修复的暗色主按钮、44px 规则、引用 chip/完整引用断行、侧栏最大宽度、外层页签选中标记重复列为新缺陷。
- 范围覆盖主工作台、资料列表、阅读器/PDF、Markdown 渲染、主题 token、空/加载/失败状态。没有声称完整仓库审查。
- 证据级别：下列“源码确定”指可从组件和 CSS 直接证明的结构/交互缺口；具体像素、字体观感和实际溢出程度仍未运行验证。

## V1 · P2：PDF 只有整页缩小，没有工作台内可读的放大路径

**源码确定：** [PdfCanvas.tsx L49–68](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/frontend/src/components/evidence/PdfCanvas.tsx#L49-L68) 用容器宽度与页尺寸计算比例，canvas 受 `max-w-full` 约束；没有 zoom state / 控件 / 可横向阅读的放大区域。渲染 effect 仅依赖 `pdf,pageIndex`，容器 resize 本身不触发重栅格化。[EvidenceReader.tsx L154–161](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/frontend/src/components/evidence/EvidenceReader.tsx#L154-L161) 只有页码输入和整页 canvas。

**用户影响（源码推导）：** 手机、窄中央栏阅读论文时整页文字被缩小；图表标注和公式无法依靠下方提取文本替代。举例而非测量：A4 约 595pt 宽、12pt 原文字，若可用宽 328 CSS px，整页适配文字约 6.6 CSS px；实际版面、缩放、字体均会影响结果。下载原件和浏览器级缩放是绕行方案，不是应用内保持证据上下文的阅读方式。

**针对性修复：** 保留适宽默认，补“适宽 / 100% / 放大缩小”，放大后只让 PDF 视口滚动；缩放或容器尺寸变化后在既有内存上限内重新栅格化。不要用提高所有页面常驻分辨率代替交互。

**验收场景：** 360/390px 手机、1280px 三栏、1440px 侧栏 resize；中英文 A4 双栏论文与图表 PDF。在不下载、不换页、不离开阅读器时可放大辨认图表小字；返回适宽保持当前页；连续 resize 不残留旧比例或明显糊图。必须实际浏览器检查，当前未执行。

## V2 · P2：选择前的证据身份不够可见

**源码确定 A：** [StudyWorkbench.tsx L408](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/frontend/src/components/workbench/StudyWorkbench.tsx#L408) 检索结果按钮可见内容只有 `hit.quote`。已有 `source_title`、locator、provenance、independent_support 只传给点击后的 citation；检索列表本身没有来源标签。

**源码确定 B：** [WorkbenchSourcesList.tsx L29–35](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/frontend/src/components/workbench/WorkbenchSourcesList.tsx#L29-L35) 各版本主标签仅显示 `created_at.slice(0,10)`；版本 ID 在 checkbox 的 aria-label 中，视觉详情另集中为一组 ID。两次同日上传、相同状态、无 provenance 的版本可呈现相同标签。

**用户影响：** 同一句引文来自不同来源时，用户必须逐个打开才能知道选什么；同日修订版难以在勾选时辨认。现有数据与可访问名称并未丢失，因此不是证据篡改，也不是“完全无法取回身份”；问题在选择现场缺少视觉辨识，增加误选风险与核对成本。

**针对性修复：** 搜索卡片采用“来源标题 → 引文 → 页码/版本短标识”的层级；来源类型/派生警示保留语义文本，不靠颜色单独表达。版本行展示本地化日期时间及短版本标识，并在同一行/展开区提供完整 ID；不改变实际 version_id、选源或引用身份逻辑。

**验收场景：** 两个来源含相同 quote；同来源一天内 3 个版本且状态一致；中文/英文长标题；390px 触控和键盘选择。无需先打开每条证据即可区分来源，能够把可见版本标识与被勾选 ID 一一对应。

## V3 · P2：引用已保护，但用户标题/问题/检索原文仍缺少长词边界

**源码确定：** [StudyWorkbench.tsx L408](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/frontend/src/components/workbench/StudyWorkbench.tsx#L408) 搜索 quote 按钮、[L446](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/frontend/src/components/workbench/StudyWorkbench.tsx#L446) 对话问题 `h3`、[L457](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/frontend/src/components/workbench/StudyWorkbench.tsx#L457) 已保存笔记标题 `h3` 没有 `overflow-wrap:anywhere`、`break-words` 或截断后的完整查看机制。外围 pane 使用 `overflow-auto`，不是这些文本的断行策略。

**用户影响（源码推导）：** 连续英文标识、长 URL、无空格文件名等内容可超出卡片宽度，促成整个 pane 横向滚动，破坏阅读对齐；纯中文短句不一定触发。不是重开 10 月 28 日 citation chip / reader citation 的已关闭问题，而是另外三个自由文本消费者。

**针对性修复：** 给这些容器明确 `min-width:0` 和长 token 换行；搜索卡片层级与 V2 一并处理。保留完整字符串及复制能力，不在证据内容上静默截断。

**验收场景：** 200–500 字符无空格 URL/哈希式标题，分别放入问题、已存笔记标题、搜索命中 quote；360/390px 和最窄桌面 side pane。卡片不撑出 pane，正常正文无需横向滚动，完整内容仍可读取/复制。当前是源码风险证明，未报告浏览器实测 overflow 数值。

## V4 · P3 / 待视觉验证：单栏宽屏阅读没有行长上限

[StudyWorkbench.tsx L412](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/frontend/src/components/workbench/StudyWorkbench.tsx#L412) 中央区充满剩余宽度；[MarkdownRenderer.tsx L64](https://github.com/Zhou-chu/study-workbench/blob/df94d8c18bfbae217aea5c9283b7a24d38844d24/frontend/src/components/ui/markdown-renderer.tsx#L64) 使用 `max-w-none`。在 xl 以下的单区域，以及更宽桌面的中央区，英文长答/中文段落可能产生过长的阅读行。源码证明没有正文 measure cap，但“是否已让阅读不舒服”必须看真实布局与字体，不能仅凭风格偏好判不通过。

建议只为正文引入可调整的阅读宽度上限（如英文 65–80ch 的起始方案，中文另看实际字数），宽表格/公式保留局部扩展或横滚，不把侧栏与整个工作台一起压窄。验收 1024px 单区、1440/1920px 桌面，连续 1500 字中英文正文的扫读、定位和回行体验。

## 不应误报的部分

- 主题已有成对 action/danger 前景和语义色；本次没有新增有充分实际组合证据的对比度问题，也没有重算出新失败率。
- 来源标题、引用 chip、打开后的完整引用已有长 token 保护；将其与上述未保护消费者区分。
- Reader 区分无提取文本与筛选无匹配，提供清除；初始加载、PDF 渲染、加载失败与重试有明确状态文案。
- Markdown 表格有局部 `overflow-x-auto`，常规正文有行高设置；不把整个阅读系统说成没有响应式处理。

## 未执行矩阵与准入边界

以下全部仍待授权且可用的隔离浏览器环境：360/390/768/1024/1280/1440/1920px；浅色/暗色；中文/英文；鼠标/触控/键盘；125%/200% 缩放；长标题/长 URL/长引用；空、加载、失败、保存未确认；PDF resize/字体清晰度及真实导入→问答→引用→保存重开旅程。

现有环境不提供获准的目标桌面执行路径，用户禁止 ZC_LAPTOP，未尝试其他机器或控制路线。本次只完成源码审查；当前像素、触控和真实任务门禁仍是 **未执行 / 无法判定通过**，不是失败复现，也不是产品已通过。后续应在获准隔离环境验证上述具体场景，而不是再进行无边界换肤或将源码推导包装成截图结论。

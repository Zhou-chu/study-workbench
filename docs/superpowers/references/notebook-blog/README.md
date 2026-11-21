# 用户博客视觉参考

2026-11-07 实际查看用户上传图片及公开博客 https://gm-2.zhou-chu.workers.dev/ ，并查看 /archive。参考图保留原始像素，不是 Notebook 原型。

- user-reference.png：用户提供的黑白浅色截图。
- blog-mono-light.jpg、blog-mono-dark.jpg：在线黑白浅色/深色实测截图。
- 博客的“黑白/自然”与“深色/浅色”为独立切换，观测时 DOM 为 data-style=mono 与 data-theme=light/dark。检查后已恢复进入时的 nature+light。没有验证博客刷新持久化或跟随系统实现。
- 浅色背景 #EEEEEB、主字 #151515、正文 #5A5A55；深色背景 #121212、surface #191919、主字 #E8E8E4、次字 #A3A39D。
- 标题 Noto Serif SC / Songti SC / STSong；1197px 视口的 Hero 约63px/68px、字重900。正文17px/33.15px，介绍宽520px，Hero max-width1240px；UI用PingFang SC/Microsoft YaHei/system-ui，编号用JetBrains Mono/ui-monospace。
- 迁移语汇：宋体标题、无衬线控件、等宽元信息、细分隔线、近直角、无重阴影、反白主操作。
- 不照搬：大Hero、建筑图片、背景纹理、归档高卡片和全页窄居中；Notebook需要可扫描侧栏、阅读宽度与充足编辑空间。
- Notebook只固定黑白灰界面并提供浅/深/跟随系统；源图表与PDF保持原色。跟随系统与偏好持久化是Notebook要求，不是声称博客已经这样实现。
- 尚未观察博客移动端；响应式、焦点和触控需在Notebook自身验收。

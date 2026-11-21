import fixture from '../../../../contracts/v1/fixtures/workspace-view-v1.json';
import { parseWorkspaceView } from '@study/contracts';
/** A1's checked-in synthetic wire fixture. Never an authenticated identity. */
export const syntheticWorkspace = parseWorkspaceView(fixture.workspace_view);
export const longPreviewContent = { title: '控制系统：从观察到理解 / A study of feedback', paragraphs: [
        '这是一份合成阅读样本。阅读与提问范围是两个独立的意图：打开原文，不代表把它加入下一次提问。清晰的边界让学习更从容。',
        'A useful learning space gives each task its place. Sources hold the evidence, conversation holds the questions, and the studio holds the ideas worth keeping. This synthetic passage tests mixed-language reading and long lines without calling an API.',
        ...Array.from({ length: 14 }, (_, index) => `${String(index + 1).padStart(2, '0')} · 在反馈系统中，观察、比较与调整形成一个闭环。稳定性与响应速度需要结合具体条件分析。这里的文字仅用于测试阅读长度、滚动和字体回退，并非真实笔记或生成的答案。 Reading should remain comfortable when a document is long, with clear spacing and a local scrolling viewport.`),
        'https://example.invalid/this-is-a-synthetic-very-long-unbroken-reference-used-only-to-check-that-reader-content-wraps-without-making-the-page-scroll-sideways-012345678901234567890123456789'
    ] };

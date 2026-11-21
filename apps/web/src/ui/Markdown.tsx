import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
function safeLink(value: string) {
    try {
        const url = new URL(value, window.location.href);
        return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
    }
    catch {
        return undefined;
    }
}
/** No raw HTML, remote image requests, or trusted TeX commands. References stay explicit user actions. */
export function Markdown({ children }: {
    children: string;
}) {
    return <div className="markdown"><ReactMarkdown skipHtml remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[[rehypeKatex, { trust: false, throwOnError: false, maxExpand: 1000, maxSize: 100, strict: (code: string) => code === 'unknownSymbol' ? 'ignore' : 'warn' }]]} urlTransform={safeLink} components={{
            a: ({ href, children }) => href ? <a href={href} target="_blank" rel="noreferrer noopener">{children}</a> : <span>{children}</span>,
            img: ({ alt }) => <span>{alt}</span>,
            table: ({ children }) => <div className="markdown-table"><table>{children}</table></div>,
        }}>{children}</ReactMarkdown></div>;
}

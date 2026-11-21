import type { ReactNode } from 'react';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';

export type PreviewContent = { title: string; paragraphs: string[] };

export function SourceScaffold({ content, onRead }: { content?: PreviewContent; onRead(): void }) {
  const { shell } = useI18n();
  return <>
    <div className="panel-heading"><h2>{shell.sources}</h2><span className="meta">{content ? '01' : '00'}</span></div>
    <p className="panel-hint">{shell.sourceHint}</p>
    {content ? <div className="source-row">
      <span aria-hidden="true">▤</span>
      <div>
        <strong>{content.title}</strong>
        <span className="meta">{shell.sample} · TXT</span>
        <Button className="source-read" onClick={onRead}>{shell.read}<span aria-hidden="true">↗</span></Button>
      </div>
    </div> : <EmptyState title={shell.sourceEmpty} description={shell.notConnected} />}
  </>;
}

export function ConversationScaffold({ content, history, question, readOnly, onNewDraft, onQuestionChange, onRead }: {
  content?: PreviewContent; history?: ReactNode; question: string; readOnly?: boolean; onNewDraft?(): void; onQuestionChange(value: string): void; onRead(): void;
}) {
  const { shell, session } = useI18n();
  return <>
    <div className="panel-heading"><h2>{shell.conversation}</h2><span aria-hidden="true">↳</span></div>
    <div className="conversation-scroll">
      {history}
      {content ? <article className="sample-article">
        <span className="eyebrow">{shell.sample}</span>
        <h2>{content.title}</h2>
        <p>{shell.previewBody}</p>
        <p>{content.paragraphs[0]}</p>
        <Button onClick={onRead}>{shell.openReader}<span aria-hidden="true">↗</span></Button>
      </article> : <EmptyState title={shell.conversationEmpty} description={shell.previewNotice} icon="↳" />}
    </div>
    <div className="composer">
      <label htmlFor="question">{shell.question}</label>
      <textarea id="question" value={question} readOnly={readOnly} onChange={event => onQuestionChange(event.target.value)} placeholder={shell.question} aria-describedby="draft-hint" />
      {readOnly&&<div><p className="panel-hint">{session.retiredDraft}</p><Button onClick={onNewDraft}>{session.newQuestion}</Button></div>}
      <div className="composer-footer">
        <p id="draft-hint">{shell.draftHint}</p>
        <Button variant="primary" disabled aria-label={shell.notConnected}><span aria-hidden="true">↑</span></Button>
      </div>
    </div>
  </>;
}

export function StudioScaffold() {
  const { shell } = useI18n();
  return <>
    <div className="panel-heading"><h2>{shell.studio}</h2><span className="meta">00</span></div>
    <EmptyState title={shell.studioEmpty} description={shell.notConnected} icon="▧" />
  </>;
}

export function ReaderScaffold({ content, onClose }: { content?: PreviewContent; onClose(): void }) {
  const { shell } = useI18n();
  return <>
    <div className="panel-heading">
      <h2>{shell.reader}</h2>
      <Button onClick={onClose} aria-label={shell.closeReader}><span aria-hidden="true">×</span></Button>
    </div>
    <div className="reader-scroll">
      <article className="reader-document">
        <span className="eyebrow">{shell.sample}</span>
        <h2>{content?.title ?? shell.reader}</h2>
        <p className="reader-disclaimer">{shell.previewBody}</p>
        {content?.paragraphs.map((text, index) => <p key={index}>{text}</p>)}
      </article>
    </div>
  </>;
}

import { useState } from 'react';
import { AppChrome } from '../../app/AppChrome';
import { WorkspaceLayout } from '../../app/WorkspaceLayout';
import type { WorkspaceSection } from '../../app/WorkspaceLayout';
import { useAppData } from '../../app/providers';
import { useI18n } from '../../i18n';
import { StatusBadge } from '../../ui/StatusBadge';
import { SourceScaffold, ConversationScaffold, StudioScaffold, ReaderScaffold } from './ScaffoldPanels';
import type { PreviewContent } from './ScaffoldPanels';

/** B1 scaffolding only. No source/selection mutations or model requests. */
export function NotebookShell({ previewContent }: { previewContent?: PreviewContent }) {
  const { workspace } = useAppData();
  const { shell, t } = useI18n();
  const [activeSection, setSection] = useState<WorkspaceSection>('conversation');
  const [readerOpen, setReaderOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const name = typeof workspace?.notebook.name === 'string' ? workspace.notebook.name : t.common.notebook;
  const contentProps = previewContent ? { content: previewContent } : {};
  return <AppChrome title={name}>
    <div className="workspace-heading">
      <div><span className="eyebrow">Notebook / {workspace ? '01' : '00'}</span><h1>{name}</h1></div>
      <StatusBadge state="unknown" label={shell.notConnected} />
    </div>
    <WorkspaceLayout
      activeSection={activeSection}
      onSectionChange={setSection}
      readerOpen={readerOpen}
      sources={<SourceScaffold {...contentProps} onRead={() => setReaderOpen(true)} />}
      conversation={<ConversationScaffold {...contentProps} question={question} onQuestionChange={setQuestion} onRead={() => setReaderOpen(true)} />}
      studio={<StudioScaffold />}
      reader={<ReaderScaffold {...contentProps} onClose={() => setReaderOpen(false)} />}
    />
  </AppChrome>;
}

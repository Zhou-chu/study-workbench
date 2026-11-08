import { useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { notebookIdFromPathname } from '../../app/notebook-route';
import { SourcesPanel } from '../sources/SourcesPanel';
import type { SourceReadIntent } from '../sources/source-selection';
import { useWorkbenchDraft } from '../../app/WorkbenchSession';
import { AppChrome } from '../../app/AppChrome';
import { WorkspaceLayout } from '../../app/WorkspaceLayout';
import type { WorkspaceSection } from '../../app/WorkspaceLayout';
import { useAppData } from '../../app/providers';
import { useI18n } from '../../i18n';
import { StatusBadge } from '../../ui/StatusBadge';
import { SourceScaffold, ConversationScaffold, StudioScaffold, ReaderScaffold } from './ScaffoldPanels';
import type { PreviewContent } from './ScaffoldPanels';
import { WorkspaceHistory, WorkspaceScope } from './WorkspaceRecords';

/** Source controls are live; conversation, studio and reader integration have separate owners. */
export function NotebookShell({ previewContent, readStatus, notebookId: routeNotebookId, onSourceRead }: { onSourceRead?: (intent: SourceReadIntent) => void; previewContent?: PreviewContent; readStatus?: ReactNode; notebookId?: string }) {
  const { workspace } = useAppData();
  const { shell, t } = useI18n();
  const [activeSection, setSection] = useState<WorkspaceSection>('conversation');
  const [readerOpen, setReaderOpen] = useState(false);
  const [previewQuestion, setPreviewQuestion] = useState('');
  const location=useLocation();
  const notebookId=routeNotebookId??notebookIdFromPathname(location.pathname)??undefined;
  const [questionSession,setQuestionSession]=useState('question');
  const draft=useWorkbenchDraft(notebookId??'preview',questionSession);
  const question=draft.connected?(draft.draft?.question??''):previewQuestion;
  const setQuestion=(value:string)=>{if(draft.connected)draft.update({question:value});else setPreviewQuestion(value);};
  const name = typeof workspace?.notebook.name === 'string' ? workspace.notebook.name : t.common.notebook;
  const contentProps = previewContent ? { content: previewContent } : {};
  return <AppChrome title={name}>
    <div className="workspace-heading">
      <div><span className="eyebrow">Notebook / {workspace ? '01' : '00'}</span><h1>{name}</h1></div>
      {!workspace && <StatusBadge state="unknown" label={shell.notConnected} />}
    </div>
    {readStatus}
    {workspace && <WorkspaceScope workspace={workspace}/>}
    <WorkspaceLayout
      activeSection={activeSection}
      onSectionChange={setSection}
      readerOpen={readerOpen}
      sources={workspace ? <SourcesPanel key={notebookId} notebookId={notebookId??'preview'} workspace={workspace} onRead={intent=>{onSourceRead?.(intent);setReaderOpen(true);}}/> : <SourceScaffold {...contentProps} onRead={() => setReaderOpen(true)} />}
      conversation={<ConversationScaffold history={workspace ? <WorkspaceHistory workspace={workspace}/> : undefined} {...contentProps} question={question} readOnly={draft.retired} onNewDraft={()=>setQuestionSession(`question:${crypto.randomUUID()}`)} onQuestionChange={setQuestion} onRead={() => setReaderOpen(true)} />}
      studio={<StudioScaffold />}
      reader={<ReaderScaffold {...contentProps} onClose={() => setReaderOpen(false)} />}
    />
  </AppChrome>;
}

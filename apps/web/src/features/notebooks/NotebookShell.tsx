import { useState, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { useWorkbenchDraft } from '../../app/WorkbenchSession';
import { AppChrome } from '../../app/AppChrome';
import { WorkspaceLayout } from '../../app/WorkspaceLayout';
import type { WorkspaceSection } from '../../app/WorkspaceLayout';
import { useAppData } from '../../app/providers';
import { useI18n } from '../../i18n';
import { StatusBadge } from '../../ui/StatusBadge';
import { SourceScaffold, ConversationScaffold, StudioScaffold, ReaderScaffold } from './ScaffoldPanels';
import type { PreviewContent } from './ScaffoldPanels';
import { WorkspaceSources, WorkspaceHistory, WorkspaceScope } from './WorkspaceRecords';

/** B1 scaffolding only. No source/selection mutations or model requests. */
export function NotebookShell({ previewContent, readStatus, notebookId: routeNotebookId }: { previewContent?: PreviewContent; readStatus?: ReactNode; notebookId?: string }) {
  const { workspace } = useAppData();
  const { shell, t } = useI18n();
  const [activeSection, setSection] = useState<WorkspaceSection>('conversation');
  const [readerOpen, setReaderOpen] = useState(false);
  const [previewQuestion, setPreviewQuestion] = useState('');
  const params=useParams();
  const notebookId=routeNotebookId??params.notebookId;
  const [questionSession,setQuestionSession]=useState('question');
  const draft=useWorkbenchDraft(notebookId??'preview',questionSession);
  const question=draft.connected?(draft.draft?.question??''):previewQuestion;
  const setQuestion=(value:string)=>{if(draft.connected)draft.update({question:value});else setPreviewQuestion(value);};
  const name = typeof workspace?.notebook.name === 'string' ? workspace.notebook.name : t.common.notebook;
  const contentProps = previewContent ? { content: previewContent } : {};
  return <AppChrome title={name}>
    <div className="workspace-heading">
      <div><span className="eyebrow">Notebook / {workspace ? '01' : '00'}</span><h1>{name}</h1></div>
      <StatusBadge state="unknown" label={shell.notConnected} />
    </div>
    {readStatus}
    {workspace && <WorkspaceScope workspace={workspace}/>}
    <WorkspaceLayout
      activeSection={activeSection}
      onSectionChange={setSection}
      readerOpen={readerOpen}
      sources={workspace ? <WorkspaceSources workspace={workspace}/> : <SourceScaffold {...contentProps} onRead={() => setReaderOpen(true)} />}
      conversation={<ConversationScaffold history={workspace ? <WorkspaceHistory workspace={workspace}/> : undefined} {...contentProps} question={question} readOnly={draft.retired} onNewDraft={()=>setQuestionSession(`question:${crypto.randomUUID()}`)} onQuestionChange={setQuestion} onRead={() => setReaderOpen(true)} />}
      studio={<StudioScaffold />}
      reader={<ReaderScaffold {...contentProps} onClose={() => setReaderOpen(false)} />}
    />
  </AppChrome>;
}

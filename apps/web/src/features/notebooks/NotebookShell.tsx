import {MaintenanceControls} from '../settings/MaintenanceControls';
import {useRetrieval} from '../settings/use-retrieval';
import {NotebookSettings} from '../settings/NotebookSettings';
import {Link} from 'react-router';
import {SetupLink} from '../settings/SetupLink';
import { ClassicNotebookPanel } from '../library/ClassicContext';
import { WorkspaceHistory } from './WorkspaceRecords';
import { Button } from '../../ui/Button';
import { NotebookSourcesPanel } from '../library/NotebookSourcesPanel';
import { StudioPanel } from '../studio/StudioPanel';
import { useStudio } from '../studio/use-studio';
import { readTurnContext, sessionCoordinator } from '@study/web-transport';
import { ReaderPane } from '../reader/ReaderPane';
import { useNotebookReader } from '../reader/use-notebook-reader';
import type { TurnView } from '@study/contracts';
import type { CitationHandler } from '../chat/Message';
import type { ConversationRetrieval, OutlineOrigin } from '../chat/ConversationPanel';
import { ConversationPanel } from '../chat/ConversationPanel';
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
import { WorkspaceScope } from './WorkspaceRecords';
/** Sources, conversation and contextual reading are live; Studio is wired through app-lifetime draft custody. */
export function NotebookShell({ previewContent, readStatus, notebookId: routeNotebookId, onSourceRead, onCitation, onSaveAnswer, onOutlineReady, retrieval }: {
    onCitation?: CitationHandler;
    onSaveAnswer?: (turn: TurnView) => void;
    onOutlineReady?: (turn: TurnView, origin: OutlineOrigin) => void;
    retrieval?: ConversationRetrieval;
    onSourceRead?: (intent: SourceReadIntent) => void;
    previewContent?: PreviewContent;
    readStatus?: ReactNode;
    notebookId?: string;
}) {
    const { workspace } = useAppData();
    const { shell, t, native: n, settings } = useI18n();
    const location = useLocation();
    const [settingsOpen,setSettingsOpen]=useState(false),[toolsOpen,setToolsOpen]=useState(false);
    const [classic, setClassic] = useState((location.state as {
        openClassic?: boolean;
    } | null)?.openClassic === true);
    const [activeSection, setSection] = useState<WorkspaceSection>('conversation');
    const [previewReaderOpen, setReaderOpen] = useState(false);
    const [previewQuestion, setPreviewQuestion] = useState('');
    const notebookId = routeNotebookId ?? notebookIdFromPathname(location.pathname) ?? undefined;
    const retrievalControl = useRetrieval(notebookId, workspace);
    const reader = useNotebookReader(notebookId ?? 'preview', workspace);
    const studio = useStudio(notebookId ?? 'preview');
    const saveAnswer = onSaveAnswer ?? studio.saveAnswer;
    const acceptOutline = onOutlineReady ?? ((turn: TurnView, origin: OutlineOrigin) => { const context = readTurnContext(); if (!context?.ready || origin.notebookId !== notebookId)
        return; const id = studio.store.captureTurn(origin.notebookId, turn, context, sessionCoordinator.current(), `outline:${origin.operationId}`, origin); if (id && !studio.store.getSnapshot().active.get(origin.notebookId))
        studio.store.select(origin.notebookId, id); });
    const readerOpen = workspace ? reader.open : previewReaderOpen;
    const [questionSession, setQuestionSession] = useState('question');
    const draft = useWorkbenchDraft(notebookId ?? 'preview', questionSession);
    const question = draft.connected ? (draft.draft?.question ?? '') : previewQuestion;
    const setQuestion = (value: string) => {
        if (draft.connected)
            draft.update({ question: value });
        else
            setPreviewQuestion(value);
    };
    const name = typeof workspace?.notebook.name === 'string' ? workspace.notebook.name : t.common.notebook;
    const contentProps = previewContent ? { content: previewContent } : {};
    return <AppChrome title={name}>
    <div className="workspace-heading">
      <div><Link className="eyebrow notebook-back" to="/notebooks">← {shell.homeTitle}</Link><h1>{name}</h1></div>
      <div className="notebook-heading-actions">
        {!workspace && <StatusBadge state="unknown" label={shell.notConnected}/>}
        {workspace && <details className="notebook-menu"><summary>{settings.tools}<span aria-hidden="true">···</span></summary><div className="notebook-menu-content">
          <Button onClick={() => setSettingsOpen(true)}>{settings.notebookSettings}</Button>
          <Button onClick={() => setClassic(!classic)} aria-pressed={classic}>{classic ? n.personal : n.classic}</Button>
          <Button aria-expanded={toolsOpen} onClick={() => setToolsOpen(!toolsOpen)}>{t.navigation.settings}</Button>
          {toolsOpen && <nav className="settings-links"><SetupLink to="/settings/models">{t.navigation.models}</SetupLink><Link to="/transformations">{t.navigation.transformations}</Link><Link to="/advanced">{t.navigation.advanced}</Link></nav>}
        </div></details>}
      </div>
    </div>
    {settingsOpen&&notebookId&&<NotebookSettings key={notebookId} notebookId={notebookId} onClose={()=>setSettingsOpen(false)} retrieval={retrievalControl}/>}
    <div className="notebook-context">{workspace && <WorkspaceScope workspace={workspace}/>} {readStatus}</div>
    <WorkspaceLayout readerKey={reader.intent?.key} activeSection={activeSection} onSectionChange={setSection} readerOpen={readerOpen} sources={workspace ? <><SourcesPanel key={notebookId} notebookId={notebookId ?? 'preview'} workspace={workspace} onRead={intent => { onSourceRead?.(intent); reader.openSource(intent); }}/><NotebookSourcesPanel notebookId={notebookId ?? 'preview'} classicContext={classic}/></> : <SourceScaffold {...contentProps} onRead={() => setReaderOpen(true)}/>} conversation={workspace ? classic ? <><ClassicNotebookPanel key={notebookId} notebookId={notebookId!}/><WorkspaceHistory workspace={workspace}/></> : <ConversationPanel key={notebookId} notebookId={notebookId ?? 'preview'} workspace={workspace} onCitation={(citation, origin) => { onCitation?.(citation, origin); reader.openCitation(citation, origin); }} onAdjustScope={() => { reader.close(); setSection('sources'); }} onSaveAnswer={saveAnswer} onOutlineReady={acceptOutline} retrieval={retrieval ?? retrievalControl.conversation}/> : <ConversationScaffold history={undefined} {...contentProps} question={question} readOnly={draft.retired} onNewDraft={() => setQuestionSession(`question:${crypto.randomUUID()}`)} onQuestionChange={setQuestion} onRead={() => setReaderOpen(true)}/>} studio={workspace ? <StudioPanel key={notebookId} notebookId={notebookId ?? 'preview'} workspace={workspace} onCitation={reader.openNoteCitation}/> : <StudioScaffold />} reader={reader.intent ? <ReaderPane maintenance={detail => reader.open ? <MaintenanceControls key={reader.intent!.key} control={retrievalControl} detail={detail} intent={reader.intent!}/> : null} intent={reader.intent} onClose={reader.close} onPositionChange={reader.onPositionChange} {...(reader.unsavedPosition ? { positionSave: { blocked: reader.positionSaveBlocked, onSave: reader.savePosition } } : {})}/> : <ReaderScaffold {...contentProps} onClose={() => setReaderOpen(false)}/>}/>
  </AppChrome>;
}

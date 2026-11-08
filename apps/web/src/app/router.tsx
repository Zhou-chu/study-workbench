import { LibraryPage } from '../features/library/LibraryPage';
import { SourcePage } from '../features/library/SourcePage';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router';
import { NotebookHome } from '../features/notebooks/NotebookHome';
import { NotebookPage } from '../features/notebooks/NotebookPage';
import { NotebookShell } from '../features/notebooks/NotebookShell';
import { AppChrome } from './AppChrome';
import { notebookIdFromPathname } from './notebook-route';
import { useI18n } from '../i18n';
function StudyAlias() { const location = useLocation(); const id = notebookIdFromPathname(location.pathname); return id ? <Navigate replace to={`/notebooks/${encodeURIComponent(id)}${location.search}${location.hash}`}/> : <PendingRoute kind="missing"/>; }
/** Retained path, explicitly NOT completed functionality. No reads or provider work on mount. */
function PendingRoute({ kind }: {
    kind: 'sources' | 'search' | 'podcasts' | 'settings' | 'models' | 'transformations' | 'advanced' | 'login' | 'missing';
}) {
    const { t, notebook, shell } = useI18n();
    const title = { sources: t.sources.title, search: t.navigation.askAndSearch, podcasts: t.navigation.podcasts, settings: t.navigation.settings, models: t.navigation.models, transformations: t.navigation.transformations, advanced: t.navigation.advanced, login: t.common.notebook, missing: t.common.noResults }[kind];
    return <AppChrome><div className="notebook-home"><h1>{title}</h1><p>{kind === 'missing' ? notebook.notFound : notebook.pending}</p><Link className="button" to="/notebooks">{shell.homeTitle}</Link></div></AppChrome>;
}
export function AppRoutes({ previewContent }: {
    previewContent?: {
        title: string;
        paragraphs: string[];
    };
}) {
    return <Routes>
 <Route path="/" element={<Navigate to="/notebooks" replace/>}/><Route path="/notebooks" element={<NotebookHome />}/><Route path="/notebooks/:notebookId" element={<NotebookPage />}/><Route path="/notebooks/:notebookId/study" element={<StudyAlias />}/>
 <Route path="/sources" element={<LibraryPage/>}/><Route path="/sources/:sourceId" element={<SourcePage/>}/><Route path="/search" element={<PendingRoute kind="search"/>}/><Route path="/podcasts" element={<PendingRoute kind="podcasts"/>}/><Route path="/settings" element={<PendingRoute kind="settings"/>}/><Route path="/settings/models" element={<PendingRoute kind="models"/>}/><Route path="/transformations" element={<PendingRoute kind="transformations"/>}/><Route path="/advanced" element={<PendingRoute kind="advanced"/>}/><Route path="/login" element={<PendingRoute kind="login"/>}/>
 {import.meta.env.DEV && <Route path="/__preview/workspace" element={<NotebookShell {...(previewContent ? { previewContent } : {})}/>}/>}
 <Route path="*" element={<PendingRoute kind="missing"/>}/>
 </Routes>;
}

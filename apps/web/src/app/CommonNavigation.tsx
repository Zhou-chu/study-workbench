import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useNotebookConnection } from '../data/use-notebook-connection';
import { useI18n } from '../i18n';
import { Button } from '../ui/Button';
import { LibraryDialog } from '../features/library/LibraryDialog';
import { SourceImportDialog } from '../features/library/SourceImportDialog';
import { CreateNotebookDialog } from '../features/notebooks/CreateNotebookDialog';
import { RetainedCreationInspector } from '../features/notebooks/RetainedCreationInspector';
import { commandDestinations } from './command-destinations';
export function CommonNavigation() {
    const [sidebar, setSidebar] = useState(true), [mobile, setMobile] = useState(false), [palette, setPalette] = useState(false), [source, setSource] = useState(false), [creation, setCreation] = useState(0);
    const { t, library: l, global:g } = useI18n(), n = useNotebookConnection(), navigate = useNavigate();
    const notebooks = useQuery({ queryKey: ['notebooks', n.scope], enabled: palette && n.ready, queryFn: ({ signal }) => n.api!.list(n.context!, signal) });
    useEffect(() => {
        const key = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLElement && (e.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)))
                return;
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !e.isComposing) {
                e.preventDefault();
                setPalette(v => !v);
            }
        };
        window.addEventListener('keydown', key);
        return () => window.removeEventListener('keydown', key);
    }, []);
    const label = (id: typeof commandDestinations[number]['id']) => id === 'sources' ? t.sources.title : id === 'notebooks' ? t.navigation.notebooks : id === 'ask' ? g.ask : id === 'podcasts' ? t.navigation.podcasts : g.search;
    const menu = <nav aria-label={t.navigation.nav}>{commandDestinations.map(item => <Link className="button" key={item.id} to={item.path} onClick={() => setMobile(false)}>{label(item.id)}</Link>)}</nav>;
    return <div className="common-navigation"><div className="library-actions"><Button aria-expanded={sidebar} aria-controls="library-sidebar" onClick={() => setSidebar(!sidebar)}>{l.toggleSidebar}</Button><Button onClick={() => setMobile(true)}>{l.openNavigation}</Button><Button onClick={() => setPalette(true)}>{l.commands}</Button><RetainedCreationInspector /></div><div id="library-sidebar" hidden={!sidebar}>{menu}</div>
 <LibraryDialog open={mobile} onOpenChange={setMobile} title={t.navigation.nav}>{menu}<Button onClick={() => setMobile(false)}>{l.closeNavigation}</Button></LibraryDialog>
 <LibraryDialog open={palette} onOpenChange={setPalette} title={l.commands}>
 <div className="command-options">{commandDestinations.map(item => <Button key={item.id} onClick={() => { setPalette(false); void navigate(item.path); }}>{label(item.id)}</Button>)}
 {notebooks.data?.map(item => <Button key={item.id} onClick={() => { setPalette(false); void navigate('/notebooks/' + encodeURIComponent(item.id)); }}>{item.name}</Button>)}
 {notebooks.isError && <p role="alert">{t.common.contentUnavailable.errorTitle}</p>}
 <Button disabled={!n.ready} onClick={() => { setPalette(false); setCreation(v => v + 1); }}>{t.common.newNotebook}</Button><Button disabled={!n.ready} onClick={() => { setPalette(false); setSource(true); }}>{t.common.newSource}</Button><Button disabled={!n.ready} onClick={()=>{setPalette(false);void navigate('/podcasts?create=1');}}>{t.podcasts.generateBtn}</Button></div>
 </LibraryDialog><SourceImportDialog open={source} onOpenChange={setSource} hideTrigger/><CreateNotebookDialog request={creation} hideTrigger/>
 </div>;
}

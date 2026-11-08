import { AppChrome } from '../../app/AppChrome';
import { EmptyState } from '../../ui/EmptyState';
import { useI18n } from '../../i18n';
export function NotebookHome() { const { shell } = useI18n(); return <AppChrome><div className="notebook-home"><div className="page-heading"><span className="eyebrow">Notebook / 01</span><h1>{shell.homeTitle}</h1><p>{shell.previewNotice}</p></div><EmptyState title={shell.homeEmpty} description={shell.notConnected}/></div></AppChrome>; }

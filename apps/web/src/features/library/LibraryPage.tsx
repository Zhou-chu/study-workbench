import { AppChrome } from '../../app/AppChrome';
import { useI18n } from '../../i18n';
import { SourceList } from './SourceList';
import { SourceImportDialog } from './SourceImportDialog';
export function LibraryPage() { const { t } = useI18n(); return <AppChrome><div className="notebook-home library-page"><header className="page-heading"><span className="eyebrow">Notebook / 02</span><h1>{t.sources.title}</h1><p>{t.sources.allSourcesDesc}</p><SourceImportDialog /></header><SourceList /></div></AppChrome>; }

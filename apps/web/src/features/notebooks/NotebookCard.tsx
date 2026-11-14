import { Link } from 'react-router';
import type { NotebookSummary } from '../../data/notebook-api';
import { useI18n } from '../../i18n';
export function NotebookCard({ notebook }: {
    notebook: NotebookSummary;
}) {
    const { t, native: n, locale } = useI18n();
    return <li className="notebook-card"><Link className="notebook-open" to={`/notebooks/${encodeURIComponent(notebook.id)}`}><h3>{notebook.name || t.common.notebook}</h3></Link>{notebook.description && <p>{notebook.description}</p>}<dl className="notebook-facts"><div><dt>{t.sources.title}</dt><dd>{notebook.source_count}</dd></div><div><dt>{t.common.notes}</dt><dd>{notebook.note_count}</dd></div><div><dt>{t.common.updated_label}</dt><dd><time dateTime={notebook.updated}>{Number.isNaN(Date.parse(notebook.updated)) ? t.common.unknown : new Date(notebook.updated).toLocaleDateString(locale, {month:'short',day:'numeric'})}</time></dd></div></dl><Link className="notebook-classic-link" to={`/notebooks/${encodeURIComponent(notebook.id)}`} state={{ openClassic: true }}>{n.classic}</Link></li>;
}

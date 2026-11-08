import type { EditorModel } from '@study/domain';
import type { WorkbenchNote } from '@study/contracts';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
export function NoteConflict({ draft, latest, candidates, onCompare, onReedit, onReload, disabled, metadataCompatible = true, classicBase }: {
    metadataCompatible?: boolean;
    classicBase?: WorkbenchNote;
    draft: EditorModel;
    latest?: WorkbenchNote;
    candidates?: readonly WorkbenchNote[];
    onCompare?: () => void;
    onReedit?: () => void;
    onReload?: () => void;
    disabled?: boolean;
}) { const { t, studio } = useI18n(); const status = draft.saveResult; return <section className="note-conflict" aria-label={t.noteConflict.review}><p role="alert">{status === 'conflict' ? t.noteConflict.conflict : status === 'unknown' ? t.noteConflict.unknown : t.noteConflict.rejected}</p><Button disabled={disabled || !onCompare} onClick={onCompare}>{t.noteConflict.compare}</Button><p>{t.noteConflict.baseRevision}: {draft.baseRevision ?? t.common.unknown}</p><details><summary>{studio.base}</summary><h4>{draft.base.title}</h4>{classicBase && <pre>{JSON.stringify(classicBase, null, 2)}</pre>}<pre>{draft.base.content}</pre><pre>{JSON.stringify({ citations: draft.base.citations, scope_snapshot: draft.base.scope_snapshot }, null, 2)}</pre></details>{latest ? <><h3>{t.noteConflict.latest}</h3><p>{t.noteConflict.serverRevision}: {latest.revision}</p><h4>{latest.title}</h4><pre>{latest.content}</pre><details><summary>{t.noteConflict.references}</summary><pre>{JSON.stringify({ citations: latest.citations, scope_snapshot: latest.scope_snapshot }, null, 2)}</pre></details>{!metadataCompatible && <p>{studio.metadataChanged}</p>}<Button disabled={disabled || !metadataCompatible || status === 'unknown'} onClick={onReedit}>{studio.reedit}</Button><Button disabled={disabled || status === 'unknown'} onClick={onReload}>{t.noteConflict.reload}</Button></> : candidates && <><p>{studio.uncorrelated}</p><h3>{t.noteConflict.candidates}</h3>{candidates.length ? candidates.map(n => <details key={n.id}><summary>{n.title} · {n.id}</summary><p>{n.revision}</p><pre>{n.content}</pre></details>) : <p>{t.noteConflict.notFound}</p>}</>}</section>; }

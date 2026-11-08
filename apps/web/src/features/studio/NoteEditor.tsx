import { useId } from 'react';
import type { EditorModel } from '@study/domain';
import type { EvidenceCitationView, WorkbenchNote } from '@study/contracts';
import type { NoteCitationOrigin } from '../reader/navigation';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { NoteConflict } from './NoteConflict';
export function NoteEditor({ noteId, baseRevision, draft, onEdit, onSave, onClose, readOnly, disabled, latest, candidates, onCompare, onReedit, onReload, onCitation, metadataCompatible, classic = false, classicBase }: {
    metadataCompatible?: boolean;
    classic?: boolean;
    classicBase?: WorkbenchNote;
    noteId?: string;
    baseRevision?: number;
    draft: EditorModel;
    onEdit(patch: {
        title?: string;
        content?: string;
    }): void;
    onSave(): void;
    onClose(): void;
    readOnly?: boolean;
    disabled?: boolean;
    latest?: WorkbenchNote;
    candidates?: readonly WorkbenchNote[];
    onCompare?: () => void;
    onReedit?: () => void;
    onReload?: () => void;
    onCitation?: (c: EvidenceCitationView, origin: NoteCitationOrigin) => void;
}) {
    const { t, session } = useI18n(), key = useId(), blocked = !!draft.pending || ['unknown', 'conflict', 'rejected'].includes(draft.saveResult), nid = noteId ?? draft.noteId, revision = baseRevision ?? draft.baseRevision;
    return <section className="note-editor" aria-label={t.common.note}><label htmlFor={key + 'title'}>{t.workbench.noteTitle}</label><input id={key + 'title'} value={draft.title} readOnly={readOnly} onChange={e => onEdit({ title: e.target.value })}/><label htmlFor={key + 'content'}>{t.workbench.noteContent}</label><textarea id={key + 'content'} value={draft.content} readOnly={readOnly} onChange={e => onEdit({ content: e.target.value })}/>{readOnly && <p role="status">{session.retiredDraft}</p>}<div className="studio-actions"><Button disabled={disabled || readOnly || blocked || (!classic || !draft.noteId) && !draft.content.trim() || !classic && !draft.title.trim() || classic && !draft.dirty} onClick={onSave}>{t.workbench.saveNote}</Button><Button disabled={blocked} onClick={onClose}>{t.common.close}</Button></div>{draft.saveResult === 'saving' && <p role="status">{t.common.saving}</p>}{draft.saveResult === 'saved' && <p role="status">{t.workbench.saved}</p>}{['conflict', 'unknown', 'rejected'].includes(draft.saveResult) && <NoteConflict {...(classicBase ? { classicBase } : {})} metadataCompatible={metadataCompatible ?? true} draft={draft} disabled={!!(disabled || readOnly)} {...(latest ? { latest } : {})} {...(candidates ? { candidates } : {})} {...(onCompare ? { onCompare } : {})} {...(onReedit ? { onReedit } : {})} {...(onReload ? { onReload } : {})}/>}<details><summary>{t.noteConflict.references}</summary><pre>{JSON.stringify(draft.base.scope_snapshot ?? {}, null, 2)}</pre>{draft.base.citations.map((c, index) => {
            const focusKey = `${key}:citation:${index}`;
            return <article key={focusKey}><p>{c.quote}</p><p>{t.workbench.validity.replace('{{status}}', c.reference_validity)}</p><Button id={focusKey} disabled={!onCitation || !nid || !revision} onClick={() => {
                    if (nid && revision)
                        onCitation?.(c as EvidenceCitationView, { kind: 'note', noteId: nid, noteRevision: revision, focusKey });
                }}>{t.workbench.read} {c.citation_id}</Button></article>;
        })}</details></section>;
}

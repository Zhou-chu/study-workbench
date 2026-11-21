import type { LibrarySource } from '../../data/library-api';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { useStudio } from '../studio/use-studio';
import type { NativeSession, NativeMessage } from '../../data/native-chat';
export function ClassicMessageSave({ notebookId, session, message, source }: {
    notebookId: string;
    session: NativeSession;
    message: NativeMessage;
    source?: LibrarySource;
}) {
    const s = useStudio(notebookId), { native: n, t } = useI18n(), origin = 'classic:' + session.id + ':' + message.id;
    const row = s.notes.find(r => r.originKey === origin);
    const locked = !!row && (!!row.editor.noteId || row.editor.saveResult !== 'idle');
    return <><Button disabled={!s.ready || locked || !message.content.trim()} onClick={() => source ? s.saveSourceMessage(source, session, message.content, origin) : s.saveClassicMessage(session, message.content, origin)}>{n.save}</Button>{row?.editor.saveResult === 'unknown' && <p role="alert">{n.unknown}</p>}{row?.editor.saveResult === 'saved' && <span role="status">{t.common.saveSuccess}</span>}</>;
}

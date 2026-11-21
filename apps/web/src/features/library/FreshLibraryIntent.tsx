import { useAppDrafts } from '../../app/providers';
import { useResourceNavigation } from '../../app/WorkbenchSession';
import { useLibraryConnection } from '../../data/use-library-connection';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import type { LibraryDraft, LibraryInput } from './library-store';
/** A new current intent, never an unlock or a copy of retained input. */
export function FreshLibraryIntent({ row, input, onFresh }: {
    row: LibraryDraft | undefined;
    input: LibraryInput;
    onFresh: (id: string) => void;
}) {
    const { library: store } = useAppDrafts(), c = useLibraryConnection(), navigation = useResourceNavigation(), { library: l } = useI18n();
    if (!row || !c.context || !store.canFresh(row, c.context, c.generation))
        return null;
    return <Button disabled={!c.ready} onClick={() => {
            const id = store.fresh(row.id, input, c.context!, c.generation);
            if (id) {
                onFresh(id);
                navigation?.activateResource(id);
            }
        }}>{l.fresh}</Button>;
}

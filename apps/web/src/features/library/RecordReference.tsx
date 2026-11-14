import { readTurnContext, sessionCoordinator } from '@study/web-transport';
import { useLibraryState } from './use-library-state';
import type { LibraryDraft } from './library-store';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppData } from '../../app/providers';
import { useLibraryConnection } from '../../data/use-library-connection';
import { createStudioApi } from '../../data/studio-api';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { Markdown } from '../../ui/Markdown';
import { LibraryDialog } from './LibraryDialog';
import { SourceInspection } from './SourceInspection';
import { InsightContent } from './SourceInsights';
export type RecordIdentity = {
    kind: 'source' | 'note' | 'source_insight';
    id: string;
};
export function recordReferences(content: string): RecordIdentity[] {
    const out = new Map<string, RecordIdentity>(), pattern = /(?:^|[\s[,(])((?:source_insight|insight|note|source):[a-zA-Z0-9_-]+(?::[a-zA-Z0-9_-]+)*)(?=$|[\s\]),.!?;])/g;
    for (const m of content.matchAll(pattern)) {
        const raw = m[1]!, id = raw.startsWith('insight:') ? 'source_insight:' + raw.slice(8) : raw, kind = id.slice(0, id.indexOf(':')) as RecordIdentity['kind'];
        out.set(id, { kind, id });
    }
    return [...out.values()];
}
// Optional original-record admission. Existing current-owner consumers retain their API.
export function useRecordReferenceAdmission(owner?: LibraryDraft) {
    const s = useLibraryState();
    return () => {
        if (!owner) return true;
        const original = s.store.get(owner.id);
        return !!original && original.context === owner.context && original.generation === owner.generation &&
            s.store.current(original, readTurnContext(), sessionCoordinator.current());
    };
}
export function RecordReferences({ content, owner }: {
    content: string;
    owner?: LibraryDraft | undefined;
}) {
    const { native: n, global: g } = useI18n(), [selected, setSelected] = useState<RecordIdentity | null>(null);
    const admitted = useRecordReferenceAdmission(owner);
    return <>{!admitted() && <p role="status">{g.retainedReadOnly}</p>}<div className="library-actions">{recordReferences(content).map(ref => <Button key={ref.id} disabled={!admitted()} onClick={() => { if (admitted()) setSelected(ref); }}>{n.reference + ' · ' + ref.id}</Button>)}</div>{selected && <RecordReference key={selected.id} reference={selected} owner={owner} onClose={() => setSelected(null)}/>}</>;
}
type ReferenceProps = {
    reference: RecordIdentity;
    onClose(): void;
    owner?: LibraryDraft | undefined;
};
export function RecordReference(props: ReferenceProps) {
    const admitted = useRecordReferenceAdmission(props.owner);
    // This is a render boundary, not effect cleanup. The reader cannot render against
    // a replacement query scope even for the first frame of an owner transition.
    return admitted() ? <CurrentRecordReference {...props}/> : null;
}
function CurrentRecordReference({ reference, onClose }: ReferenceProps) {
    const c = useLibraryConnection(), { transport } = useAppData(), studio = useMemo(() => transport ? createStudioApi(transport) : null, [transport]), { t, native: n } = useI18n();
    const read = useQuery({ queryKey: ['library', 'reference', c.scope, reference.kind, reference.id], enabled: c.ready && reference.kind !== 'source', queryFn: async () => {
            if (reference.kind === 'source_insight')
                return { kind: 'insight' as const, value: await c.api!.insights.get(reference.id, c.context!) };
            const note = await studio!.readClassic(reference.id, c.context!);
            if (note.id !== reference.id)
                throw new Error('Reference identity mismatch');
            return { kind: 'note' as const, value: note };
        } });
    if (reference.kind === 'source')
        return <SourceInspection sourceId={reference.id} onClose={onClose}/>;
    return <LibraryDialog open title={n.reference + ' · ' + reference.id} onOpenChange={value => { if (!value)
        onClose(); }}>{read.isPending && <p role="status">{t.common.loading}</p>}{read.isError && <p role="alert">{t.common.contentUnavailable.errorTitle}</p>}{read.data?.kind === 'insight' && <InsightContent insight={read.data.value}/>} {read.data?.kind === 'note' && <article><h3>{read.data.value.title ?? t.sources.untitledNote}</h3><p>{t.common.version+': '+read.data.value.revision}</p><Markdown>{read.data.value.content ?? t.common.unknown}</Markdown></article>}</LibraryDialog>;
}

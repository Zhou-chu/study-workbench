import { useMemo } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useAppData } from '../../app/providers';
import { createStudioApi } from '../../data/studio-api';
import { useLibraryConnection } from '../../data/use-library-connection';
import type { ContextConfig } from '../../data/native-chat';
import { ContextMode } from './ClassicContext';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
export function PodcastContextSelection({ notebookId, config, disabled, onChange }: {
    notebookId: string;
    config: ContextConfig;
    disabled: boolean;
    onChange(c: ContextConfig): void;
}) {
    const c = useLibraryConnection(), { transport } = useAppData(), studio = useMemo(() => transport ? createStudioApi(transport) : null, [transport]), { t, native: n } = useI18n();
    const sources = useInfiniteQuery({ queryKey: ['library', 'podcast-sources', c.scope, notebookId], enabled: c.ready && !disabled, initialPageParam: 0, queryFn: ({ signal, pageParam }) => c.api!.sources.list({ notebook_id: notebookId, offset: pageParam, limit: 100 }, c.context!, signal), getNextPageParam: (last, pages) => last.length === 100 ? pages.length * 100 : undefined });
    const notes = useQuery({ queryKey: ['library', 'podcast-notes', c.scope, notebookId], enabled: c.ready && !disabled && !!studio, queryFn: () => studio!.listClassic(notebookId, c.context!) });
    const rows = sources.data?.pages.flat() ?? [], nr = notes.data ?? [];
    function sourcesChange(ids: string[], mode: string) { onChange({ ...config, sources: { ...config.sources, ...Object.fromEntries(ids.map(id => [id, mode])) } } as ContextConfig); }
    function notesChange(ids: string[], selected: boolean) { onChange({ ...config, notes: { ...config.notes, ...Object.fromEntries(ids.map(id => [id, selected ? 'full content' : 'not in'])) } } as ContextConfig); }
    return <div className="podcast-selection"><ContextMode label={n.bulkSources} bulk value="" disabled={disabled || !rows.length} onChange={mode => sourcesChange(rows.map(r => r.id), mode)}/>{rows.map(source => <ContextMode key={source.id} label={t.podcasts.selectMode + ' · ' + (source.title || source.id)} value={config.sources[source.id] ?? 'not in'} disabled={disabled} onChange={mode => sourcesChange([source.id], mode)}/>)}{Object.keys(config.sources).filter(id => config.sources[id] !== 'not in' && !rows.some(r => r.id === id)).map(id => <ContextMode key={id} label={id + ' · ' + t.common.unknown} value={config.sources[id]!} disabled={disabled} onChange={mode => sourcesChange([id], mode)}/>)}
 {sources.hasNextPage && <Button disabled={sources.isFetchingNextPage} onClick={() => void sources.fetchNextPage()}>{t.sources.loadingMore}</Button>}
 <Button disabled={disabled || !nr.length} onClick={() => notesChange(nr.map(r => r.id), true)}>{n.bulkNotes}</Button><Button disabled={disabled} onClick={() => notesChange(Object.keys(config.notes), false)}>{t.sources.excludeAllFromContext}</Button>
 {nr.map(note => <label className="library-check" key={note.id}><input type="checkbox" checked={config.notes[note.id] === 'full content'} disabled={disabled} onChange={e => notesChange([note.id], e.target.checked)}/>{note.title || note.id}</label>)}
 {Object.keys(config.notes).filter(id => config.notes[id] === 'full content' && !nr.some(r => r.id === id)).map(id => <label className="library-check" key={id}><input type="checkbox" checked disabled={disabled} onChange={() => notesChange([id], false)}/>{id + ' · ' + t.common.unknown}</label>)}
 {(sources.isError || notes.isError) && <p role="alert">{t.common.contentUnavailable.errorTitle}</p>}</div>;
}

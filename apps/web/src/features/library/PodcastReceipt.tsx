import type { LibraryDraft } from './library-store';
import { useI18n } from '../../i18n';
export function PodcastReceipt({ row }: {
    row: LibraryDraft | undefined;
}) {
    const { global: g, t } = useI18n();
    if (!row)
        return null;
    const message = row.status === 'unknown' ? g.unknown : row.status === 'not-sent' ? g.notSent : row.status === 'rejected' ? g.rejected : row.status === 'accepted' ? t.podcasts.generationStartedDesc : row.status === 'pending' ? t.common.loading : row.status === 'failed' ? t.podcasts.generationFailed : t.common.success;
    const input = row.input.kind === 'podcast-operation' ? row.input : null;
    return <div className="podcast-receipt" role={['unknown', 'rejected', 'failed'].includes(row.status) ? 'alert' : 'status'}><p>{message}</p>{input?.targetId && <p>{input.targetId}</p>}{input?.request && <details><summary>{t.podcasts.summary}</summary><pre>{JSON.stringify(input.request, null, 2)}</pre></details>}{row.commandId && <p>{row.commandId}</p>}{row.receipts.map((r, i) => <p key={i}>{r.resourceId}{r.commandId && r.commandId !== row.commandId ? ' · ' + r.commandId : ''}</p>)}</div>;
}

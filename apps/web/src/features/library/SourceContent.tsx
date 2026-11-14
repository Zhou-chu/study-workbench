import { useI18n } from '../../i18n';
import { Tabs } from '../../ui/Tabs';
import { Markdown } from '../../ui/Markdown';
import type { LibrarySource } from '../../data/library-api';
import { SourceAsset } from './SourceAsset';
import { SourceInsights } from './SourceInsights';
import { SourceDetails } from './SourceDetails';
/** Shared source view: route, source inspection and verified references share these consumers. */
export function SourceContent({ source }: {
    source: LibrarySource;
}) {
    const { t } = useI18n();
    return <Tabs key={source.id} label={t.sources.detailsTitle} defaultValue="content" items={[{ value: 'content', label: t.sources.content, content: <><Markdown>{source.full_text ?? t.sources.noContent}</Markdown><SourceAsset source={source}/></> }, { value: 'insights', label: t.sources.insights, content: <SourceInsights source={source}/> }, { value: 'details', label: t.sources.details, content: <SourceDetails source={source}/> }]}/>;
}

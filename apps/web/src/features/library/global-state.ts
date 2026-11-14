import type { GlobalQuery, AskModels, SearchResponse } from '../../data/global-search';
import type { AskEvent } from './global-ask-stream';
export type GlobalQueryInput = GlobalQuery & {
    kind: 'global-query';
    routeKey: string;
    intentId: string;
};
export type GlobalRunInput = GlobalQuery & {
    kind: 'global-run';
    runId: string;
    intentId: string;
    models?: AskModels;
};
export type GlobalSaveInput = {
    kind: 'global-save';
    runId: string;
    title: string;
    content: string;
    targets: readonly {
        notebookId: string;
        studioId: string;
    }[];
};
export type GlobalOutput = {
    search?: SearchResponse;
    strategy?: Extract<AskEvent, {
        type: 'strategy';
    }>;
    answers?: readonly string[];
    final?: string;
    terminal?: 'answer' | 'no-answer' | 'error';
    message?: string;
};

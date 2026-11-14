import type { ContextConfig } from '../../data/native-chat';
import type { EpisodeProfileInput, SpeakerProfileInput, GenerationRequest } from '../../data/podcast-contracts';
export type PodcastGenerationForm = {
    kind: 'podcast-form';
    formKey: 'generate';
    intentId: string;
    name: string;
    instructions: string;
    profileId: string;
    selectionVersion: number;
    selection: Record<string, ContextConfig>;
};
export type PodcastProfileForm = {
    kind: 'podcast-profile-form';
    formKey: string;
    intentId: string;
    profileType: 'episode' | 'speaker';
    targetId: string | null;
    payload: EpisodeProfileInput | SpeakerProfileInput;
};
export type PodcastOperation = {
    kind: 'podcast-operation';
    key: string;
    action: 'generate' | 'retry' | 'delete-episode' | 'save-episode' | 'save-speaker' | 'duplicate-episode' | 'duplicate-speaker' | 'delete-episode-profile' | 'delete-speaker-profile';
    targetId: string | null;
    originId: string;
    request?: GenerationRequest | EpisodeProfileInput | SpeakerProfileInput;
    original?: PodcastGenerationForm | PodcastProfileForm;
};
export type PodcastInput = PodcastGenerationForm | PodcastProfileForm | PodcastOperation;
export type PodcastPreview = {
    revision: number;
    selectionVersion: number;
    content: string;
    tokens: number;
    chars: number;
    issues: {
        id: string;
        kind: 'missing' | 'unusable' | 'invalid';
    }[];
};
export const emptyPodcastForm = (): PodcastGenerationForm => ({ kind: 'podcast-form', formKey: 'generate', intentId: crypto.randomUUID(), name: '', instructions: '', profileId: '', selectionVersion: 0, selection: {} });
export const isPodcastInput = (v: {
    kind: string;
}) => v.kind === 'podcast-form' || v.kind === 'podcast-profile-form' || v.kind === 'podcast-operation';

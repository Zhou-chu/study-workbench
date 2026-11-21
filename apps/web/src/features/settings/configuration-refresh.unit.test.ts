import { expect, it, vi } from 'vitest';
import type { DispatchContext } from '@study/domain';
import { refreshConfigurationSources } from './configuration-refresh';

type ReadApi = NonNullable<Parameters<typeof refreshConfigurationSources>[2]>;
type ReadStore = Parameters<typeof refreshConfigurationSources>[3];
const context: DispatchContext = {
    epoch: 1, ready: true, target: { mode: 'legacy_password', apiBase: '/api', protocol: null },
};
const id = 'configuration:ordinary';
const fixture = () => {
    const state = { ready: true, context: context as DispatchContext | null, generation: 9 };
    const runtime = {
        ready: () => state.ready,
        context: () => state.context,
        generation: () => state.generation,
    };
    const store = {
        get: vi.fn<ReadStore['get']>(() => ({ context, retired: false })),
        loading: vi.fn<ReadStore['loading']>(() => 1),
        publish: vi.fn<ReadStore['publish']>(),
    };
    const api = {
        contentSettings: vi.fn<ReadApi['contentSettings']>().mockResolvedValue({ docling_ocr: false }),
        extractionCapabilities: vi.fn<ReadApi['extractionCapabilities']>().mockResolvedValue({
            docling_available: true, crawl4ai_available: false, crawl4ai_remote_configured: false,
        }),
        webSearchStatus: vi.fn<ReadApi['webSearchStatus']>().mockResolvedValue({
            state: 'unconfigured', configured: false, access_mode: null, trial: false,
        }),
        providers: vi.fn<ReadApi['providers']>().mockResolvedValue([]),
        credentialsMetadata: vi.fn<ReadApi['credentialsMetadata']>().mockResolvedValue([]),
        models: vi.fn<ReadApi['models']>().mockResolvedValue([]),
        modelDefaults: vi.fn<ReadApi['modelDefaults']>().mockResolvedValue({
            default_chat_model: null, default_embedding_model: null,
            default_text_to_speech_model: null, default_speech_to_text_model: null,
            default_transformation_model: null, default_tools_model: null, large_context_model: null,
        }),
    };
    return { api, state, store, runtime };
};

it('routes each application settings read, preserving false values and the revision assigned to each request', async () => {
    const {api,store,runtime}=fixture();
    store.loading.mockReturnValueOnce(4).mockReturnValueOnce(8).mockReturnValueOnce(12);
    expect(await refreshConfigurationSources(id,['content','capabilities','web'],api,store,runtime)).toBe(true);
    expect(api.contentSettings).toHaveBeenCalledExactlyOnceWith(context);
    expect(api.extractionCapabilities).toHaveBeenCalledExactlyOnceWith(context);
    expect(api.webSearchStatus).toHaveBeenCalledExactlyOnceWith(context);
    expect(api.providers).not.toHaveBeenCalled();
    expect(store.publish.mock.calls).toEqual([
        [id,'content',4,{docling_ocr:false}],
        [id,'capabilities',8,{docling_available:true,crawl4ai_available:false,crawl4ai_remote_configured:false}],
        [id,'web',12,{state:'unconfigured',configured:false,access_mode:null,trial:false}],
    ]);
});

it('keeps successful model metadata when one sibling read is rejected', async () => {
    const {api,store,runtime}=fixture();
    const provider = {name:'ollama',display_name:'Ollama',modalities:['language'],docs_url:null,env_configured:false};
    const model = {id:'model:one',name:'Demo model',provider:'ollama',type:'language',credential:null,created:'2026-11-01',updated:'2026-11-01'};
    api.providers.mockResolvedValueOnce([provider]);
    api.models.mockResolvedValueOnce([model]);
    api.credentialsMetadata.mockRejectedValueOnce(new Error('synthetic unavailable list'));
    expect(await refreshConfigurationSources(id,['providers','credentials','models','defaults'],api,store,runtime)).toBe(false);
    expect(api.credentialsMetadata).toHaveBeenCalledExactlyOnceWith(context);
    expect(store.publish).toHaveBeenCalledWith(id,'providers',1,[provider]);
    expect(store.publish).toHaveBeenCalledWith(id,'models',1,[model]);
    expect(store.publish).toHaveBeenCalledWith(id,'credentials',1,null);
    expect(store.publish).toHaveBeenCalledWith(id,'defaults',1,expect.objectContaining({default_chat_model:null}));
    expect(store.publish).toHaveBeenCalledTimes(4);
});

it('does not read settings when the draft, API, runtime or captured context is unavailable', async () => {
    const {api,store,runtime,state}=fixture();
    const names=['content'] as const;
    expect(await refreshConfigurationSources(null,names,api,store,runtime)).toBe(false);
    expect(await refreshConfigurationSources(id,names,null,store,runtime)).toBe(false);
    state.ready=false;
    expect(await refreshConfigurationSources(id,names,api,store,runtime)).toBe(false);
    expect(store.get).not.toHaveBeenCalled();
    state.ready=true;
    store.get.mockReturnValueOnce(undefined).mockReturnValueOnce({context,retired:true});
    expect(await refreshConfigurationSources(id,names,api,store,runtime)).toBe(false);
    expect(await refreshConfigurationSources(id,names,api,store,runtime)).toBe(false);
    state.context=null;
    expect(await refreshConfigurationSources(id,names,api,store,runtime)).toBe(false);
    expect(store.loading).not.toHaveBeenCalled();
    expect(api.contentSettings).not.toHaveBeenCalled();
});

it('does not read an item when no loading revision was assigned', async () => {
    const {api,store,runtime}=fixture();
    store.loading.mockReturnValueOnce(null).mockReturnValueOnce(5);
    expect(await refreshConfigurationSources(id,['models','providers'],api,store,runtime)).toBe(false);
    expect(api.models).not.toHaveBeenCalled();
    expect(store.publish).toHaveBeenCalledExactlyOnceWith(id,'providers',5,[]);
});

it.each(['generation','context'] as const)('ignores a late read after %s changes during the request', async phase => {
    const {api,store,runtime,state}=fixture();
    type Response = Awaited<ReturnType<ReadApi['contentSettings']>>;
    let resolve!: (item: Response) => void;
    const response = new Promise<Response>(done => { resolve = done; });
    api.contentSettings.mockReturnValueOnce(response);
    const result=refreshConfigurationSources(id,['content'],api,store,runtime);
    expect(api.contentSettings).toHaveBeenCalledExactlyOnceWith(context);
    if (phase==='generation') state.generation++;
    else state.context={...context,epoch:2};
    resolve({docling_ocr:true});
    expect(await result).toBe(false);
    expect(store.publish).not.toHaveBeenCalled();
});

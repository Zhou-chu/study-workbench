import {expect, it, vi} from 'vitest';
import {RequestNotDispatchedError, type DispatchContext} from '@study/web-transport';
import {SettingsRequestError} from '../../data/settings-api';
import {runConfigurationWrite} from './configuration-write';
import type {ConfigurationToken} from './configuration-store';

type Api=NonNullable<Parameters<typeof runConfigurationWrite>[1]>;
type Store=Parameters<typeof runConfigurationWrite>[2];
const context: DispatchContext={epoch:3,ready:true,target:{mode:'legacy_password',apiBase:'/api',protocol:null}};
const operation='operation:example';
const ticket=(intent: ConfigurationToken['intent']): ConfigurationToken=>({
    id:operation,ownerId:'configuration:reading',context,generation:5,providerRevision:11,
    controlRevision:7,metadataRevision:9,fieldRevisions:{},intent,
});
function fixture() {
    const api: {[K in keyof Api]: ReturnType<typeof vi.fn<Api[K]>>}={
        saveContentSettings:vi.fn(),saveModelDefault:vi.fn(),saveCredential:vi.fn(),
        testCredential:vi.fn(),discoverCredentialModels:vi.fn(),registerCredentialModels:vi.fn(),
        deleteCredential:vi.fn(),deleteModel:vi.fn(),testModel:vi.fn(),migrateEnvironment:vi.fn(),autoAssignDefaults:vi.fn(),
    };
    const store={begin:vi.fn<Store['begin']>(()=>true),settle:vi.fn<Store['settle']>(()=>true)};
    const current={ready:true,context:context as DispatchContext|null,generation:5,providerRevision:11};
    const runtime={
        ready:()=>current.ready,context:()=>current.context,generation:()=>current.generation,
        providerRevision:()=>current.providerRevision,
    };
    return { api,store,current,runtime,
        run:(token: ConfigurationToken)=>runConfigurationWrite(token,api,store,runtime) };
}
const defaults={
    default_chat_model:null,default_embedding_model:null,default_text_to_speech_model:null,
    default_speech_to_text_model:null,default_transformation_model:null,default_tools_model:null,large_context_model:null,
};

it('skips writes when the API or draft is not ready and after the store declines admission',async()=>{
    const {api,store,current,runtime,run}=fixture();
    const token=ticket({kind:'content',changes:{docling_ocr:false}});
    expect(await runConfigurationWrite(token,null,store,runtime)).toBeNull();
    current.ready=false;
    expect(await run(token)).toBeNull();
    expect(store.begin).not.toHaveBeenCalled();
    current.ready=true;
    store.begin.mockReturnValueOnce(false);
    expect(await run(token)).toBeNull();
    expect(store.begin).toHaveBeenCalledExactlyOnceWith(token,context,5,11);
    expect(api.saveContentSettings).not.toHaveBeenCalled();
    expect(store.settle).not.toHaveBeenCalled();
});

it('conveys an explicit false content field and returns the exact accepted result',async()=>{
    const {api,store,run}=fixture();
    const fields={docling_ocr:false,default_content_processing_engine_doc:'simple'} as const;
    const token=ticket({kind:'content',changes:fields});
    api.saveContentSettings.mockResolvedValueOnce(fields);
    expect(await run(token)).toBe(fields);
    expect(api.saveContentSettings).toHaveBeenCalledExactlyOnceWith(fields,context,operation);
    expect(store.settle).toHaveBeenCalledExactlyOnceWith(token,'confirmed',context,5,fields);
});

it('clears exactly the selected optional default and withholds a late confirmation',async()=>{
    const {api,store,current,run}=fixture();
    const token=ticket({kind:'defaults',field:'default_tools_model',value:null});
    type Result=Awaited<ReturnType<Api['saveModelDefault']>>;
    let resolve!: (value: Result)=>void;
    api.saveModelDefault.mockReturnValueOnce(new Promise<Result>(done=>{resolve=done;}));
    store.settle.mockReturnValueOnce(false);
    const pending=run(token);
    expect(api.saveModelDefault).toHaveBeenCalledExactlyOnceWith('default_tools_model',null,context,operation);
    current.generation=6;
    current.context={...context,epoch:4};
    resolve(defaults);
    expect(await pending).toBeNull();
    expect(store.settle).toHaveBeenCalledExactlyOnceWith(token,'confirmed',current.context,6,defaults);
});

it('routes explicit model probe and environment auto-assignment to their own endpoints',async()=>{
    const {api,store,run}=fixture();
    const probe=ticket({kind:'model-test',id:'model:compare'});
    const safeResult={success:false,details_present:true};
    api.testModel.mockResolvedValueOnce(safeResult);
    expect(await run(probe)).toBe(safeResult);
    expect(api.testModel).toHaveBeenCalledExactlyOnceWith('model:compare',context,operation);
    const auto=ticket({kind:'auto-assign'});
    const summary={assigned:{default_chat_model:'model:compare'},skipped:[],missing:['default_embedding_model']};
    api.autoAssignDefaults.mockResolvedValueOnce(summary);
    expect(await run(auto)).toBe(summary);
    expect(api.autoAssignDefaults).toHaveBeenCalledExactlyOnceWith(context,operation);
    expect(store.settle).toHaveBeenLastCalledWith(auto,'confirmed',context,5,summary);
});

it.each([0,2])('retains migration counts without reporting partial failure as confirmed (%s errors)',async(errors)=>{
    const {api,store,run}=fixture();
    const token=ticket({kind:'migrate-env'});
    const result={migrated:1,skipped:0,not_configured:1,errors};
    api.migrateEnvironment.mockResolvedValueOnce(result);
    expect(await run(token)).toBe(errors?null:result);
    expect(api.migrateEnvironment).toHaveBeenCalledExactlyOnceWith(context,operation);
    expect(store.settle).toHaveBeenCalledExactlyOnceWith(token,errors?'unknown':'confirmed',context,5,result);
});

it.each([
    [new RequestNotDispatchedError('aborted'),'not-sent',undefined],
    [new SettingsRequestError(503),'unknown',503],
    [new Error('reply unavailable'),'unknown',undefined],
] as const)('distinguishes a known unsent save from a missing outcome without replay',async(error,status,httpStatus)=>{
    const {api,store,run}=fixture();
    const token=ticket({kind:'content',changes:{docling_ocr:true}});
    api.saveContentSettings.mockRejectedValueOnce(error);
    expect(await run(token)).toBeNull();
    expect(api.saveContentSettings).toHaveBeenCalledOnce();
    expect(store.settle).toHaveBeenCalledExactlyOnceWith(token,status,context,5,undefined,httpStatus);
});

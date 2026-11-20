import {afterEach, expect, it, vi} from 'vitest';
import {RequestNotDispatchedError, sessionCoordinator} from '@study/web-transport';
import {LibraryError, type LibraryApi, type LibrarySource} from '../../data/library-api';
import {sourceContext} from '../../test/source-fixtures';
import {executeLibraryDraft, observeCommand, retryReason, sourceHref, validImportInput, youtubeId} from './library-operations';
import type {ImportInput, LibraryDraft, LibraryInput, LibraryStore} from './library-store';

const source = (changes: Partial<LibrarySource> = {}): LibrarySource => ({
    id:'source:one', title:'Reading', topics:null, asset:null, embedded:false, embedded_chunks:0,
    created:'2026-11-01', updated:'2026-11-02', file_available:null, command_id:null, status:'failed',
    submissionUnknown:false, ...changes,
});
const draftInput = (changes: Partial<ImportInput> = {}): ImportInput => ({
    kind:'import', type:'text', title:'Daily notes', text:'Test note', urls:'', files:[], notebooks:['notebook:study'],
    transformations:[], embed:false, step:3, ...changes,
});
function fixture(input: LibraryInput) {
    const c=sourceContext(), g=sessionCoordinator.current(), id='draft:fixed', commandId='command:ordinary';
    const token={id, attempt:1, revision:0, context:c, generation:g};
    let row: LibraryDraft={id, input, owner:{kind:'global'}, context:c, generation:g, revision:0, token,
        status:'editing', attempt:1, retired:false, dirty:true, receipts:[], stopRequested:false};
    const boundary: Pick<LibraryStore,'begin'|'current'|'finish'|'get'|'item'|'observe'>={
        begin:vi.fn(()=>row={...row,status:'pending'}),
        current:vi.fn(()=>true),
        finish:vi.fn(),
        get:vi.fn(()=>row),
        item:vi.fn(),
        observe:vi.fn(),
    };
    const apiBoundary={
        sources:{create:vi.fn<LibraryApi['sources']['create']>(), get:vi.fn<LibraryApi['sources']['get']>(),
            update:vi.fn<LibraryApi['sources']['update']>(), retry:vi.fn<LibraryApi['sources']['retry']>(),
            delete:vi.fn<LibraryApi['sources']['delete']>()},
        associations:{set:vi.fn<LibraryApi['associations']['set']>()},
        insights:{create:vi.fn<LibraryApi['insights']['create']>(),delete:vi.fn<LibraryApi['insights']['delete']>()},
        embed:vi.fn<LibraryApi['embed']>(),
        command:vi.fn<LibraryApi['command']>(),
    };
    const store=boundary as LibraryStore, api=apiBoundary as unknown as LibraryApi;
    return {c,g,id,token,commandId,apiBoundary,boundary,store,api,
        run:()=>executeLibraryDraft(store,id,api),
        change:(changes:Partial<LibraryDraft>)=>row={...row,...changes}};
}
afterEach(()=>vi.useRealTimers());

it('validates completed drafts and maps ordinary external reference formats without fetching',()=>{
    expect(validImportInput(draftInput({step:2}))).toBe(false);
    expect(validImportInput(draftInput({step:2}),false)).toBe(true);
    expect(validImportInput(draftInput({text:'  '}))).toBe(false);
    expect(validImportInput(draftInput({notebooks:[' ']}))).toBe(false);
    expect(validImportInput(draftInput({type:'upload'}))).toBe(false);
    const note=new File(['notes'],'notes.txt');
    expect(validImportInput(draftInput({type:'upload',files:[note]}))).toBe(true);
    expect(validImportInput(draftInput({type:'link',urls:' https://example.test/one\n\nhttp://example.test/two '}))).toBe(true);
    expect(validImportInput(draftInput({type:'link',urls:'missing-host'}))).toBe(false);
    expect(sourceHref('source:one')).toBe('/sources/source%3Aone');
    const id='aB3cD4E5_FG';
    for(const url of [`https://www.youtube.com/watch?v=${id}`,`https://youtu.be/${id}`,`https://m.youtube.com/shorts/${id}`,`https://www.youtube.com/embed/${id}`]) {
        expect(youtubeId(url)).toBe(id);
    }
    expect(youtubeId(null)).toBeNull();
    expect(youtubeId('https://www.youtube.com/watch?v=short')).toBeNull();
});

it('does not begin an incomplete import; ready text is submitted once with original notebook and operation key',async()=>{
    const held=fixture(draftInput({step:1}));
    await held.run();
    expect(held.boundary.begin).not.toHaveBeenCalled();
    expect(held.apiBoundary.sources.create).not.toHaveBeenCalled();
    const f=fixture(draftInput({transformations:['transform:summary'],embed:true}));
    f.apiBoundary.sources.create.mockResolvedValue(source({command_id:'command:import'}));
    await f.run();
    expect(f.apiBoundary.sources.create).toHaveBeenCalledExactlyOnceWith({
        type:'text',title:'Daily notes',content:'Test note',notebooks:['notebook:study'],transformations:['transform:summary'],embed:true,
    },f.c,f.id+':0');
    expect(f.boundary.item).toHaveBeenCalledExactlyOnceWith(f.id,f.token,0,
        {state:'accepted',resourceId:'source:one',commandId:'command:import'},f.c,f.g);
    expect(f.boundary.finish).toHaveBeenCalledExactlyOnceWith(f.id,f.token,'succeeded',f.c,f.g,undefined);
});

it('keeps a rejected item alongside later accepted links without assigning one title to the batch',async()=>{
    const f=fixture(draftInput({type:'link',urls:'https://example.test/one\n https://example.test/two'}));
    f.apiBoundary.sources.create.mockRejectedValueOnce(new LibraryError('rejected',422)).mockResolvedValueOnce(source());
    await f.run();
    expect(f.apiBoundary.sources.create.mock.calls.map(([p,,k])=>[p.url,p.title,k])).toEqual([
        ['https://example.test/one',undefined,f.id+':0'],['https://example.test/two',undefined,f.id+':1'],
    ]);
    expect(vi.mocked(f.boundary.item).mock.calls.map(([, ,i,receipt])=>[i,receipt.state])).toEqual([[0,'rejected'],[1,'accepted']]);
    expect(f.boundary.finish).toHaveBeenCalledExactlyOnceWith(f.id,f.token,'failed',f.c,f.g,undefined);
});

it.each([false,true])('stops a definitively unsent item without replay after earlier acceptance=%s',async(partial)=>{
    const f=fixture(draftInput({type:'link',urls:'https://example.test/one\nhttps://example.test/two\nhttps://example.test/three'}));
    if (partial) f.apiBoundary.sources.create.mockResolvedValueOnce(source());
    f.apiBoundary.sources.create.mockRejectedValueOnce(new RequestNotDispatchedError('aborted'));
    await f.run();
    expect(f.apiBoundary.sources.create).toHaveBeenCalledTimes(partial?2:1);
    expect(f.boundary.item).toHaveBeenCalledTimes(partial?2:0);
    expect(f.boundary.finish).toHaveBeenCalledExactlyOnceWith(f.id,f.token,partial?'unknown':'not-sent',f.c,f.g,undefined);
});

it('resolves source links before writing only changed notebook memberships',async()=>{
    const f=fixture({kind:'associations',sourceId:'source:one',original:['old','shared'],selected:['new','shared']});
    f.apiBoundary.sources.get.mockResolvedValue(source());
    await f.run();
    expect(f.apiBoundary.sources.get).toHaveBeenCalledTimes(2);
    expect(f.apiBoundary.associations.set.mock.calls).toEqual([
        ['new','source:one',true,f.c,f.id+':0'],['old','source:one',false,f.c,f.id+':1'],
    ]);
    expect(f.boundary.finish).toHaveBeenCalledExactlyOnceWith(f.id,f.token,'succeeded',f.c,f.g,undefined);
});

it('does not apply a pending link after its editor is stopped during the lookup',async()=>{
    const f=fixture({kind:'existing',notebookId:'new',selected:['source:one','source:two'],query:''});
    f.apiBoundary.sources.get.mockImplementationOnce(async()=>{f.change({stopRequested:true}); return source();});
    await f.run();
    expect(f.apiBoundary.sources.get).toHaveBeenCalledTimes(1);
    expect(f.apiBoundary.associations.set).not.toHaveBeenCalled();
    expect(f.boundary.finish).toHaveBeenCalledExactlyOnceWith(f.id,f.token,'unknown',f.c,f.g,undefined);
});

it('strips empty topic separators before metadata writes',async()=>{
    const f=fixture({kind:'metadata',sourceId:'source:one',title:'Edited',topics:' science, , notes , '});
    f.apiBoundary.sources.update.mockResolvedValue(source());
    await f.run();
    expect(f.apiBoundary.sources.update).toHaveBeenCalledExactlyOnceWith('source:one',{title:'Edited',topics:['science','notes']},f.c,f.id);
    expect(f.boundary.finish).toHaveBeenCalledExactlyOnceWith(f.id,f.token,'succeeded',f.c,f.g,undefined);
});

it('blocks duplicate retry of running work and adopts the exact new command for a failed source',async()=>{
    expect(retryReason(source({status:'completed'}))).toBe('completed');
    expect(retryReason(source({submissionUnknown:true}))).toBe('unknown');
    expect(retryReason(source({status:null,command_id:'command:prior'}))).toBe('unknown');
    const busy=fixture({kind:'action',action:'retry',sourceId:'source:one'});
    busy.apiBoundary.sources.get.mockResolvedValue(source({status:'running'}));
    await busy.run();
    expect(busy.apiBoundary.sources.retry).not.toHaveBeenCalled();
    expect(busy.boundary.finish).toHaveBeenCalledExactlyOnceWith(busy.id,busy.token,'rejected',busy.c,busy.g,undefined);
    const f=fixture({kind:'action',action:'retry',sourceId:'source:one'});
    f.apiBoundary.sources.get.mockResolvedValue(source());
    f.apiBoundary.sources.retry.mockResolvedValue(source({command_id:f.commandId}));
    await f.run();
    expect(f.apiBoundary.sources.retry).toHaveBeenCalledExactlyOnceWith('source:one',f.c,f.id);
    expect(f.boundary.finish).toHaveBeenCalledExactlyOnceWith(f.id,f.token,'accepted',f.c,f.g,f.commandId);
});

it('preserves ambiguous command receipt and never polls without ownership',async()=>{
    const f=fixture({kind:'action',action:'embed',sourceId:'source:one'});
    f.apiBoundary.embed.mockRejectedValue(new LibraryError('unknown',503,'source:one',f.commandId));
    await f.run();
    expect(f.boundary.item).toHaveBeenCalledExactlyOnceWith(f.id,f.token,0,
        {state:'unknown',resourceId:'source:one',commandId:f.commandId},f.c,f.g);
    await observeCommand(f.api,f.change({status:'accepted'}),f.store,new AbortController().signal,vi.fn());
    expect(f.apiBoundary.command).not.toHaveBeenCalled();
    expect(f.boundary.finish).toHaveBeenCalledExactlyOnceWith(f.id,f.token,'unknown',f.c,f.g,f.commandId);
});

it('observes only the captured command, invokes the terminal callback once and never resubmits',async()=>{
    vi.useFakeTimers();
    const f=fixture({kind:'action',action:'embed',sourceId:'source:one'});
    const terminal=vi.fn(), signal=new AbortController().signal;
    const row=f.change({status:'accepted',commandId:f.commandId});
    f.apiBoundary.command.mockResolvedValueOnce({job_id:f.commandId,status:'running'})
        .mockResolvedValueOnce({job_id:f.commandId,status:'completed'});
    vi.mocked(f.boundary.observe).mockImplementation((_,__,status)=>{if(status==='completed') f.change({status:'succeeded'});});
    const polling=observeCommand(f.api,row,f.store,signal,terminal);
    await vi.advanceTimersByTimeAsync(2000);
    await polling;
    expect(f.apiBoundary.command.mock.calls).toEqual([[f.commandId,f.c,signal],[f.commandId,f.c,signal]]);
    expect(f.apiBoundary.embed).not.toHaveBeenCalled();
    expect(terminal).toHaveBeenCalledOnce();
});

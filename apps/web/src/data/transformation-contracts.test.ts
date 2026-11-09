import { expect, it } from 'vitest';
import { parseTransformation, parseTransformations, transformationBody, parseTransformationOutput, transformationId } from './transformation-contracts';
import { transformationFixture as fixture } from '../test/transformation-fixtures';
it('projects exact transformation fields and accepts the real colon identity', () => {
    expect(parseTransformation({ ...fixture, private_extra: '/unsafe' })).toEqual(fixture);
    expect(transformationId('transformation:one')).toBe('transformation:one');
    for (const bad of ['', 'a/b', 'a\\b', 'a\u0000b'])
        expect(() => transformationId(bad)).toThrow();
});
it('preserves null and empty clears, absent keeps, false defaults and literal prompt bytes', () => {
    expect(transformationBody({ description: null, model_id: null, apply_default: false })).toEqual({ description: null, model_id: null, apply_default: false });
    expect(transformationBody({ description: '' })).toEqual({ description: '' });
    expect(transformationBody({ prompt: ' {{ literal }} ' })).toEqual({ prompt: ' {{ literal }} ' });
    expect(() => transformationBody({})).toThrow();
});
it.each([null, {}, [{ ...fixture, apply_default: 'false' }], [fixture, fixture], [{ ...fixture, prompt: null }]])('rejects malformed lists rather than returning an empty success', value => {
    expect(() => parseTransformations(value)).toThrow();
});
it('accepts matching nullable returned model identity without inventing actual execution proof', () => {
    const original = { transformation_id: fixture.id, input_text: 'private input', model_id: 'model:chat' };
    expect(parseTransformationOutput({ output: '<b>safe text</b>', transformation_id: fixture.id, model_id: null, trace: 'secret' }, original)).toEqual({ output: '<b>safe text</b>', transformation_id: fixture.id, model_id: null });
    for (const bad of [{ output: '', transformation_id: fixture.id, model_id: null }, { output: 'x', transformation_id: 'other', model_id: null }, { output: 'x', transformation_id: fixture.id, model_id: 'other' }])
        expect(() => parseTransformationOutput(bad, original)).toThrow();
});

import {createSettingsApi} from './settings-api';
import {sourceContext} from '../test/source-fixtures';
import {type RequestSpec} from '@study/web-transport';
it('adapter transmits exact null/false presence, one-segment identities and local operation evidence without wire idempotency',async()=>{
 const context=sourceContext(),requests:RequestSpec[]=[];
 const api=createSettingsApi({send:async r=>{requests.push(r);return new Response(JSON.stringify({...fixture,description:'',model_id:null,apply_default:false}),{status:200,headers:{'content-type':'application/json'}})}});
 await api.updateTransformation(fixture.id,{description:null,model_id:null,apply_default:false},context,'local-original-key');
 expect(requests).toHaveLength(1);
 expect(requests[0]).toMatchObject({method:'PUT',path:'/transformations/transformation%3Aone',operationKey:'local-original-key'});
 expect(JSON.parse(String(requests[0]!.body))).toEqual({description:null,model_id:null,apply_default:false});
 expect(String(requests[0]!.body)).not.toMatch(/idempotency|local-original-key|name|prompt/);
});

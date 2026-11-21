import assert from 'node:assert/strict';
import test from 'node:test';
import executionReporter from './coverage-node-reporter.mjs';

async function* events(values) { yield* values; }
async function collect(source) {
  const chunks=[];
  for await (const chunk of executionReporter(source)) chunks.push(chunk);
  assert.equal(chunks.length,1);
  return JSON.parse(chunks[0]);
}

test('reporter records native per-file summaries without echoing requested paths',async()=>{
  const summary={file:'/synthetic/actual.test.mjs',success:true,counts:{tests:1,passed:1}};
  const result=await collect(events([
    {type:'test:pass',data:{file:'/synthetic/not-a-summary.test.mjs'}},
    {type:'test:summary',data:{success:true}},
    {type:'test:summary',data:summary},
  ]));
  assert.deepEqual(result,{version:1,engine:'node',complete:true,summaries:[summary]});
});

test('reporter records completed empty stream, leaving selection audit to reject missing files',async()=>{
  assert.deepEqual(await collect(events([])),{version:1,engine:'node',complete:true,summaries:[]});
});

test('interrupted native stream cannot emit a successful completion document',async()=>{
  const failure=new Error('synthetic interruption');
  async function* broken(){
    yield {type:'test:summary',data:{file:'/synthetic/partial.test.mjs'}};
    throw failure;
  }
  const output=[];
  await assert.rejects(async()=>{for await(const chunk of executionReporter(broken()))output.push(chunk);},error=>error===failure);
  assert.deepEqual(output,[]);
});

/** Node's native per-file summaries; no selection list is read or echoed. */
export default async function* executionReporter(source) {
 const summaries=[];
 for await(const event of source){
  if(event.type==='test:summary' && typeof event.data?.file==='string')summaries.push(event.data);
 }
 yield JSON.stringify({version:1,engine:'node',complete:true,summaries})+'\n';
}

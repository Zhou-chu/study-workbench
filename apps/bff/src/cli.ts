import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {getWebSessionConfig,createBffServer} from './server.js';
/** Socket configuration only. It neither changes trust nor selects an upstream. */
export function listenAddress(env:Readonly<Record<string,string|undefined>>=process.env){
 const port=env.PORT??'3000',host=env.STUDY_WORKBENCH_BFF_LISTEN_HOST??'127.0.0.1';
 if(!/^\d+$/.test(port)||Number(port)<1||Number(port)>65535||!['127.0.0.1','0.0.0.0'].includes(host))throw Error('INVALID_LISTEN_ADDRESS');
 return {port:Number(port),host};
}
// Imports of either the CLI or constructors never listen.
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const address=listenAddress(),server=createBffServer(getWebSessionConfig());
  for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{server.close(()=>{process.exitCode=0;});});
  server.on('error',()=>{console.error('BFF_START_FAILED');process.exitCode=1;});
  server.listen(address.port,address.host);
 }catch{console.error('BFF_START_FAILED');process.exitCode=1;}
}

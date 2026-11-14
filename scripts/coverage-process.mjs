import { spawnSync } from 'node:child_process';
import { mkdirSync,openSync,closeSync,writeSync } from 'node:fs';
import { dirname } from 'node:path';
/** File-backed output survives executor switches and never hits spawnSync's buffer limit. */
export function recordedRun(command,args,{cwd,env,logPath}){
 mkdirSync(dirname(logPath),{recursive:true});
 const fd=openSync(logPath,'w');
 try{
  const result=spawnSync(command,args,{cwd,env,stdio:['ignore',fd,fd]});
  if(result.error)writeSync(fd,String(result.error)+'\n');
  return result.status??1;
 }finally{closeSync(fd);}
}

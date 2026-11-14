/** Root-relative in-memory destinations only. */
export function safeReturnPath(value:unknown):string|null{
 const unsafe=(v:string)=>v.startsWith('//')||v.includes('\\')||[...v].some(c=>c.charCodeAt(0)<=32||c.charCodeAt(0)===127);
 if(typeof value!=='string'||!value.startsWith('/')||unsafe(value))return null;
 try{const decoded=decodeURIComponent(value);if(unsafe(decoded))return null;
 const url=new URL(value,'https://local.invalid'),decodedPath=decodeURIComponent(url.pathname);
  let end=decodedPath.length;
  while(end>0&&decodedPath.charCodeAt(end-1)===47)end--;
  const path=decodedPath.slice(0,end).toLowerCase();
 if(url.origin!=='https://local.invalid'||path==='/login')return null;
 return url.pathname+url.search+url.hash;}catch{return null}
}

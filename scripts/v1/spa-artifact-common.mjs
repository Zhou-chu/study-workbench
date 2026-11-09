/** Pure source/artifact gates. Never opens a socket or reads ambient credentials. */
import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,open,readdir,writeFile,mkdir,rename,cp} from 'node:fs/promises';
import {execFileSync,spawnSync} from 'node:child_process';
import {builtinModules} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const MANIFEST='spa-artifact-manifest.json', INVENTORY='artifact-inventory.json';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const canonical=value=>JSON.stringify(sort(value));
function sort(v){return Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;}
export const digest=value=>sha(canonical(value));
export function safePath(name){
 if(typeof name!=='string'||!name||name.length>512||name.includes('\\')||name.startsWith('/')||name.split('/').some(p=>!p||p==='.'||p==='..'||!/^[-A-Za-z0-9_@.]+$/.test(p)||/^(?:\.|node_modules$|private(?:\.|$)|secrets?(?:\.|$)|credentials?(?:\.|$)|browser[-_]profile)/i.test(p)||/\.(?:pem|key|secret|sqlite3?|db|p12|pfx)$/i.test(p)))throw Error('unsafe/private path');
 return name;
}
async function noLinks(filename){let p=path.resolve(filename);while(true){const s=await lstat(p);if(s.isSymbolicLink())throw Error('symlink path');const parent=path.dirname(p);if(parent===p)return;p=parent;}}
export async function bytes(filename,scan=true){
 await noLinks(filename); const h=await open(filename,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const s=await h.stat();if(!s.isFile()||s.size>32*1024*1024)throw Error('special/oversized file');const b=await h.readFile();if(b.length!==s.size)throw Error('file changed');
 if(scan&&/PRIVATE_SENTINEL|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|(?:sk-proj-|sk_live_)[A-Za-z0-9]{16}/.test(b.toString()))throw Error('private sentinel');
 return {data:b,mode:(s.mode&0o111)?'0755':'0644'};}finally{await h.close();}
}
export async function inventory(root,{metadata=false}={}){
 await noLinks(root);if(!(await lstat(root)).isDirectory())throw Error('expected directory');
 const rows=[];let total=0;
 async function walk(dir,prefix=''){for(const name of (await readdir(dir)).sort()){
  const relative=safePath(prefix+name),full=path.join(dir,name),s=await lstat(full);
  if(s.isSymbolicLink())throw Error('symlink payload');if(s.isDirectory()){await walk(full,relative+'/');continue;}
  const b=await bytes(full);total+=b.data.length;if(rows.length>=20000||total>256*1024*1024)throw Error('inventory limit');
  if(!metadata&&[MANIFEST,INVENTORY].includes(relative))continue;
  rows.push({path:relative,size:b.data.length,mode:b.mode,sha256:sha(b.data)});
 }}await walk(root);return rows.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
}
function keys(v,wanted){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join()!==[...wanted].sort().join())throw Error('malformed schema');}
const hashes=['authored_digest','asset_digest','contract_digest'];
export function validateManifest(m){
 keys(m,['schema_version','source_commit',...hashes,'ui_transport_protocol','supported_contracts']);
 if(m.schema_version!=='spa-artifact-v1'||!/^[a-f0-9]{40}$/.test(m.source_commit)||hashes.some(k=>!/^[a-f0-9]{64}$/.test(m[k]))||m.ui_transport_protocol!==1||canonical(m.supported_contracts)!=='["workspace-view-v1"]')throw Error('malformed manifest');
}
function validateRows(rows,authored=false){
 if(!Array.isArray(rows)||!rows.length||rows.length>20000)throw Error('invalid inventory');
 let previous='';
 for(const r of rows){keys(r,['path','size','mode','sha256']);if(!(authored&&r.path==='.dockerignore'))safePath(r.path);if(r.path<=previous||!Number.isSafeInteger(r.size)||r.size<0||r.size>32*1024*1024||!['0644','0755'].includes(r.mode)||!/^[a-f0-9]{64}$/.test(r.sha256))throw Error('invalid inventory entry');previous=r.path;}
}
const git=(...args)=>execFileSync('git',args,{cwd:ROOT,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
export const sourceCommit=()=>git('rev-parse','HEAD');
export function cleanSource(){if(git('status','--porcelain','--untracked-files=all'))throw Error('clean committed source required');return sourceCommit();}
export function authoredPaths(kind){
 if(!['web','bff'].includes(kind))throw Error('artifact kind');
 const roots=['package.json','package-lock.json','tsconfig.base.json','contracts/v1/openapi.json','packages/contracts','deploy/v1','scripts/v1/spa-artifact-common.mjs','scripts/v1/check_spa_artifacts.py','scripts/v1/container_check.py','.dockerignore','apps/'+kind];
 if(kind==='web')roots.push('packages/domain','packages/web-transport');
 return git('ls-files','-z','--',...roots).split('\0').filter(Boolean).filter(p=>!p.includes('/dist/')).sort();
}
export async function authoredInventory(kind){
 const rows=[];
 for(const name of authoredPaths(kind)){const b=await bytes(path.join(ROOT,name),false);rows.push({path:name,size:b.data.length,mode:b.mode,sha256:sha(b.data)});}
 return rows;
}
export async function verifyBffClosure(root){
 const files=await inventory(root);const names=new Set(files.map(x=>x.path));
 const pkg=JSON.parse((await bytes(path.join(root,'package.json'))).data);
 if(canonical(pkg)!==canonical({type:'module',private:true}))throw Error('BFF package closure');
 if(!names.has('cli.js')||!names.has('server.js'))throw Error('missing BFF entry closure');
 for(const r of files){
  if(['package.json','artifact-identity.json'].includes(r.path))continue;
  if(!r.path.endsWith('.js'))throw Error('unexpected BFF closure payload');
  const code=(await bytes(path.join(root,r.path))).data.toString();
  if(/\b(?:require|eval)\s*\(|\bimport\s*\(|\bFunction\s*\(/.test(code))throw Error('dynamic dependency closure');
  for(const m of code.matchAll(/(?:\bfrom\s*|\bimport\s*)['"]([^'"]+)['"]/g)){
   const spec=m[1];
   if(spec.startsWith('node:')&&builtinModules.includes(spec.slice(5)))continue;
   if(!spec.startsWith('./')||!spec.endsWith('.js')||!names.has(path.posix.join(path.posix.dirname(r.path),spec)))throw Error('external or missing import closure');
  }
 }
}
export async function finishArtifact(root,kind,identity,authored){
 const assets=await inventory(root);
 const manifest={schema_version:'spa-artifact-v1',source_commit:identity.source_commit,authored_digest:digest(authored),asset_digest:digest(assets),contract_digest:identity.contract_digest,ui_transport_protocol:1,supported_contracts:['workspace-view-v1']};
 const receipt={schema_version:'spa-inventory-v1',kind,release_slot:identity.release_slot,authored,assets};
 await writeFile(path.join(root,MANIFEST),canonical(manifest)+'\n',{flag:'wx'});
 await writeFile(path.join(root,INVENTORY),canonical(receipt)+'\n',{flag:'wx'});
 await verifyArtifact(root,{kind});return manifest;
}
export async function verifyArtifact(root,{kind,contract,source=false}={}){
 const m=await readCanonical(path.join(root,MANIFEST));validateManifest(m);
 const i=await readCanonical(path.join(root,INVENTORY));
 keys(i,['schema_version','kind','release_slot','authored','assets']);
 if(i.schema_version!=='spa-inventory-v1'||!['web','bff'].includes(i.kind)||kind&&kind!==i.kind||!/^[a-z0-9][a-z0-9-]{15,79}$/.test(i.release_slot))throw Error('invalid association');
 validateRows(i.authored,true);validateRows(i.assets);
 if(digest(i.authored)!==m.authored_digest||digest(i.assets)!==m.asset_digest||canonical(await inventory(root))!==canonical(i.assets))throw Error('payload inventory mismatch');
 const own=await readCanonical(path.join(root,'artifact-identity.json'));
 const expected={release_slot:i.release_slot,source_commit:m.source_commit,authored_digest:m.authored_digest,contract_digest:m.contract_digest,ui_transport_protocol:1,supported_contracts:['workspace-view-v1']};
 if(canonical(own)!==canonical(expected))throw Error('immutable association mismatch');
 if(contract&&sha((await bytes(contract)).data)!==m.contract_digest)throw Error('wrong contract');
 if(source&&(cleanSource()!==m.source_commit||canonical(await authoredInventory(i.kind))!==canonical(i.authored)))throw Error('wrong source snapshot');
 if(i.kind==='bff')await verifyBffClosure(root);
 else{
  const index=(await bytes(path.join(root,'index.html'))).data.toString();
  const prefix='/_spa/releases/'+i.release_slot+'/';
  const scripts=[...index.matchAll(/(?:src|href)="([^"]+)"/g)].map(m=>m[1]);
  if(!scripts.some(s=>s.startsWith(prefix+'assets/')&&s.endsWith('.js'))||scripts.some(s=>!s.startsWith(prefix)))throw Error('index association');
  for(const src of scripts)if(!i.assets.some(a=>a.path===src.slice(prefix.length)))throw Error('missing index asset');
  const code=await Promise.all(i.assets.filter(a=>a.path.startsWith('assets/')&&a.path.endsWith('.js')).map(async a=>(await bytes(path.join(root,a.path))).data.toString()));
  if(!code.some(c=>c.includes(i.release_slot)&&c.includes(m.source_commit)&&c.includes(m.authored_digest)&&c.includes(m.contract_digest)))throw Error('missing executable association');
 }
 return {manifest:m,inventory:i};
}
export async function beginBuild(kind,slot){
 const app=path.join(ROOT,'apps',kind),out=path.join(app,'dist');
 // Archive previous success before any validation/build; failed attempts cannot leave a stale success at dist.
 try{await noLinks(out);await mkdir(path.join(app,'build'),{recursive:true});await rename(out,path.join(app,'build','previous-'+randomUUID()));}catch(e){if(e.code!=='ENOENT')throw e;}
 const commit=cleanSource(),authored=await authoredInventory(kind);
 slot=slot??commit.slice(0,12)+'-'+randomUUID();
 if(!/^[a-z0-9][a-z0-9-]{15,79}$/.test(slot))throw Error('invalid release slot');
 const slots=path.join(app,'build','slots');await mkdir(slots,{recursive:true});await writeFile(path.join(slots,slot),'reserved\n',{flag:'wx'});
 const candidate=path.join(app,'build','candidate-'+randomUUID());await mkdir(candidate,{recursive:true});
 const identity={release_slot:slot,source_commit:commit,authored_digest:digest(authored),contract_digest:sha((await bytes(path.join(ROOT,'contracts/v1/openapi.json'))).data),ui_transport_protocol:1,supported_contracts:['workspace-view-v1']};
 return {app,out,candidate,identity,authored,async finish(){
  if(cleanSource()!==commit||canonical(await authoredInventory(kind))!==canonical(authored))throw Error('source drift during build');
  await writeFile(path.join(candidate,'artifact-identity.json'),canonical(identity)+'\n',{flag:'wx'});
  const m=await finishArtifact(candidate,kind,identity,authored);await rename(candidate,out);return m;
 }};
}
export function runNode(args,cwd,extra={}){
 const result=spawnSync(process.execPath,args,{cwd,stdio:'inherit',env:{PATH:path.dirname(process.execPath)+':/usr/bin:/bin',HOME:cwd,LANG:'C.UTF-8',TZ:'UTC',NODE_ENV:'production',NPM_CONFIG_OFFLINE:'true',...extra}});
 if(result.status!==0)throw Error('build command failed');
}
export async function stageGateway(output,artifacts){
 if(!artifacts.length)throw Error('retained client window required');
 // Never replace a former gateway staging success. Caller chooses a fresh directory.
 await mkdir(output,{recursive:false});
 const seen=new Map(),slots=new Set();
 for(const artifact of artifacts){
  const verified=await verifyArtifact(artifact,{kind:'web'}),slot=verified.inventory.release_slot;
  if(slots.has(slot))throw Error('reused release slot');slots.add(slot);
  for(const row of verified.inventory.assets){
   if(!row.path.startsWith('assets/')&&!row.path.startsWith('pdfjs/'))continue;
   const old=seen.get(row.path);if(old&&old!==row.sha256)throw Error('retained path collision');seen.set(row.path,row.sha256);
  }
  await cp(artifact,path.join(output,'_spa/releases',slot),{recursive:true,errorOnExist:true,force:false});
  if(canonical(await verifyArtifact(path.join(output,'_spa/releases',slot)))!==canonical(verified))throw Error('retained artifact drift');
 }
 const current=artifacts[0];await cp(path.join(current,'index.html'),path.join(output,'index.html'));
 await cp(path.join(current,'pdfjs'),path.join(output,'pdfjs'),{recursive:true});
 await writeFile(path.join(output,'client-window.json'),canonical({schema_version:'spa-client-window-v1',current:(await verifyArtifact(current)).inventory.release_slot,retained:[...slots]})+'\n',{flag:'wx'});
 await verifyGateway(output);
}

export async function readCanonical(filename){
 const raw=(await bytes(filename)).data.toString(),value=JSON.parse(raw);
 if(raw!==canonical(value)+'\n')throw Error('noncanonical/duplicate metadata');
 return value;
}
export async function verifyGateway(root){
 const window=await readCanonical(path.join(root,'client-window.json'));
 keys(window,['schema_version','current','retained']);
 if(window.schema_version!=='spa-client-window-v1'||!Array.isArray(window.retained)||!window.retained.length||window.retained[0]!==window.current||new Set(window.retained).size!==window.retained.length)throw Error('invalid retained window');
 const expected=[],seen=new Map();
 for(const slot of window.retained){
  if(typeof slot!=='string'||!/^[a-z0-9][a-z0-9-]{15,79}$/.test(slot))throw Error('invalid release slot');
  const relative='_spa/releases/'+slot,source=path.join(root,relative),checked=await verifyArtifact(source,{kind:'web'});
  if(checked.inventory.release_slot!==slot)throw Error('slot association mismatch');
  for(const entry of await inventory(source,{metadata:true})){
   expected.push({...entry,path:relative+'/'+entry.path});
   if(entry.path.startsWith('assets/')||entry.path.startsWith('pdfjs/')){
    const before=seen.get(entry.path);if(before&&before!==entry.sha256)throw Error('retained path collision');seen.set(entry.path,entry.sha256);
   }
   if(slot===window.current&&(entry.path==='index.html'||entry.path.startsWith('pdfjs/')))expected.push(entry);
  }
 }
 const windowBytes=await bytes(path.join(root,'client-window.json'));
 expected.push({path:'client-window.json',mode:windowBytes.mode,size:windowBytes.data.length,sha256:sha(windowBytes.data)});
 expected.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 if(canonical(await inventory(root,{metadata:true}))!==canonical(expected))throw Error('gateway payload inventory mismatch');
 return window;
}

export async function rebuildPackages(kind){
 for(const name of kind==='web'?['contracts','domain','web-transport']:['contracts']){
  const root=path.join(ROOT,'packages',name),dist=path.join(root,'dist');
  try{await noLinks(dist);await mkdir(path.join(root,'build'),{recursive:true});await rename(dist,path.join(root,'build','previous-'+randomUUID()));}catch(e){if(e.code!=='ENOENT')throw e;}
  runNode([path.join(ROOT,'node_modules/typescript/bin/tsc'),'--project','tsconfig.build.json'],root);
 }
}

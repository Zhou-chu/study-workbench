/** Adapted from the retained frontend asset/inventory gate. No deletion or network fetch. */
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const VERSION='6.4.299', MAX_FILE=16*1024*1024, MAX_TOTAL=64*1024*1024, MAX_FILES=1024;
const sha=b=>createHash('sha256').update(b).digest('hex');
async function noSymlinkPath(filename){let current=path.resolve(filename);while(true){try{if((await lstat(current)).isSymbolicLink())throw new Error('symlink path rejected');}catch(e){if(e.code!=='ENOENT')throw e;}const parent=path.dirname(current);if(parent===current)return;current=parent;}}
async function regularBytes(filename){await noSymlinkPath(filename);const handle=await open(filename,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{const stat=await handle.stat();if(!stat.isFile()||stat.size>MAX_FILE)throw new Error('expected bounded regular file');const buffer=Buffer.alloc(stat.size+1);let offset=0;while(offset<buffer.length){const {bytesRead}=await handle.read(buffer,offset,buffer.length-offset,null);if(!bytesRead)break;offset+=bytesRead;}if(offset!==stat.size)throw new Error('bounded file changed during read');return {bytes:buffer.subarray(0,offset),executable:stat.mode&0o111};}finally{await handle.close();}}
function safeName(name){if(name.startsWith('.')||/^(private|secrets|credentials)(\.|$)/i.test(name)||/\.(secret|pem|key|p12|pfx)$/i.test(name))throw new Error('private resource rejected');}
async function inventory(root){await noSymlinkPath(root);const files={};let total=0;async function walk(directory,prefix=''){for(const name of (await readdir(directory)).sort()){safeName(name);const relative=prefix?prefix+'/'+name:name,full=path.join(directory,name),stat=await lstat(full);if(stat.isSymbolicLink())throw new Error('symlink resource rejected');if(stat.isDirectory())await walk(full,relative);else{const value=await regularBytes(full);total+=value.bytes.length;if(total>MAX_TOTAL||Object.keys(files).length>=MAX_FILES)throw new Error('bounded resource inventory exceeded');files[relative]={sha256:sha(value.bytes),size:value.bytes.length,executable:value.executable};}}}await walk(root);return files;}
const canonical=files=>Object.fromEntries(Object.entries(files).sort(([a],[b])=>a.localeCompare(b)));
export async function preparePdfAssets({source,destination,checkOnly=false}){
 source=path.resolve(source);destination=path.resolve(destination);await noSymlinkPath(source);await noSymlinkPath(destination);
 const manifest=JSON.parse((await regularBytes(path.join(source,'package.json'))).bytes.toString());if(manifest.version!==VERSION)throw new Error('unexpected PDF.js version');
 const files={},sources={};for(const folder of ['cmaps','standard_fonts','wasm'])for(const [name,value] of Object.entries(await inventory(path.join(source,folder)))){files[folder+'/'+name]=value;sources[folder+'/'+name]=path.join(source,folder,name);}
 for(const [name,relative] of [['LICENSE','LICENSE'],['pdf.worker.min.mjs','build/pdf.worker.min.mjs']]){const value=await regularBytes(path.join(source,relative));files[name]={sha256:sha(value.bytes),size:value.bytes.length,executable:value.executable};sources[name]=path.join(source,relative);}
 if(!(await regularBytes(path.join(source,'LICENSE'))).bytes.toString().includes('Apache License'))throw new Error('PDF.js license missing');
 const expected={version:VERSION,files:canonical(files)};let existing=false;try{await lstat(destination);existing=true;}catch(e){if(e.code!=='ENOENT')throw e;}
 if(existing){const found=await inventory(destination);if(!found['manifest.json'])throw new Error('unowned generated destination');delete found['manifest.json'];const saved=JSON.parse((await regularBytes(path.join(destination,'manifest.json'))).bytes.toString());if(JSON.stringify(canonical(found))!==JSON.stringify(expected.files)||JSON.stringify(saved)!==JSON.stringify(expected))throw new Error('generated PDF assets drift');return expected;}
 if(checkOnly)throw new Error('generated PDF assets missing');await mkdir(destination,{recursive:true});
 for(const [name,file] of Object.entries(sources)){const target=path.join(destination,name);await mkdir(path.dirname(target),{recursive:true});await noSymlinkPath(target);const value=await regularBytes(file);if(sha(value.bytes)!==files[name].sha256)throw new Error('source resource drift');await writeFile(target,value.bytes,{flag:'wx',mode:0o644|files[name].executable});}
 await writeFile(path.join(destination,'manifest.json'),JSON.stringify(expected),{flag:'wx'});return preparePdfAssets({source,destination,checkOnly:true});
}
const entry=process.argv[1]&&path.resolve(process.argv[1]);if(entry===fileURLToPath(import.meta.url)){const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');const require=createRequire(path.join(root,'package.json'));const source=path.dirname(require.resolve('pdfjs-dist/package.json'));const result=await preparePdfAssets({source,destination:path.join(root,'public/pdfjs',VERSION),checkOnly:process.argv.includes('--check')});console.log(`Verified PDF.js ${result.version}: ${Object.keys(result.files).length} generated assets, SHA256 and bundled licenses`);}

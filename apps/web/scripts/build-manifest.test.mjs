import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const artifact = await import('./build-manifest.mjs').catch(()=>({}));
const common = await import('../../../scripts/v1/spa-artifact-common.mjs').catch(()=>({}));
test('Web manifest producer and verifier are independent callable file gates',()=>{
 assert.equal(typeof artifact.buildWeb,'function'); assert.equal(typeof common.verifyArtifact,'function');
});
test('canonical payload inventory rejects missing, extra, private, symlink and special bytes',async()=>{
 assert.equal(typeof common.inventory,'function');
 const root=await mkdtemp(path.join(tmpdir(),'c1-payload-'));
 try {
  await mkdir(path.join(root,'assets')); await writeFile(path.join(root,'assets/a.js'),'export default 1;');
  const original=await common.inventory(root);
  assert.equal(original.length,1);
  await writeFile(path.join(root,'assets/b.js'),'extra');
  assert.notDeepEqual(await common.inventory(root),original);
  await writeFile(path.join(root,'.env'),'PRIVATE_SENTINEL');
  await assert.rejects(common.inventory(root),/private|unsafe/i);
  await rm(path.join(root,'.env')); await symlink('a.js',path.join(root,'assets/link.js'));
  await assert.rejects(common.inventory(root),/symlink/i);
 } finally {await rm(root,{recursive:true,force:true});}
});
test('canonical inventory digest measures sizes, modes, bytes and sorted paths',()=>{
 assert.equal(typeof common.digest,'function');
 assert.equal(common.digest({b:2,a:1}),common.digest({a:1,b:2}));
 assert.notEqual(common.digest([{path:'a',size:1,mode:'0644',sha256:'a'}]),common.digest([{path:'a',size:1,mode:'0755',sha256:'a'}]));
});

async function fixtureWeb(base,slot,suffix='a',pdf='pdf'){
 const root=path.join(base,slot);await mkdir(path.join(root,'assets'),{recursive:true});await mkdir(path.join(root,'pdfjs/6.4.299'),{recursive:true});
 const authored=[{path:'source.js',size:1,mode:'0644',sha256:'a'.repeat(64)}];
 const identity={release_slot:slot,source_commit:'b'.repeat(40),authored_digest:common.digest(authored),contract_digest:'c'.repeat(64),ui_transport_protocol:1,supported_contracts:['workspace-view-v1']};
 await writeFile(path.join(root,'artifact-identity.json'),common.canonical(identity)+'\n');
 await writeFile(path.join(root,'assets',suffix+'-12345678.js'),'const identity='+JSON.stringify(identity));
 await writeFile(path.join(root,'index.html'),'<script src="/_spa/releases/'+slot+'/assets/'+suffix+'-12345678.js"></script>');
 await writeFile(path.join(root,'pdfjs/6.4.299/file.bcmap'),pdf);
 await common.finishArtifact(root,'web',identity,authored);return root;
}
test('retains exact release manifests/assets, rejects reused slots and PDF/hash collisions',async()=>{
 assert.equal(typeof common.verifyGateway,'function');
 const root=await mkdtemp(path.join(tmpdir(),'c1-retain-'));
 try{
  const first=await fixtureWeb(root,'synthetic-release-001','a'),second=await fixtureWeb(root,'synthetic-release-002','b');
  const output=path.join(root,'gateway');await common.stageGateway(output,[first,second]);
  await common.verifyGateway(output);
  await writeFile(path.join(output,'extra.js'),'unmeasured');
  await assert.rejects(common.verifyGateway(output),/inventory|extra|payload/);
  await assert.rejects(common.stageGateway(path.join(root,'reuse'),[first,first]),/reused/);
  const collision=await fixtureWeb(root,'synthetic-release-003','c','different');
  await assert.rejects(common.stageGateway(path.join(root,'pdf-collision'),[first,collision]),/collision/);
  const hashCollision=await fixtureWeb(root,'synthetic-release-004','a');
  await assert.rejects(common.stageGateway(path.join(root,'hash-collision'),[first,hashCollision]),/collision/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('Node verifier rejects duplicate/noncanonical manifests and undeclared files',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'c1-schema-'));
 try{
  const artifact=await fixtureWeb(root,'synthetic-release-005');
  const {readFile}=await import('node:fs/promises');const p=path.join(artifact,'spa-artifact-manifest.json'),saved=await readFile(p,'utf8');
  await writeFile(p,saved.replace('{"','{"schema_version":"spa-artifact-v1","'));
  await assert.rejects(common.verifyArtifact(artifact),/canonical|schema/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('gateway packaging checks the selected current contract without replacing retained identities',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'c1-contract-'));
 try{
  const artifact=await fixtureWeb(root,'synthetic-release-006');
  const output=path.join(root,'gateway');await common.stageGateway(output,[artifact]);
  const contract=path.join(root,'openapi.json');await writeFile(contract,'wrong');
  await assert.rejects(common.verifyGateway(output,{contract}),/contract/);
 }finally{await rm(root,{recursive:true,force:true});}
});

/** Pure explicit-file planning only. Callers must independently validate selection. */
export const unitPartitions = Object.freeze({
 contracts:'packages/contracts',domain:'packages/domain','web-transport':'packages/web-transport',
 bff:'apps/bff',web:'apps/web','legacy-web':'frontend','node-tools':null,
 'legacy-node-tools':null,'deployment-config':'.','quality-tooling':'.','quality-configs':null,
});
function safeFile(path) {
 return typeof path==='string' && path && !path.startsWith('/') && !/[\\*?{}()[\]!]/.test(path)
  && path.split('/').every(part=>part && part!=='.' && part!=='..');
}
export function planUnitPartitions(files) {
 if(!Array.isArray(files)||!files.length||files.some(file=>!safeFile(file))||new Set(files).size!==files.length)
  throw Error('Invalid/empty explicit unit file selection');
 const partitions=Object.fromEntries(Object.keys(unitPartitions).map(name=>[name,[]]));
 const pythonFiles=[];
 for(const file of [...files].sort()){
  if(/^tests\/(?:.*\/)?(?:test_.*|.*_test)\.py$/.test(file)){pythonFiles.push(file);continue;}
  let name;
  for(const [partition,directory] of Object.entries(unitPartitions)){
   if(directory && directory!=='.' && file.startsWith(directory+'/')
    && /\/(?:src|test)\/.*\.(?:test|spec)\.(?:ts|tsx|js|jsx)$/.test(file))name=partition;
  }
  if(/^apps\/(?:bff|web)\/scripts\/[^/]+\.test\.mjs$/.test(file))name='node-tools';
  if(/^frontend\/scripts\/[^/]+\.test\.mjs$/.test(file))name='legacy-node-tools';
  if(/^scripts\/tests\/deployment\/[^/]+\.test\.ts$/.test(file))name='deployment-config';
  if(/^scripts\/tests\/quality\/[^/]+\.test\.ts$/.test(file))name='quality-tooling';
  if(file==='scripts/tests/quality/config-node.test.mjs')name='quality-configs';
  if(!name)throw Error('Unsupported explicit unit runner file: '+file);
  partitions[name].push(file);
 }
 return {partitions,pythonFiles};
}
export function unitVitestConfig(base, files) {
 if(!base || typeof base!=='object' || Array.isArray(base) || !base.test?.coverage
  || !Array.isArray(files) || files.some(file=>!safeFile(file)))throw Error('Invalid explicit Vitest unit configuration');
 return {...base,test:{...base.test,include:[...files],passWithNoTests:true}};
}

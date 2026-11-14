import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
// Preserve default Array.sort UTF-16 ordering, independent of locale.
function comparePaths(left, right) {
 if (left < right) return -1;
 if (left > right) return 1;
 return 0;
}
export function qualityConfigFiles(root) {
 return ['apps/web/vite.config.ts','frontend/vitest.config.ts','scripts/coverage-quality.config.ts'].map(file=>resolve(root,file)).sort(comparePaths);
}
export function qualityToolingFiles(root) {
 const scripts=resolve(root,'scripts');
 const helpers=existsSync(scripts)?readdirSync(scripts).filter(name=>/^coverage-.*\.(?:mjs|ts)$/.test(name)&&!/(?:\.test\.|\.d\.ts$)/.test(name)).map(name=>'scripts/'+name):[];
 const configs=['apps/web/coverage.config.ts','apps/bff/coverage.config.ts','packages/contracts/coverage.config.ts','packages/domain/coverage.config.ts','packages/web-transport/coverage.config.ts','frontend/coverage.config.ts','apps/web/vite.config.ts','eslint.config.mjs','frontend/eslint.config.mjs','frontend/postcss.config.mjs','frontend/vitest.config.ts'];
 return [...helpers,...configs].filter(file=>existsSync(resolve(root,file))).map(file=>resolve(root,file)).filter(file=>!qualityConfigFiles(root).includes(file)).sort(comparePaths);
}
export function inventory(root,partition,directory) {
 if(partition==='quality-configs')return qualityConfigFiles(root);
 if(partition==='quality-tooling')return qualityToolingFiles(root);
 if(partition==='deployment-config')return ['examples/easypanel/index.ts','frontend/next.config.ts'].map(file=>resolve(root,file)).sort(comparePaths);
 const roots=partition==='node-tools'?['apps/bff/scripts','apps/web/scripts','scripts/v1']:partition==='legacy-node-tools'?['frontend/scripts']: [directory+'/src'];
 const files=[];
 function walk(path){for(const item of readdirSync(path,{withFileTypes:true})){const file=resolve(path,item.name);if(item.isDirectory())walk(file);else if(/\.(?:[cm]?js|jsx|tsx?)$/.test(file)&&!/(?:\.test\.|\.spec\.|\.d\.ts$)/.test(file)&&!((partition==='web'||partition==='legacy-web')&&relative(resolve(root,directory),file).replaceAll('\\','/').startsWith('src/test/')))files.push(file);}}
 for(const path of roots)if(existsSync(resolve(root,path)))walk(resolve(root,path));
 if(partition==='node-tools')files.push(resolve(root,'apps/web/public/theme-bootstrap.js'));
 if(partition==='legacy-node-tools')files.push(resolve(root,'frontend/start-server.js'));
 return files.sort(comparePaths);
}
export function auditReport(root,partition,directory) {
 const path=resolve(root,'coverage',partition,'coverage-summary.json');
 const expected=inventory(root,partition,directory);
 const summary=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):{};
 const actual=new Set(Object.keys(summary).filter(key=>key!=='total').map(key=>resolve(key)));
 return {expectedSourceFiles:expected.length,reportedSourceFiles:actual.size,missing:expected.filter(file=>!actual.has(file)).map(file=>relative(root,file)),unexpected:[...actual].filter(file=>!expected.includes(file)).map(file=>relative(root,file))};
}

export function sourceDigest(root,partition,directory) {
 const hash=createHash('sha256');
 for(const file of inventory(root,partition,directory)){hash.update(relative(root,file));hash.update(readFileSync(file));}
 return hash.digest('hex');
}

import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
export function coverageEnvironment(run,inherited){
 const env={};
 for(const key of ['PATH','LANG','LC_ALL','LC_CTYPE','SYSTEMROOT','COMSPEC','PATHEXT'])if(inherited[key]!==undefined)env[key]=inherited[key];
 for(const [key,directory] of Object.entries({HOME:'home',USERPROFILE:'home',APPDATA:'home/config',LOCALAPPDATA:'home/local',XDG_CONFIG_HOME:'home/config',XDG_CACHE_HOME:'cache',XDG_DATA_HOME:'home/data',XDG_RUNTIME_DIR:'runtime',TMPDIR:'tmp',TMP:'tmp',TEMP:'tmp',OPEN_NOTEBOOK_DATA_DIR:'application',STUDY_WORKBENCH_DATA_DIR:'personal',STUDY_WORKBENCH_RUNTIME_DIR:'runtime',NOTEBOOKLM_HOME:'notebooklm'})){
  env[key]=resolve(run,directory);mkdirSync(env[key],{recursive:true});
 }
 Object.assign(env,{NODE_ENV:'test',TZ:'UTC',CI:'1',NO_COLOR:'1',NEXT_TELEMETRY_DISABLED:'1',PYTHON_DOTENV_DISABLED:'1',NOTEBOOKLM_STORAGE_PATH:resolve(run,'notebooklm/storage_state.json'),DOTENV_CONFIG_PATH:resolve(run,'absent.env')});
 return env;
}

import {useQuery} from '@tanstack/react-query';
import {Link} from 'react-router';
import {useMemo} from 'react';
import {readTurnContext,sessionCoordinator} from '@study/web-transport';
import {useAppData} from '../../app/providers';
import {useWorkbenchSnapshot} from '../../app/WorkbenchSession';
import {createSettingsApi} from '../../data/settings-api';
import {useI18n} from '../../i18n';
/** The one safe credential/env projection, reusable by later credential screens. */
export function useSetupMetadata(){const {transport}=useAppData(),{state}=useWorkbenchSnapshot(),context=readTurnContext();const api=useMemo(()=>transport?createSettingsApi(transport):null,[transport]);
 return useQuery({queryKey:['setup-metadata',context?.epoch,sessionCoordinator.current()],enabled:!!api&&!!context?.ready&&state?.ready===true,queryFn:()=>api!.setup(context!),staleTime:Infinity,retry:false,refetchOnMount:false,refetchOnWindowFocus:false,refetchOnReconnect:false})}
export function SetupWarning(){const {t}=useI18n(),read=useSetupMetadata();
 if(read.isPending)return <p className="setup-warning" role="status">{t.common.loading}</p>;
 if(read.isError)return <p className="setup-warning" role="status">{t.common.error}</p>;
 const data=read.data;if(!data)return null;
 const count=Object.keys(data.environment).filter(k=>data.environment[k]&&data.source[k]==='environment').length;
 if(data.encryption_configured&&!count)return null;
 return <aside className="setup-warning" role="status"><h2>{data.encryption_configured?t.setupBanner.migrationAvailable:t.setupBanner.encryptionRequired}</h2><p>{data.encryption_configured?t.setupBanner.migrationDescription.replace('{{count}}',String(count)):t.setupBanner.encryptionRequiredDescription}</p><Link className="button" to="/settings/models">{t.setupBanner.goToSettings}</Link>{!data.encryption_configured&&<a className="button" href="https://github.com/lfnovo/open-notebook/blob/main/docs/3-USER-GUIDE/api-configuration.md#encryption-setup" target="_blank" rel="noopener noreferrer">{t.setupBanner.viewDocs}</a>}</aside>;
}

import { beforeEach, expect, it, vi } from 'vitest';
import { generate } from '../../../examples/easypanel/index';
import { randomPassword, randomString } from '~templates-utils';
vi.mock('~templates-utils',()=>({randomPassword:vi.fn(),randomString:vi.fn()}));
const base={appServiceName:'research',appServiceImage:'example/app:v1',databaseServiceName:'database',databaseServiceImage:'example/db:v2'};
beforeEach(()=>{vi.resetAllMocks();vi.mocked(randomString).mockReturnValue('test-encryption');});
it.each([undefined,''])('generates a blank/absent app password separately from database password (%s)',(appPassword)=>{
 vi.mocked(randomPassword).mockReturnValueOnce('app-generated').mockReturnValueOnce('db-generated');
 const result=generate({...base,appPassword});
 expect(randomPassword).toHaveBeenCalledTimes(2);
 expect(result.services[1].data.env).toContain('OPEN_NOTEBOOK_PASSWORD=app-generated');
 expect(result.services[1].data.env).toContain('SURREAL_PASSWORD=db-generated');
 expect(result.services[0].data.deploy?.command).toContain('--pass db-generated');
});
it.each(['chosen-password','  preserved  '])('preserves a supplied password without generating a replacement (%s)',(appPassword)=>{
 vi.mocked(randomPassword).mockReturnValue('db-secret');
 const result=generate({...base,appPassword});
 expect(randomPassword).toHaveBeenCalledTimes(1);
 expect(randomString).toHaveBeenCalledExactlyOnceWith(64);
 expect(result).toEqual({services:[
 {type:'app',data:{serviceName:'database',env:'SURREAL_EXPERIMENTAL_GRAPHQL=true',source:{type:'image',image:'example/db:v2'},
 deploy:{command:'start --log info --user root --pass db-secret --bind 0.0.0.0:8000 rocksdb:/mydata/mydatabase.db'},
 mounts:[{type:'volume',name:'surreal-data',mountPath:'/mydata'}]}},
 {type:'app',data:{serviceName:'research',source:{type:'image',image:'example/app:v1'},
 env:['API_URL=https://$(PRIMARY_DOMAIN)','INTERNAL_API_URL=http://localhost:5055','OPEN_NOTEBOOK_ENCRYPTION_KEY=test-encryption',
 'OPEN_NOTEBOOK_PASSWORD='+appPassword,'SURREAL_URL=ws://$(PROJECT_NAME)_database:8000/rpc','SURREAL_USER=root','SURREAL_PASSWORD=db-secret','SURREAL_NAMESPACE=open_notebook','SURREAL_DATABASE=open_notebook'].join('\n'),
 domains:[{host:'$(EASYPANEL_DOMAIN)',port:8502}],mounts:[{type:'volume',name:'notebook-data',mountPath:'/app/data'}]}}
 ]});
 expect(base).toEqual({appServiceName:'research',appServiceImage:'example/app:v1',databaseServiceName:'database',databaseServiceImage:'example/db:v2'});
});

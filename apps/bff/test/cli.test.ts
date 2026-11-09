import {it,expect,vi} from 'vitest';
import * as cli from '../src/cli';
it('uses only supported literal socket hosts and a bounded port',()=>{
 expect(typeof cli.listenAddress).toBe('function');
 expect(cli.listenAddress({})).toEqual({port:3000,host:'127.0.0.1'});
 expect(cli.listenAddress({STUDY_WORKBENCH_BFF_LISTEN_HOST:'0.0.0.0',PORT:'3000'})).toEqual({port:3000,host:'0.0.0.0'});
 for(const host of ['localhost','::','[::1]','https://evil.test','0.0.0.0 ','']){
  expect(()=>cli.listenAddress({STUDY_WORKBENCH_BFF_LISTEN_HOST:host})).toThrow();
 }
 for(const port of ['0','65536','-1','1e3','3000x'])expect(()=>cli.listenAddress({PORT:port})).toThrow();
});
it('importing the CLI and constructors does not start a listener',async()=>{
 const http=await import('node:http');const listen=vi.spyOn(http.Server.prototype,'listen');
 await import('../src/cli');await import('../src/server');
 expect(listen).not.toHaveBeenCalled();listen.mockRestore();
});

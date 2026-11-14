// Test-only stand-in for EasyPanel's injected platform module; never deploys.
export type Services = Array<{type:string;data:{serviceName:string;env:string;source:{type:string;image:string};deploy?:{command:string};mounts:Array<{type:string;name:string;mountPath:string}>;domains?:Array<{host:string;port:number}>}}>;
export type Output = {services:Services};
export function randomPassword():string { throw new Error('randomPassword must be mocked'); }
export function randomString(_length:number):string { throw new Error('randomString must be mocked'); }

import type {RebuildStatus} from '../../data/advanced-contracts';
/** A user-triggered finite read session. Stopping reads is never remote cancellation. */
export function observeAdvanced(options:{read(signal:AbortSignal):Promise<RebuildStatus>;current():boolean;onStart(time:number):boolean;value(value:RebuildStatus):boolean;unavailable():void;stopped():void;notBefore:number}){
 let active=true,count=0,timer:ReturnType<typeof setTimeout>|undefined;const controller=new AbortController(),started=Date.now();
 const stop=()=>{if(!active)return;active=false;if(timer)clearTimeout(timer);clearTimeout(deadline);controller.abort();options.stopped()};
 const fail=()=>{if(active&&options.current())options.unavailable();stop()};
 const deadline=setTimeout(fail,60000);
 const poll=async()=>{if(!active)return;if(!options.current()){stop();return}const now=Date.now();if(count>=12||now-started>=60000){fail();return}if(!options.onStart(now)){fail();return}count++;
 try{const result=await options.read(controller.signal);if(!active)return;if(!options.current()){stop();return}if(!options.value(result)){stop();return}}
 catch{fail();return}
 if(!active)return;if(count>=12){fail();return}const delay=Math.max(0,now+5000-Date.now());timer=setTimeout(()=>{void poll()},delay);
 };
 timer=setTimeout(()=>{void poll()},Math.max(0,options.notBefore-Date.now()));
 return stop;
}

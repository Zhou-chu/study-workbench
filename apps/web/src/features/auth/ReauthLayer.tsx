import * as Dialog from '@radix-ui/react-dialog';
import {useEffect,useRef} from 'react';
import {useI18n} from '../../i18n';
import {Button} from '../../ui/Button';
import {LoginForm} from './LoginPage';
import type {SessionController,SessionSnapshot} from './session';
export function ReauthLayer(props:{controller:SessionController;state:SessionSnapshot}){
 const {session,settings,t}=useI18n(),resume=useRef<HTMLButtonElement>(null);
 useEffect(()=>{if(!props.state.reauthOpen&&!props.state.signedOutLocally)resume.current?.focus()},[props.state.reauthOpen,props.state.signedOutLocally]);
 if(props.state.signedOutLocally)return <section className="connection-state" role="status"><h2>{t.auth.signedOutTitle}</h2><p>{props.state.localSignoutConfirmed?(props.state.serverRevocation==='not-performed'?settings.legacySignedOut:t.auth.remoteRevocationUnconfirmed):settings.localSignoutUnconfirmed}</p>{!props.state.localSignoutConfirmed&&<Button disabled={props.state.busy} onClick={()=>void props.controller.signoutLocal()}>{t.auth.retrySignout}</Button>}<LoginForm {...props}/></section>;
 if(!props.state.reauthOpen)return <section className="connection-state"><p>{session.memoryHint}</p><Button ref={resume} onClick={()=>props.controller.openReauth()}>{settings.resume}</Button></section>;
 return <Dialog.Root open onOpenChange={open=>{if(!open)props.controller.closeReauth()}}><Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className="dialog-content" onPointerDownOutside={event=>event.preventDefault()} onCloseAutoFocus={event=>event.preventDefault()}><Dialog.Title>{session.reauth}</Dialog.Title><Dialog.Description>{session.memoryHint}</Dialog.Description><LoginForm {...props}/><Button onClick={()=>props.controller.closeReauth()}>{settings.closeAuth}</Button></Dialog.Content></Dialog.Portal></Dialog.Root>;
}

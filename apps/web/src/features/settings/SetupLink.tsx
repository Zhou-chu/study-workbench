import {Link, useLocation, type LinkProps} from 'react-router';
import {useI18n} from '../../i18n';
/** Keep only known local working routes. Never use history-back or external state as a destination. */
export function safeSetupReturn(value: unknown): string | null {
 if(typeof value !== 'string' || /[\\\u0000-\u0020]/.test(value)) return null;
 if(!/^\/(?:notebooks|sources|search|podcasts|transformations|advanced)(?:[/?#]|$)/.test(value)) return null;
 return value;
}
export function SetupLink({returnTo, ...props}: LinkProps & {returnTo?:string | undefined}){
 const location=useLocation();
 const inherited=safeSetupReturn((location.state as {setupReturnTo?:unknown}|null)?.setupReturnTo);
 const setupReturnTo=safeSetupReturn(returnTo) ?? inherited ?? safeSetupReturn(location.pathname+location.search+location.hash);
 return <Link {...props} state={{setupReturnTo}}/>;
}
export function SetupReturnLink(){
 const location=useLocation(),{t}=useI18n();
 const target=safeSetupReturn((location.state as {setupReturnTo?:unknown}|null)?.setupReturnTo);
 if(!location.pathname.startsWith('/settings') || !target)return null;
 return <div className="notebook-home"><Link className="button" to={target}>{t.common.back}</Link></div>;
}

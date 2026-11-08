import { useRef, useId } from 'react';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { ThemeControl } from '../../theme/ThemeControl';
import type { SessionController, SessionSnapshot } from './session';
export function LoginForm({ controller, state }: {
    controller: SessionController;
    state: SessionSnapshot;
}) {
    const { session } = useI18n();
    const input = useRef<HTMLInputElement>(null);
    const id = useId();
    return <form className="auth-form" onSubmit={event => { event.preventDefault(); const field = input.current; if (!field || !field.value || state.busy)
        return; const password = field.value; field.value = ''; void controller.login(password); }}>
   <label htmlFor={id}>{session.password}</label><input ref={input} id={id} name="password" type="password" autoComplete="current-password" required disabled={state.busy}/>
   {state.issue === 'invalid-password' && <p role="alert">{session.invalidPassword}</p>}
   <Button type="submit" variant="primary" disabled={state.busy}>{state.busy ? session.pending : session.signIn}</Button>
 </form>;
}
export function LoginPage(props: {
    controller: SessionController;
    state: SessionSnapshot;
}) { const { session } = useI18n(); return <main className="auth-page"><div className="auth-appearance"><ThemeControl /></div><section className="auth-card"><span className="brand">Notebook</span><h1>{session.signIn}</h1><LoginForm {...props}/><p className="panel-hint">{session.memoryHint}</p></section></main>; }

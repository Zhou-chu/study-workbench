import * as Dialog from '@radix-ui/react-dialog';
import { useI18n } from '../../i18n';
import { LoginForm } from './LoginPage';
import type { SessionController, SessionSnapshot } from './session';
/** Portal only: the workspace beneath is never replaced by a login route. */
export function ReauthLayer(props: {
    controller: SessionController;
    state: SessionSnapshot;
}) { const { session } = useI18n(); return <Dialog.Root open><Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className="dialog-content" onEscapeKeyDown={event => event.preventDefault()} onPointerDownOutside={event => event.preventDefault()}><Dialog.Title>{session.reauth}</Dialog.Title><Dialog.Description>{session.memoryHint}</Dialog.Description><LoginForm {...props}/></Dialog.Content></Dialog.Portal></Dialog.Root>; }

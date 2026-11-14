import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useBlocker } from 'react-router';
import { Button } from '../ui/Button';
import { useI18n } from '../i18n';
import type { NavigationController } from './drafts';
export function UnsavedNavigationDialog({ navigation }: {
    navigation: NavigationController;
}) {
    const state = useSyncExternalStore(navigation.subscribe, navigation.getSnapshot);
    const { session, notebook, library } = useI18n();
    useEffect(() => {
        const warn = (event: BeforeUnloadEvent) => {
            if (navigation.registry.hasUnsaved()) {
                event.preventDefault();
                event.returnValue = '';
            }
        };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [navigation]);
    return <Dialog.Root open={state.status !== null} onOpenChange={open => {
            if (!open)
                navigation.cancel(state.capture);
        }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className="dialog-content" onCloseAutoFocus={event => event.preventDefault()}><Dialog.Title>{session.unsavedTitle}</Dialog.Title><Dialog.Description>{state.status === 'retain' ? (state.capture && 'resourceId' in state.capture ? library.retainHint : notebook.retainCreationHint) : state.status === 'blocked' ? session.blocked : session.unsavedHint}</Dialog.Description><div className="dialog-actions"><Button onClick={() => navigation.cancel(state.capture)}>{session.keepEditing}</Button>{state.status === 'confirm' && <Button variant="danger" onClick={() => navigation.confirm(state.capture)}>{session.leave}</Button>}{state.status === 'retain' && <Button onClick={() => navigation.confirm(state.capture)}>{state.capture && 'resourceId' in state.capture ? library.continueRetained : notebook.retainCreation}</Button>}</div></Dialog.Content></Dialog.Portal></Dialog.Root>;
}
export function RouterNavigationGuard({ navigation }: {
    navigation: NavigationController;
}) {
    const blocker = useBlocker(({ currentLocation, nextLocation }) => currentLocation.pathname !== nextLocation.pathname && navigation.requestNavigation({ destination: nextLocation.pathname + nextLocation.search + nextLocation.hash, opener: document.activeElement instanceof HTMLElement ? document.activeElement : null }) !== 'allow');
    const latest = useRef(blocker);
    latest.current = blocker;
    useEffect(() => {
        // The navigation controller owns the captured target. React Router owns history repair.
        const originalConfirm = navigation.confirm;
        const originalCancel = navigation.cancel;
        navigation.confirm = (expected) => {
            if (expected !== undefined && expected !== navigation.getSnapshot().capture)
                return null;
            const intent = originalConfirm(expected);
            const current = latest.current;
            if (current.state === 'blocked') {
                if (intent && intent.destination === current.location.pathname + current.location.search + current.location.hash)
                    current.proceed();
                else
                    current.reset();
            }
            return intent;
        };
        navigation.cancel = (expected) => {
            if (expected !== undefined && expected !== navigation.getSnapshot().capture)
                return;
            originalCancel(expected);
            const current = latest.current;
            if (current.state === 'blocked')
                current.reset();
        };
        return () => { navigation.confirm = originalConfirm; navigation.cancel = originalCancel; };
    }, [navigation]);
    return null;
}

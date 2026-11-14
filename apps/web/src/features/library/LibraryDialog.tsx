import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from '../../ui/Button';
import { useI18n } from '../../i18n';
export function LibraryDialog({ open, onOpenChange, title, description, children }: {
    open: boolean;
    onOpenChange(value: boolean): void;
    title: string;
    description?: string;
    children: ReactNode;
}) {
    const { t } = useI18n();
    const opener = useRef<HTMLElement | null>(null);
    const mounted = useRef(false);
    const closeRequested = useRef(false);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

    return <Dialog.Root open={open} onOpenChange={value => {
        // A normal close may also conditionally unmount this component.
        closeRequested.current = !value;
        onOpenChange(value);
    }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className="dialog-content library-dialog" onOpenAutoFocus={() => {
        closeRequested.current = false;
        opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }} onCloseAutoFocus={event => {
        event.preventDefault();
        const target = opener.current;
        opener.current = null;
        if ((mounted.current || closeRequested.current) && target?.isConnected && target !== document.body && !target.matches(':disabled, [aria-disabled="true"]')) target.focus({ preventScroll: true });
    }}><Dialog.Title>{title}</Dialog.Title><Dialog.Description>{description ?? title}</Dialog.Description>{children}<Dialog.Close asChild><Button>{t.common.close}</Button></Dialog.Close></Dialog.Content></Dialog.Portal></Dialog.Root>;
}

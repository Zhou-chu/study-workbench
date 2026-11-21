import * as Dialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
export function ConfirmSourceAction({ open, title, description, children, disabled, onConfirm, onCancel }: {
    open: boolean;
    title: string;
    description: string;
    children: ReactNode;
    disabled: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}) { const { t } = useI18n(); return <Dialog.Root open={open} onOpenChange={v => { if (!v)
    onCancel(); }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className="dialog-content"><Dialog.Title>{title}</Dialog.Title><Dialog.Description>{description}</Dialog.Description>{children}<div className="source-actions"><Button onClick={onCancel}>{t.common.cancel}</Button><Button disabled={disabled} onClick={onConfirm}>{t.common.confirm}</Button></div></Dialog.Content></Dialog.Portal></Dialog.Root>; }

import * as Dialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { Button } from '../../ui/Button';
import { useI18n } from '../../i18n';
export function StudioConfirm({ title, description, children, onCancel, onConfirm, disabled, confirmLabel }: {
    title: string;
    description: string;
    children?: ReactNode;
    onCancel(): void;
    onConfirm(): void;
    disabled?: boolean;
    confirmLabel?: string;
}) {
    const { t } = useI18n();
    return <Dialog.Root open onOpenChange={open => {
            if (!open)
                onCancel();
        }}><Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className="dialog-content"><Dialog.Title>{title}</Dialog.Title><Dialog.Description>{description}</Dialog.Description>{children}<div className="studio-actions"><Button onClick={onCancel}>{t.common.cancel}</Button><Button variant="primary" disabled={disabled} onClick={onConfirm}>{confirmLabel ?? t.common.confirm}</Button></div></Dialog.Content></Dialog.Portal></Dialog.Root>;
}

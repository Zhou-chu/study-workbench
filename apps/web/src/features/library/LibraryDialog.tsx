import * as Dialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
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
    return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="dialog-overlay"/><Dialog.Content className="dialog-content library-dialog"><Dialog.Title>{title}</Dialog.Title><Dialog.Description>{description ?? title}</Dialog.Description>{children}<Dialog.Close asChild><Button>{t.common.close}</Button></Dialog.Close></Dialog.Content></Dialog.Portal></Dialog.Root>;
}

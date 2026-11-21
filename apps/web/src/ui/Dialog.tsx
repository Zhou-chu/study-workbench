import * as Radix from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { Button } from './Button';
export function Dialog({ trigger, triggerLabel, title, description, closeLabel, children }: {
    trigger: ReactNode;
    triggerLabel?: string;
    title: string;
    description: string;
    closeLabel: string;
    children: ReactNode;
}) {
    return <Radix.Root><Radix.Trigger asChild><Button aria-label={triggerLabel}>{trigger}</Button></Radix.Trigger><Radix.Portal><Radix.Overlay className="dialog-overlay"/><Radix.Content className="dialog-content"><div className="dialog-heading"><Radix.Title>{title}</Radix.Title><Radix.Close asChild><Button aria-label={closeLabel}><span aria-hidden="true">×</span></Button></Radix.Close></div><Radix.Description>{description}</Radix.Description>{children}</Radix.Content></Radix.Portal></Radix.Root>;
}

import type { ReactNode } from 'react';
export function EmptyState({ title, description, icon = '□', action }: {
    title: string;
    description: string;
    icon?: string;
    action?: ReactNode;
}) { return <div className="empty-state"><span className="empty-icon" aria-hidden="true">{icon}</span><h2>{title}</h2><p>{description}</p>{action}</div>; }

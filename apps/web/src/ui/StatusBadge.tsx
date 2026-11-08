export type StatusState = 'success' | 'warning' | 'error' | 'pending' | 'unknown';
const icons: Record<StatusState, string> = { success: '✓', warning: '△', error: '×', pending: '◷', unknown: '?' };
export function StatusBadge({ state, label }: {
    state: StatusState;
    label: string;
}) { return <span className={`status-badge status-${state}`} role="status"><span className="status-icon" aria-hidden="true">{icons[state]}</span><span>{label}</span></span>; }

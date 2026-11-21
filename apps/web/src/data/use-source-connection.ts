import { useMemo, useSyncExternalStore } from 'react';
import { readTurnContext, subscribeTurnContext } from '@study/web-transport';
import { useAppData } from '../app/providers';
import { useWorkbenchSnapshot } from '../app/WorkbenchSession';
import { createSourceApi } from './source-api';
export function useSourceConnection() { const { transport } = useAppData(); const { state, controller } = useWorkbenchSnapshot(); const context = useSyncExternalStore(subscribeTurnContext, readTurnContext, () => null); const api = useMemo(() => transport ? createSourceApi(transport) : undefined, [transport]); return { api, context, state, controller, ready: !!api && !!context?.ready && state?.ready === true, maxBytes: state?.capabilities?.limits.source_upload_max_bytes }; }

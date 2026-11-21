import { act, waitFor } from '@testing-library/react';
import type { SessionController } from '../features/auth/session';
export async function suspendAndRecover(controller: SessionController) {
    act(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => { if (controller.getSnapshot().ready) throw new Error('Expected suspended controller'); });
    act(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => { if (!controller.getSnapshot().ready) throw new Error('Expected verified controller'); });
}

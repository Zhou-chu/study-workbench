import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { WebTransport } from '@study/web-transport';
import type { WorkspaceViewV1 } from '@study/contracts';
import { AppProviders } from '../app/providers';
import { AppRoutes } from '../app/router';
export function renderApp(options: {
    route?: string;
    transport?: WebTransport;
    workspace?: WorkspaceViewV1;
} = {}) {
    const { route = '/', ...providers } = options;
    return render(<AppProviders {...providers} locale="en-US"><MemoryRouter initialEntries={[route]}><AppRoutes /></MemoryRouter></AppProviders>);
}

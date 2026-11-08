import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { WorkbenchSession } from './app/WorkbenchSession';
import { AppProviders } from './app/providers';
import { AppRoutes } from './app/router';
import './theme/tokens.css';
import './app/styles.css';
async function mount() {
    const preview = import.meta.env.DEV && location.pathname === '/__preview/workspace' ? await import('./test/fixtures') : undefined;
    const routes=<AppRoutes {...(preview ? {previewContent:preview.longPreviewContent} : {})}/>;
    const router=createBrowserRouter([{path:'*',element:preview?routes:<WorkbenchSession>{routes}</WorkbenchSession>}]);
    createRoot(document.getElementById('root')!).render(<AppProviders {...(preview ? { workspace: preview.syntheticWorkspace } : {})}><RouterProvider router={router}/></AppProviders>);
}
void mount();

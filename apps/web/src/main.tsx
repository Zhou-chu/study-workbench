import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { AppProviders } from './app/providers';
import { AppRoutes } from './app/router';
import './theme/tokens.css';
import './app/styles.css';
async function mount() {
    const preview = import.meta.env.DEV && location.pathname === '/__preview/workspace' ? await import('./test/fixtures') : undefined;
    createRoot(document.getElementById('root')!).render(<AppProviders {...(preview ? { workspace: preview.syntheticWorkspace } : {})}><BrowserRouter><AppRoutes {...(preview ? { previewContent: preview.longPreviewContent } : {})}/></BrowserRouter></AppProviders>);
}
void mount();

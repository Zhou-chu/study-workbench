import { Route, Routes } from 'react-router';
import { NotebookHome } from '../features/notebooks/NotebookHome';
import { NotebookShell } from '../features/notebooks/NotebookShell';
export function AppRoutes({ previewContent }: {
    previewContent?: {
        title: string;
        paragraphs: string[];
    };
}) { return <Routes><Route path="/" element={<NotebookHome />}/><Route path="/notebooks/:notebookId" element={<NotebookShell />}/>{import.meta.env.DEV && <Route path="/__preview/workspace" element={<NotebookShell {...(previewContent ? { previewContent } : {})}/>}/>}<Route path="*" element={<NotebookHome />}/></Routes>; }

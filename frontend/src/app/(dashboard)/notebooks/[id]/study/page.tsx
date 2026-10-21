import { AppShell } from '@/components/layout/AppShell'
import { StudyWorkbench } from '@/components/workbench/StudyWorkbench'
export default async function StudyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  // Notebook links encode SurrealDB IDs. Decode once, before API clients encode
  // path segments, while leaving malformed route input safe to display.
  let notebookId = id
  try { notebookId = decodeURIComponent(id) } catch { /* Keep the original invalid route ID. */ }
  return <AppShell><StudyWorkbench key={notebookId} notebookId={notebookId} /></AppShell>
}

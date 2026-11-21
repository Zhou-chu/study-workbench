import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { AppProviders } from '../../app/providers';
import { StudioPanel, savedArtifactProgress } from './StudioPanel';
import { ArtifactCard } from './ArtifactCard';
import { sourceWorkspace } from '../../test/source-fixtures';
it('does not expose a backend jobs tab or protocol identifiers in the results workspace', () => {
 const workspace = sourceWorkspace();
 workspace.jobs = [{job_id:'job:private-internal-123', operation:'portable_export', state:'queued'}];
 render(<AppProviders locale="en-US"><StudioPanel notebookId="n" workspace={workspace}/></AppProviders>);
 expect(screen.queryByRole('button', {name:'Tasks'})).not.toBeInTheDocument();
 expect(screen.queryByText('job:private-internal-123')).not.toBeInTheDocument();
 expect(screen.getByRole('button',{name:'New Note'})).toBeVisible();
});
it('unknown server states use a readable fallback without echoing protocol values', () => {
 render(<AppProviders locale="en-US"><ArtifactCard title="Audio" state="internal_backend_state_391"/></AppProviders>);
 expect(screen.queryByText(/internal_backend_state_391/)).not.toBeInTheDocument();
 expect(screen.getByText(/Unknown/)).toBeVisible();
});

it('keeps actual note content including code unchanged', () => {
 const workspace=sourceWorkspace();
 workspace.notes=[{id:'note:code',title:'A useful example',content:'const value = { answer: 42 };',revision:1}];
 render(<AppProviders locale="en-US"><StudioPanel notebookId="n" workspace={workspace}/></AppProviders>);
 expect(screen.getByText('const value = { answer: 42 };')).toBeInTheDocument();
});

it('keeps persisted audio progress on rerender without showing unrelated jobs or IDs',()=>{
 const workspace=sourceWorkspace();workspace.jobs=[{job_id:'private-audio',operation:'audio',state:'running',remote_may_continue:true},{job_id:'private-extract',operation:'extract_evidence',state:'queued'}];
 const view=render(<AppProviders locale="en-US"><StudioPanel notebookId="n" workspace={workspace}/></AppProviders>);
 expect(screen.getByText('Create audio · Running')).toBeInTheDocument();
 view.rerender(<AppProviders locale="en-US"><StudioPanel notebookId="n" workspace={{...workspace,jobs:[{job_id:'private-audio',operation:'audio',state:'waiting_remote'}]}}/></AppProviders>);
 expect(screen.getByText('Create audio · Waiting for Google')).toBeInTheDocument();expect(document.body.textContent).not.toContain('private-audio');expect(document.body.textContent).not.toContain('private-extract');
});
it('deduplicates represented artifact progress and never admits generic operations',()=>{
 const jobs=[{job_id:'one',operation:'audio',state:'running'},{job_id:'two',operation:'portable_export',state:'queued'},{job_id:'three',operation:'background_extract',state:'running'}];
 expect(savedArtifactProgress(jobs,['one']).map(job=>'job_id' in job ? job.job_id : null)).toEqual(['two']);
});

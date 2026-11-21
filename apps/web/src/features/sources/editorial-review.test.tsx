import {render,screen} from '@testing-library/react';
import {expect,it} from 'vitest';
import {MemoryRouter} from 'react-router';
import {AppProviders} from '../../app/providers';
import {CommonNavigation} from '../../app/CommonNavigation';
import {SourceDetails} from './SourceDetails';
it('keeps extraction readiness and original availability readable',()=>{
 render(<AppProviders locale="en-US"><SourceDetails sourceTitle="Paper" versions={[{source_version_id:'private-version',status:'ready',extraction_status:'needs_ocr',original_status:'missing'}]} selected={[]} disabled={false} onSelect={()=>{}} onRead={()=>{}}/></AppProviders>);
 expect(screen.getByText(/OCR needed/)).toBeInTheDocument();
 expect(screen.getByText(/Missing/)).toBeInTheDocument();
 expect(screen.queryByText('private-version')).not.toBeInTheDocument();
});
it('marks only the chosen search mode as current',()=>{
 render(<AppProviders locale="en-US"><MemoryRouter initialEntries={['/search?mode=ask']}><CommonNavigation/></MemoryRouter></AppProviders>);
 const active=document.querySelectorAll('a[aria-current="page"]');
 expect(active).toHaveLength(1);expect(active[0]).toHaveAttribute('href','/search?mode=ask');
});

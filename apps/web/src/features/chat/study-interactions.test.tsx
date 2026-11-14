import { fireEvent,render,screen } from '@testing-library/react';
import { expect,it,vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { AppProviders } from '../../app/providers';
import { ScopeSummary } from './ScopeSummary';
import { SourceRow } from '../sources/SourceRow';
it('offers explicit scope adjustment without mutating the selection',()=>{
 const adjust=vi.fn();
 render(<AppProviders locale="en-US"><ScopeSummary selection={null} unconfirmed={false} onAdjustScope={adjust}/></AppProviders>);
 fireEvent.click(screen.getByRole('button',{name:'Change'}));expect(adjust).toHaveBeenCalledOnce();
});
it('opens the latest readable source from its title without selecting it',()=>{
 const read=vi.fn(),select=vi.fn();
 render(<AppProviders locale="en-US"><MemoryRouter><SourceRow source={{source_id:'s',title:'Paper',versions:[{source_version_id:'old',created_at:'2025-01-01'},{source_version_id:'new',created_at:'2026-01-01'}]}} selected={[]} disabled={false} uploadDisabled={false} onSelect={select} onRead={read} onUpload={()=>{}}/></MemoryRouter></AppProviders>);
 fireEvent.click(screen.getByRole('button',{name:'Paper'}));
 expect(read).toHaveBeenCalledWith({source_version_id:'new'});expect(select).not.toHaveBeenCalled();
});

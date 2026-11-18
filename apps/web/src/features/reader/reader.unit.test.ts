import { expect, it } from 'vitest';
import { createReaderNavigation } from './navigation';
import { sourceContext } from '../../test/source-fixtures';
import { citation } from '../../test/reader-fixtures';
import { sessionCoordinator } from '@study/web-transport';

it('does not load the latest extraction for a citation with missing evidence identity', () => { const context = sourceContext(); const nav = createReaderNavigation({ notebookId: 'n', context, generation: sessionCoordinator.current() }); const value = { ...citation(), evidence_id: null }; expect(nav.openCitation(value, { turnId: 'old', focusKey: 'old' }).source_version_id).toBeNull(); });

it('keeps future citation kinds displayable without making their locator actionable',()=>{const context=sourceContext();const nav=createReaderNavigation({notebookId:'n',context,generation:sessionCoordinator.current()});const value={...citation(),kind:'future_kind'};const intent=nav.openCitation(value,{turnId:'old',focusKey:'old'});expect(intent.citation?.quote).toBe('😀 proof');expect(intent.source_version_id).toBeNull();});

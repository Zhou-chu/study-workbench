import type { WorkbenchSelection } from '@study/contracts'
export type ScopeModel = Readonly<WorkbenchSelection>
export type ScopeEvent = { type: 'read'; sourceVersionId: string } | { type: 'select'; selection: WorkbenchSelection }
export function createScope(selection: WorkbenchSelection): ScopeModel {
  return Object.freeze({ engine: selection.engine, selection_origin: selection.selection_origin, source_version_ids: Object.freeze([...selection.source_version_ids]) as unknown as string[], remote_source_ids: Object.freeze([...selection.remote_source_ids]) as unknown as string[] })
}
export function reduceScope(state: ScopeModel, event: ScopeEvent): ScopeModel { return event.type === 'read' ? state : createScope(event.selection) }

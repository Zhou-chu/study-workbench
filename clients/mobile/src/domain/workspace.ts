import type { Workspace } from './contracts.ts';
export interface NavigationState { screen:'list' | 'workspace'; generation:number; notebookId?:string; workspace?:Workspace }
export interface NavigationTicket { generation:number; notebookId:string }
export function initialNavigation(): NavigationState { return {screen:'list',generation:0}; }
export function beginNavigation(state: NavigationState, notebookId: string): {state:NavigationState;ticket:NavigationTicket} {
  const ticket = {generation:state.generation+1, notebookId};
  return {state:{screen:'workspace',...ticket},ticket};
}
export function resolveNavigation(state:NavigationState,ticket:NavigationTicket,workspace:Workspace): NavigationState {
  if (state.screen !== 'workspace' || state.generation !== ticket.generation || state.notebookId !== ticket.notebookId || workspace.notebook.id !== ticket.notebookId) return state;
  return {...state,workspace};
}
export function backToList(state:NavigationState):NavigationState {
  return {screen:'list',generation:state.generation+1};
}
// Drafts/operations are owned outside navigation, keyed by note/action identity.

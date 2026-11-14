export function navigationDecision(state: { targetChanged: boolean; dirty: boolean; saving: boolean; unknown: boolean }): 'allow' | 'confirm' | 'blocked' {
  if (!state.targetChanged) return 'allow'
  return state.saving || state.unknown ? 'blocked' : state.dirty ? 'confirm' : 'allow'
}

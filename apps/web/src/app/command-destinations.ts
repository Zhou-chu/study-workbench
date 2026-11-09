/** Only implemented destinations are registered. Later B8 slices extend this same list. */
export const commandDestinations = [{ id: 'notebooks', path: '/notebooks' }, { id: 'sources', path: '/sources' }, { id: 'search', path: '/search?mode=search' }, { id: 'ask', path: '/search?mode=ask' }] as const;

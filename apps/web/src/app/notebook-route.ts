/** Decode the actual URL segment once. React Router params replace literal %2F twice. */
export function notebookIdFromPathname(pathname: string): string | null {
    const match = /^\/notebooks\/([^/]+)(?:\/study)?\/?$/.exec(pathname);
    if (!match?.[1])
        return null;
    try {
        return decodeURIComponent(match[1]);
    }
    catch {
        return null;
    }
}

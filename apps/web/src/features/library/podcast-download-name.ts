/** Preserve filename policy order: substitute, strip suffix, truncate, fallback, prefix. */
export function podcastDownloadName(name: string): string {
    const replaced = name.replace(/[<>:"|?*]/g, '_');
    let end = replaced.length;
    while (end > 0 && (replaced[end - 1] === '.' || replaced[end - 1] === ' ')) end--;
    let filename = replaced.slice(0, end).slice(0, 180) || 'podcast.mp3';
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(filename)) filename = '_' + filename;
    return filename;
}

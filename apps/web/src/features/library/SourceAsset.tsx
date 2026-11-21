import { useEffect, useRef, useState } from 'react';
import { readTurnContext, sessionCoordinator, canDispatch } from '@study/web-transport';
import { useLibraryConnection } from '../../data/use-library-connection';
import type { LibrarySource } from '../../data/library-api';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { safeContentUrl, youtubeId } from './library-operations';
export function downloadName(header: string | null, fallback = 'source') {
    let name = header?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    if (name) {
        try {
            name = decodeURIComponent(name);
        }
        catch {
            name = undefined;
        }
    }
    name ??= header?.match(/filename="([^"]+)"/i)?.[1] ?? header?.match(/filename=([^;]+)/i)?.[1];
    return (name ?? fallback).split(/[\\/]/).at(-1)?.replace(/[\u0000-\u001f\u007f]/g, '').trim() || 'source';
}
export function SourceAsset({ source }: {
    source: LibrarySource;
}) {
    const c = useLibraryConnection(), { t, library: l } = useI18n(), [busy, setBusy] = useState(false), [error, setError] = useState(false), [copied, setCopied] = useState(false), [play, setPlay] = useState(false);
    const controller = useRef<AbortController | null>(null), url = useRef<string | null>(null), activation = useRef(0);
    useEffect(() => {
        activation.current++;
        setPlay(false);
        return () => {
            activation.current++;
            controller.current?.abort();
            if (url.current) {
                URL.revokeObjectURL(url.current);
                url.current = null;
            }
        };
    }, [source.id, c.scope]);
    const original = safeContentUrl(source.asset?.url), video = youtubeId(original);
    const download = async () => {
        if (!c.context || !c.api || busy)
            return;
        setBusy(true);
        setError(false);
        const ticket = activation.current, context = c.context, g = c.generation, abort = new AbortController();
        controller.current = abort;
        try {
            await c.api.sources.available(source.id, context, abort.signal);
            const value = await c.api.sources.download(source.id, context, abort.signal);
            if (ticket !== activation.current || abort.signal.aborted || !canDispatch(context, readTurnContext()) || g !== sessionCoordinator.current())
                return;
            const object = URL.createObjectURL(value.blob);
            url.current = object;
            const a = document.createElement('a');
            a.href = object;
            a.download = downloadName(value.disposition, source.title ?? 'source');
            a.click();
            URL.revokeObjectURL(object);
            url.current = null;
        }
        catch {
            if (ticket === activation.current && !abort.signal.aborted)
                setError(true);
        }
        finally {
            if (ticket === activation.current)
                setBusy(false);
        }
    };
    return <section className="library-assets"><div className="library-actions"><Button disabled={!c.ready || busy || source.file_available === false || !source.asset?.hasFile} onClick={() => void download()}>{t.sources.downloadFile}</Button>
 {original && <><a className="button" href={original} target="_blank" rel="noopener noreferrer">{l.originalUrl}</a><Button onClick={() => { setCopied(false); void navigator.clipboard.writeText(original).then(() => setCopied(true), () => setError(true)); }}>{l.copyUrl}</Button></>}
 {video && <><a className="button" href={'https://www.youtube.com/watch?v=' + video} target="_blank" rel="noopener noreferrer">{t.sources.openOnYoutube}</a><Button onClick={() => setPlay(true)}>{l.playYoutube}</Button></>}</div>
 {error && <p role="alert">{t.common.contentUnavailable.errorTitle}</p>}{copied && <p role="status">{t.sources.urlCopied}</p>}
 {video && play && <iframe className="source-media" title={t.common.accessibility.ytVideo} src={'https://www.youtube-nocookie.com/embed/' + video} allow="fullscreen; picture-in-picture" referrerPolicy="no-referrer"/>}
 </section>;
}

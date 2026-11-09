import { useEffect, useRef, useState } from 'react';
import { canDispatch, readTurnContext, sessionCoordinator } from '@study/web-transport';
import { useLibraryConnection } from '../../data/use-library-connection';
import { podcastAudioPath, type PodcastEpisode } from '../../data/podcast-contracts';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { downloadName } from './SourceAsset';
export function PodcastAudio({ episode }: {
    episode: PodcastEpisode;
}) {
    const c = useLibraryConnection(), { t, podcast: p } = useI18n(), original = useRef({ context: c.context, generation: c.generation }), controller = useRef<AbortController | null>(null), owned = useRef<string | null>(null), serial = useRef(0), latch = useRef(false), [url, setUrl] = useState<string | null>(null), [error, setError] = useState(false), [busy, setBusy] = useState(false);
    const current = () => !!original.current.context && canDispatch(original.current.context, readTurnContext()) && original.current.generation === sessionCoordinator.current();
    useEffect(() => { setUrl(null); return () => { serial.current++; controller.current?.abort(); if (owned.current) {
        URL.revokeObjectURL(owned.current);
        owned.current = null;
    } }; }, [episode.id, c.scope]);
    async function load(download: boolean) {
        if (latch.current || !current() || !c.api || !original.current.context || !podcastAudioPath(episode))
            return;
        latch.current = true;
        setBusy(true);
        setError(false);
        const abort = new AbortController(), ticket = serial.current;
        controller.current = abort;
        try {
            const value = await c.api.podcasts.audio(episode, original.current.context, abort.signal);
            if (abort.signal.aborted || ticket !== serial.current || !current())
                return;
            const object = URL.createObjectURL(value.blob);
            if (download) {
                try {
                    const a = document.createElement('a');
                    a.href = object;
                    let filename = downloadName(value.disposition, episode.name + '.mp3').replace(/[<>:"|?*]/g, '_').replace(/[. ]+$/g, '').slice(0, 180) || 'podcast.mp3';
                    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(filename))
                        filename = '_' + filename;
                    a.download = filename;
                    a.click();
                }
                finally {
                    URL.revokeObjectURL(object);
                }
            }
            else {
                if (owned.current)
                    URL.revokeObjectURL(owned.current);
                owned.current = object;
                setUrl(object);
            }
        }
        catch {
            if (!abort.signal.aborted && ticket === serial.current)
                setError(true);
        }
        finally {
            if (ticket === serial.current) {
                latch.current = false;
                setBusy(false);
            }
        }
    }
    const available = !!podcastAudioPath(episode) && c.ready && current();
    return <section className="podcast-audio"><div className="library-actions"><Button disabled={!available || busy || !!url} onClick={() => void load(false)}>{p.loadAudio}</Button><Button disabled={!available || busy} onClick={() => void load(true)}>{t.sources.downloadFile}</Button></div>{!available && <p>{t.podcasts.audioUnavailable}</p>}{error && <p role="alert">{t.podcasts.audioUnavailable}</p>}{url && current() && <audio controls preload="none" onError={() => setError(true)} src={url} aria-label={episode.name + ' ' + p.audio}/>}</section>;
}

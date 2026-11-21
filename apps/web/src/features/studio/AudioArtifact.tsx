import { useEffect, useRef, useState } from 'react';
import type { ArtifactView } from '@study/contracts';
import { canDispatch, readTurnContext, sessionCoordinator, subscribeTurnContext } from '@study/web-transport';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { ArtifactCard } from './ArtifactCard';
export function AudioArtifact({ artifact, remoteMayContinue, onLoad, valid = () => true }: {
    artifact: ArtifactView;
    remoteMayContinue?: boolean;
    onLoad?: () => Promise<Blob>;
    valid?: () => boolean;
}) {
    const { t, studio } = useI18n(), [url, setUrl] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(false), live = useRef(true), flight = useRef(false), owned = useRef<string | null>(null);
    useEffect(() => {
        live.current = true;
        const off = subscribeTurnContext(() => {
            if (owned.current) {
                URL.revokeObjectURL(owned.current);
                owned.current = null;
                setUrl(null);
            }
        });
        return () => {
            live.current = false;
            off();
            if (owned.current)
                URL.revokeObjectURL(owned.current);
        };
    }, []);
    async function load() {
        if (!onLoad || flight.current || !valid())
            return;
        const c = readTurnContext(), g = sessionCoordinator.current();
        flight.current = true;
        setBusy(true);
        setError(false);
        try {
            const blob = await onLoad();
            if (!live.current || !c || !canDispatch(c, readTurnContext()) || g !== sessionCoordinator.current() || !valid())
                return;
            if (owned.current)
                URL.revokeObjectURL(owned.current);
            owned.current = URL.createObjectURL(blob);
            setUrl(owned.current);
        }
        catch {
            if (live.current)
                setError(true);
        }
        finally {
            flight.current = false;
            if (live.current)
                setBusy(false);
        }
    }
    const local = typeof artifact.artifact_id === 'string', mime = typeof artifact.mime_type === 'string' ? artifact.mime_type : '';
    return <ArtifactCard title={typeof artifact.title === 'string' ? artifact.title : t.workbench.jobOperations.audio}>{remoteMayContinue && <p role="status">{t.workbench.remoteMayContinue}</p>}{!local && <p>{t.workbench.artifactNotSaved}</p>}{local && onLoad && <><p>{studio.memoryLimit}</p><Button disabled={busy || !valid()} onClick={() => void load()}>{t.workbench.playAudio}</Button>{url && <>{mime.startsWith('audio/') && <audio controls src={url}/>}<a className="button" href={url} download="notebook-artifact">{t.common.download}</a></>}</>}{error && <p role="alert">{t.workbench.exportDownloadError}</p>}</ArtifactCard>;
}

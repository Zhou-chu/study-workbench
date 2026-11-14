import { Markdown } from '../../ui/Markdown';
import type { EvidenceCitationView, TurnView } from '@study/contracts';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { observedTurnState } from '@study/domain';
import { TurnStatus } from './TurnStatus';
export type CitationOrigin = {
    turnId: string;
    focusKey: string;
};
export type CitationHandler = (reference: EvidenceCitationView, origin: CitationOrigin) => void;
const text = (v: unknown): string | undefined => typeof v === 'string' ? v : undefined;
export function Message({ turn, index, onCitation, onSaveAnswer }: {
    turn: TurnView;
    index: number;
    onCitation?: CitationHandler | undefined;
    onSaveAnswer?: ((turn: TurnView) => void) | undefined;
}) {
    const { t, chat } = useI18n(), turnId = text(turn.turn_id), valid = !turn.projection_status, answer = text(turn.answer), state = observedTurnState(turn.status ?? turn.state);
    const count = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? String(v) : t.common.unknown;
    const warning = (value: string) => { const code = value.split(':', 1)[0]; return code === 'BOUNDED_OVERVIEW' ? t.workbench.boundedOutline : code === 'PARTIAL_SOURCE_COVERAGE' || code === 'PARTIAL_COVERAGE' ? t.workbench.partialCoverage : code === 'CONTEXT_BUDGET' ? t.workbench.contextBudget : value; };
    const method = (value: unknown) => value === 'hybrid' ? t.workbench.hybridMode : value === 'selected_overview' ? t.workbench.selectedOverview : value === 'lexical' || value === 'lexical_fallback' ? t.workbench.lexicalOnly : text(value) ?? t.common.unknown;
    const citations = Array.isArray(turn.citations) ? turn.citations : [], scope = turn.scope_snapshot, coverage = turn.coverage, retrieval = turn.retrieval;
    return <article className="chat-message" aria-label={`${t.workbench.question} ${index + 1}`}>
 <p className="chat-question">{text(turn.message) ?? t.common.unknown}</p><TurnStatus state={state}/>
 {answer && <div className="chat-answer"><Markdown>{answer}</Markdown></div>}
 {!valid && <p role="status">{t.common.unknown}</p>}
 {(turn.error || state === 'failed') && <p role="alert">{t.workbench.answerFailure}</p>}
 {['unknown', 'submission_unknown'].includes(state) && <p>{t.workbench.turnRecoveryUncertain}</p>}
 {answer && <p className="panel-hint">{t.workbench.coverageExcerptOnly}</p>}
 {coverage && 'selected_source_count' in coverage && <p>{t.workbench.coverageSummary.replace('{{selected}}', count(coverage.selected_source_count)).replace('{{retrieved}}', count(coverage.retrieved_source_count)).replace('{{evidence}}', count(coverage.evidence_count))}</p>}
 {coverage && 'selected_source_count' in coverage && typeof coverage.selected_source_count === 'number' && typeof coverage.retrieved_source_count === 'number' && coverage.retrieved_source_count < coverage.selected_source_count && <p>{t.workbench.partialCoverage}</p>}
 {Array.isArray(turn.warnings) && turn.warnings.map((w, i) => <p className="chat-warning" key={i}>{warning(w)}</p>)}
 {retrieval && 'retrieval_method' in retrieval && <><details className="chat-diagnostics"><summary>{t.workbench.jobTechnicalDetails}</summary><p>{t.workbench.effectiveRetrieval.replace('{{method}}', method(retrieval.retrieval_method))}</p><p>{t.workbench.retrievalCoverage.replace('{{indexed}}', count(retrieval.indexed_version_count)).replace('{{selected}}', count(retrieval.selected_version_count))}</p></details>{text(retrieval.fallback_reason) && <p>{t.workbench.retrievalFallback.replace('{{reason}}', text(retrieval.fallback_reason)!)}</p>}{Array.isArray(retrieval.warnings) && retrieval.warnings.map((w, i) => <p key={i}>{warning(w)}</p>)}</>}
 <ul className="chat-citations">{citations.map((c, i) => {
            const citation = c as EvidenceCitationView, focusKey = `citation:${turnId ?? 'unknown'}:${index}:${i}`, actionable = valid && !citation.projection_status && !!turnId && typeof citation.citation_id === 'string';
            return <li key={i}><Button id={focusKey} disabled={!actionable || !onCitation} onClick={() => {
                    if (actionable && turnId)
                        onCitation?.(citation, { turnId, focusKey });
                }}>{text(citation.citation_id) ?? t.common.unknown} · {text(citation.source_title) ?? t.workbench.quote}</Button><p>{text(citation.quote)}</p><p>{t.workbench.validity.replace('{{status}}', text(citation.reference_validity) ?? t.common.unknown)}</p>{(citation.kind === 'derived_snapshot' || citation.provenance && 'kind' in citation.provenance && citation.provenance.kind === 'derived') && <p>{t.sourceSnapshots.notIndependentEvidence}</p>}</li>;
        })}</ul>
 {citations.length > 0 && <p className="panel-hint">{onCitation ? t.workbench.verificationMeaning : chat.readerPending}</p>}
 {scope && 'source_version_ids' in scope && <details><summary>{t.workbench.turnScope}</summary><p>{text(scope.engine)} · {text(scope.selection_origin)}</p><ul>{[...(Array.isArray(scope.source_version_ids) ? scope.source_version_ids : []), ...(Array.isArray(scope.remote_source_ids) ? scope.remote_source_ids : [])].map((id, i) => <li key={i}>{id}</li>)}</ul></details>}
 {answer && <><Button disabled={!valid || !turnId || state !== 'succeeded' || !onSaveAnswer} onClick={() => onSaveAnswer?.(turn)}>{t.workbench.saveAnswer}</Button>{!onSaveAnswer && <p className="panel-hint">{chat.savePending}</p>}</>}
 </article>;
}

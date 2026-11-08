import { useId, useRef, type ReactNode } from 'react';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
export function Composer({ question, onChange, onSubmit, onOutline, disabled, readOnly, scope, onNewDraft }: {
    question: string;
    onChange(value: string): void;
    onSubmit(): void;
    onOutline?: (() => void) | undefined;
    disabled: boolean;
    readOnly: boolean;
    scope: ReactNode;
    onNewDraft(): void;
}) {
    const { t, session, chat } = useI18n(), id = useId(), composing = useRef(false);
    return <div className="composer">{scope}<label htmlFor={id}>{t.workbench.question}</label><textarea id={id} value={question} readOnly={readOnly} aria-describedby={`${id}-hint`} onChange={e => onChange(e.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={e => {
            if (e.key !== 'Enter' || e.shiftKey)
                return;
            if (e.nativeEvent.isComposing || composing.current || e.keyCode === 229 || e.repeat) {
                e.preventDefault();
                return;
            }
            e.preventDefault();
            if (!disabled && !readOnly && question.trim())
                onSubmit();
        }}/><p id={`${id}-hint`} className="panel-hint">{chat.keys}</p><p className="panel-hint">{chat.independentQuestions}</p>{readOnly && <><p>{session.retiredDraft}</p><Button onClick={onNewDraft}>{session.newQuestion}</Button></>}
 <div className="composer-footer"><Button disabled={disabled || readOnly || !question.trim()} variant="primary" onClick={() => {
            if (!composing.current)
                onSubmit();
        }}>{t.workbench.ask}</Button><Button disabled={disabled || readOnly || !onOutline} onClick={() => {
            if (!composing.current)
                onOutline?.();
        }}>{t.workbench.outline}</Button></div></div>;
}

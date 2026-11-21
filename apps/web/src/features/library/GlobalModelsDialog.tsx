import { useState } from 'react';
import type { AskModels } from '../../data/global-search';
import { LibraryDialog } from './LibraryDialog';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
export function GlobalModelsDialog({ models, initial, ready, onCancel, onSubmit }: {
    models: readonly {
        id: string;
        name: string;
        type: string;
    }[];
    initial: string | null;
    ready: boolean;
    onCancel(): void;
    onSubmit(value: AskModels): void;
}) {
    const { global: g, t } = useI18n(), [chosen, setChosen] = useState<AskModels>({ strategy_model: initial ?? '', answer_model: initial ?? '', final_answer_model: initial ?? '' });
    const options = models.filter(m => m.type === 'language'), labels = { strategy_model: g.strategyModel, answer_model: g.answerModel, final_answer_model: g.finalModel };
    return <LibraryDialog open title={t.searchPage.advancedModelTitle} onOpenChange={open => { if (!open)
        onCancel(); }}>
 {(Object.keys(labels) as (keyof AskModels)[]).map(key => <label key={key}>{labels[key]}<select value={chosen[key]} onChange={e => setChosen({ ...chosen, [key]: e.target.value })}><option value="">{t.searchPage.notSet}</option>{options.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>)}
 <Button onClick={onCancel}>{t.common.cancel}</Button><Button disabled={!ready || Object.values(chosen).some(v => !options.some(m => m.id === v))} onClick={() => onSubmit(chosen)}>{g.start}</Button>
 </LibraryDialog>;
}

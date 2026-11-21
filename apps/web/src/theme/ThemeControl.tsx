import { useTheme } from './theme';
import { useI18n } from '../i18n';
import { Button } from '../ui/Button';
export function ThemeControl() {
    const { preference, setThemePreference } = useTheme();
    const { t } = useI18n();
    return <div className="theme-control" role="group" aria-label={t.common.theme}>{(['light', 'dark', 'system'] as const).map(value => <Button key={value} aria-pressed={preference === value} onClick={() => setThemePreference(value)}><span aria-hidden="true">{value === 'light' ? '☼' : value === 'dark' ? '◐' : '◑'}</span>{t.common[value]}</Button>)}</div>;
}

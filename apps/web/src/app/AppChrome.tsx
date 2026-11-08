import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ThemeControl } from '../theme/ThemeControl';
import { Dialog } from '../ui/Dialog';
import { useI18n, languages } from '../i18n';
import type { LanguageCode } from '../i18n';
import { StatusBadge } from '../ui/StatusBadge';

export function AppChrome({ children, title }: { children: ReactNode; title?: string }) {
  const { t, shell, session, locale, setLocale } = useI18n();
  return <>
    <a className="skip-link" href="#main-content">{session.skipMain}</a>
    <header className="app-header">
      <Link className="brand" to="/" aria-label={shell.homeTitle}>
        <span className="brand-mark" aria-hidden="true">▥</span><span>Notebook</span>
      </Link>
      <span className="header-divider" aria-hidden="true" />
      {title && <span className="header-title">{title}</span>}
      <div className="header-tools">
        <ThemeControl />
        <Dialog
          trigger={<><span aria-hidden="true">⚙</span><span className="settings-label">{shell.preferences}</span></>}
          triggerLabel={shell.preferences}
          title={shell.preferences} description={shell.previewNotice} closeLabel={t.common.close}
        >
          <label className="field-label" htmlFor="language">{t.common.language}</label>
          <select id="language" value={locale} onChange={event => setLocale(event.target.value as LanguageCode)}>
            {languages.map(item => <option key={item.code} value={item.code}>{item.label}</option>)}
          </select>
        </Dialog>
      </div>
    </header>
    <div className="preview-notice">
      <StatusBadge state="pending" label={shell.previewTitle} /><span>{shell.previewNotice}</span>
    </div>
    <main id="main-content" tabIndex={-1}>{children}</main>
  </>;
}

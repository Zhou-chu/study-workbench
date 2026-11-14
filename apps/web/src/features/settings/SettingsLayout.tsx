import {ApplicationSettings} from './ApplicationSettings';
import {SetupLink as Link} from './SetupLink';
import {useI18n} from '../../i18n';
import {AppChrome} from '../../app/AppChrome';
/** Shared entry shell only. Later settings slices remain explicitly pending. */
export function SettingsLayout(){const {t}=useI18n();return <AppChrome><section className="notebook-home"><h1>{t.navigation.settings}</h1><ApplicationSettings/><nav className="settings-links"><Link className="button" to="/settings/models">{t.navigation.models}</Link><Link className="button" to="/transformations">{t.navigation.transformations}</Link><Link className="button" to="/advanced">{t.navigation.advanced}</Link></nav></section></AppChrome>}

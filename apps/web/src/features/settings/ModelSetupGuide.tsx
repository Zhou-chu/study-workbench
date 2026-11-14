import { useI18n } from '../../i18n';
import { modelSetupCopy } from '../../i18n/model-setup-messages';
import type { Credential, Model } from '../../data/configuration-contracts';
import type { ConfigurationDraft } from './configuration-store';
import './ModelSetupGuide.css';

type Metadata = Pick<ConfigurationDraft, 'data' | 'sources' | 'retired'>;
type Source = 'providers' | 'credentials' | 'models' | 'defaults';
function available(row: Metadata | undefined, source: Source) {
  return !!row && !row.retired && row.sources[source]?.phase === 'ready' && row.data[source] !== undefined;
}

export const credentialSetupAnchor = (id: string) => 'model-setup-credential-' +
  id.split('').map(character => character.charCodeAt(0).toString(16).padStart(4, '0')).join('');

/** A read-only projection: this component has no transport or mutation callbacks. */
export function ModelSetupGuide({ row, current, testCurrent, navigationReady, canAddConfiguration, supportedProviderNames }: {
  row: ConfigurationDraft | undefined;
  current: boolean;
  testCurrent: boolean;
  navigationReady: boolean;
  canAddConfiguration: boolean;
  supportedProviderNames: readonly string[];
}) {
  const { locale } = useI18n(), m = modelSetupCopy(locale);
  const metadata = current ? row : undefined;
  const missing = (sources: readonly Source[]) => row && (!current || row.retired) ? m.unknown
    : sources.some(source => row?.sources[source]?.phase === 'error') ? m.readFailed
      : sources.some(source => row?.sources[source]?.phase !== 'ready') ? m.loading : m.unknown;
  const providerName = (name: string) => available(metadata, 'providers')
    ? row!.data.providers!.find(provider => provider.name === name)?.display_name || name : name;
  const defaultId = row?.data.defaults?.default_chat_model;
  const selected = available(metadata, 'models') ? row!.data.models!.find(model => model.id === defaultId && model.type === 'language') : undefined;
  const chat = !available(metadata, 'defaults') ? missing(['defaults'])
    : defaultId === null ? m.notSelected
      : !available(metadata, 'models') ? missing(['models'])
        : selected ? providerName(selected.provider) + ' · ' + selected.name : m.unknown;
  const attempt = row?.attempt, intent = attempt?.token.intent;
  let validation = m.noTest;
  if (attempt && (intent?.kind === 'credential-test' || intent?.kind === 'model-test')) {
    const kind = intent.kind === 'credential-test' ? m.connectionCheck : m.modelCheck;
    const target = intent.kind === 'credential-test'
      ? available(metadata, 'credentials') ? row!.data.credentials!.find(credential => credential.id === intent.id && credential.provider === intent.provider) : undefined
      : available(metadata, 'models') ? row!.data.models!.find(model => model.id === intent.id) : undefined;
    const result = attempt.phase === 'pending' ? m.checking
      : attempt.phase === 'not-sent' ? m.notSent
        : attempt.phase !== 'confirmed' || typeof attempt.result?.success !== 'boolean' ? m.uncertain
          : !testCurrent ? m.previousCheck : attempt.result.success ? m.received + ' · ' + m.invocationUnknown : m.failed;
    validation = kind + ': ' + (target ? providerName(target.provider) + ' · ' + target.name : m.unknown) + ' · ' + result;
  }
  const navigationKnown = navigationReady && (['providers', 'credentials', 'models', 'defaults'] as const)
    .every(source => available(metadata, source));
  const languageCredentials = navigationKnown ? row!.data.credentials!.filter(c => c.modalities.includes('language')) : [];
  const links = (credential: Credential) => row!.data.models!.filter(model => model.credential === credential.id);
  const languageModels = navigationKnown ? row!.data.models!.filter(model => model.type === 'language') : [];
  const unknownModelLink = languageModels.some(model => model.credential !== null &&
    !row!.data.credentials!.some(c => c.id === model.credential && c.provider === model.provider && !c.decryption_problem));
  const unresolved = unknownModelLink || languageCredentials.some(c => c.decryption_problem || !supportedProviderNames.includes(c.provider)
    || !row!.data.providers!.some(p => p.name === c.provider && p.modalities.includes('language'))
    || links(c).length !== c.model_count || links(c).some(model => model.provider !== c.provider));
  const pending = navigationKnown && !unresolved ? languageCredentials.filter(c => c.model_count === 0 || languageModels.length === 0) : [];
  const registerLabel = (credential: Credential) => m.registerFor.replace('{{configuration}}',
    providerName(credential.provider) + ' · ' + credential.name);
  const firstPending = pending[0];
  let primary = { href: '#model-setup-status', label: m.reviewStatus };
  if (navigationKnown && !unresolved) {
    if (pending.length === 1 && firstPending) primary = { href: '#' + credentialSetupAnchor(firstPending.id), label: registerLabel(firstPending) };
    else if (pending.length > 1) primary = { href: '#model-setup-pending', label: m.reviewPending };
    else if (languageModels.length > 0)
      primary = { href: '#model-default-assignments', label: m.reviewDefaults };
    else if (canAddConfiguration && languageCredentials.length === 0 && row!.data.providers!.some(p =>
      supportedProviderNames.includes(p.name) && p.modalities.includes('language')))
      primary = { href: '#model-setup-providers', label: m.addChat };
  }
  return <section className="model-setup-guide" aria-label={m.title}>
    <h2>{m.title}</h2>
    <dl aria-live="polite">
      <div><dt>{m.saved}</dt><dd>{available(metadata, 'credentials') ? row!.data.credentials!.length : missing(['credentials'])}</dd></div>
      <div><dt>{m.registered}</dt><dd>{available(metadata, 'models') ? row!.data.models!.length : missing(['models'])}</dd></div>
      <div className="model-setup-wide"><dt>{m.chat}</dt><dd>{chat}</dd></div>
      <div className="model-setup-wide"><dt>{m.validation}</dt><dd>{validation}</dd></div>
    </dl>
    <div className="dialog-actions">
      <a className="button" href={primary.href}>{primary.label}</a>
      <a className="button" href="#registered-models">{m.reviewModels}</a>
    </div>
    {pending.length > 1 && <ul id="model-setup-pending" tabIndex={-1} aria-label={m.reviewPending}>
      {pending.map(credential => <li key={credential.id}>
        <a href={'#' + credentialSetupAnchor(credential.id)}>{registerLabel(credential)}</a>
      </li>)}
    </ul>}
    <p>{m.defaultPolicy}</p>
    <details>
      <summary>{m.explanation}</summary>
      <p>{m.defaultNext}</p>
      <p>{m.testHint} {m.testLimit} {m.taskScope}</p>
    </details>
  </section>;
}

export function CredentialSetupHint({ row, credential }: { row: Metadata | undefined; credential: Credential }) {
  const { locale } = useI18n(), m = modelSetupCopy(locale);
  if (!available(row, 'credentials') || credential.decryption_problem) return null;
  if (!available(row, 'models')) return <p>{m.linksUnknown}</p>;
  const links = row!.data.models!.filter(model => model.credential === credential.id);
  if (links.length !== credential.model_count || links.some(model => model.provider !== credential.provider))
    return <p>{m.linksUnknown}</p>;
  const purposes = credential.modalities.map(type => ({
    embedding: m.retrieval, text_to_speech: m.audio, speech_to_text: m.transcription
  }[type])).filter(Boolean).join(' · ');
  return links.length === 0 ? <p>{credential.modalities.includes('language') ? m.noModels : m.noModelsOther.replace('{{tasks}}', purposes || m.unknown)}</p> : null;
}

export function ModelCredentialLink({ row, model }: { row: Metadata | undefined; model: Model }) {
  const { locale } = useI18n(), m = modelSetupCopy(locale);
  const current = available(row, 'models');
  const credential = current && available(row, 'credentials') && model.credential !== null
    ? row!.data.credentials!.find(item => item.id === model.credential && item.provider === model.provider) : undefined;
  const label = !current ? m.unknown : model.credential === null ? m.unbound : credential?.name || m.unknown;
  return <p>{m.linked}: {label}</p>;
}

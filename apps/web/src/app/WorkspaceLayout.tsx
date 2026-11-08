import type { ReactNode } from 'react';
import { useI18n } from '../i18n';
import { Button } from '../ui/Button';

export type WorkspaceSection = 'sources' | 'conversation' | 'studio';
export type WorkspaceLayoutProps = {
  sources: ReactNode; conversation: ReactNode; studio: ReactNode; reader: ReactNode;
  readerOpen: boolean; activeSection: WorkspaceSection;
  onSectionChange(section: WorkspaceSection): void;
};

/** Stable slot order preserves in-memory editors/readers across every breakpoint. */
export function WorkspaceLayout({ sources, conversation, studio, reader, readerOpen, activeSection, onSectionChange }: WorkspaceLayoutProps) {
  const { shell } = useI18n();
  const icons = { sources: '▤', conversation: '↳', studio: '▧' };
  return <div className="workspace-frame">
    <nav className="section-navigation" aria-label={shell.sections}>
      {(['sources', 'conversation', 'studio'] as const).map(section =>
        <Button key={section} aria-pressed={activeSection === section} onClick={() => onSectionChange(section)}>
          <span aria-hidden="true">{icons[section]}</span>{shell[section]}
        </Button>)}
    </nav>
    <div className="workspace-layout" data-reader-open={readerOpen} data-active-section={activeSection}>
      <section className="workspace-panel workspace-sources" aria-label={shell.sources}>{sources}</section>
      <section className="workspace-panel workspace-conversation" aria-label={shell.conversation}>{conversation}</section>
      <section className="workspace-panel workspace-studio" aria-label={shell.studio}>{studio}</section>
      <section className="workspace-panel workspace-reader" aria-label={shell.reader} hidden={!readerOpen}>{reader}</section>
    </div>
  </div>;
}

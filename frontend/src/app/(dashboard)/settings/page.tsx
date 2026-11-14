'use client'

import Link from 'next/link'
import { Bot, Shuffle, Wrench, ArrowUpRight } from 'lucide-react'
import { AppShell } from '@/components/layout/AppShell'
import { ThemeToggle } from '@/components/common/ThemeToggle'
import { LanguageToggle } from '@/components/common/LanguageToggle'
import { WebSearchSettings } from '@/components/settings/WebSearchSettings'
import { SettingsForm } from './components/SettingsForm'
import { useTranslation } from '@/lib/hooks/use-translation'

export default function SettingsPage() {
  const { t } = useTranslation()
  return <AppShell><div className="min-h-0 flex-1 overflow-y-auto"><div className="mx-auto max-w-4xl space-y-8 px-4 py-7 lg:px-8">
    <header className="space-y-2"><h1 className="font-display text-2xl font-semibold tracking-tight">{t('navigation.settings')}</h1><p className="max-w-2xl text-sm leading-6 text-muted-foreground">{t('learningWorkspace.settingsDescription')}</p></header>
    <section className="space-y-4 border-b pb-7"><h2 className="text-base font-semibold">{t('learningWorkspace.preferences')}</h2><div className="flex flex-wrap gap-3"><ThemeToggle /><LanguageToggle /></div></section>
    <section className="space-y-4"><h2 className="text-base font-semibold">{t('learningWorkspace.connections')}</h2><div className="divide-y rounded-lg border bg-card">{[
      { href: '/settings/models', key: 'navigation.models', icon: Bot },
      { href: '/transformations', key: 'navigation.transformations', icon: Shuffle },
      { href: '/advanced', key: 'navigation.advanced', icon: Wrench },
    ].map(item => <Link className="flex min-h-14 items-center gap-3 px-4 py-3 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" key={item.href} href={item.href}><item.icon className="size-4 text-muted-foreground" aria-hidden="true" /><span>{t(item.key)}</span><ArrowUpRight className="ml-auto size-4 text-muted-foreground" aria-hidden="true" /></Link>)}</div></section>
    <WebSearchSettings />
    <SettingsForm />
    <footer className="border-t pt-5 text-xs text-muted-foreground"><a href="https://github.com/lfnovo/open-notebook" target="_blank" rel="noopener noreferrer" className="hover:underline">{t('common.appName')}</a></footer>
  </div></div></AppShell>
}

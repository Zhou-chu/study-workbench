'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslation } from '@/lib/hooks/use-translation'
import { cn } from '@/lib/utils'

export function SettingsNavigation() {
  const { t } = useTranslation()
  const pathname = usePathname()
  return <nav aria-label={t('learningWorkspace.settingsNavigation')} className="flex shrink-0 gap-1 overflow-x-auto border-b bg-card px-4 py-2 lg:px-6">{[
    { href: '/settings', key: 'navigation.settings' },
    { href: '/settings/models', key: 'navigation.models' },
    { href: '/transformations', key: 'navigation.transformations' },
    { href: '/advanced', key: 'navigation.advanced' },
  ].map(item => <Link key={item.href} href={item.href} aria-current={pathname === item.href ? 'page' : undefined} className={cn('shrink-0 rounded-md px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', pathname === item.href ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-muted')}>{t(item.key)}</Link>)}</nav>
}

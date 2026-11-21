'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BookOpen, Search, Headphones, Settings, LogOut, PanelLeftClose, PanelLeftOpen, Library, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/lib/hooks/use-auth'
import { useSidebarStore } from '@/lib/stores/sidebar-store'
import { useCreateDialogs } from '@/lib/hooks/use-create-dialogs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslation } from '@/lib/hooks/use-translation'

export function AppSidebar() {
  const { t } = useTranslation()
  const pathname = usePathname()
  const { logout, isLoading: authBusy } = useAuth()
  const { isCollapsed, toggleCollapse } = useSidebarStore()
  const { openNotebookDialog } = useCreateDialogs()
  const settingsActive = pathname?.startsWith('/settings') || pathname === '/advanced' || pathname === '/transformations'
  const navigation = [
    { label: t('navigation.notebooks'), href: '/notebooks', icon: BookOpen },
    { label: t('navigation.sources'), href: '/sources', icon: Library },
    { label: t('navigation.askAndSearch'), href: '/search', icon: Search },
    { label: t('navigation.podcasts'), href: '/podcasts', icon: Headphones },
  ]
  const navigationLink = (item: typeof navigation[number], active: boolean) => {
    const Icon = item.icon
    const separateSettings = item.href === '/settings' && pathname?.endsWith('/study')
    const link = <Link href={item.href} target={separateSettings ? '_blank' : undefined} rel={separateSettings ? 'noopener noreferrer' : undefined} title={separateSettings ? t('learningWorkspace.settingsOpenSeparately') : undefined} aria-label={item.label} aria-current={active ? 'page' : undefined} className={cn('flex min-h-10 items-center gap-3 rounded-md px-3 text-sm transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', active ? 'bg-card font-semibold text-foreground ring-1 ring-border' : 'text-muted-foreground', isCollapsed && 'justify-center px-2')}><Icon className={cn('size-4 shrink-0', active && 'text-fern')} aria-hidden="true" />{!isCollapsed && <span>{item.label}</span>}</Link>
    return isCollapsed ? <Tooltip key={item.href}><TooltipTrigger asChild>{link}</TooltipTrigger><TooltipContent side="right">{item.label}</TooltipContent></Tooltip> : <div key={item.href}>{link}</div>
  }
  return <TooltipProvider delayDuration={100}>
    <aside className={cn('app-sidebar flex h-full flex-col border-r bg-sidebar', isCollapsed ? 'w-16' : 'w-52')}>
      <div className={cn('flex h-16 shrink-0 items-center gap-2 px-3', isCollapsed ? 'justify-center' : 'justify-between')}>
        {!isCollapsed && <Link href="/notebooks" className="flex min-w-0 items-center gap-2 text-sm font-semibold tracking-tight"><span className="flex size-7 items-center justify-center rounded-md bg-fern text-primary-foreground" aria-hidden="true"><BookOpen className="size-4" /></span><span className="truncate">{t('workbench.title')}</span></Link>}
        <Button variant="ghost" size="icon" onClick={toggleCollapse} aria-label={t('workbench.navigation')} aria-expanded={!isCollapsed} data-testid="sidebar-toggle">{isCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}</Button>
      </div>
      <div className="px-3 pb-4"><Button className={cn('w-full gap-2', !isCollapsed && 'justify-start')} onClick={openNotebookDialog} aria-label={t('common.newNotebook')}><Plus className="size-4 shrink-0" aria-hidden="true" />{!isCollapsed && t('common.newNotebook')}</Button></div>
      <nav aria-label={t('navigation.nav')} className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3">{navigation.map(item => navigationLink(item, pathname === item.href || !!pathname?.startsWith(`${item.href}/`)))}</nav>
      <div className="space-y-1 border-t p-3">
        {navigationLink({ label: t('navigation.settings'), href: '/settings', icon: Settings }, !!settingsActive)}
        <Button variant="ghost" className={cn('w-full gap-3 text-muted-foreground', isCollapsed ? 'justify-center px-2' : 'justify-start px-3')} onClick={() => void logout()} disabled={authBusy} aria-label={t('common.signOut')}><LogOut className="size-4 shrink-0" aria-hidden="true" />{!isCollapsed && t('common.signOut')}</Button>
      </div>
    </aside>
  </TooltipProvider>
}

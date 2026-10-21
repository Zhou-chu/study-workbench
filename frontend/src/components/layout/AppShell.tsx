'use client'

import { useState } from 'react'
import { Menu } from 'lucide-react'
import { AppSidebar } from './AppSidebar'
import { SetupBanner } from './SetupBanner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { useTranslation } from '@/lib/hooks/use-translation'

interface AppShellProps {
  children: React.ReactNode
}

export function AppShell({ children }: AppShellProps) {
  const { t } = useTranslation()
  const [navigationOpen, setNavigationOpen] = useState(false)
  return (
    <div className="flex h-dvh overflow-hidden">
      <div className="hidden lg:block shrink-0"><AppSidebar /></div>
      <main className="flex-1 min-w-0 flex flex-col min-h-0 overflow-hidden">
        <div className="lg:hidden shrink-0 border-b p-2">
          <Dialog open={navigationOpen} onOpenChange={setNavigationOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="sm"><Menu className="size-4" aria-hidden="true" /><span>{t('workbench.navigation')}</span></Button>
            </DialogTrigger>
            <DialogContent className="left-0 top-0 h-dvh w-72 max-w-[calc(100%-2rem)] translate-x-0 translate-y-0 rounded-none p-0 block">
              <DialogTitle className="sr-only">{t('workbench.navigation')}</DialogTitle>
              <div className="h-full overflow-y-auto" onClick={event => { if ((event.target as HTMLElement).closest('a')) setNavigationOpen(false) }}>
                <AppSidebar />
              </div>
            </DialogContent>
          </Dialog>
        </div>
        <SetupBanner />
        {children}
      </main>
    </div>
  )
}

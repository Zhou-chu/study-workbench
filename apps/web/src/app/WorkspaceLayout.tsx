import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '../i18n';
import { Button } from '../ui/Button';
export type WorkspaceSection = 'sources' | 'conversation' | 'studio';
export type WorkspaceLayoutProps = {
 sources: ReactNode; conversation: ReactNode; studio: ReactNode; reader: ReactNode;
 readerKey?: string | undefined;
 readerOpen: boolean; activeSection: WorkspaceSection;
 onSectionChange(section: WorkspaceSection): void;
};
/** Stable DOM slots preserve readers and drafts across view changes. */
export function WorkspaceLayout({ sources, conversation, studio, reader, readerOpen, readerKey, activeSection, onSectionChange }: WorkspaceLayoutProps) {
 const { shell } = useI18n();
 const [view,setView] = useState<{mode:'balanced'|'reader'|'conversation';key:string|undefined}>({mode:'balanced',key:readerKey});
 const setFocus=(mode:'balanced'|'reader'|'conversation')=>setView({mode,key:readerKey});
 const focus=view.key===readerKey?view.mode:'balanced';
 const readerPanel=useRef<HTMLElement>(null);
 const [narrow,setNarrow]=useState(()=>window.matchMedia('(max-width: 899px)').matches);
 useLayoutEffect(()=>{
  const media=window.matchMedia('(max-width: 899px)');
  const update=()=>setNarrow(media.matches);
  update();media.addEventListener('change',update);
  return ()=>media.removeEventListener('change',update);
 },[]);
 // The full-screen reader is a modal only while visible at the narrow breakpoint.
 // Preserve existing inert attributes; do not remount any background editors.
 useLayoutEffect(()=>{
  const panel=readerPanel.current;
  if(!narrow||!readerOpen||!panel)return;
  const isolated:HTMLElement[]=[];
  let branch:HTMLElement=panel;
  while(branch.parentElement){
   for(const sibling of Array.from(branch.parentElement.children)){
    if(sibling!==branch&&sibling instanceof HTMLElement&&!sibling.hasAttribute('inert')){
     sibling.setAttribute('inert','');isolated.push(sibling);
    }
   }
   if(branch.parentElement===document.body)break;
   branch=branch.parentElement;
  }
  if(!panel.contains(document.activeElement)){
   panel.querySelector<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]')?.focus({preventScroll:true});
  }
  return ()=>{for(const element of isolated)element.removeAttribute('inert');};
 },[narrow,readerOpen,readerKey]);
 const chooseSection = (section:WorkspaceSection) => { setFocus('balanced'); onSectionChange(section); };
 const currentFocus = readerOpen ? focus : 'balanced';
 return <div className="workspace-frame study-workspace">
  <div className="study-toolbar">
   <nav className="section-navigation" aria-label={shell.sections}>
    {(['sources','conversation','studio'] as const).map(section=><Button key={section} aria-pressed={activeSection===section} onClick={()=>chooseSection(section)}>{shell[section]}</Button>)}
   </nav>
   {readerOpen && <div className="study-view-control" role="group" aria-label={shell.viewMode}>
    <Button variant="quiet" aria-pressed={currentFocus==='balanced'} onClick={()=>setFocus('balanced')}>{shell.sideBySide}</Button>
    <Button variant="quiet" aria-pressed={currentFocus==='reader'} onClick={()=>setFocus('reader')}>{shell.expandReading}</Button>
    <Button variant="quiet" aria-pressed={currentFocus==='conversation'} onClick={()=>{setFocus('conversation');onSectionChange('conversation');}}>{shell.expandAnswers}</Button>
   </div>}
  </div>
  <div className="workspace-layout" data-reader-open={readerOpen} data-active-section={activeSection} data-focus={currentFocus}>
   <section className="workspace-panel workspace-sources" aria-label={shell.sources}>{sources}</section>
   <section ref={readerPanel} className="workspace-panel workspace-reader" aria-label={shell.reader} hidden={!readerOpen}>{reader}</section>
   <section className="workspace-panel workspace-conversation" aria-label={shell.conversation}>{conversation}</section>
   <section className="workspace-panel workspace-studio" aria-label={shell.studio}>{studio}</section>
  </div>
 </div>;
}

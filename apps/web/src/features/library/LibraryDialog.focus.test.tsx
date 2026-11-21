import {useState} from 'react';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {it,expect,vi} from 'vitest';
import {LibraryDialog} from './LibraryDialog';
vi.mock('../../i18n',()=>({useI18n:()=>({t:{common:{close:'Close'}}})}));
it.each(['Escape','Close','conditional Escape','conditional Close'])('returns focus to the opener after %s',async method=>{
 function Example(){const [open,setOpen]=useState(false);return <><button onClick={()=>setOpen(true)}>Test model</button>{(!method.startsWith('conditional')||open)&&<LibraryDialog open={open} onOpenChange={setOpen} title="Confirm test"><button>Confirm</button></LibraryDialog>}</>;}
 render(<Example/>);
 const opener=screen.getByRole('button',{name:'Test model'});
 opener.focus();fireEvent.click(opener);
 const dialog=await screen.findByRole('dialog');
 await waitFor(()=>expect(dialog.contains(document.activeElement)).toBe(true));
 if(method.endsWith('Escape'))fireEvent.keyDown(document.activeElement!,{key:'Escape'});
 else fireEvent.click(screen.getByRole('button',{name:'Close'}));
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
 await waitFor(()=>expect(opener).toHaveFocus());
});

it.each(['removed','disabled','unmounted'])('does not restore an invalid opener after %s',async mode=>{
 function Example({show=true,disabled=false}:{show?:boolean;disabled?:boolean}){
 const [open,setOpen]=useState(false);return <>{show&&<button disabled={disabled} onClick={()=>setOpen(true)}>Open</button>}<LibraryDialog open={open} onOpenChange={setOpen} title="Dialog"><button>Confirm</button></LibraryDialog></>;
 }
 const h=render(<Example/>);
 const opener=screen.getByRole('button',{name:'Open'});
 opener.focus();fireEvent.click(opener);
 await screen.findByRole('dialog');
 const focus=vi.spyOn(opener,'focus');focus.mockClear();
 if(mode==='unmounted')h.unmount();
 else {
 h.rerender(<Example show={mode!=='removed'} disabled={mode==='disabled'}/>);
 fireEvent.keyDown(document.activeElement!,{key:'Escape'});
 }
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
 await new Promise(resolve=>setTimeout(resolve,20));
 expect(focus).not.toHaveBeenCalled();
});

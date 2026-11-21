import { render, screen } from '@testing-library/react'
import { useState } from 'react'
import { expect, it } from 'vitest'
import type { WebTransport } from '@study/web-transport'
import { AppProviders, useAppData } from './providers'
it('accepts a replacement transport without remounting a draft',()=>{
 const first:WebTransport={send:async()=>new Response('first')}
 const second:WebTransport={send:async()=>new Response('second')}
 let observed:WebTransport|undefined
 function Child(){observed=useAppData().transport;const [draft]=useState('Keep this');return <input aria-label="Draft" value={draft} readOnly/>}
 const view=render(<AppProviders transport={first}><Child/></AppProviders>)
 const input=screen.getByLabelText('Draft')
 expect(observed).toBe(first)
 view.rerender(<AppProviders transport={second}><Child/></AppProviders>)
 expect(observed).toBe(second)
 expect(screen.getByLabelText('Draft')).toBe(input)
 expect(input).toHaveValue('Keep this')
})

import {fireEvent, render, screen} from '@testing-library/react';
import {createMemoryRouter, RouterProvider, Outlet} from 'react-router';
import {expect, it, vi} from 'vitest';
import {SetupLink, SetupReturnLink, safeSetupReturn} from './SetupLink';
vi.mock('../../i18n',()=>({useI18n:()=>({t:{common:{back:'Back'}}})}));
it.each(['https://evil.example','//evil.example','/\\evil.example','/%2f%2fevil.example','/settings/models','/login','/notebooks\n'])('rejects unsafe or irrelevant return target %s', value=>expect(safeSetupReturn(value)).toBeNull());
it('keeps the working route across settings steps and returns without history dependence', async()=>{
 const router=createMemoryRouter([{element:<><SetupReturnLink/><Outlet/></>,children:[
 {path:'/notebooks/:id',element:<SetupLink to="/settings">Configure</SetupLink>},
 {path:'/settings',element:<SetupLink to="/settings/models">Models</SetupLink>},
 {path:'/settings/models',element:<p>Model configuration</p>}]}],{initialEntries:['/notebooks/example?tab=conversation#composer']});
 render(<RouterProvider router={router}/>);
 fireEvent.click(screen.getByRole('link',{name:'Configure'}));
 fireEvent.click(await screen.findByRole('link',{name:'Models'}));
 expect(await screen.findByText('Model configuration')).toBeVisible();
 expect(screen.getByRole('link',{name:'Back'})).toHaveAttribute('href','/notebooks/example?tab=conversation#composer');
 fireEvent.click(screen.getByRole('link',{name:'Back'}));
 expect(await screen.findByRole('link',{name:'Configure'})).toBeVisible();
 expect(screen.queryByRole('link',{name:'Back'})).toBeNull();
});

it('uses an explicit safe return route for local profile state',async()=>{
 const router=createMemoryRouter([{path:'/podcasts',element:<SetupLink to="/settings/models" returnTo="/podcasts?tab=profiles">Configure profiles</SetupLink>},{path:'/settings/models',element:<SetupReturnLink/>}],{initialEntries:['/podcasts']});
 render(<RouterProvider router={router}/>);
 fireEvent.click(screen.getByRole('link',{name:'Configure profiles'}));
 expect(await screen.findByRole('link',{name:'Back'})).toHaveAttribute('href','/podcasts?tab=profiles');
});

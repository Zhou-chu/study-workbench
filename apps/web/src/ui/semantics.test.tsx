import { render, screen, fireEvent } from '@testing-library/react';
import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Button } from './Button';
import { StatusBadge } from './StatusBadge';
import { Tabs } from './Tabs';
import { Dialog } from './Dialog';
it('distinguishes every gray status with icon and accessible text', () => {
    const states = ['success', 'warning', 'error', 'pending', 'unknown'] as const;
    render(<>{states.map(state => <StatusBadge key={state} state={state} label={state}/>)}</>);
    expect(screen.getAllByRole('status')).toHaveLength(5);
    const icons = states.map(state => { const badge = screen.getByText(state).closest('[role=status]')!; expect(badge).toHaveTextContent(state); return badge.querySelector('[aria-hidden]')?.textContent; });
    expect(new Set(icons).size).toBe(5);
});
it('uses native button and selected keyboard-operable tab semantics', () => {
    render(<><Button disabled>Unavailable</Button><Tabs label="Sections" defaultValue="one" items={[{ value: 'one', label: 'One', content: 'First' }, { value: 'two', label: 'Two', content: 'Second' }]}/></>);
    expect(screen.getByRole('button')).toBeDisabled();
    expect(screen.getByRole('tab', { name: 'One' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Two' }), { button: 0, ctrlKey: false });
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Two' }), { key: 'Enter' });
    expect(screen.getByRole('tab', { name: 'Two' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Second');
});
it('dialog labels content, closes on Escape and restores trigger focus', async () => {
    render(<Dialog trigger="Open settings" title="Settings" description="Appearance preferences" closeLabel="Close"><p>Options</p></Dialog>);
    const trigger = screen.getByRole('button', { name: 'Open settings' });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Settings');
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription('Appearance preferences');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(trigger).toHaveFocus();
});
it('declares 44px targets, visible focus, distinct selection and no media filter', () => {
    const css = readFileSync('src/app/styles.css', 'utf8');
    expect(css).toMatch(/min-block-size:\s*44px/);
    expect(css).toMatch(/min-inline-size:\s*44px/);
    expect(css).toMatch(/:focus-visible/);
    expect(css).toMatch(/aria-selected/);
    expect(css).not.toMatch(/grayscale\(|filter\s*:/);
});

it('keeps an icon-only dialog trigger named when its visual label is hidden',()=>{
 render(<Dialog trigger={<span aria-hidden="true">⚙</span>} triggerLabel="Preferences" title="Appearance" description="Choose appearance" closeLabel="Close"><p>Options</p></Dialog>)
 expect(screen.getByRole('button',{name:'Preferences'})).toBeVisible()
})

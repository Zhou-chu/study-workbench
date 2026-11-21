import * as Radix from '@radix-ui/react-tabs';
import { useState } from 'react';
import type { ReactNode } from 'react';
export type TabItem = {
    value: string;
    label: string;
    content: ReactNode;
};
export function Tabs({ label, items, defaultValue }: {
    label: string;
    items: TabItem[];
    defaultValue: string;
}) {
    const [value, setValue] = useState(defaultValue);
    return <Radix.Root value={value} onValueChange={setValue}><Radix.List className="tabs-list" aria-label={label}>{items.map(item => <Radix.Trigger className="tab" key={item.value} value={item.value}>{item.label}</Radix.Trigger>)}</Radix.List>{items.map(item => <Radix.Content forceMount hidden={value !== item.value} className="tab-panel" key={item.value} value={item.value}>{item.content}</Radix.Content>)}</Radix.Root>;
}

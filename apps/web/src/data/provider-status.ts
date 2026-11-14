import { isRecord } from '@study/contracts';
export type ProviderStatus = Readonly<{ state: string; reason?: string | null; account_label?: string | null; last_verified_at?: string | null; quota?: number | null }>;
/** Exact safe ConnectionStatus projection. Missing/null are not positive evidence. */
export function parseProviderStatus(value: unknown): ProviderStatus {
 if (!isRecord(value) || typeof value.state !== 'string' || !value.state || value.state.length > 80 ||
 !['reason','account_label','last_verified_at'].every(k => value[k] === undefined || value[k] === null || typeof value[k] === 'string' && value[k].length <= 1000) ||
 value.quota !== undefined && value.quota !== null && (!Number.isSafeInteger(value.quota) || Number(value.quota) < 0)) throw new Error('Invalid provider metadata');
 return Object.freeze({state:value.state,...(value.reason !== undefined ? {reason:typeof value.reason==='string'?(value.reason.match(/^[A-Z][A-Z0-9_]{0,80}/)?.[0]??null):null}:{}),...(value.account_label !== undefined ? {account_label:value.account_label as string|null}:{}),...(value.last_verified_at !== undefined ? {last_verified_at:value.last_verified_at as string|null}:{}),...(value.quota !== undefined ? {quota:value.quota as number|null}:{})});
}

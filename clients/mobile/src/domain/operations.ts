import { copy } from './contracts.ts';
import type { Job, OutlineRequest, Receipt, SubmissionResult } from './contracts.ts';
export interface OutlineOperation {
  idempotencyKey:string; request:OutlineRequest; status:'pending'|'receipt'|'unknown'|'error';
  receipt?:Receipt; job?:Job;
}
// No replay policy has been authorized, including for unrecognized states.
export function canReplay(_job:Job):boolean { return false; }
export function beginOutline(existing:OutlineOperation|null,request:OutlineRequest,key:string,origin?:Job):OutlineOperation {
  if (origin?.restored_history === true || origin?.replay_allowed === false) throw new Error('Historical replay forbidden');
  if (existing) return existing;
  return {idempotencyKey:key,request:copy(request),status:'pending'};
}
export function receiveSubmission(operation:OutlineOperation,result:SubmissionResult):OutlineOperation {
  if (operation.status !== 'pending') return operation;
  return result.kind === 'receipt' ? {...operation,status:'receipt',receipt:copy(result.receipt)} : {...operation,status:result.kind};
}
export function resumeOperation(operation:OutlineOperation,job:Job):OutlineOperation {
  if (operation.receipt?.job_id !== job.job_id) return operation;
  return {...operation,job:copy(job)};
}

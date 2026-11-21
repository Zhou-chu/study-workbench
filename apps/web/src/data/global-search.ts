import { isRecord } from '@study/contracts';
export type GlobalQuery = {question:string; mode:'search'|'ask'; searchType:'text'|'vector'; includeSources:boolean; includeNotes:boolean; notebooks:readonly string[]};
export type AskModels = {strategy_model:string;answer_model:string;final_answer_model:string};
export type SearchResult = Record<string,unknown>;
export type SearchResponse = {results:SearchResult[];total_count:number;search_type:string};
export function validScope(ids:readonly string[]) {return ids.length<=50 && ids.every(id=>!!id.trim() && !/[\\/\s\u0000-\u001f?#]/.test(id));}
export function parseSearch(value:unknown):SearchResponse {
 if(!isRecord(value)||!Array.isArray(value.results)||!value.results.every(isRecord)||typeof value.total_count!=='number'||!Number.isInteger(value.total_count)||value.total_count<0||typeof value.search_type!=='string')throw new Error('Invalid search response');
 return {results:value.results,total_count:value.total_count,search_type:value.search_type};
}
export function resultScore(row:SearchResult):number|null {for(const key of ['relevance','similarity','score']){const v=row[key];if(typeof v==='number' && Number.isFinite(v))return v;}return null;}

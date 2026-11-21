import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const tokens=readFileSync(new URL('../src/theme/tokens.css',import.meta.url),'utf8');
const css=readFileSync(new URL('../src/theme/editorial.css',import.meta.url),'utf8');
test('soft floating layers keep solid and accessibility fallbacks',()=>{
 for(const term of ['--overlay-glass','blur(12px)','prefers-reduced-transparency: reduce','forced-colors: active','--overlay-radius: 18px']) assert.ok(css.includes(term),term);
});
const lum=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
const ratio=(a,b)=>(Math.max(lum(a),lum(b))+.05)/(Math.min(lum(a),lum(b))+.05);
test('actual glass and all ordinary text tokens pass over extreme backdrops',()=>{
 const glasses=[...css.matchAll(/--overlay-glass: rgb\((\d+) (\d+) (\d+) \/ (\d+)%\)/g)];
 assert.equal(glasses.length,2);
 const themes=tokens.split(':root[data-theme="dark"]');
 glasses.forEach((match,i)=>{
  const surface=match.slice(1,4).map(Number),alpha=Number(match[4])/100;
  for(const name of ['text','muted','auxiliary','error','warning','success']) {
   const hex=themes[i].match(new RegExp('--'+name+': #([0-9A-Fa-f]{6})'))[1];
   const text=hex.match(/../g).map(v=>parseInt(v,16));
   for(const bg of [0,255]) for(const glow of [0,.02]) assert.ok(ratio(surface.map(v=>(v*alpha+bg*(1-alpha))*(1-glow)+255*glow),text)>=4.5,`${i} ${name}`);
  }
 });
});
test('reduced transparency and forced-colors contain real fallback declarations',()=>{
 for(const feature of ['prefers-reduced-transparency: reduce','forced-colors: active']) {
  const block=css.slice(css.indexOf('@media ('+feature)).split('\n}')[0];
  assert.match(block,/background: (var\(--surface\)|Canvas)/);
  assert.match(block,/-webkit-backdrop-filter: none/);
  assert.match(block,/[; ]backdrop-filter: none/);
 }
});

test('charcoal shell keeps text and control borders distinguishable',()=>{
 const dark=tokens.split(':root[data-theme="dark"]')[1];
 for(const hex of [...css.matchAll(/#([0-9A-F]{6}) 0%/g)].map(m=>m[1])) {
  const bg=hex.match(/../g).map(v=>parseInt(v,16));
  for(const name of ['text','muted','auxiliary','interactive-border']) {
   const fg=dark.match(new RegExp('--'+name+': #([0-9A-Fa-f]{6})'))[1].match(/../g).map(v=>parseInt(v,16));
   assert.ok(ratio(bg,fg)>=(name==='interactive-border'?3:4.5),name+'/'+hex);
  }
 }
});

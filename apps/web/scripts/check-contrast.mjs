import { readFileSync } from 'node:fs'
const css=readFileSync(new URL('../src/theme/tokens.css',import.meta.url),'utf8')
const blocks=[...css.matchAll(/:root[^}]*\{([^}]+)\}/g)].map(match=>Object.fromEntries([...match[1].matchAll(/--([\w-]+):\s*(#[\da-f]{6})/gi)].map(item=>[item[1],item[2]])))
if(blocks.length!==2) throw new Error('Expected both actual theme token blocks')
function luminance(hex){ const rgb=hex.slice(1).match(/../g).map(value=>parseInt(value,16)/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4); return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2] }
const pairs=[['text','background',4.5],['text','surface',4.5],['muted','background',4.5],['muted','surface',4.5],['text','selected',4.5],['muted','selected',4.5],['on-primary','primary',4.5],['interactive-border','background',3],['interactive-border','surface',3],['focus','background',3],['focus','surface',3],['focus','selected',3]]
for(const [index,tokens] of blocks.entries())for(const [foreground,background,min] of pairs){if(!tokens[foreground]||!tokens[background])throw new Error('Missing actual token');const a=luminance(tokens[foreground]),b=luminance(tokens[background]);const ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);console.log(`${index?'dark':'light'} ${foreground}/${background}: ${ratio.toFixed(2)} >= ${min}`);if(ratio<min)throw new Error(`Contrast failure ${foreground}/${background}`)}
console.log('24 token pairs passed')

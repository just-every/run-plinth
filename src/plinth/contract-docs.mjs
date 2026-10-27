import fs from 'node:fs'
import {parseContract} from '../base/seed-contract.mjs'
const mode=process.argv[2]
if(!['write','check'].includes(mode))throw Error('Use write or check')
let source=fs.readFileSync('CONTRACT.md','utf8')
const cells=line=>line.trim().slice(1,-1).split(/(?<!\\)\|/).map(v=>v.trim())
const statusRows=source.split('\n').filter(line=>/^\| `[A-Z]+-\d+`/.test(line)).map(cells)
const count=rows=>['done','partial','missing'].map(status=>rows.filter(r=>r[3]===status).length).concat(rows.length)
const summaries={'Published':count(statusRows.filter(r=>r[2]==='published')),'Target and push further':count(statusRows.filter(r=>r[2]!=='published')),'All':count(statusRows)}
source=source.split('\n').map(line=>{const row=line.startsWith('|')?cells(line):[];return summaries[row[0]]?'| '+row[0]+' | '+summaries[row[0]].join(' | ')+' |':line}).join('\n')
const contract=parseContract(source),lines=source.split('\n')
const evidence=clause=>cells(lines[clause.row-1])[4]
const acceptance=['# Plinth target acceptance','','Generated from CONTRACT.md. Change the contract, then run the Lander-Regenerate command in AGENTS.md. Each partial Gap retains the complete work still owed.','']
for(const area of contract.areas){
 acceptance.push('## '+area.name,'')
 for(const clause of contract.clauses.filter(c=>c.area===area.name))acceptance.push('- **'+clause.id+' — '+clause.title+'.** **Status:** '+clause.status+'. '+clause.text+' **Current evidence:** '+evidence(clause)+(clause.gap?' **Remaining:** '+clause.gap:''),'')
}
const claims=['# Plinth contract status','','Generated from CONTRACT.md. These are implementation statuses for the contract clauses; a partial row remains limited by its Gap.','','| Clause | Status | Gap |','| --- | --- | --- |',...contract.clauses.map(c=>'| '+c.id+' | '+c.status+' | '+c.gap+' |'),'']
const prose=value=>value.split(/(`[^`]*`|https?:\/\/[^\s)]+)/).map((part,i)=>i%2?part:part.replace(/(?<![\w.\/:-])([A-Za-z][\w-]*(?:\/[A-Za-z][\w-]*)+)(?![\w\/.-])/g,token=>token.replaceAll('/',' and '))).join('')
const outputs={'CONTRACT.md':source,'ACCEPTANCE.md':prose(acceptance.join('\n')),'docs/CLAIMS.md':prose(claims.join('\n'))}
for(const [path,content] of Object.entries(outputs)){
 if(mode==='write')fs.writeFileSync(path,content)
 else if(!fs.existsSync(path)||fs.readFileSync(path,'utf8')!==content)throw Error(path+' is stale; run the Lander-Regenerate write command')
}
console.log('Contract documents '+mode+' passed: '+JSON.stringify(contract.counts))

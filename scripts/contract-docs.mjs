import {readFileSync,writeFileSync,existsSync} from 'node:fs'
import {parseContract} from '../src/base/seed-contract.mjs'

const [mode,...ids]=process.argv.slice(2)
if(!['write','check'].includes(mode)||!ids.length)throw Error('Usage: node scripts/contract-docs.mjs write|check CLAUSE [CLAUSE ...]')
let source=readFileSync('CONTRACT.md','utf8')
const rows=source.split('\n').filter(line=>/^\| `[A-Z]/.test(line)).map(line=>line.split(/(?<!\\)\|/).slice(1,-1).map(cell=>cell.trim()))
const counts=kind=>{const selected=kind?rows.filter(row=>row[2]===kind):rows;return ['done','partial','missing'].map(status=>selected.filter(row=>row[3]===status).length).concat(selected.length)}
for(const [label,kind] of [['Published','published'],['Target and push further','target'],['All',null]]){
 const values=label==='Target and push further'?['done','partial','missing'].map(status=>rows.filter(row=>row[2]!=='published'&&row[3]===status).length).concat(rows.filter(row=>row[2]!=='published').length):counts(kind)
 source=source.replace(new RegExp('^\\| '+label+' \\|.*$','m'),'| '+label+' | '+values.join(' | ')+' |')
}
const contract=parseContract(source),selected=ids.map(id=>{const clause=contract.clauses.find(c=>c.id===id);if(!clause)throw Error('Unknown clause '+id);return clause})
let acceptance=readFileSync('ACCEPTANCE.md','utf8')
for(const clause of selected){
 const row=rows.find(r=>r[0]==='`'+clause.id+'`'),start=acceptance.indexOf('- **'+clause.id+' — ')
 if(start<0)throw Error('Acceptance entry missing for '+clause.id)
 const end=acceptance.indexOf('\n\n',start),stop=end<0?acceptance.length:end
 const proof=clause.text.split('**Acceptance evidence:**')[1]?.trim()
 if(!proof)throw Error('Acceptance evidence is missing for '+clause.id)
 const entry='- **'+clause.id+' — '+clause.title+'.** **Status:** '+clause.status+'. '+proof+' **Current evidence:** '+(row[4]||'No implementation evidence.')+(row[5]?' **Remaining:** '+row[5]:'')
 acceptance=acceptance.slice(0,start)+entry+acceptance.slice(stop)
}
const claims='# Plinth contract status\n\nGenerated from CONTRACT.md by the seed contract document generator. Acceptance and Status remain in CONTRACT.md. Partial rows retain all stated gaps.\n\n| Clause | Status | Evidence | Gap |\n| --- | --- | --- | --- |\n'+rows.map(row=>'| '+[row[0],row[3],row[4],row[5]].join(' | ')+' |').join('\n')+'\n'
for(const [path,content] of [['CONTRACT.md',source],['ACCEPTANCE.md',acceptance],['docs/CLAIMS.md',claims]]){
 if(mode==='write')writeFileSync(path,content)
 else if(!existsSync(path)||readFileSync(path,'utf8')!==content)throw Error('Stale generated document: '+path)
}
console.log('Contract documents '+mode+': '+contract.counts.total+' clauses; '+ids.join(', '))

export const historicalBytes=Buffer.from('Synthetic historical signed change. Source signature claimed by the exporter; unverified.\n')
export function historicalSource(externalId='MOVE-001'){
 const record={id:'synthetic-plinth-1',kind:'signed-change',occurredAt:'2026-09-01T12:00:00Z',description:'Old signed window change; historical evidence only',fileIds:['synthetic-plinth-original','synthetic-plinth-missing']}
 return JSON.stringify({version:1,jobs:[{externalId,files:[{id:'synthetic-plinth-original',name:'synthetic-plinth-signed-change.txt',mediaType:'text/plain',base64:historicalBytes.toString('base64')}],records:[record,{...record},...['note','schedule','invoice','payment','approval','unsupported-source-kind'].map((kind,i)=>({id:'synthetic-plinth-'+(i+2),kind,occurredAt:'2026-09-02T12:00:00Z',description:'Unverified historical '+kind,fileIds:[]}))]}]})
}

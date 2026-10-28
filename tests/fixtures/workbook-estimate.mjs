import JSZip from 'jszip'
const headers=['id','description','code','phase','category','quantity','unit','rate_unit','unit_cents','cost_unit_cents']
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')
const row=(number,values)=>`<row r="${number}">${values.map((v,i)=>{const r=String.fromCharCode(65+i)+number;if(v&&typeof v==='object')return `<c r="${r}"><f>${escape(v.formula)}</f>${v.cache===undefined?'':`<v>${v.cache}</v>`}</c>`;return `<c r="${r}" t="inlineStr"><is><t>${escape(v)}</t></is></c>`}).join('')}</row>`
export async function estimateWorkbook({missingCache=false,unsupported=false,macro=false,tag='synthetic-plinth-1'}={}) {
 const zip=new JSZip(),ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
 zip.file('[Content_Types].xml',`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${[1,2].map(n=>`<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`)
 zip.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
 zip.file('xl/workbook.xml',`<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Estimate" sheetId="1" r:id="rId1"/><sheet name="Notes" sheetId="2" r:id="rId2"/></sheets></workbook>`)
 zip.file('xl/_rels/workbook.xml.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+[1,2].map(n=>`<Relationship Id="rId${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${n}.xml"/>`).join('')+'</Relationships>')
 const first=[tag+'-wall','Framing', 'FRAME','Structure','labor','2.5','feet','feet','101','79'],second=[tag+'-sheet','Wallboard','BOARD','Finishes','material',{formula:unsupported?'WEBSERVICE("https://invalid.example")':'5/4',...(missingCache?{}:{cache:'1.25'})},'sheets','sheets','333','201'],bad=[tag+'-invalid','Unmapped fixture','INVALID','Finishes','material','1','sheets','sheets','500','300']
 zip.file('xl/worksheets/sheet1.xml',`<worksheet xmlns="${ns}"><sheetData>${[headers,first,second,first,bad].map((values,i)=>row(i+1,values)).join('')}</sheetData></worksheet>`)
 zip.file('xl/worksheets/sheet2.xml',`<worksheet xmlns="${ns}"><sheetData>${row(1,['Notes'])}${row(2,['Historical notes; not estimate inputs'])}</sheetData></worksheet>`)
 if(macro)zip.file('xl/vbaProject.bin','synthetic-plinth-unsupported-content')
 return {name:'synthetic-plinth-estimate.xlsx',base64:await zip.generateAsync({type:'base64',compression:'DEFLATE'})}
}
export const workbookMapping={sheet:'Estimate',columns:Object.fromEntries(headers.map((h,i)=>[h==='cost_code'?'code':h,String.fromCharCode(65+i)])),codes:{FRAME:'06-100',BOARD:'09-200'},units:{feet:'ft',sheets:'sheet'},currency:'USD',duplicates:'skip-identical',reviewed_formulas:true,excluded_rows:{'5':'Invalid source code held for correction'}}
export const workbookInput=async(options)=>({...await estimateWorkbook(options),title:'Synthetic coded estimate',client_email:['workbook','dev.localhost'].join('@'),address:'Synthetic site',mapping:structuredClone(workbookMapping)})

export function catalogInput(tag='synthetic-plinth-catalog-1',supplied) {
 const headers=['id','description','code','unit','unit_cents','cost_unit_cents','vendor','effective_on','reference']
 const rows=[headers,...(supplied??[[tag+'-frame','Framing rate','FRAME','feet','101','79','Synthetic supply','2026-10-01',tag+'-quote'],[tag+'-board','Board rate','BOARD','sheets','333','201','Synthetic supply','2026-10-01',tag+'-quote']])]
 const csv=rows.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n')+'\r\n'
 return {name:tag+'.csv',base64:Buffer.from(csv).toString('base64'),title:'Synthetic dated rates',mapping:{purpose:'catalog',sheet:'CSV',columns:Object.fromEntries(headers.map((h,i)=>[h,String.fromCharCode(65+i)])),codes:{FRAME:'06-100',BOARD:'09-200'},units:{feet:'ft',sheets:'sheet'},currency:'USD',duplicates:'reject',reviewed_formulas:false,excluded_rows:{}}}
}

export function costInput(job,tag='synthetic-plinth-costs-1') {
 const headers=['id','description','code','quantity','unit','unit_cents','kind','dated_on','period','reference','employee_reference']
 const csv=[headers,[tag+'-time','Reviewed framing time','TIME','1.25','hours','10001','time','2026-10-01','2026-10',tag+'-time-sheet','synthetic-plinth-worker'],[tag+'-expense','Reviewed supplies','EXPENSE','1','each','5000','expense','2026-10-01','2026-10',tag+'-receipt','synthetic-plinth-worker']].map(row=>row.map(v=>'"'+v+'"').join(',')).join('\r\n')+'\r\n'
 return {name:tag+'.csv',base64:Buffer.from(csv).toString('base64'),title:'Synthetic reviewed time and expenses',job_id:job.id,expected_version:job.version,mapping:{purpose:'costs',sheet:'CSV',columns:Object.fromEntries(headers.map((h,i)=>[h,String.fromCharCode(65+i)])),codes:{TIME:'06-100',EXPENSE:'09-200'},units:{hours:'hour',each:'each'},currency:'USD',duplicates:'reject',reviewed_formulas:false,excluded_rows:{}}}
}

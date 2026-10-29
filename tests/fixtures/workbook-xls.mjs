import {compound,u16,u32} from './legacy-documents/compound.mjs'
const rec=(kind,data=Buffer.alloc(0))=>Buffer.concat([u16(kind),u16(data.length),data])
const bof=kind=>rec(0x0809,Buffer.concat([u16(0x600),u16(kind),u16(0xdbb),u16(1997),u32(0x41),u32(6)]))
const str=value=>Buffer.concat([u16(value.length),Buffer.from([1]),Buffer.from(value,'utf16le')])
const number=value=>{const b=Buffer.alloc(8);b.writeDoubleLE(value);return b}
/** Genuine BIFF8 in an MS-CFB container, independently authored from MS-XLS. */
export function legacyWorkbook({missingCache=false,unsupported=false,macro=false,tag='synthetic-plinth-2',continued=false}={}){
 const headers=['id','description','code','phase','category','quantity','unit','rate_unit','unit_cents','cost_unit_cents']
 const first=[tag+'-wall','Framing','FRAME','Structure','labor',2.5,'feet','feet',101,79],second=[tag+'-sheet','Wallboard','BOARD','Finishes','material',{formula:true},'sheets','sheets',333,201],bad=[tag+'-invalid','Unmapped fixture','INVALID','Finishes','material',1,'sheets','sheets',500,300]
 const rows=[headers,first,second,first,bad],strings=[...new Set(rows.flat().filter(v=>typeof v==='string'))],name='Estimate'
 const cell=(row,col,value)=>{const position=Buffer.concat([u16(row),u16(col),u16(0)])
  if(typeof value==='string')return rec(0xfd,Buffer.concat([position,u32(strings.indexOf(value))]))
  if(typeof value==='number')return rec(0x203,Buffer.concat([position,number(value)]))
  const tokens=unsupported?Buffer.from([0x39,0,0,0,0,0,0]):Buffer.from([0x1e,5,0,0x1e,4,0,6])
  const cache=missingCache?Buffer.from([3,0,0,0,0,0,255,255]):number(1.25)
  return rec(6,Buffer.concat([position,cache,u16(0),u32(0),u16(tokens.length),tokens]))
 }
 const sheets=[Buffer.concat([bof(0x10),...rows.flatMap((values,r)=>values.map((v,c)=>cell(r,c,v))),rec(10)]),Buffer.concat([bof(0x10),rec(0x204,Buffer.concat([u16(0),u16(0),u16(0),str('Notes')])),rec(0x204,Buffer.concat([u16(1),u16(0),u16(0),str('Historical notes')])),rec(10)])]
 const bound=(at,n)=>rec(0x85,Buffer.concat([u32(at),Buffer.from([0,0,n.length,0]),Buffer.from(n)]))
 // The continued form splits one Unicode string's characters, exercising the BIFF continuation flag.
 const stringsBytes=Buffer.concat(strings.map(str)),split=8+3+2
 const table=Buffer.concat([u32(rows.flat().filter(v=>typeof v==='string').length),u32(strings.length),stringsBytes])
 const sst=continued?Buffer.concat([rec(0xfc,table.subarray(0,split)),rec(0x3c,Buffer.concat([Buffer.from([1]),table.subarray(split)]))]):rec(0xfc,table)
 const globals=(a,b)=>Buffer.concat([bof(5),rec(0x42,u16(1200)),bound(a,name),bound(b,'Notes'),sst,rec(10)])
 const size=globals(0,0).length,source=compound({Workbook:Buffer.concat([globals(size,size+sheets[0].length),...sheets]),...(macro?{_VBA_PROJECT:Buffer.from('synthetic-plinth-unsupported-macro')}:{})})
 return {name:'synthetic-plinth-estimate.xls',base64:source.toString('base64')}
}

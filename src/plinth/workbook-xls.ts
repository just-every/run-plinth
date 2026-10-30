import { Compound } from '../ui/attachment-legacy/compound'
import { workbook, u16, u32, unicode, type Biff } from '../ui/attachment-legacy/spreadsheet-records'
import { DomainError, need } from './model'
import type { Cell, Sheet } from './workbook-import'

const reject = (message: string): never => { throw new DomainError('invalid_workbook', message) }
const column = (n: number) => { let s = ''; for (n++; n; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s }
const float = (data: Uint8Array, at: number) => new DataView(data.buffer, data.byteOffset, data.byteLength).getFloat64(at, true)
const numeric = (value: number) => { need(Number.isFinite(value), 'Excel numeric cache is not finite'); return String(value) }
function rk(data: Uint8Array, at: number): string {
 const raw = u32(data, at), bytes = new Uint8Array(8)
 new DataView(bytes.buffer).setUint32(4, raw & 0xfffffffc, true)
 return numeric((raw & 2 ? (raw | 0) >> 2 : float(bytes, 0)) / (raw & 1 ? 100 : 1))
}
/** BIFF8 shared strings may continue mid-string with a new character-width flag. */
function sharedStrings(records: Biff[]): string[] {
 const index = records.findIndex(r => r.type === 0x00fc)
 if (index < 0) return []
 const parts = [records[index]!.data]
 for (let n = index + 1; records[n]?.type === 0x003c; n++) parts.push(records[n]!.data)
 let part = 0, at = 0
 const advance = () => { if (at === parts[part]!.length) { part++; at = 0 }; need(part < parts.length, 'Excel shared string is truncated') }
 const byte = () => { advance(); return parts[part]![at++]! }
 const word = () => byte() + byte() * 256
 const dword = () => word() + word() * 65536
 dword(); const count = dword(); need(count <= 10000, 'Excel shared strings exceed the import limit')
 const strings: string[] = []
 for (let n = 0; n < count; n++) {
  const length = word(); let flags = byte(), wide = !!(flags & 1)
  need(length <= 10000 && !(flags & 0xf2), 'Unsupported Excel string flags or length')
  const runs = flags & 8 ? word() : 0, extension = flags & 4 ? dword() : 0
  let value = ''
  for (let i = 0; i < length; i++) {
   if (at === parts[part]!.length) { advance(); flags = byte(); need(flags === 0 || flags === 1, 'Unsupported continued Excel string'); wide = !!flags }
   need(!wide || at + 2 <= parts[part]!.length, 'Excel character is truncated')
   value += String.fromCharCode(wide ? word() : byte())
  }
  for (let i = 0; i < runs * 4 + extension; i++) byte()
  strings.push(value)
 }
 return strings
}
/** Decode a bounded arithmetic and SUM vocabulary; never calculate, run macros or resolve links. */
function formula(data: Uint8Array): string | undefined {
 const stack: string[] = []; let at = 0
 const take = (n: number) => { need(at + n <= data.length, 'Excel formula tokens are truncated'); const p = at; at += n; return p }
 const pop = () => { const value = stack.pop(); need(value !== undefined, 'Excel formula has incomplete operands'); return value }
 while (at < data.length) {
  const opcode = data[take(1)]!
  if (opcode === 0x1e) stack.push(String(u16(data, take(2))))
  else if (opcode === 0x1f) stack.push(numeric(float(data, take(8))))
  else if ([0x24, 0x44, 0x64].includes(opcode)) { const p = take(4), col = u16(data, p + 2) & 0x3fff; need(col < 256, 'Unsupported Excel formula column'); stack.push(column(col) + (u16(data, p) + 1)) }
  else if ([0x25, 0x45, 0x65].includes(opcode)) { const p = take(8); stack.push(`${column(u16(data, p + 4) & 255)}${u16(data, p) + 1}:${column(u16(data, p + 6) & 255)}${u16(data, p + 2) + 1}`) }
  else if ([3,4,5,6].includes(opcode)) { const right = pop(), left = pop(); stack.push(`(${left}${({3:'+',4:'-',5:'*',6:'/'})[opcode]}${right})`) }
  else if (opcode === 0x12 || opcode === 0x13) stack.push(`${opcode === 0x13 ? '-' : '+'}${pop()}`)
  else if (opcode === 0x15) stack.push(`(${pop()})`)
  else if (opcode === 0x19) { const p = take(3); if (data[p] !== 0x10) return undefined; stack.push(`SUM(${pop()})`) }
  else if ([0x22,0x42,0x62].includes(opcode)) { const p = take(3), count = data[p]!; if (u16(data,p+1) !== 4 || count < 1 || count > stack.length) return undefined; stack.push(`SUM(${stack.splice(-count).join(',')})`) }
  else return undefined
 }
 return stack.length === 1 ? stack[0] : undefined
}
export function readXls(bytes: Uint8Array): { sheets: Sheet[]; problems: string[] } {
 try {
  const compound = new Compound(bytes), raw = compound.stream(compound.has('Workbook') ? 'Workbook' : 'Book'), globals: Biff[] = []
  for (let at = 0; at < raw.length;) { need(at + 4 <= raw.length, 'Truncated Excel globals'); const type = u16(raw,at), end = at + 4 + u16(raw,at+2); need(end <= raw.length, 'Truncated Excel globals'); globals.push({type,start:at,end,data:raw.subarray(at+4,end)}); at = end; if(type===10) break }
  const problems: string[] = []
  if (compound.names.some(n => /vba|macros|_vba_project/i.test(n)) || globals.some(r => r.type === 0x0085 && r.data[5] !== 0 && r.data[5] !== 2)) problems.push('Macros and non-worksheet executable sheets are unsupported; remove them from a copy before adoption.')
  if (globals.some(r => r.type === 0x01ae && (r.data.length < 4 || u16(r.data,2) !== 0x0401))) problems.push('External workbook links are unsupported; replace them with reviewed literal values.')
  const strings = sharedStrings(globals), source = workbook(bytes), sheets: Sheet[] = []
  need(source.sheets.length > 0 && source.sheets.length <= 10, 'Choose a workbook with 1–10 worksheets')
  for (const sheet of source.sheets) {
   const rows = new Map<number, Cell[]>()
   const put = (row: number, col: number, value: string, extra: Partial<Cell> = {}) => {
    need(row < 10000 && col < 100, 'Excel cell exceeds the supported row or column range')
    const cells = rows.get(row + 1) ?? []; need(!cells[col], 'Excel worksheet has duplicate cells'); cells[col] = {value,address:column(col)+(row+1),...extra}; rows.set(row+1,cells)
    need(rows.size <= 101, 'Worksheet exceeds 100 data rows')
   }
   for (const record of sheet.records) {
    const d = record.data, type = record.type
    if (![0x00fd,0x0203,0x027e,0x00bd,0x0006,0x0204,0x0205,0x00d6].includes(type)) continue
    need(d.length >= 6, 'Excel cell record is truncated'); const row = u16(d,0), col = u16(d,2)
    if (type === 0x00fd) { need(d.length === 10, 'Excel shared string cell is truncated'); const value = strings[u32(d,6)]; put(row,col,value??'',value===undefined?{problem:'Shared string is unavailable'}:{}) }
    else if (type === 0x0203) { need(d.length === 14, 'Excel number is truncated'); put(row,col,numeric(float(d,6))) }
    else if (type === 0x027e) { need(d.length === 10, 'Excel compact number is truncated'); put(row,col,rk(d,6)) }
    else if (type === 0x00bd) { need(d.length >= 12 && (d.length-6)%6===0, 'Excel compact number range is truncated'); const end=u16(d,d.length-2); need(end-col+1===(d.length-6)/6, 'Excel number range is inconsistent'); for(let c=col;c<=end;c++)put(row,c,rk(d,6+(c-col)*6)) }
    else if (type === 0x0204 || type === 0x00d6) { const decoded=unicode(d,6); put(row,col,decoded.text) }
    else if (type === 0x0205) { need(d.length === 8, 'Excel boolean or error is truncated'); put(row,col,String(d[6]),{problem:d[7]?'Cell contains an Excel error':'Boolean cells are unsupported for estimate inputs'}) }
    else {
     need(d.length >= 22 && 22+u16(d,20)===d.length, 'Excel formula is truncated')
     const tokens=d.subarray(22), expression=formula(tokens), special=d[12]===255&&d[13]===255
     put(row,col,special?'':numeric(float(d,6)),{formula:expression??'BIFF8 tokens '+Array.from(tokens,b=>b.toString(16).padStart(2,'0')).join(''),...(special?{problem:'Formula has no numeric cached value; recalculate and save it in the source workbook'}:!expression?{problem:'Unsupported formula; replace it with reviewed literal values'}:{})})
    }
   }
   sheets.push({name:sheet.name,rows:[...rows].sort(([a],[b])=>a-b).map(([number,cells])=>({number,cells:Array.from({length:cells.length},(_,i)=>cells[i]??{value:'',address:column(i)+number})}))})
  }
  return {sheets,problems}
 } catch (error) { if (error instanceof DomainError) throw error; return reject(error instanceof Error ? error.message : 'Invalid legacy XLS workbook') }
}

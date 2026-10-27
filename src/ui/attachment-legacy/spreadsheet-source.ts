import { fail } from './types'
const END = 0xfffffffe, FREE = 0xffffffff
/** A derived, single-stream MS-CFB v3 container. Original source bytes are never changed. */
export function spreadsheetSource(workbook: Uint8Array): Uint8Array<ArrayBuffer> {
 if (!workbook.length || workbook.length > 20 * 1024 * 1024) return fail('the derived current Excel workbook exceeds 20 MiB.')
 const small = workbook.length < 4096, miniCount = small ? Math.ceil(workbook.length / 64) : 0
 const stored = small ? miniCount * 64 : workbook.length, dataCount = Math.ceil(stored / 512), base = 1 + dataCount + (small ? 1 : 0)
 let fatCount = 0, difatCount = 0
 for (;;) {
  const nextFat = Math.ceil((base + fatCount + difatCount) / 128), nextDifat = Math.ceil(Math.max(0, nextFat - 109) / 127)
  if (nextFat === fatCount && nextDifat === difatCount) break
  fatCount = nextFat; difatCount = nextDifat
 }
 const sectorCount = base + fatCount + difatCount
 if ((sectorCount + 1) * 512 > 20 * 1024 * 1024) return fail('the derived current Excel workbook exceeds 20 MiB.')
 const output = new Uint8Array((sectorCount + 1) * 512), view = new DataView(output.buffer)
 const w16 = (at: number, value: number) => view.setUint16(at, value, true), w32 = (at: number, value: number) => view.setUint32(at, value, true)
 const sector = (id: number) => (id + 1) * 512, miniFat = 1 + dataCount, firstFat = base, firstDifat = base + fatCount
 output.set([208, 207, 17, 224, 161, 177, 26, 225]); w16(24, 0x3e); w16(26, 3); w16(28, 0xfffe); w16(30, 9); w16(32, 6)
 w32(44, fatCount); w32(48, 0); w32(56, 4096); w32(60, small ? miniFat : END); w32(64, small ? 1 : 0); w32(68, difatCount ? firstDifat : END); w32(72, difatCount)
 output.fill(255, 76, 512)
 for (let n = 0; n < Math.min(109, fatCount); n++) w32(76 + n * 4, firstFat + n)
 const directory = (index: number, name: string, kind: number, start: number, size: number, child: number) => {
  const at = sector(0) + index * 128
  for (let n = 0; n < name.length; n++) w16(at + n * 2, name.charCodeAt(n))
  w16(at + 64, (name.length + 1) * 2); output[at + 66] = kind; output[at + 67] = 1
  w32(at + 68, FREE); w32(at + 72, FREE); w32(at + 76, child); w32(at + 116, start); w32(at + 120, size)
 }
 directory(0, 'Root Entry', 5, small ? 1 : END, small ? stored : 0, 1)
 directory(1, 'Workbook', 2, small ? 0 : 1, workbook.length, FREE)
 output.set(workbook, sector(1))
 const fat = new Uint32Array(fatCount * 128); fat.fill(FREE); fat[0] = END
 for (let n = 0; n < dataCount; n++) fat[1 + n] = n + 1 < dataCount ? n + 2 : END
 if (small) {
  fat[miniFat] = END; output.fill(255, sector(miniFat), sector(miniFat) + 512)
  for (let n = 0; n < miniCount; n++) w32(sector(miniFat) + n * 4, n + 1 < miniCount ? n + 1 : END)
 }
 for (let n = 0; n < fatCount; n++) fat[firstFat + n] = 0xfffffffd
 for (let n = 0; n < difatCount; n++) fat[firstDifat + n] = 0xfffffffc
 for (let n = 0; n < fat.length; n++) w32(sector(firstFat) + n * 4, fat[n]!)
 for (let n = 0; n < difatCount; n++) {
  const at = sector(firstDifat + n); output.fill(255, at, at + 512)
  for (let j = 0; j < 127 && 109 + n * 127 + j < fatCount; j++) w32(at + j * 4, firstFat + 109 + n * 127 + j)
  w32(at + 508, n + 1 < difatCount ? firstDifat + n + 1 : END)
 }
 return output
}

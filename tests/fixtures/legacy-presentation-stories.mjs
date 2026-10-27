import { compound, u16, u32 } from './legacy-documents/compound.mjs'

const record = (type, body = Buffer.alloc(0), { instance = 0, version = 0, container = false } = {}) => Buffer.concat([u16(instance * 16 + (container ? 15 : version)),u16(type),u32(body.length),body])
const container = (type, children, instance = 0) => record(type,Buffer.concat(children),{container:true,instance})
const textBody = (value, bytes = false) => [record(0x0f9f,u32(4)),record(bytes ? 0x0fa8 : 0x0fa0,Buffer.from(value,bytes ? 'latin1' : 'utf16le'))]
const persist = (id, objectId, texts = 0) => record(0x03f3,Buffer.concat([u32(id),u32(4),u32(texts),u32(objectId),u32(0)]))
const slideAtom = (masterId = 0, notesId = 0) => {
 const body = Buffer.alloc(24); body.writeUInt32LE(1); body.writeUInt32LE(masterId >>> 0,12); body.writeUInt32LE(notesId,16); body.writeUInt16LE(7,20)
 return record(0x03ef,body,{version:2})
}
const notesAtom = slideId => record(0x03f1,Buffer.concat([u32(slideId),u16(slideId ? 7 : 0),u16(0)]),{version:1})
const scheme = () => record(0x07f0,Buffer.alloc(32),{version:0,instance:1})
function drawing(value, { bytes = false, grouped = false } = {}) {
 const properties = Buffer.alloc(8); properties.writeUInt32LE(1025); properties.writeUInt32LE(0x0a00,4)
 const textbox = container(0xf00d,textBody(value,bytes))
 const shape = container(0xf004,[record(0xf00a,properties,{version:2}),textbox])
 const shapes = grouped ? container(0xf003,[container(0xf003,[shape])]) : container(0xf003,[shape])
 return container(0x040c,[container(0xf002,[record(0xf008,Buffer.concat([u32(1),u32(1025)])),shapes])])
}
function document(mainText, { deleted = false } = {}) {
 const atom = Buffer.alloc(40); atom.writeUInt32LE(5760,0); atom.writeUInt32LE(4320,4); atom.writeUInt32LE(4320,8); atom.writeUInt32LE(5760,12); atom.writeUInt32LE(1,16); atom.writeUInt32LE(1,20); atom.writeUInt32LE(6,24); atom.writeUInt32LE(7,28); atom.writeUInt16LE(1,32)
 const masters = [persist(4,0x80000000),persist(5,0x80000001)], slides = [persist(2,256,1),...textBody(mainText)], notes = [persist(3,1000)]
 if (deleted) { masters.push(persist(10,0x80000002)); slides.push(persist(8,257,1),...textBody('Historical removed slide synthetic-plinth-9794')); notes.push(persist(9,1001)) }
 return container(0x03e8,[record(0x03e9,atom,{version:1}),container(0x0ff0,masters,1),container(0x0ff0,slides),container(0x0ff0,notes,2)])
}

/** Genuine CFB/MS-PPT incremental saves; no appended plain-text surrogate. */
export function legacyPresentationStories() {
 const terms = Array.from({length:7},(_,n)=>`synthetic-plinth-${9721+n}`)
 const absent = Array.from({length:6},(_,n)=>`synthetic-plinth-${9791+n}`)
 const chunks = [], offsets = new Map(); let length = 0
 function append(bytes) { const at = length; chunks.push(bytes); length += bytes.length; return at }
 function object(id,bytes) { offsets.set(id,append(bytes)) }
 function directory(ids) {
  // Separate valid entries permit sparse newest-edit overrides.
  return append(record(0x1772,Buffer.concat(ids.map(id=>Buffer.concat([u32((1<<20)|id),u32(offsets.get(id))])))))
 }
 function edit(directoryOffset, previous = 0) {
  const body = Buffer.alloc(28); body.writeUInt32LE(257,0); body.writeUInt32LE(0x03f40000,4); body.writeUInt32LE(previous,8); body.writeUInt32LE(directoryOffset,12); body.writeUInt32LE(1,16); body.writeUInt32LE(11,20)
  return append(record(0x0ff5,body))
 }
 object(1,document(`Historical main text ${absent[0]}`,{deleted:true}))
 // One DrawingContainer per live slide: put both shapes into its OfficeArt group.
 const slide = Buffer.concat([slideAtom(0x80000001,1000),container(0x040c,[container(0xf002,[
  record(0xf008,Buffer.concat([u32(2),u32(1026)])),
  container(0xf003,[
   container(0xf004,[record(0xf00a,Buffer.concat([u32(1025),u32(0x0a00)]),{version:2}),container(0xf00d,[record(0x0f9e,u32(0))])]),
   container(0xf003,[container(0xf004,[record(0xf00a,Buffer.concat([u32(1026),u32(0x0a00)]),{version:2}),container(0xf00d,textBody(`Current grouped slide café 😀 ${terms[1]}`))])]),
  ]),
 ])]),scheme()])
 object(2,record(0x03ee,slide,{container:true}))
 object(3,container(0x03f0,[notesAtom(256),drawing(`Historical notes ${absent[1]}`),scheme()]))
 object(4,container(0x03f8,[slideAtom(),drawing(`Historical main master ${absent[2]}`),scheme()]))
 object(5,container(0x03ee,[slideAtom(0x80000000),drawing(`Current title master ${terms[4]}`,{bytes:true}),scheme()]))
 object(6,container(0x03f0,[notesAtom(0),drawing(`Current notes master ${terms[5]}`),scheme()]))
 object(7,container(0x0fc9,[drawing(`Current handout master ${terms[6]}`,{bytes:true}),scheme()]))
 object(8,container(0x03ee,[slideAtom(0x80000002,1001),drawing(`Deleted slide ${absent[3]}`),scheme()]))
 object(9,container(0x03f0,[notesAtom(257),drawing(`Deleted notes ${absent[4]}`),scheme()]))
 object(10,container(0x03f8,[slideAtom(),drawing(`Deleted master ${absent[5]}`),scheme()]))
 const previous = edit(directory([...offsets.keys()]))
 object(1,document(`Current main slide ${terms[0]}`))
 object(3,container(0x03f0,[notesAtom(256),drawing(`Current speaker notes ${terms[2]}`,{grouped:true}),scheme()]))
 object(4,container(0x03f8,[slideAtom(),drawing(`Current main master ${terms[3]}`,{bytes:true}),scheme()]))
 const current = edit(directory([1,3,4]),previous)
 const user = Buffer.alloc(24); user.writeUInt32LE(20,0); user.writeUInt32LE(0xe391c05f,4); user.writeUInt32LE(current,8); user.writeUInt16LE(0x03f4,14); user[16] = 3; user.writeUInt32LE(8,20)
 return {name:'site-review-deck.ppt',mime:'application/vnd.ms-powerpoint',bytes:compound({'PowerPoint Document':Buffer.concat(chunks),'Current User':record(0x0ff6,user)}),terms,absent}
}

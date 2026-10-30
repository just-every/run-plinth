import JSZip from 'jszip'

export const cellTerms = ['synthetic-plinth-shared-9300', 'synthetic-plinth-inline-9301', 'synthetic-plinth-second-9302', 'synthetic-plinth-comment-9303', 'synthetic-plinth-drawing-9304', 'synthetic-plinth-print-9305', '41000+1157', 'FRAMING']
const s = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships', a = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const xml = body => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + body
const relations = items => xml(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(([id, kind, target]) => `<Relationship Id="${id}" Type="${r}/${kind}" Target="${target}"/>`).join('')}</Relationships>`)

/** A real workbook with shared and inline strings, cached formula data, comments and a drawing. */
export async function spreadsheetDocument(image, damage) {
 const zip = new JSZip()
 zip.file('[Content_Types].xml', xml('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/xl/comments1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>'))
 zip.file('_rels/.rels', relations([['main', 'officeDocument', 'xl/workbook.xml']]))
 zip.file('xl/workbook.xml', xml(`<workbook xmlns="${s}" xmlns:r="${r}"><sheets><sheet name="Cabinet clearances" sheetId="1" r:id="sheet1"/><sheet name="Revision checks" sheetId="2" r:id="sheet2"/></sheets></workbook>`))
 zip.file('xl/_rels/workbook.xml.rels', relations([['sheet1', 'worksheet', 'worksheets/sheet1.xml'], ['sheet2', 'worksheet', 'worksheets/sheet2.xml'], ['strings', 'sharedStrings', 'sharedStrings.xml']]))
 zip.file('xl/sharedStrings.xml', xml(`<sst xmlns="${s}" count="1" uniqueCount="1"><si><t>${sheetTerms[0]}</t></si></sst>`))
 zip.file('xl/worksheets/sheet1.xml', xml(`<worksheet xmlns="${s}" xmlns:r="${r}"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>${sheetTerms[1]}</t></is></c><c r="C1"><f>${sheetTerms[6]}</f><v>42157</v></c></row></sheetData><headerFooter><oddHeader>&amp;C${sheetTerms[5]}</oddHeader></headerFooter><drawing r:id="drawing"/></worksheet>`))
 zip.file('xl/worksheets/sheet2.xml', xml(`<worksheet xmlns="${s}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${sheetTerms[2]}</t></is></c></row></sheetData></worksheet>`))
 zip.file('xl/worksheets/_rels/sheet1.xml.rels', relations([['drawing', 'drawing', '../drawings/drawing1.xml'], ['comments', 'comments', '../comments1.xml']]))
 zip.file('xl/comments1.xml', xml(`<comments xmlns="${s}"><authors><author>Synthetic Plinth</author></authors><commentList><comment ref="A1" authorId="0"><text><t>${sheetTerms[3]}</t></text></comment></commentList></comments>`))
 zip.file('xl/drawings/drawing1.xml', xml(`<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="${a}" xmlns:r="${r}"><xdr:absoluteAnchor><xdr:pos x="0" y="0"/><xdr:ext cx="9144000" cy="1371600"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="Site image"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="image"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:absoluteAnchor><xdr:absoluteAnchor><xdr:pos x="0" y="0"/><xdr:ext cx="9144000" cy="1371600"/><xdr:sp><xdr:nvSpPr><xdr:cNvPr id="2" name="Drawing note"/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr/><xdr:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${sheetTerms[4]}</a:t></a:r></a:p></xdr:txBody></xdr:sp><xdr:clientData/></xdr:absoluteAnchor></xdr:wsDr>`))
 zip.file('xl/drawings/_rels/drawing1.xml.rels', relations([['image', 'image', '../media/site.png']]))
 zip.file('xl/media/site.png', image)
 await addThreads(zip, damage)
 return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

// Independent expected source records: each listed sheet has a thread, including a blank boundary cell.
export const threadedRecords = [
 { sheet: 'Cabinet clearances', cell: 'B1', id: '{10000000-0000-0000-0000-000000000001}', parent: '', author: 'Synthetic Plinth author one', person: '{20000000-0000-0000-0000-000000000001}', date: '2026-10-20T08:30:00Z', text: 'synthetic-plinth-thread-root-9310' },
 { sheet: 'Cabinet clearances', cell: 'B1', id: '{10000000-0000-0000-0000-000000000002}', parent: '{10000000-0000-0000-0000-000000000001}', author: 'Synthetic Plinth author two', person: '{20000000-0000-0000-0000-000000000002}', date: '2026-10-20T09:45:00Z', text: 'synthetic-plinth-thread-reply-9311' },
 { sheet: 'Revision checks', cell: 'XFD1048576', id: '{10000000-0000-0000-0000-000000000003}', parent: '', author: 'Synthetic Plinth author two', person: '{20000000-0000-0000-0000-000000000002}', date: '2026-10-21T10:00:00Z', text: 'synthetic-plinth-thread-second-root-9312' },
 { sheet: 'Revision checks', cell: 'XFD1048576', id: '{10000000-0000-0000-0000-000000000004}', parent: '{10000000-0000-0000-0000-000000000003}', author: 'Synthetic Plinth author one', person: '{20000000-0000-0000-0000-000000000001}', date: '2026-10-21T11:15:00+00:00', text: 'synthetic-plinth-thread-second-reply-9313' },
]
export const fallbackTerm = 'synthetic-plinth-fallback-9314'
export const sheetTerms = [...cellTerms, ...threadedRecords.map(record => record.text), fallbackTerm, 'synthetic-plinth-classic-author-9318']
export const orphanTerms = ['synthetic-plinth-orphan-thread-9315', 'synthetic-plinth-unlisted-sheet-9316', 'synthetic-plinth-orphan-person-9317']
const tc = 'http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments'
const tr = 'http://schemas.microsoft.com/office/2017/10/relationships/'
const comment = row => `<threadedComment ref="${row.cell}" dT="${row.date}" personId="${row.person}" id="${row.id}"${row.parent ? ` parentId="${row.parent}"` : ''}><text>${row.text}</text></threadedComment>`

async function addThreads(zip, damage) {
 const records = structuredClone(threadedRecords)
 const missing = '{90000000-0000-0000-0000-000000000001}'
 if (damage === 'missing-author') records[1].person = missing
 if (damage === 'missing-parent') records[1].parent = missing
 if (damage === 'duplicate-id') records[3].id = records[0].id.toLowerCase()
 if (damage === 'cross-sheet') records[3].parent = records[0].id
 if (damage === 'cross-cell') records[1].cell = 'C1'
 if (damage === 'cycle') records[0].parent = records[1].id
 if (damage === 'missing-date') records[0].date = ''
 if (damage === 'bad-cell') records[0].cell = 'bad'
 if (damage === 'past-last-column') records[0].cell = 'XFE1'
 if (damage === 'past-last-row') records[0].cell = 'A1048577'
 if (damage === 'duplicate-root') records[1].parent = ''
 if (damage === 'reply-limit') for (let i = 0; i < 65; i++) records.push({ ...records[1], id: 'synthetic-plinth-depth-' + i, parent: i ? 'synthetic-plinth-depth-' + (i - 1) : records[1].id })
 if (damage === 'comment-limit') for (let i = 0; i < 10000; i++) records.push({ ...records[1], id: 'synthetic-plinth-comment-' + i })
 const read = async name => zip.file(name).async('string')
 const rel = (kind, target, external = false) => `<Relationship Id="threads" Type="${damage === 'relationship-namespace' ? 'https://synthetic-plinth.invalid/' : tr}${kind}" Target="${target}"${external ? ' TargetMode="External"' : ''}/>`
 const types = await read('[Content_Types].xml')
 zip.file('[Content_Types].xml', types.replace('</Types>', '<Override PartName="/xl/persons/person.xml" ContentType="application/vnd.ms-excel.person+xml"/><Override PartName="/xl/threadedComments/thread1.xml" ContentType="application/vnd.ms-excel.threadedcomments+xml"/><Override PartName="/xl/threadedComments/thread2.xml" ContentType="application/vnd.ms-excel.threadedcomments+xml"/></Types>'))
 const workbookRels = await read('xl/_rels/workbook.xml.rels')
 let currentWorkbookRels = workbookRels
 if (damage === 'sheet-relationship') currentWorkbookRels = currentWorkbookRels.replace('/worksheet"', '/comments"')
 if (damage === 'sheet-namespace') currentWorkbookRels = currentWorkbookRels.replace(`${r}/worksheet`, 'https://synthetic-plinth.invalid/worksheet')
 zip.file('xl/_rels/workbook.xml.rels', currentWorkbookRels.replace('</Relationships>', (damage === 'missing-inventory' ? '' : rel('person', damage === 'external-people' ? 'https://synthetic-plinth.invalid/people' : 'persons/person.xml', damage === 'external-people')) + '</Relationships>'))
 for (const number of [1, 2]) {
  const name = `xl/worksheets/_rels/sheet${number}.xml.rels`
  const existing = zip.file(name) ? await read(name) : relations([])
  const threadPart = damage === 'reused-part' ? 1 : number
  let threadRelation = rel('threadedComment', damage === 'external-comments' ? 'https://synthetic-plinth.invalid/comments' : `../threadedComments/thread${threadPart}.xml`, damage === 'external-comments')
  if (damage === 'duplicate-relationship') threadRelation += threadRelation.replace('Id="threads"', 'Id="extra-thread"')
  zip.file(name, existing.replace('</Relationships>', threadRelation + '</Relationships>'))
  const rows = records.filter(row => row.sheet === (number === 1 ? 'Cabinet clearances' : 'Revision checks'))
  // Replies are deliberately stored before their roots; identity, not order, defines the thread.
  let content = rows.reverse().map(comment).join('')
  if (damage === 'child-namespace') content = content.replace('</text>', '</text><mentions><mention xmlns="https://synthetic-plinth.invalid/mention"/></mentions>')
  zip.file(`xl/threadedComments/thread${number}.xml`, xml(`<ThreadedComments xmlns="${damage === 'namespace' ? 'https://synthetic-plinth.invalid/threaded' : tc}">${content}</ThreadedComments>`))
 }
 let people = [threadedRecords[0], threadedRecords[1]]
 if (damage === 'duplicate-person') people.push(people[0])
 if (damage === 'person-limit') people = Array.from({length:2001}, (_, i) => ({person:'synthetic-plinth-person-' + i,author:'Synthetic stored author'}))
 zip.file('xl/persons/person.xml', xml(`<personList xmlns="${damage === 'person-namespace' ? 'https://synthetic-plinth.invalid/people' : tc}">${people.map(row => `<person id="${row.person}" displayName="${row.author}"/>`).join('')}</personList>`))
 const classic = await read('xl/comments1.xml')
 zip.file('xl/comments1.xml', classic.replace('</authors>', `<author>tc=${threadedRecords[0].id}</author><author>tc=Synthetic Plinth note</author></authors>`).replace('</commentList>', `<comment ref="B1" authorId="1"><text><t>[Threaded comment] ${fallbackTerm}</t></text></comment><comment ref="C1" authorId="2"><text><t>synthetic-plinth-classic-author-9318</t></text></comment></commentList>`))
 // These parts are intentionally unreferenced, even though their content looks valid.
 zip.file('xl/threadedComments/orphan.xml', xml(`<ThreadedComments xmlns="${tc}">${comment({...threadedRecords[0],text:orphanTerms[0]})}</ThreadedComments>`))
 zip.file('xl/persons/orphan.xml', xml(`<personList xmlns="${tc}"><person id="unlisted" displayName="${orphanTerms[2]}"/></personList>`))
 zip.file('xl/worksheets/unlisted.xml', xml(`<worksheet xmlns="${s}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${orphanTerms[1]}</t></is></c></row></sheetData></worksheet>`))
 zip.file('xl/worksheets/_rels/unlisted.xml.rels', relations([]).replace('</Relationships>', rel('threadedComment', '../threadedComments/orphan.xml') + '</Relationships>'))
}

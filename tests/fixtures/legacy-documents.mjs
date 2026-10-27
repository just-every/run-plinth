import { wordDocument } from './legacy-documents/word.mjs'
import { spreadsheetDocument } from './legacy-documents/spreadsheet.mjs'
import { presentationDocument } from './legacy-documents/presentation.mjs'
// Original synthetic fixture generators, authored for Plinth under its MIT license.
// Source formats: Microsoft MS-CFB, MS-DOC, MS-XLS and MS-PPT specifications.
// No downloaded or third-party authored document content is included.
export function legacyDocuments() {
 return [
  { name: 'synthetic-plinth-9411.doc', mime: 'application/msword', bytes: wordDocument(), term: 'synthetic-plinth-9401' },
  { name: 'synthetic-plinth-9412.xls', mime: 'application/vnd.ms-excel', bytes: spreadsheetDocument(), term: 'synthetic-plinth-9402' },
  { name: 'synthetic-plinth-9413.ppt', mime: 'application/vnd.ms-powerpoint', bytes: presentationDocument(), term: 'synthetic-plinth-9403', additionalTerm: 'synthetic-plinth-9405' },
 ]
}

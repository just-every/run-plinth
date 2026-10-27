# Find a job decision or attachment

Open **Decision search** on the job. Text, tag, sender, sheet and cost-code filters
combine. Results and downloads follow the current source record's audience;
index annotations never grant access to private correspondence or originals.

An attachment result shows its embedded-text extraction state. A failed,
unsupported, limited or empty extraction is visible and does not claim that all
original content was searched. Download the original to inspect it.

Under **Index metadata → Supplied attachment text**, a signed-in owner or
administrator can supply text for the exact original. **Extract text in this
browser** can prepare a draft from English raster images, rendered PDF pages,
embedded PDF text, a PDF unlocked with its password, or modern Word, Excel and
PowerPoint packages including linked stories, notes, comments and raster pictures. File
bytes and PDF passwords stay in the browser; pinned OCR resources come from the
installation. The password is cleared when extraction starts and is never saved.

Extraction is bounded by the limits shown in the panel. Unsupported or oversized
originals fail visibly without copying partial output. Every PDF page is read
within those bounds. Linked Word headers, footers, footnotes, endnotes and text
boxes are included. Spreadsheet formulas and saved values are read without
recalculation; slide layouts and masters can repeat text. Embedded objects,
equations, threaded comments and unsupported pictures can remain unread;
the draft shows these limitations. Legacy binary Office files have a bounded
local reader: main Word text and declared footnotes, grouped headers and footers,
annotations, endnotes and text boxes, saved spreadsheet cell values, and current
slide text. Its notes name unread comments, pictures and other omissions. Encrypted legacy files are refused.

Multi-page TIFF, RTF code pages and Unicode, BOM UTF-16 plain text, inert HTML
and SVG stored text also have local readers. TIFF and inline raster pictures use
English OCR. TIFF includes bounded tiled uncompressed, LZW, PackBits and deflate
images and stripped sequential RGB or YCbCr JPEG scans. BigTIFF, old JPEG,
tiled JPEG, grayscale JPEG, progressive JPEG and unsupported sample models fail
explicitly. Scripts are
never executed; HTML linked resources are not fetched, and SVG external
references are refused. Markup layout, outlined vector glyphs, embedded objects
and unsupported parts still require manual inspection and supplied text.

Classic Office charts contribute saved titles, labels, raw cache values and
formulas. They are not recalculated or rendered; caches can be stale. OpenDocument
text, spreadsheets and presentations also include stored tables, formulas,
values, comments, notes, headers, footers and supported embedded raster pictures.
Encrypted OpenDocument packages are refused. None of these readers executes
macros, refreshes linked data or opens embedded document payloads.

PDF pages with embedded text use
that text by default; choose **OCR every PDF page** to read the rendered page
instead. OCR is an unverified draft and can miss handwriting, symbols, numbers,
layout or reading order. Check it against the complete original.

**Use text in editor** copies the draft without saving. Correct or supply the
text, choose **Review complete supplied text**, inspect the entire body and
explicitly confirm its audience before saving. A changed job, original checksum,
prior revision, body or authority requires a fresh review. Agents, clients and
project managers cannot save supplied attachment text.

Saved revisions are immutable and inspectable. Search indexes the latest
revision together with embedded text, retaining the original extraction state.
The original bytes are unchanged. Current source grants apply to text reads,
source links and search; losing the source grant removes access on the next
request. The text follows its job's existing holds, erasure and private recovery.
No extraction or save sends an email or changes a meeting decision.

The current human API uses these session-authenticated doors, separate from the
version 1 generated machine client:

- `GET /api/plinth/jobs/{job}/decision-search` combines the five filters.
- `GET /api/plinth/jobs/{job}/decision-search/transcriptions?source=files:{id}`
  reads permitted full revisions.
- `POST /api/plinth/jobs/{job}/decision-search/transcription-preview` reviews
  `source`, `checksum`, `expected_version` and the complete `text`.
- `POST /api/plinth/jobs/{job}/decision-search/transcriptions` saves that exact
  review with its `digest` and explicit `confirm: true`.

A source can be reviewed only while its original is currently accessible. The
original checksum, job version and previous revision are checked again in the
save transaction. Restoring a private archive retains the revisions and their
attribution; it restores no sign-in or outbound delivery authority.

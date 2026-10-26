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
embedded PDF text, a PDF unlocked with its password, or DOCX body text. File
bytes and PDF passwords stay in the browser; pinned OCR resources come from the
installation. The password is cleared when extraction starts and is never saved.

Extraction is bounded by the limits shown in the panel. Unsupported or oversized
originals fail visibly without copying partial output. DOCX headers, footers,
images and some embedded objects are omitted. PDF pages with embedded text use
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

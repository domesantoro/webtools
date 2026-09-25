# preanalyst-rejection-pdf

Path: `webtools/preanalyst/src/rejection_pdf.js`
Examined: 2026-09-25

The PDF a client can download when their request is refused: the pre-specification as it was stored,
plus the internal reason when the caller says so. The module keeps one boundary very well — whether
the reason is shown is decided by the caller and by the configuration, and when it is `null` "the
document does not let on that it exists" (`:12-14`, `:76`). Four findings, three of them about the
class of documents and characters it will actually be handed.

---

## 1. The renderer is written for the document our template produces; the one it is handed may be the client's own

- `webtools/preanalyst/src/rejection_pdf.js:25-27` — "These are the only shapes `prespec.md.njk`
  produces: headings, lists, quotations, paragraphs."
- Shape: **6 — the world narrowed to fit the code**
- Class: **the documents `latestSpec` returns.** It returns the **latest** specification stored for
  the project, and there are two origins, by design: `system`, the pre-specification rendered from
  the form (`webtools/preanalyst/src/server.js:403-406`), and `third_party`, a `.md` **uploaded by
  the client** (`webtools/preanalyst/src/server.js:234-239`). The upload requires only that the
  front matter names a project the uploader owns; it does not look at the pipeline state, so a
  client whose request was refused can upload a document to that project and then download the
  rejection PDF of it. No change to code or configuration is needed.
- What arrives then is arbitrary markdown: tables, fenced code, `#### ` headings, `**bold**`,
  numbered lists, indented continuation lines. The renderer prints them with their markers showing,
  as paragraphs. It survives only because its last branch prints anything — which is luck, not
  design, and the comment above tells the next reader they may rely on a structure that is not
  guaranteed. Note in particular that the protection the system document has — every line of client
  text prefixed with `> ` by the `quote` filter, so a `#` the client typed can never become a
  heading (`webtools/preanalyst/src/prespec.js:52-57`) — does not exist for an uploaded document.
- Severity: `breaks-now`; the consequence is a degraded rendering of the client's own document, not
  a failure.
- Smallest generalising change: say what the class is — any markdown that may have been stored — and
  either render it as such or state at the boundary that the PDF is produced only from a document of
  our own making, and check the origin before printing it.

## 2. Nothing is established about the characters the PDF can print

- `webtools/preanalyst/src/rejection_pdf.js:34-49`, `:68-80` — every `text()` call uses
  `Helvetica`, `Helvetica-Bold` or `Helvetica-Oblique`, pdfkit's built-in standard fonts
- Shape: **4 — capability inferred from resemblance**
- Class: **the characters a client may write.** The form accepts any UTF-8 — workspaces validates
  the encoding and nothing else (`webtools/webtools-workspaces/src/server.js:79-85`) — so the text
  reaching this module may contain Greek, Cyrillic, Chinese, Arabic, emoji, or the typographic
  characters a word processor inserts when the client pastes from one. A standard PDF font carries
  one encoding, and the code says nothing anywhere about which characters it can print.
- Severity: `uncertain`. What would need to be known, and what this audit does not assert: what
  pdfkit's standard fonts do with a character outside their encoding — drop it, substitute it, or
  throw. Each of the three is a different defect: a client's text silently losing characters, a page
  of wrong glyphs, or finding 4 below. Guessing which would be the very thing this rule forbids.
- Smallest generalising change: establish it explicitly — an embedded font that states its coverage,
  or a declared mapping with a decided behaviour for what falls outside it.

## 3. The file name is interpolated into a header, and is safe only because of the one caller

- `webtools/preanalyst/src/rejection_pdf.js:61` —
  `"content-disposition": \`attachment; filename="${fileName}"\``
- Shape: **6 — the world narrowed to fit the code**
- Class: **the values `fileName` may take.** The parameter declares the class "a file name"; the
  code handles only the member the single caller passes, and the caller knows it:
  "The file name: just the id, which is a UUID, so there is nothing to clean"
  (`webtools/preanalyst/src/server.js:906-907`). The guarantee is stated in the caller and relied on
  in the module, which is the wrong way round — the module publishes the parameter.
- A second caller is the ordinary next step for a download: the project's name, the client's own
  uploaded file name (which the upload endpoint already receives and cleans,
  `webtools/preanalyst/src/server.js:256-260`), a date. A quote or a newline in any of those ends
  the header value, and a CR/LF splits the response.
- Severity: `latent`
- Smallest generalising change: quote and filter the name where the header is written — the boundary
  that owns the header — rather than in whoever calls.

## 4. The response is committed before the document is produced

- `webtools/preanalyst/src/rejection_pdf.js:58-66` — `writeHead(200)` and `doc.pipe(response)`
  before any content is generated, with no handler on the stream and nothing wrapped
- Shape: **5 — only the outcome that succeeds is handled**
- Class: **the outcomes of producing a PDF.** Only the one that succeeds exists here. If anything
  throws while the body is being written — finding 2 is the most likely cause, but a disk-backed
  font, a `null` in `t()` or a broken pipe would do — the status line and the headers have already
  gone, so the client receives `200 application/pdf` and a truncated file. The caller's failure
  paths (`webtools/preanalyst/src/server.js:897-899`) and the generic handler cannot help: the
  handler will attempt a response that has already been sent.
- Severity: `latent`
- Smallest generalising change: build the document first and send it when it is complete, or attach
  an error handler that at least destroys the connection rather than presenting a truncated file as
  a whole one.

---

## Noted, not raised as findings

- `:20-23` — the front matter is stripped by a regular expression anchored at the start, and if
  there is none the whole document is printed. Both members of that class are handled, and the
  reason for not printing the codes is given.
- `:44-45` — the bare `>` line, which the `quote` filter produces for an empty line inside a
  client's answer, is handled as its own case rather than falling through to a paragraph. A member
  of the class that is easy to miss, and was not missed.

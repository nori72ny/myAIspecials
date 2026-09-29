# PR #741 artifact delivery continuation

Audited base: `b46f64f70d09d410fbd4500fb000725ebd32da74`.
Date: 2026-09-29. Publication hold: Issue #742 remains in force.

## Reproduced and corrected

- Japanese titles caused the artifact download route to return HTTP 422 for
  Markdown, CSV, DOCX, XLSX and PPTX. Node rejected the raw non-Latin header
  value. Before the fix all five new HTTP regression cases failed; after the
  fix all five return 200 with a UTF-8 filename parameter and ASCII fallback.
- The PDF generator discarded content after 46 lines and after 100 characters
  per line. It now wraps at a bounded fixed-font width and paginates A4 pages,
  preserving all accepted text, with page numbering. Tabs and CR line breaks
  are normalized instead of being replaced with question marks.

## Local evidence

- Artifact generator/router suite: 16/16 passing.
- TypeScript typecheck: passed.
- Production build (Vite and server esbuild): passed.
- Poppler independently parsed a three-page PDF and extracted all 110 record
  lines, all 210 characters of a long line, and the final sentinel.
- First and last pages rendered and visually inspected: no clipping/overlap.

These checks do not prove Japanese PDF support: that path still rejects
unsupported text with `PDF_UNICODE_RENDERING_UNAVAILABLE`.

## Remaining release requirements

The new commit needs its own normal CI, exact-head Preview, live answer-quality
evidence, held-out Coding qualification and independent review. Cloudflare
Free server credentials and actual image generation remain unverified in this
continuation. No Production change, account change, paid fallback or release
approval is included. Do not reuse the previous SHA's green checks for this
commit. Other artifact visual/layout limits still need broader qualification.

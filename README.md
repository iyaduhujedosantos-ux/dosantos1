# Fieldnotes

A small, responsive study website that reads `ilovepdf_merged.pdf` in the browser, organizes selectable PDF text into topic sections, and creates multiple-choice review questions with answers and source-page references.

## Run the site

This is a static site: no build step or API key is required. Serve the repository root over HTTP, or publish it with GitHub Pages. The PDF.js library is loaded from jsDelivr, so an internet connection is needed. Opening `index.html` directly as a `file://` URL may prevent the browser from loading the bundled PDF.

For local development, from the repository root run:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000>.

The included book loads automatically. The **Choose a PDF** button also lets a reader study a different text-selectable PDF without uploading it to a server. Scanned PDFs need OCR before their text can be used.

## How the guide works

- It extracts selectable text in the browser using PDF.js; the PDF itself is not sent to a service.
- It uses PDF typography and numbered/chapter headings to find topic sections, and links each section back to its source pages.
- It keeps the original text and highlights key sentences instead of claiming to produce AI-written explanations. The topic introduction is based on the section text.
- It creates fill-in-the-blank multiple-choice questions directly from complete sentences in that section. Selecting an option immediately reveals the answer, source sentence, and page.
- When the PDF has no extractable text or useful passages, the guide reports that clearly rather than inventing content.

The generated review questions are a starting point for recall practice; verify details against the cited passages in the book.

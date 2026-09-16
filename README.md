# bulk-rename-core

The **core file-renaming logic** behind [Bulk File Rename](https://bulkfilerename.com) —
published so anyone can inspect exactly how filenames are generated in the browser.

## What this code does

Pure, dependency-free functions for batch renaming:

- `computeBaseFor` / `applyRename` / `renameBatch` — turn a user pattern
  (`Photo 001`, `trip_{name}`, `{date}_{n:03}`, …) into new filenames, with
  sequential numbering, `{name}` / `{date}` / `{filedate}` / `{random}` tokens,
  find & replace, letter-casing rules, and extension handling.
- `sanitizeBase` — strips characters illegal on Windows/macOS, guards reserved
  device names, and caps length so names stay portable.
- `detectCollisions` — case-insensitive duplicate-name detection (the same
  check that powers the preview warning on the site).
- `createZipPathMapper` — de-duplicates `folder + name` paths inside the
  download ZIP (`name (2)`, `name (3)`, …).

## Local-first by design

- These functions only ever see **file names** and small metadata
  (last-modified date for `{filedate}`). They never read file *contents*,
  never make network requests, and contain no analytics, tracking, API keys,
  deployment config, or credentials of any kind.
- On the website, processing happens **locally in your browser**: selected
  files stay in browser memory, the preview is computed with this logic, and
  the renamed files are downloaded as a separate copy (ZIP built in-memory
  with JSZip, which lives on the site — not in this package). File contents
  are not uploaded to our servers.

> Open-source inspection shows *how names are computed*. It does not, by
> itself, prove anything about the rest of the website — for file uploads,
> the reliable check is DevTools → Network while renaming.

## How the website uses it

The workbench (`RenamePlayground`) implements this same logic inline in the
page script. This package is the extracted, testable equivalent: same rules,
no DOM, no UI, no site code. Only this folder is public — the website UI,
styling, analytics, and deployment configuration stay private.

## Inspect / run it

Requirements: Node 22+.

```bash
cd bulk-rename-core
npm install
npx tsc --noEmit   # typecheck, no build output
```

Quick check in Node:

```js
import { renameBatch } from "./src/index.ts";

console.log(
	renameBatch(["IMG_9042.jpg", "IMG_9043.jpg"], { pattern: "Goa Trip 001" }),
);
// → [ 'Goa Trip 001.jpg', 'Goa Trip 002.jpg' ]
```

## License

MIT — see [LICENSE](./LICENSE).

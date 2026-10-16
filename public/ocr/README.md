# The screenshot reader's runtime

Everything the in-browser reader needs to run offline, served from this folder so nothing about a scan leaves
the machine and nothing depends on a CDN.

The reader is [tesseract.js](https://github.com/naptha/tesseract.js) with its own WebAssembly core, running in
a Web Worker. The manager's choice is the only thing that loads it: `tesseract.js` is behind a dynamic import
and the pane that uses it is behind a dynamic import of its own, so a visit that never opens the Screenshot pane
downloads none of this.

## What is here, and what is not

| Path | Committed | Size | Where it comes from |
| --- | --- | --- | --- |
| `worker.min.js` | no | 111,307 B | copied from `node_modules/tesseract.js/dist/worker.min.js` |
| `core/tesseract-core*.wasm.js` | no | 25,777,826 B across six files | copied from `node_modules/tesseract.js-core/` |
| `lang/eng.traineddata.gz` | **yes** | 1,984,273 B | fetched once from the tesseract.js language host |

The worker and the core are build output and are gitignored. They are copied into place by
`scripts/stage-ocr-assets.mjs`, which runs from `predev` and `prebuild` and from `scripts/with-target.mjs`, so
both the Node build and the browser build have them and a build that cannot find them fails loudly rather than
shipping a scanner that does not work.

The language model is committed, for the same reason `public/parse-resources/` is: a fresh clone has to be able
to run a scan offline without a network fetch, and 2 MB is a reasonable price for that. If it is ever missing,
the staging script fetches it and verifies its size before the build continues.

## Why six core builds

`tesseract.js-core` ships one plain build, one SIMD build and one relaxed-SIMD build, each in a normal and an
LSTM-only variant. Passing `corePath` as a directory makes tesseract's `getCore.js` pick one at run time by
probing the browser for SIMD and relaxed-SIMD support. Staging all six is what keeps that choice working in the
manager's browser instead of failing on the one build that was not copied.

The fallback if the download size ever matters more than the range is to pin `corePath` to the two LSTM-only
files, `tesseract-core-lstm.wasm.js` and `tesseract-core-simd-lstm.wasm.js`. That is a one line change in
`src/lib/ocr/engine.ts` and it has not been needed.

## Versions

`tesseract.js` 7.0.0 and `tesseract.js-core` 7.0.0, both Apache-2.0.

## Sizes, for the record

The browser export grows by about 26 MB of core plus the model and the worker. That is inside the host's per
file limit, none of it is served until a scan is asked for, and only one of the six core builds is ever fetched
by a given browser.

## Licensing

`tesseract.js`, `tesseract.js-core` and the `eng` traineddata are Apache-2.0, from the `naptha/tesseract.js`
project which in turn wraps `tesseract-ocr/tesseract`. The exact versions, sources and licence texts are in
[`THIRD-PARTY-NOTICES.md`](../../THIRD-PARTY-NOTICES.md).

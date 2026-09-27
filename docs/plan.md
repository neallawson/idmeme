# idMeme fix plan

The pipeline, classification, catalog, and repo-polish passes below are done. Setup is in `README.md`. Agent constraints are in `AGENTS.md`. Remaining repo work is under Later.

The live prompt is `src/backend/config.json` when that file sets `prompt`. Otherwise the backend uses `DEFAULT_PROMPT` in `src/backend/src/settings.ts`. `docs/prompts.txt` is a copy of that default for reading and editing. Those three texts must match.

## This pass

Done.

- [x] Prompt: valid JSON example (comma after `intent`), the word `find` kept intact in the default, and the generic-character sentence present in all three copies.
- [x] Parse model output: accept raw JSON or a fenced block, reject anything that is not a JSON object, and store the parsed object. Fail the job with the real reason instead of stuffing the raw reply into `keywords`.
- [x] Ollama errors (timeout, HTTP failure, empty body, connection failure) fail the queue row with that message.
- [x] Re-ingest updates `tags_json`, `hash`, `size`, and `updated_at` for an existing path. `created_at` stays.
- [x] Each folder is one batch. Opening that folder again attaches to the existing batch. Retry sets `failed` rows back to `pending`. Rescan adds paths that are not already in the batch.
- [x] Worker counts a job as in-flight as soon as it is claimed, including early failures. On startup, move leftover `hashing` and `classifying` rows back to `pending`.
- [x] Directory ingest only queues image files. An unreadable entry is skipped. An explicit filename that is missing or not an image is rejected.
- [x] The ingest file picker only sends names. The UI says those names must already be in the folder path.
- [x] Full-text search and the field filter can be used together. A bad FTS query returns a 400 and the search page shows that error instead of crashing. `searchImages` queries `tags_json`.

## Classification pass

Done.

- [x] Prompt example is valid JSON with real field values. `config.json`, `docs/prompts.txt`, and `DEFAULT_PROMPT` match.
- [x] Stored records use the six fields only. Keywords and characters split on commas. Text keeps commas and splits on new lines. An empty result fails the job.
- [x] Requests use Ollama's native chat API with the configured model and temperature. Do not send `format: "json"`; it hung on this GPU. `OLLAMA_MODEL` and `OLLAMA_TEMPERATURE` still override the settings file.
- [x] AI Settings edits model and temperature.
- [x] A field filter matches a whole phrase. `man` does not match `woman`. Comma-separated terms must all match. The same file bytes at a new path copy the existing classification instead of calling Ollama again. Re-ingest of the same path still classifies.

## Catalog pass

Done.

- [x] Before a classification request, the image is decoded and sent as JPEG with the long edge at most 768 pixels. Small images are not enlarged. A file that cannot be decoded fails the job with `Could not read image`.
- [x] Classification uses Ollama's native chat API and defaults to `qwen3-vl:latest`. `llava:latest` runs out of GPU memory on a 4GB card and the runner exits.
- [x] Home describes idMeme and links to ingest, gallery, and search.
- [x] Gallery lists cataloged images. Search and gallery show category, style, intent, characters, keywords, and quoted text instead of raw JSON.

## Later

- Production Docker image and the `ollama/ollama:0.1` compose tag. Those files are still in the repo and are not a supported way to run the app. The working path is host Ollama plus the backend on port 3000.
- `/api/file` and `/api/ingest` accept any local path, with open CORS. Fine for localhost. Do not expose the API on an untrusted network until this is restricted.
- The frontend uses Vite 7, while the installed SvelteKit still pulls Vite 5. `vite.config.ts` casts past the resulting type error. Align the versions.
- Svelte files are outside Prettier and ESLint.
- `npm audit` findings are not triaged.

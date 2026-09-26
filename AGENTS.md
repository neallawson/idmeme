# Agent notes

idMeme is a local meme classifier: SvelteKit UI, Express plus better-sqlite3, and a host Ollama vision model.

## How to work

- Do not start, stop, or restart the user's backend or frontend. They run those themselves.
- Do not use or recommend Docker. `docker-compose.dev.yml` and the Dockerfiles are not a supported setup. Host Ollama on port 11434 is the working path.
- Verify with `npm test` and `npm run check` from the repo root. Backend tests live in `src/backend/test` and must set `DB_FILE` before importing `src/db.ts`, or they will open the user's `src/backend/idmeme.sqlite`.
- Do not commit `idmeme.sqlite`, `.env`, or model files.

## Classification

- Default model is `qwen3-vl:latest`. Do not switch the default to `llava`; it runs out of memory on a 4GB GPU.
- Call Ollama `POST /api/chat`. Do not send `format: "json"` or OpenAI `response_format`. JSON mode hung for several minutes on `qwen3-vl`.
- The prompt asks for JSON. `extractClassification` pulls an object out of the reply. A reply with no usable fields fails the job.
- Keep these three texts the same: `DEFAULT_PROMPT` in `src/backend/src/settings.ts`, the `prompt` field in `src/backend/config.json` when it is set, and `docs/prompts.txt`.
- `prepareImageForModel` sends a JPEG whose long edge is at most 768 (`IDMEME_IMAGE_EDGE`). Do not upscale.

## Queue

There is one worker. Each folder is an `ingest_batches` row, and file rows belong to that batch. `ingestFolderBatch` returns the existing batch instead of inserting another copy of the same files.

Only a batch with status `running` is processed. Pause leaves the in-flight file alone. Retry sets `failed` rows back to `pending`. Rescan adds paths that are not already in the batch. On startup, `hashing` and `classifying` rows return to `pending`.

## Layout

- Backend cwd is `src/backend`, so `config.json` and `idmeme.sqlite` live there.
- UI dev server is port 5173. API is port 3000.
- Search combines full-text `MATCH` with field filters. A field phrase is a whole word (`man` does not match `woman`). Commas in a field filter mean every term must match.

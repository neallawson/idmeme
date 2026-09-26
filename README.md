# idMeme

idMeme classifies meme images on your machine. A local [Ollama](https://ollama.com) vision model reads each image, and the app stores the text and meaning so you can search them later.

This is a single-user app. The API accepts any local folder path and serves local image files, and CORS is open. Run it on localhost. Do not expose it on a network you do not trust.

## Requirements

- Node.js 20.19+ or 22.12+
- [Ollama](https://ollama.com) running on `http://localhost:11434`
- The `qwen3-vl:latest` model (`ollama pull qwen3-vl:latest`)

`llava` is a poor fit here: it runs out of memory on a 4GB GPU. Docker Compose in this repo is not a supported way to run the app.

## Run

From the repository root:

```sh
npm install
```

In one terminal:

```sh
npm --workspace=src/backend run dev
```

In another:

```sh
npm --workspace=src/frontend run dev
```

- UI: http://localhost:5173
- API: http://localhost:3000

The first image in a batch can take a few minutes while the model loads.

## Ingest

Each folder is one batch. Opening a folder that already has a batch attaches to that batch instead of queueing the same files again. One batch runs at a time. Restarting the backend continues the batch that was running. From the attached batch you can pause, resume, rescan for new files, retry failures, or cancel files that have not started.

## Where things live

| Path                          | What it is                                                                  |
| ----------------------------- | --------------------------------------------------------------------------- |
| `src/backend/idmeme.sqlite`   | Catalog and ingest queue. Created on first run. Not committed.              |
| `src/backend/config.json`     | Live prompt, model, temperature, and concurrency.                           |
| `src/backend/src/settings.ts` | Defaults used when config or environment variables are unset.               |
| `docs/prompts.txt`            | Readable copy of the default prompt. Keep it identical to `DEFAULT_PROMPT`. |

Environment overrides: `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `OLLAMA_PROMPT`, `OLLAMA_TEMPERATURE`, `IDMEME_MAX_CONCURRENCY`, `IDMEME_CONFIG`, `IDMEME_IMAGE_EDGE`, `DB_FILE`.

Images are sent as JPEG with the long edge capped at 768 pixels.

## Checks

```sh
npm test          # backend unit tests
npm run check     # backend tsc and frontend svelte-check
npm run lint
npm run format:check
```

`npm run format` writes Prettier formatting.

## License

[MIT](LICENSE)

# Cigarette Card Search

Semantic image search over the New York Public Library [Cigarette Cards](https://digitalcollections.nypl.org/collections/b50ab6f0-c52b-012f-5986-58d385a7bc34) collection

## Features

- Search by subject, scene, color, or mood
- Six results at a time, with the option to load more
- Front and back card views with links to the original NYPL records
- Local search across all cards, with public search limited by project rights policy

## Stack

- Next.js / React / TypeScript
- Python / SigLIP2
- PostgreSQL / pgvector

## Setup

Use Node.js 24, Python 3.13, and Docker with Compose.

Run commands from the repository root.

```bash
npm ci
python3.13 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
cp -n .env.example .env
docker compose up -d --wait db
docker compose exec -T db psql -v ON_ERROR_STOP=1 -U cards -d cigarette_cards < db/schema.sql
```

Set `DPLA_API_KEY` in `.env` before fetching. Remaining defaults match the local services.

Search scope defaults to `SEARCH_SCOPE=public`; use `all` for full-corpus local search.

## Data

For a new dataset, with the Python environment active:

```bash
npm run fetch:cards
npm run normalize:cards
npm run verify:cards
python -m ml.embed_cards
python -m ml.import_pgvector
```

### Refreshing an existing dataset

Archive raw and processed files and the entire `data/embeddings/` directory outside the repository before refreshing. Compare the new normalized records with the previous snapshot: identical records can reuse matching embeddings; changed records need fresh checkpoints. Import requires an empty `cards` table.

Compare verified normalized snapshots with `npm run compare:cards -- <previous.jsonl> <current.jsonl>`.

## Run

Terminal 1 (Embedding Service):

```bash
source .venv/bin/activate
python -m uvicorn ml.embedding_service:app --host 127.0.0.1 --port 8000
```

Terminal 2 (Web App):

```bash
npm run dev
```

Open <http://127.0.0.1:3000>. Requires active PostgreSQL database and embedding service.

## Build

```bash
npm run build
npm start
```

## Testing

```bash
npm test
npm run typecheck
python -m unittest discover -s tests -p 'test_*.py'
```

---

Collection metadata from [DPLA](https://dp.la/), images from [NYPL](https://digitalcollections.nypl.org/), and embeddings from [SigLIP2](https://huggingface.co/google/siglip2-base-patch16-224).

# Helia: AI Medical Records Assistant

Helia helps people understand their own health records. Users upload medical documents, then ask questions in plain language and get answers grounded in their own records and in trusted public health sources.

> **Disclaimer:** Helia is a student project. It is not medical advice, it has not been clinically validated, and it is not HIPAA compliant. Do not upload real patient data to a public deployment.

## What it does

- **Chat with your records.** Ask questions like "What did my last lab results say?" and get answers based on your own documents and reference sources.
- **Document upload and summaries.** PDFs are parsed, summarized, and indexed so they can be searched.
- **Hospital connection.** Imports records from a hospital's FHIR bundle and indexes them the same way.
- **Health tools built on the records:** symptom and medication tracking, appointment prep and debrief, a health timeline, health insights and alerts, nutrition and lifestyle tips, a second-opinion helper, a health score, and an emergency health card.
- **Per-user data.** Records are tied to the logged-in user through Supabase Auth and row-level security policies.

## How the question-answering works (RAG)

Helia uses retrieval-augmented generation, so answers come from real documents instead of only the model's memory.

1. **Chunking.** Each document is split by paragraph and sentence into chunks of about 500 tokens, with a small overlap when a long section has to be cut.
2. **Embeddings.** Each chunk is turned into a 1,536-number vector with OpenAI's `text-embedding-3-small` and stored in Postgres using **pgvector**, with an HNSW cosine-similarity index.
3. **Hybrid retrieval.** When a user asks a question, the question is embedded and the closest chunks are found. Results are scored with a weighted mix of semantic similarity (65%) and keyword match (35%), so exact terms such as drug names or lab values still count. The weights are constants in `server/rag.js`.
4. **Source routing.** Questions are sorted into categories (medication, lab, symptom, prevention, nutrition, personal) and each category pulls from a different mix of sources. For example, medication questions favor FDA content, and prevention questions favor CDC content. About 12 chunks go into each answer.
5. **Answer.** The retrieved text is passed to Anthropic's Claude, which writes the response and streams it to the browser.

**Reference sources** (ingested by the scripts in `server/scripts/`): NIH MedlinePlus, FDA drug information, CDC, and PubMed.

## Architecture

```
React (Create React App)  ->  Node/Express API  ->  Supabase (Postgres + pgvector + Auth)
   src/                          server/               *.sql schema and security policies
                                   |
                                   +-> Anthropic Claude API  (chat, summaries, insights)
                                   +-> OpenAI Embeddings API (text-embedding-3-small)
```

| Layer | Technology |
| --- | --- |
| Frontend | React 19, React Router, Supabase JS client |
| Backend | Node.js, Express |
| Database and auth | Supabase (PostgreSQL, pgvector, Auth) |
| LLM | Anthropic Claude API |
| Embeddings | OpenAI `text-embedding-3-small` |
| Data ingestion | Node scripts for MedlinePlus, FDA, CDC, PubMed |

## Security and privacy

- Supabase **row-level security** policies (see the `supabase-*.sql` files) tie rows to the logged-in user's ID.
- API keys live in environment variables and are not committed. See `server/.env.example`.
- The Supabase key used in the browser is the public (publishable) key, which is designed to be exposed. The server uses a separate service key that stays in `server/.env`.

## Running locally

**Prerequisites:** Node.js, a Supabase project, an Anthropic API key, and an OpenAI API key.

1. **Install dependencies**
   ```bash
   npm install
   npm --prefix server install
   ```
2. **Set up the database.** In the Supabase SQL editor, run the `supabase-*.sql` files in this repo to create the tables, vector indexes, and row-level security policies.
3. **Configure the server.** Copy `server/.env.example` to `server/.env` and fill in `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`. The server runs on port 3001 by default.
4. **Load reference content (optional but recommended).**
   ```bash
   npm run ingest-medical
   npm run ingest-fda
   npm run ingest-cdc
   npm run ingest-pubmed
   ```
5. **Start the server and the app** in two terminals:
   ```bash
   npm --prefix server run dev
   npm start
   ```
   The app opens at http://localhost:3000. To point the frontend at a different API, set `REACT_APP_API_URL`.

## Project structure

```
src/        React app (documents, chat, trackers, insights, and more)
server/     Express API, RAG logic (rag.js), health context builders, ingestion scripts
*.sql       Supabase schema, vector search functions, and row-level security policies
```

## Limitations

- It is a prototype. There is no clinical validation, and the only automated test is the default Create React App test.
- Scanned, image-only PDFs are detected and are not text-searchable.
- Answers depend on the quality of the uploaded documents and the retrieved sources, and the language model can still make mistakes.

## Author

Built by Esther Levy.

<div align="center">

# Gyan Varsha

**A Self-RAG chatbot that answers from Gemini's knowledge, your PDF / Excel files, or the live web, and can understand images.**

Gemini | LangGraph | FAISS | FastEmbed | Tavily | PostgreSQL | FastAPI | HTML + CSS + JS

</div>

---

## Demo video

[![Watch the demo](thumbnail.png)](Chatboat.mp4)

**[Watch the demo video (Chatboat.mp4, 18 s)](Chatboat.mp4)**

> **Publishing note:** if you put this project on GitHub, open this README in the GitHub editor and drag
> `demo/Chatboat.mp4` into it, or upload the video to YouTube / Google Drive and replace the link above with
> that public URL (for example `https://youtu.be/XXXXXXXXXXX`). A relative link like the one above only works
> inside the repository or the unzipped folder.

Full documentation: [`chatboatimage.pdf`](chatboatimage.pdf)

---

## Table of contents
1. [Features](#features)
2. [How it works](#how-it-works)
3. [Technologies and models](#technologies-and-models)
4. [Data and datasets](#data-and-datasets)
5. [Project structure](#project-structure)
6. [Quick start](#quick-start)
7. [Configuration (.env)](#configuration-env)
8. [Using the app](#using-the-app)
9. [Testing Self-RAG](#testing-self-rag)
10. [API reference](#api-reference)
11. [Troubleshooting](#troubleshooting)
12. [Limitations and roadmap](#limitations-and-roadmap)
13. [Security notes](#security-notes)

---

## Features

- **Self-RAG routing**: for every question the bot decides to answer *directly* (Gemini's own knowledge), *from your files*, or *from the web*.
- **PDF, Excel (.xlsx, .xls, .xlsm) and CSV upload**: indexed per chat; answers cite the file and the page or sheet rows.
- **Fallback to the web**: if your files do not contain the answer, the bot says so and searches with Tavily.
- **Image understanding**: attach, drag, or paste an image; Gemini's vision answers questions about it.
- **Verification**: answers based on files or the web are checked against their sources and tagged *Verified*.
- **ChatGPT-style interface**: sidebar with chat history, search and delete; streaming answers; Stop and Copy buttons; attachments with an x button.
- **Two themes**: cream / beige (day) and metal black (night), remembered in the browser.
- **Persistent memory** in PostgreSQL: reopen, continue, search and delete past chats.
- **Free-tier stack**: nothing in the project requires a paid service.

## How it works

```mermaid
flowchart LR
    U[User message] --> R{route}
    R -- direct --> G[generate - Gemini]
    R -- document --> RT[retrieve - FAISS]
    RT --> GR{grade}
    GR -- relevant --> G
    GR -- not enough, 1st time --> RW[rewrite query] --> RT
    GR -- still missing --> W[web_search - Tavily]
    R -- web --> W
    W --> G
    G --> V[verify] --> E[Answer + sources + Verified]
    G -. direct answers .-> E
```

1. The browser sends your message (and any image or file names) to `POST /api/chat`.
2. Attached files are uploaded, split into chunks, embedded and saved in a FAISS index for that chat.
3. The **router** (Gemini with structured output) picks `direct`, `document` or `web` and rewrites the question so follow-ups make sense.
4. For `document`: retrieve the 6 closest chunks, let Gemini **grade** them, **rewrite** the query once if needed, and fall back to **web search** if the answer is still missing.
5. **Generate** writes the answer (streamed word by word) with a prompt matched to the source. **Verify** checks document and web answers.
6. LangGraph saves the whole conversation state to PostgreSQL after every run.

## Technologies and models

| Area | Technology | Role |
|---|---|---|
| LLM | Google Gemini (name set in `GEMINI_MODEL`) | Router, grader, rewriter, answer writer, verifier, image understanding. Pre-trained transformer, not fine-tuned. |
| Embedding model | `BAAI/bge-small-en-v1.5` via FastEmbed (ONNX, CPU) | 384-dimensional text vectors. Local, free, ~130 MB download once. |
| Vector store | FAISS (`faiss-cpu`) | One index per chat in `data/faiss/<chat-id>/`. |
| Web search | Tavily API | Fresh information and fallback. |
| Agent framework | LangGraph + LangChain | Self-RAG graph, shared state, Gemini and FAISS integrations. |
| Memory | PostgreSQL 16 + `langgraph-checkpoint-postgres` | Conversation checkpoints and `threads` table. |
| Backend | Python 3.12, FastAPI, Uvicorn | REST API, uploads, Server-Sent Events streaming. |
| File readers | pypdf, openpyxl, xlrd, csv | PDF text and spreadsheet rows. |
| Frontend | HTML, CSS, JavaScript, marked, DOMPurify | Interface, Markdown rendering, safe HTML. |

**Chunking:** PDFs are split into 1,000-character chunks with 200 characters of overlap. Spreadsheets get one summary chunk per sheet (columns, row count, sum / average / min / max of numeric columns) plus 15 rows per chunk, up to 10,000 rows per sheet.

## Data and datasets

- **No model is trained or fine-tuned**, so there is no training dataset.
- The app works with **your uploaded files** (stored only as vectors on your computer) and **Tavily web results** (not stored).
- [`samples/Zorbex_Test_Handbook.pdf`](samples/Zorbex_Test_Handbook.pdf) is a fictional 3-page company handbook for testing. Gemini cannot know its facts, so correct answers prove the retrieval works.

## Project structure

```
.
|-- backend/
|   |-- agent.py        Self-RAG graph, models, ingestion, FAISS, Tavily
|   |-- db.py           PostgreSQL pool and threads table (+ Windows libpq fix)
|   `-- main.py         FastAPI endpoints and SSE streaming
|-- frontend/
|   |-- index.html      page structure
|   |-- style.css       day / night themes and layout
|   `-- app.js          chat, uploads, streaming, themes
|-- data/faiss/         vector indexes (created at runtime)
|-- demo/               Chatboat.mp4 and thumbnail
|-- docs/               full PDF documentation
|-- samples/            Zorbex_Test_Handbook.pdf
|-- check_models.py     lists Gemini models your key can call
|-- docker-compose.yml  PostgreSQL 16 container
|-- requirements.txt
`-- .env.example
```

## Quick start

### 1. Requirements
- Python 3.12 (3.10+ should work)
- PostgreSQL 16 (or Docker)
- A free Gemini API key: <https://aistudio.google.com/apikey>
- A free Tavily API key: <https://app.tavily.com>

### 2. Database
```bash
docker compose up -d                       # easiest: PostgreSQL in Docker
# or, with a local PostgreSQL install:
psql -U postgres -h localhost -c "CREATE DATABASE advance_chatbot;"
```

### 3. Install
**Windows (PowerShell)**
```powershell
py -3.12 -m venv venv
venv\Scripts\activate
python -m pip install -r requirements.txt
```
**Linux / macOS**
```bash
python3 -m venv venv && source venv/bin/activate
python -m pip install -r requirements.txt "psycopg[binary]"
```
On Windows the app uses `libpq.dll` from your PostgreSQL installation (`C:\Program Files\PostgreSQL\<version>\bin`), which avoids Application Control blocking psycopg's bundled DLL.

### 4. Configure
```bash
cp .env.example .env        # Windows: copy .env.example .env
```
Fill in the keys (see the next section). Optional check of which models your key can use:
```bash
python check_models.py
```

### 5. Run (from the project root)
```bash
python -m uvicorn backend.main:app --reload
```
Open <http://localhost:8000> and press **Ctrl+Shift+R** once after updates.

## Configuration (.env)

| Variable | Required | Description |
|---|---|---|
| `GOOGLE_API_KEY` | yes | Gemini API key |
| `GEMINI_MODEL` | yes | A model your key can call, for example `gemini-flash-latest` |
| `TAVILY_API_KEY` | for web search | Tavily key (free plan) |
| `DATABASE_URL` | yes | `postgresql://USER:PASSWORD@localhost:5432/DATABASE` (URL-encode special characters) |
| `ENABLE_SELF_CHECK` | no | `false` skips the verify step (one Gemini call less per answer) |
| `LANGCHAIN_*` | no | Optional LangSmith tracing. Set `LANGCHAIN_TRACING_V2=false` to keep everything local |

Never commit `.env`. It is listed in `.gitignore`.

## Using the app

- Click **+** (or drag and drop, or paste) to attach a **PDF / Excel / CSV** file or an **image**. Click the **x** on a chip to remove it before sending.
- Files are read when you press send and stay available for follow-up questions in that chat only.
- Switch **Night mode / Day mode** at the bottom of the sidebar.
- **Enter** sends, **Shift+Enter** adds a new line. The round button becomes **Stop** while an answer streams.

## Testing Self-RAG

Upload [`samples/Zorbex_Test_Handbook.pdf`](samples/Zorbex_Test_Handbook.pdf) in a new chat and try:

| Question | Expected |
|---|---|
| Who is the CEO of Zorbex Dynamics? | Marisol Quenby, tag *Your files*, page 1, *Verified* |
| How many days of annual leave do employees get? | 23 days (plus 9 sick days), page 2 |
| What was total 2025 revenue and which region grew fastest? | EUR 48.3M, Asia-Pacific (+31%) |
| What is the price of the TerraPulse S2? | Not in the PDF: *Not in your files, searched web* |
| What is the capital of France? | Direct answer, ignores the PDF |
| What is the latest news about AI today? | Web answer with Tavily links |

More scenarios are listed in the PDF documentation (section 15).

## API reference

| Method and path | Purpose |
|---|---|
| `GET /api/threads` | List chats |
| `POST /api/threads/{id}` | Create a chat |
| `GET /api/threads/{id}` | Chat info and uploaded files |
| `GET /api/threads/{id}/messages` | Saved messages |
| `DELETE /api/threads/{id}` | Delete chat, memory and index |
| `POST /api/threads/{id}/upload` | Upload PDF / Excel / CSV (max 25 MB) |
| `POST /api/chat` | Send a message; streams `step`, `token`, `meta`, `verified`, `error`, `done` events |

## Troubleshooting

| Problem | Fix |
|---|---|
| `No module named 'backend'` | Run `python -m uvicorn backend.main:app` from the project root, not from `backend/` |
| `uvicorn.exe` blocked | Use `python -m uvicorn ...` |
| `no pq wrapper available` (DLL blocked) | `pip uninstall psycopg-binary`; keep PostgreSQL installed (its bin folder is added to PATH by `db.py`) |
| `password authentication failed` | Correct the password in `DATABASE_URL` |
| `database ... does not exist` | `CREATE DATABASE advance_chatbot;` |
| Model name does not change | An old Windows variable `GEMINI_MODEL` exists; the app uses `load_dotenv(override=True)`, restart fully |
| `404 model no longer available` | Pick a current model (`python check_models.py`) |
| `403 PERMISSION_DENIED` | Your key's project cannot call that model; create a key in a new project |
| `429` | Free-tier rate limit: wait, or set `ENABLE_SELF_CHECK=false` |
| Page looks unstyled | Hard refresh with Ctrl+Shift+R |

## Limitations and roadmap

- One source per answer (a question needing both a file and the web gets a single-source answer).
- No OCR for scanned PDFs; spreadsheet answers are best for lookups and column statistics.
- LaTeX maths is shown as plain text; no user login.
- Planned: OCR, code-execution tool for exact spreadsheet calculations, multi-source answers, hybrid search with re-ranking, KaTeX and code highlighting, authentication, one-command Docker deployment.

## Security notes

- Keep API keys only in `.env`. If a key was ever pasted in public, revoke it and create a new one.
- The app has no login: run it on a trusted machine, or add authentication before exposing it on a network.
- Uploaded files are stored only as vectors in `data/faiss` on your machine; text needed for an answer is sent to Gemini (and queries to Tavily).

---

Built with Gemini, LangGraph, FAISS, FastEmbed, Tavily, PostgreSQL and FastAPI.

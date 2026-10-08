<div align="center">

# Gyan Varsha

**A Self-RAG chatbot that answers from Gemini's knowledge, your PDF / Excel files, or the live web, and can understand images.**


</div>

---

## Demo video

[![Watch the demo](thumbnail.png)](https://drive.google.com/file/d/1Ku-SH_A1pumYEvxpR3NznoyLFipJm-SD/view?usp=drive_link)


Full documentation: [`chatboatimage.pdf`](chatboatimage.pdf)

---

## Table of contents
1. [Features](#features)
2. [How it works](#how-it-works)
3. [Technologies and models](#technologies-and-models)
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
- **UI Interface**: sidebar with chat history, search and delete; streaming answers; Stop and Copy buttons; attachments with an x button.
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

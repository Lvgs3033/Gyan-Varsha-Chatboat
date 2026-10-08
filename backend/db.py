"""PostgreSQL helpers: connection pool + a `threads` table (titles & uploaded-file info).
Chat history itself is stored by LangGraph's PostgresSaver in its own tables."""
import glob
import os

# Windows: psycopg's bundled DLL may be blocked by Application Control, so use the
# libpq.dll from the locally installed PostgreSQL instead.
if os.name == "nt":
    for _bin in sorted(glob.glob(r"C:\Program Files\PostgreSQL\*\bin"), reverse=True):
        os.environ["PATH"] = _bin + os.pathsep + os.environ.get("PATH", "")

from dotenv import load_dotenv
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

load_dotenv(override=True)
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/chatbot")

# autocommit + dict_row are required by PostgresSaver
pool = ConnectionPool(
    conninfo=DATABASE_URL,
    max_size=10,
    kwargs={"autocommit": True, "prepare_threshold": 0, "row_factory": dict_row},
    open=True,
)


def init_db():
    with pool.connection() as c:
        c.execute(
            """CREATE TABLE IF NOT EXISTS threads (
                   id TEXT PRIMARY KEY,
                   title TEXT NOT NULL DEFAULT 'New chat',
                   filename TEXT,
                   pages INT,
                   chunks INT,
                   created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                   updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
               )"""
        )
        c.execute("ALTER TABLE threads ADD COLUMN IF NOT EXISTS docs JSONB NOT NULL DEFAULT '[]'::jsonb")


def ensure_thread(tid: str):
    with pool.connection() as c:
        c.execute("INSERT INTO threads (id) VALUES (%s) ON CONFLICT DO NOTHING", (tid,))


def list_threads():
    with pool.connection() as c:
        return c.execute(
            """SELECT id, title FROM threads
               WHERE title <> 'New chat' OR jsonb_array_length(docs) > 0
               ORDER BY updated_at DESC"""
        ).fetchall()


def get_thread(tid: str):
    with pool.connection() as c:
        return c.execute("SELECT * FROM threads WHERE id=%s", (tid,)).fetchone()


def touch_and_title(tid: str, first_message: str):
    title = first_message.strip().replace("\n", " ")[:48] or "New chat"
    with pool.connection() as c:
        c.execute(
            """UPDATE threads SET updated_at = now(),
               title = CASE WHEN title = 'New chat' THEN %s ELSE title END
               WHERE id=%s""",
            (title, tid),
        )


def add_doc(tid: str, info: dict):
    with pool.connection() as c:
        c.execute(
            "UPDATE threads SET docs = docs || %s, updated_at = now() WHERE id=%s",
            (Jsonb([info]), tid),
        )


def delete_thread(tid: str):
    with pool.connection() as c:
        c.execute("DELETE FROM threads WHERE id=%s", (tid,))

import json
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from langchain_core.messages import AIMessage, AIMessageChunk, HumanMessage
from pydantic import BaseModel

from . import db
from .agent import chatbot, checkpointer, drop_thread_data, has_image, ingest_file, text_of

app = FastAPI(title="Gyan Varsha")
FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
ALLOWED = (".pdf", ".xlsx", ".xlsm", ".xls", ".csv")
MAX_UPLOAD = 25 * 1024 * 1024


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


class ChatReq(BaseModel):
    thread_id: str
    message: str
    image: Optional[str] = None  # data URL (already resized by the browser)
    files: List[str] = []        # names of files sent with this message (for display)


def thread_with_docs(tid: str) -> dict:
    t = db.get_thread(tid) or {}
    if t and not t.get("docs") and t.get("filename"):  # threads created by older versions
        t["docs"] = [{"filename": t["filename"], "kind": "pdf"}]
    return t


@app.get("/api/threads")
def threads():
    return db.list_threads()


@app.post("/api/threads/{tid}")
def create_thread(tid: str):
    db.ensure_thread(tid)
    return thread_with_docs(tid)


@app.get("/api/threads/{tid}")
def thread_info(tid: str):
    return thread_with_docs(tid)


@app.get("/api/threads/{tid}/messages")
def messages(tid: str):
    state = chatbot.get_state(config={"configurable": {"thread_id": tid}})
    out = []
    for m in state.values.get("messages", []):
        text = text_of(m.content).strip()
        if isinstance(m, HumanMessage):
            out.append({"role": "user", "content": text, "has_image": has_image(m), "files": m.additional_kwargs.get("files", [])})
        elif isinstance(m, AIMessage) and text:
            out.append({"role": "assistant", "content": text, "meta": m.additional_kwargs.get("rag")})
    return out


@app.delete("/api/threads/{tid}")
def delete_thread(tid: str):
    try:
        checkpointer.delete_thread(tid)
    except Exception:
        pass
    drop_thread_data(tid)
    db.delete_thread(tid)
    return {"ok": True}


@app.post("/api/threads/{tid}/upload")
def upload(tid: str, file: UploadFile = File(...)):
    name = file.filename or ""
    if not name.lower().endswith(ALLOWED):
        raise HTTPException(400, "Supported files: PDF, Excel (.xlsx, .xls) and CSV.")
    data = file.file.read()
    if len(data) > MAX_UPLOAD:
        raise HTTPException(400, "File is larger than 25 MB.")
    db.ensure_thread(tid)
    try:
        ingest_file(data, tid, name)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(400, f"Could not read this file: {e}")
    return thread_with_docs(tid)


@app.post("/api/chat")
def chat(req: ChatReq):
    db.ensure_thread(req.thread_id)
    db.touch_and_title(req.thread_id, req.message)
    cfg = {"configurable": {"thread_id": req.thread_id}, "metadata": {"thread_id": req.thread_id}}
    if req.image and req.image.startswith("data:image/") and len(req.image) < 8_000_000:
        content = [{"type": "text", "text": req.message}, {"type": "image_url", "image_url": {"url": req.image}}]
    else:
        content = req.message

    def gen():
        turn = {
            "messages": [HumanMessage(content=content, additional_kwargs={"files": req.files[:10]})], "question": req.message, "route": "", "source": "",
            "contexts": [], "fallback": False, "good": False, "rewrites": 0, "meta": {}, "grounded": None,
        }
        last_node = None
        try:
            for mode, data in chatbot.stream(turn, config=cfg, stream_mode=["messages", "updates"]):
                if mode == "messages":
                    chunk, meta = data
                    node = meta.get("langgraph_node")
                    if node and node != last_node:
                        last_node = node
                        yield sse("step", {"node": node})
                    if node == "generate" and isinstance(chunk, AIMessageChunk):
                        t = text_of(chunk.content)
                        if t:
                            yield sse("token", {"text": t})
                else:
                    for node, upd in data.items():
                        if node == "generate" and upd and upd.get("meta"):
                            yield sse("meta", upd["meta"])
                        if node == "verify" and upd:
                            yield sse("verified", {"grounded": upd.get("grounded")})
        except Exception as e:
            yield sse("error", {"message": str(e)})
        yield sse("done", {})

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


@app.get("/")
def index():
    return FileResponse(FRONTEND / "index.html", headers={"Cache-Control": "no-store"})


class NoCacheStatic(StaticFiles):
    """Always serve the latest CSS/JS (avoids stale files in the browser)."""

    async def get_response(self, path, scope):
        resp = await super().get_response(path, scope)
        resp.headers["Cache-Control"] = "no-store"
        return resp


app.mount("/static", NoCacheStatic(directory=FRONTEND), name="static")

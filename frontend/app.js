(() => {
  const $ = (id) => document.getElementById(id);
  const root = document.documentElement;
  const I = (d) => `<svg viewBox="0 0 24 24">${d}</svg>`;
  const ICONS = {
    logo: '<svg viewBox="0 0 24 24"><path d="M12 2.5c3.2 4 6 7 6 10.4A6 6 0 0 1 6 12.9C6 9.5 8.8 6.5 12 2.5z"/></svg>',
    panel: I('<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/>'),
    pen: I('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
    search: I('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>'),
    plus: I('<path d="M12 5v14M5 12h14"/>'),
    file: I('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>'),
    image: I('<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-9 9"/>'),
    up: I('<path d="M12 19V5M5 12l7-7 7 7"/>'),
    stop: '<svg viewBox="0 0 24 24" style="fill:currentColor;stroke:none"><rect x="6" y="6" width="12" height="12" rx="2.5"/></svg>',
    copy: I('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>'),
    check: I('<path d="M5 12l5 5 9-10"/>'),
    trash: I('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
    close: I('<path d="M6 6l12 12M18 6L6 18"/>'),
    sun: I('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
    moon: I('<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>'),
  };
  document.querySelectorAll("[data-icon]").forEach((e) => (e.innerHTML = ICONS[e.dataset.icon]));

  const el = {
    main: $("main"), scroll: $("scroll"), msgs: $("messages"), input: $("input"), send: $("send"), tray: $("tray"),
    threads: $("threads"), search: $("search"), menu: $("menu"), drop: $("drop"), toast: $("toast"), composer: $("composer"),
  };
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "t-" + Date.now() + Math.random().toString(16).slice(2));
  let threadId = localStorage.getItem("thread_id") || uuid();
  let busy = false, ctl = null, pendingImage = null, staged = [], allThreads = [];

  const api = async (url, opts) => {
    const r = await fetch(url, opts);
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || r.statusText);
    return r.json();
  };
  const md = (t) => DOMPurify.sanitize(marked.parse(t, { breaks: true }));
  let tt;
  const toast = (m, err) => { el.toast.textContent = m; el.toast.className = "toast show" + (err ? " err" : ""); clearTimeout(tt); tt = setTimeout(() => (el.toast.className = "toast"), 3500); };
  const nearBottom = () => el.scroll.scrollHeight - el.scroll.scrollTop - el.scroll.clientHeight < 140;
  const toBottom = () => (el.scroll.scrollTop = el.scroll.scrollHeight);
  const setEmpty = (v) => el.main.classList.toggle("is-empty", v);

  // ---- theme & sidebar
  function applyTheme(t) {
    root.dataset.theme = t; localStorage.setItem("theme", t);
    $("themeIcon").innerHTML = t === "dark" ? ICONS.sun : ICONS.moon;
    $("themeLabel").textContent = t === "dark" ? "Day mode" : "Night mode";
  }
  applyTheme(root.dataset.theme);
  $("themeBtn").onclick = () => applyTheme(root.dataset.theme === "dark" ? "light" : "dark");
  const mobile = () => matchMedia("(max-width:768px)").matches;
  function toggleSidebar() {
    if (mobile()) root.classList.toggle("sb-mobile");
    else { root.classList.toggle("sb-closed"); localStorage.setItem("sb", root.classList.contains("sb-closed") ? "0" : "1"); }
  }
  $("collapseBtn").onclick = () => (mobile() ? root.classList.remove("sb-mobile") : toggleSidebar());
  $("openBtn").onclick = toggleSidebar;
  $("backdrop").onclick = () => root.classList.remove("sb-mobile");

  // ---- tray (documents + staged image)
  const kindOf = (name) => (/\.pdf$/i.test(name) ? "PDF" : "Spreadsheet");
  function fileChip(name, onRemove) {
    const c = document.createElement("div"); c.className = "fchip";
    c.innerHTML = `<div class="ic">${ICONS.file}</div><div class="nm"><b></b><span></span></div>`;
    c.querySelector("b").textContent = name; c.querySelector("span").textContent = kindOf(name);
    if (onRemove) {
      const x = document.createElement("button"); x.className = "rm"; x.title = "Remove"; x.setAttribute("aria-label", "Remove " + name);
      x.innerHTML = ICONS.close; x.onclick = onRemove; c.appendChild(x);
    }
    return c;
  }
  function renderTray() {
    el.tray.innerHTML = "";
    staged.forEach((f) => el.tray.appendChild(fileChip(f.name, () => { staged = staged.filter((x) => x !== f); renderTray(); updateSend(); })));
    if (pendingImage) {
      const t = document.createElement("div"); t.className = "thumb";
      t.innerHTML = `<img alt="Attached image"><button aria-label="Remove image">${ICONS.close}</button>`;
      t.querySelector("img").src = pendingImage;
      t.querySelector("button").onclick = () => { pendingImage = null; renderTray(); updateSend(); };
      el.tray.appendChild(t);
    }
  }
  function updateSend() {
    el.send.innerHTML = busy ? ICONS.stop : ICONS.up;
    el.send.disabled = !busy && !(el.input.value.trim() || pendingImage || staged.length);
  }
  function autosize() { el.input.style.height = "auto"; el.input.style.height = Math.min(el.input.scrollHeight, 200) + "px"; }

  // ---- messages
  const LABELS = { route: "Thinking", retrieve: "Searching your files", grade: "Checking relevance", rewrite: "Refining the question",
    web_search: "Searching the web", generate: "Writing", verify: "Verifying answer" };
  const SRC = { direct: "Gemini knowledge", document: "Your files", web: "Web (Tavily)" };

  function renderMeta(box, meta) {
    if (!meta || !meta.source) return;
    box.innerHTML = "";
    const tag = (txt, cls) => { const s = document.createElement("span"); s.className = "tag " + (cls || ""); s.textContent = txt; box.appendChild(s); };
    tag(SRC[meta.source] || meta.source);
    if (meta.fallback) tag("Not in your files, searched web", "warn");
    (meta.sources || []).forEach((x) => {
      if (x.url) { const a = document.createElement("a"); a.className = "tag"; a.href = x.url; a.target = "_blank"; a.rel = "noopener noreferrer"; a.textContent = x.title || x.url; box.appendChild(a); }
      else tag(`${x.file} - ${x.loc}`);
    });
    if (meta.grounded === true) tag("Verified", "ok");
    if (meta.grounded === false) tag("Could not fully verify", "warn");
  }

  function addUser(text, image, hasImage, files) {
    const row = document.createElement("div"); row.className = "msg user";
    if (files && files.length) {
      const fr = document.createElement("div"); fr.className = "files";
      files.forEach((n) => fr.appendChild(fileChip(n)));
      row.appendChild(fr);
    }
    if (image) { const im = document.createElement("img"); im.className = "img-thumb"; im.src = image; im.alt = "Attached image"; row.appendChild(im); }
    else if (hasImage) { const n = document.createElement("div"); n.className = "img-note"; n.innerHTML = ICONS.image + "<span>Image attached</span>"; row.appendChild(n); }
    if (text) { const b = document.createElement("div"); b.className = "bubble"; b.textContent = text; row.appendChild(b); }
    el.msgs.appendChild(row);
  }

  function addAssistant(text, meta) {
    const row = document.createElement("div"); row.className = "msg assistant";
    row.innerHTML = `<div class="status"></div><div class="content"></div><div class="meta"></div><div class="actions" hidden><button title="Copy" aria-label="Copy"></button></div>`;
    const o = { row, status: row.querySelector(".status"), content: row.querySelector(".content"), meta: row.querySelector(".meta"), actions: row.querySelector(".actions"), text: text || "" };
    const btn = o.actions.firstChild; btn.innerHTML = ICONS.copy;
    btn.onclick = async () => { try { await navigator.clipboard.writeText(o.text); btn.innerHTML = ICONS.check; setTimeout(() => (btn.innerHTML = ICONS.copy), 1500); } catch { toast("Copy failed", true); } };
    if (text) { o.status.hidden = true; o.content.innerHTML = md(text); renderMeta(o.meta, meta); o.actions.hidden = false; }
    el.msgs.appendChild(row);
    return o;
  }

  async function send(preset) {
    let text = (preset ?? el.input.value).trim();
    if (busy || (!text && !pendingImage && !staged.length)) return;
    if (!text) text = staged.length ? "Summarize the attached file." : "Describe this image.";
    const image = pendingImage, files = staged, tid = threadId;
    pendingImage = null; staged = []; renderTray();
    el.input.value = ""; autosize(); setEmpty(false);
    addUser(text, image, false, files.map((f) => f.name));
    const a = addAssistant(); a.status.textContent = "Thinking"; toBottom();
    busy = true; ctl = new AbortController(); updateSend();
    let meta = null;
    try {
      for (const f of files) {  // index the attached files first, like ChatGPT reads them on send
        a.status.textContent = "Reading " + f.name;
        try { const fd = new FormData(); fd.append("file", f); await api(`/api/threads/${tid}/upload`, { method: "POST", body: fd, signal: ctl.signal }); }
        catch (e) { if (e.name === "AbortError") throw e; if (!/already uploaded/i.test(e.message)) throw new Error(`Could not read ${f.name}: ${e.message}`); }
      }
      a.status.textContent = "Thinking";
      const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ thread_id: tid, message: text, image, files: files.map((f) => f.name) }), signal: ctl.signal });
      if (!res.ok) throw new Error(res.statusText);
      const reader = res.body.getReader(), dec = new TextDecoder(); let buf = "";
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n"); buf = parts.pop();
        for (const p of parts) {
          const ev = /event: (\w+)/.exec(p)?.[1], data = JSON.parse(/data: (.*)/s.exec(p)?.[1] || "{}");
          const stick = nearBottom();
          if (ev === "step") a.status.textContent = LABELS[data.node] || data.node;
          else if (ev === "token") { a.status.hidden = true; a.text += data.text; a.content.innerHTML = md(a.text); }
          else if (ev === "meta") { meta = data; renderMeta(a.meta, meta); }
          else if (ev === "verified") { meta = { ...meta, grounded: data.grounded }; renderMeta(a.meta, meta); }
          else if (ev === "error") { toast(data.message, true); }
          if (stick) toBottom();
        }
      }
      if (!a.text) a.content.textContent = "No response. Check the server log and your Gemini key.";
    } catch (e) {
      if (e.name !== "AbortError") a.content.textContent = "Something went wrong: " + e.message;
    }
    a.status.hidden = true; if (a.text) a.actions.hidden = false;
    busy = false; ctl = null; updateSend(); el.input.focus(); loadThreads();
  }

  // ---- threads
  function drawThreads() {
    const q = el.search.value.trim().toLowerCase();
    el.threads.innerHTML = "";
    allThreads.filter((t) => t.title.toLowerCase().includes(q)).forEach((t) => {
      const li = document.createElement("li"); li.className = "thread" + (t.id === threadId ? " active" : "");
      li.innerHTML = `<span class="t"></span><button class="del" title="Delete chat" aria-label="Delete chat">${ICONS.trash}</button>`;
      li.querySelector(".t").textContent = t.title;
      li.onclick = () => openThread(t.id);
      li.querySelector(".del").onclick = async (e) => {
        e.stopPropagation(); if (!confirm("Delete this chat?")) return;
        await api("/api/threads/" + t.id, { method: "DELETE" });
        if (t.id === threadId) newChat(); else loadThreads();
      };
      el.threads.appendChild(li);
    });
  }
  async function loadThreads() { try { allThreads = await api("/api/threads"); drawThreads(); } catch (e) { toast(e.message, true); } }
  el.search.oninput = drawThreads;

  async function openThread(id) {
    if (busy && ctl) ctl.abort();
    threadId = id; localStorage.setItem("thread_id", id);
    root.classList.remove("sb-mobile"); pendingImage = null; staged = [];
    el.msgs.innerHTML = "";
    try {
      const msgs = await api(`/api/threads/${id}/messages`);
      msgs.forEach((m) => (m.role === "user" ? addUser(m.content, null, m.has_image, m.files) : addAssistant(m.content, m.meta)));
      setEmpty(msgs.length === 0);
    } catch (e) { toast(e.message, true); }
    renderTray(); updateSend(); toBottom(); loadThreads();
  }
  async function newChat() {
    const id = uuid();
    await api("/api/threads/" + id, { method: "POST" });
    await openThread(id); el.input.focus();
  }
  $("newChat").onclick = newChat;

  // ---- files
  const imgExt = /\.(png|jpe?g|gif|webp|bmp)$/i, docExt = /\.(pdf|xlsx|xlsm|xls|csv)$/i;
  function stageImage(file) {
    const fr = new FileReader();
    fr.onload = () => {
      const img = new Image();
      img.onload = () => {
        const s = Math.min(1, 1280 / Math.max(img.width, img.height));
        const c = document.createElement("canvas"); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        pendingImage = c.toDataURL("image/jpeg", 0.85); renderTray(); updateSend(); el.input.focus();
      };
      img.onerror = () => toast("Could not read this image.", true);
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  }
  function stageDoc(f) {
    if (f.size > 25 * 1024 * 1024) return toast(`${f.name} is larger than 25 MB.`, true);
    if (staged.some((x) => x.name === f.name)) return;
    staged.push(f); renderTray(); updateSend(); el.input.focus();
  }
  function handleFiles(files) {
    [...files].forEach((f) => {
      if (f.type.startsWith("image/") || imgExt.test(f.name)) stageImage(f);
      else if (docExt.test(f.name)) stageDoc(f);
      else toast(`${f.name}: use PDF, Excel, CSV or an image.`, true);
    });
  }
  $("plusBtn").onclick = (e) => { e.stopPropagation(); el.menu.hidden = !el.menu.hidden; };
  document.addEventListener("click", () => (el.menu.hidden = true));
  $("pickDoc").onclick = () => $("docInput").click();
  $("pickImg").onclick = () => $("imgInput").click();
  $("docInput").onchange = (e) => { handleFiles(e.target.files); e.target.value = ""; };
  $("imgInput").onchange = (e) => { handleFiles(e.target.files); e.target.value = ""; };
  el.input.addEventListener("paste", (e) => { const f = [...(e.clipboardData?.files || [])]; if (f.length) { e.preventDefault(); handleFiles(f); } });
  let depth = 0;
  addEventListener("dragenter", (e) => { e.preventDefault(); depth++; el.drop.classList.add("show"); });
  addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; el.drop.classList.remove("show"); } });
  addEventListener("dragover", (e) => e.preventDefault());
  addEventListener("drop", (e) => { e.preventDefault(); depth = 0; el.drop.classList.remove("show"); handleFiles(e.dataTransfer.files); });

  // ---- input events
  el.send.onclick = () => (busy ? ctl && ctl.abort() : send());
  el.input.addEventListener("input", () => { autosize(); updateSend(); });
  el.input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
  document.querySelectorAll(".sugg").forEach((b) => (b.onclick = () => send(b.dataset.q)));

  // ---- start
  api("/api/threads/" + threadId, { method: "POST" }).then(() => openThread(threadId)).catch((e) => toast(e.message, true));
})();

import Anthropic from "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.131.0/+esm";

// ---------- state & storage ----------
const LS = {
  bank: "qb.bank", papers: "qb.papers", key: "qb.apiKey", model: "qb.model", subject: "qb.subject",
};
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { alert("သိမ်းမရပါ: " + e.message); } };

let bank = load(LS.bank, []);
let papers = load(LS.papers, []);
let currentPaper = null;   // { title, subject, questions[], total, regen }
let bankImages = [];
let checkImages = [];

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const MY_DIGITS = "၀၁၂၃၄၅၆၇၈၉";
const my = (n) => String(n).replace(/\d/g, (d) => MY_DIGITS[d]);
const LEVEL = { easy: "လွယ်", medium: "အလယ်", hard: "ခက်" };
const LEVEL_ORDER = { easy: 0, medium: 1, hard: 2 };
const uid = () => Math.random().toString(36).slice(2, 10);
const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const norm = (s) => String(s).replace(/\s+/g, "").toLowerCase();
const chapterSort = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });

function setStatus(el, msg, isError = false) {
  el.textContent = msg;
  el.classList.toggle("error", isError);
}

// ---------- tabs ----------
$$(".tab").forEach((t) => t.addEventListener("click", () => {
  $$(".tab").forEach((x) => x.classList.toggle("active", x === t));
  $$(".panel").forEach((p) => p.classList.toggle("active", p.id === "tab-" + t.dataset.tab));
  if (t.dataset.tab === "check") renderCheckPapers();
}));

// ---------- settings ----------
$("#apiKey").value = load(LS.key, "");
$("#model").value = load(LS.model, "claude-opus-5-5");
$("#subject").value = load(LS.subject, "");
$("#subject").addEventListener("change", () => save(LS.subject, $("#subject").value));
$("#saveSettings").addEventListener("click", () => {
  save(LS.key, $("#apiKey").value.trim());
  save(LS.model, $("#model").value);
  $("#settingsStatus").textContent = "✔ သိမ်းပြီးပါပြီ";
});

// ---------- Claude ----------
async function askClaude({ system, content, schema, maxTokens = 32000 }) {
  const apiKey = load(LS.key, "");
  if (!apiKey) throw new Error("⚙ ဆက်တင်မှာ API Key အရင်ထည့်ပါ");
  const model = load(LS.model, "claude-opus-5-5");
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const params = {
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content }],
    output_config: { effort: "high", format: { type: "json_schema", schema } },
  };
  if (model !== "claude-haiku-5-5") {
    // Re-route automatically if a safety classifier declines the request.
    params.betas = ["server-side-fallback-2026-07-01"];
    params.fallbacks = "default";
  }
  const msg = await client.beta.messages.stream(params).finalMessage();
  if (msg.stop_reason === "refusal") throw new Error("AI က ဒီတောင်းဆိုမှုကို ငြင်းပယ်ခဲ့ပါတယ်");
  if (msg.stop_reason === "max_tokens") throw new Error("အဖြေရှည်လွန်းပါတယ် — ဓာတ်ပုံအရေအတွက် လျှော့ပြီး ထပ်စမ်းပါ");
  const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return JSON.parse(text);
}

function apiErrorText(e) {
  if (e instanceof Anthropic.AuthenticationError) return "API Key မှားနေပါတယ်";
  if (e instanceof Anthropic.RateLimitError) return "ခဏနားပြီးမှ ထပ်စမ်းပါ (rate limit)";
  if (e instanceof Anthropic.APIConnectionError) return "အင်တာနက် ချိတ်ဆက်မှု မရပါ";
  if (e instanceof Anthropic.APIError) return `API error ${e.status ?? ""}: ${e.message}`;
  return e.message || String(e);
}

// ---------- images ----------
async function toImageBlock(file) {
  const img = await createImageBitmap(file);
  const max = 2000;
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return { type: "image", source: { type: "base64", media_type: "image/jpeg", data: dataUrl.split(",")[1] } };
}

function setupDrop(dropSel, inputSel, previewSel, onFiles) {
  const drop = $(dropSel), input = $(inputSel);
  const handle = (files) => {
    const list = [...files].filter((f) => f.type.startsWith("image/"));
    onFiles(list);
    $(previewSel).innerHTML = "";
    list.forEach((f) => {
      const im = document.createElement("img");
      im.src = URL.createObjectURL(f);
      im.title = f.name;
      $(previewSel).appendChild(im);
    });
  };
  input.addEventListener("change", () => handle(input.files));
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); handle(e.dataTransfer.files); });
}
setupDrop("#bankDrop", "#bankFiles", "#bankPreview", (f) => (bankImages = f));
setupDrop("#checkDrop", "#checkFiles", "#checkPreview", (f) => (checkImages = f));

// ---------- ① extract questions ----------
const EXTRACT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["questions"],
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["chapter", "chapterTitle", "number", "question", "answer", "marks", "difficulty"],
        properties: {
          chapter: { type: "string", description: "Chapter number as Arabic digits, e.g. \"3\". Empty string if unknown." },
          chapterTitle: { type: "string" },
          number: { type: "string", description: "Question number as printed" },
          question: { type: "string", description: "Full question text exactly as printed, including sub-parts and choices" },
          answer: { type: "string", description: "Answer exactly as printed in the photos; empty string if no answer is shown" },
          marks: { type: "number", description: "Marks as printed; if not printed, best estimate from question type" },
          difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
        },
      },
    },
  },
};

const EXTRACT_SYSTEM = `You transcribe exam questions and answers from photos of textbooks, question banks and past papers (often in Myanmar/Burmese, sometimes English).
Rules:
- Transcribe every question visible in the photos, word for word, in the original language. Never invent, rephrase, merge or add questions.
- Pair each question with its answer when the answer appears anywhere in the photos (same page, answer key, or a separate answer page). Copy the answer as written. If no answer is shown, use an empty string.
- chapter: the chapter (အခန်း) the question belongs to, as Arabic digits. Use headings, running headers or question labels to decide.
- marks: the marks printed for the question (e.g. "(၅ မှတ်)", "[2]"); if none are printed, estimate from question type and length.
- difficulty: judge from the cognitive demand: easy = recall/definition, medium = explanation/application, hard = multi-step reasoning, calculation or long answer.
- Convert Myanmar digits to Arabic digits only in the chapter and marks fields; keep question and answer text as written.`;

$("#extractBtn").addEventListener("click", async () => {
  const st = $("#bankStatus");
  if (!bankImages.length) return setStatus(st, "ဓာတ်ပုံ အရင်ရွေးပါ", true);
  const btn = $("#extractBtn");
  btn.disabled = true;
  try {
    const BATCH = 20;
    let added = 0, skipped = 0;
    for (let i = 0; i < bankImages.length; i += BATCH) {
      const files = bankImages.slice(i, i + BATCH);
      setStatus(st, `⏳ ဓာတ်ပုံ ${my(i + 1)}–${my(i + files.length)} / ${my(bankImages.length)} ကို ဖတ်နေပါတယ်... (မိနစ်အနည်းငယ် ကြာနိုင်ပါတယ်)`);
      const blocks = await Promise.all(files.map(toImageBlock));
      const subject = $("#subject").value.trim();
      const res = await askClaude({
        system: EXTRACT_SYSTEM,
        content: [...blocks, { type: "text", text: `Subject: ${subject || "(not given)"}\nExtract every question with its answer from these ${files.length} photo(s).` }],
        schema: EXTRACT_SCHEMA,
        maxTokens: 64000,
      });
      const existing = new Set(bank.map((q) => norm(q.question)));
      for (const q of res.questions) {
        if (!q.question.trim()) continue;
        if (existing.has(norm(q.question))) { skipped++; continue; }
        existing.add(norm(q.question));
        bank.push({ id: uid(), subject, source: files.map((f) => f.name).join(", "), ...q, marks: Number(q.marks) || 1 });
        added++;
      }
      save(LS.bank, bank);
      renderBank();
    }
    setStatus(st, `✔ မေးခွန်း ${my(added)} ပုဒ် ထည့်ပြီးပါပြီ${skipped ? `（ထပ်နေသော ${my(skipped)} ပုဒ် ကျော်ခဲ့သည်）` : ""}။ အောက်က ဇယားမှာ အခန်း/အမှတ်/ခက်ခဲမှု ကို စစ်ပြီး ပြင်နိုင်ပါတယ်။`);
  } catch (e) {
    setStatus(st, "✖ " + apiErrorText(e), true);
  } finally {
    btn.disabled = false;
  }
});

// ---------- bank table ----------
function chapters() {
  const m = new Map();
  bank.forEach((q) => { if (!m.has(q.chapter) || !m.get(q.chapter)) m.set(q.chapter, q.chapterTitle); });
  return [...m.entries()].sort((a, b) => chapterSort(a[0], b[0]));
}
const marksValues = () => [...new Set(bank.map((q) => q.marks))].sort((a, b) => a - b);

function renderBank() {
  $("#bankCount").textContent = my(bank.length);
  const sum = chapters().map(([c, t]) => {
    const qs = bank.filter((q) => q.chapter === c);
    return `<span>အခန်း ${esc(my(c || "?"))}${t ? " – " + esc(t) : ""}: ${my(qs.length)} ပုဒ်</span>`;
  });
  const byMarks = marksValues().map((m) => `<span>${my(m)} မှတ်ဖိုး: ${my(bank.filter((q) => q.marks === m).length)}</span>`);
  $("#bankSummary").innerHTML = sum.join("") + byMarks.join("");

  const f = norm($("#bankFilter").value);
  const rows = bank
    .filter((q) => !f || norm(q.question + q.answer + q.chapter).includes(f))
    .sort((a, b) => chapterSort(a.chapter, b.chapter) || a.marks - b.marks || LEVEL_ORDER[a.difficulty] - LEVEL_ORDER[b.difficulty]);
  $("#bankTable").innerHTML = `
    <tr><th>အခန်း</th><th>မေးခွန်း / အဖြေ</th><th>အမှတ်</th><th>ခက်ခဲမှု</th><th></th></tr>
    ${rows.map((q) => `
      <tr data-id="${q.id}">
        <td style="width:5em"><input data-f="chapter" value="${esc(q.chapter)}"></td>
        <td class="q">
          <textarea data-f="question" rows="2">${esc(q.question)}</textarea>
          <details><summary class="hint">အဖြေ</summary><textarea data-f="answer" rows="3">${esc(q.answer)}</textarea></details>
        </td>
        <td style="width:5em"><input data-f="marks" type="number" min="0" step="0.5" value="${q.marks}"></td>
        <td style="width:7em"><select data-f="difficulty" class="lvl-${q.difficulty}">
          ${Object.entries(LEVEL).map(([k, v]) => `<option value="${k}" ${k === q.difficulty ? "selected" : ""}>${v}</option>`).join("")}
        </select></td>
        <td><button data-del title="ဖျက်">✖</button></td>
      </tr>`).join("")}`;
  renderPresetChapters();
  renderBlueprint();
}

$("#bankTable").addEventListener("change", (e) => {
  const tr = e.target.closest("tr[data-id]");
  const field = e.target.dataset.f;
  if (!tr || !field) return;
  const q = bank.find((x) => x.id === tr.dataset.id);
  q[field] = field === "marks" ? Number(e.target.value) || 0 : e.target.value;
  save(LS.bank, bank);
  if (field !== "question" && field !== "answer") renderBank();
});
$("#bankTable").addEventListener("click", (e) => {
  if (!e.target.matches("[data-del]")) return;
  const id = e.target.closest("tr").dataset.id;
  bank = bank.filter((q) => q.id !== id);
  save(LS.bank, bank);
  renderBank();
});
$("#bankFilter").addEventListener("input", renderBank);

$("#exportBank").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify({ bank, papers }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `question-bank-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
});
$("#importBank").addEventListener("change", async (e) => {
  try {
    const data = JSON.parse(await e.target.files[0].text());
    const incoming = Array.isArray(data) ? data : data.bank || [];
    const existing = new Set(bank.map((q) => norm(q.question)));
    incoming.forEach((q) => { if (!existing.has(norm(q.question))) bank.push({ ...q, id: q.id || uid() }); });
    if (data.papers) papers = [...papers, ...data.papers.filter((p) => !papers.some((x) => x.id === p.id))];
    save(LS.bank, bank); save(LS.papers, papers);
    renderBank(); renderSavedPapers();
  } catch (err) { alert("JSON ဖိုင် မမှန်ပါ: " + err.message); }
  e.target.value = "";
});
$("#clearBank").addEventListener("click", () => {
  if (!confirm("မေးခွန်းဘဏ် အားလုံးကို ဖျက်မှာ သေချာလား?")) return;
  bank = []; save(LS.bank, bank); renderBank();
});

// ---------- ② generate ----------
function renderPresetChapters() {
  $("#presetChapters").innerHTML = chapters().map(([c, t]) => `<option value="${esc(c)}" selected>အခန်း ${esc(my(c || "?"))}${t ? " – " + esc(t) : ""}</option>`).join("");
}

// Pick questions whose marks add up exactly to `total` (or as close as possible).
function pickForTotal(pool, total, level) {
  const quota = level === "mixed" ? { easy: 0.3, medium: 0.5, hard: 0.2 } : { [level]: 1 };
  const candidates = level === "mixed" ? pool : pool.filter((q) => q.difficulty === level);
  let best = [], bestSum = -1;
  for (let attempt = 0; attempt < 400 && bestSum !== total; attempt++) {
    const picked = [], got = { easy: 0, medium: 0, hard: 0 };
    let sum = 0;
    const order = shuffle(candidates).sort((a, b) => {
      // prefer difficulties still under their quota
      const need = (q) => (quota[q.difficulty] || 0) * total - got[q.difficulty];
      return need(b) - need(a);
    });
    for (const q of order) {
      if (sum + q.marks > total) continue;
      const under = got[q.difficulty] < (quota[q.difficulty] || 0) * total;
      if (!under && Math.random() < 0.7) continue;
      picked.push(q); sum += q.marks; got[q.difficulty] += q.marks;
      if (sum === total) break;
    }
    if (sum > bestSum) { best = picked; bestSum = sum; }
  }
  return best;
}

function pickByRows(pool, rows) {
  const used = new Set(), picked = [], missing = [];
  for (const r of rows) {
    const match = shuffle(pool.filter((q) => !used.has(q.id)
      && (r.chapter === "*" || String(q.chapter) === String(r.chapter))
      && (r.marks === "*" || Number(q.marks) === Number(r.marks))
      && (r.difficulty === "*" || q.difficulty === r.difficulty)));
    const take = match.slice(0, r.count);
    take.forEach((q) => used.add(q.id));
    picked.push(...take);
    if (take.length < r.count) missing.push(`${rowLabel(r)}: ${my(r.count)} ပုဒ်လိုချင်ပေမယ့် ${my(take.length)} ပုဒ်သာ ရှိပါတယ်`);
  }
  return { picked, missing };
}
const rowLabel = (r) => `${r.chapter === "*" ? "အခန်းအားလုံး" : "အခန်း " + my(r.chapter)} / ${r.marks === "*" ? "အမှတ်မရွေး" : my(r.marks) + " မှတ်ဖိုး"} / ${r.difficulty === "*" ? "ခက်ခဲမှုမရွေး" : LEVEL[r.difficulty]}`;

function showPaper(questions, title, regen, notes = []) {
  const st = $("#genStatus");
  if (!questions.length) return setStatus(st, "✖ ကိုက်ညီတဲ့ မေးခွန်း မရှိပါ။ မေးခွန်းဘဏ်ထဲ မေးခွန်းထည့်ပါ (သို့) စည်းကမ်းချက် လျှော့ပါ။\n" + notes.join("\n"), true);
  const total = questions.reduce((s, q) => s + q.marks, 0);
  currentPaper = { title, subject: $("#subject").value.trim(), questions: questions.map((q) => ({ ...q })), total, regen };
  $("#paperTitle").value = title;
  setStatus(st, notes.length ? "⚠ " + notes.join("\n") : `✔ မေးခွန်း ${my(questions.length)} ပုဒ်၊ စုစုပေါင်း ${my(total)} မှတ်`, notes.length > 0);
  renderPaper();
  $("#paperCard").classList.remove("hidden");
  $("#paperCard").scrollIntoView({ behavior: "smooth" });
}

// Group by marks (section), easy → hard inside each section, numbered continuously.
function orderedSections(questions) {
  const groups = new Map();
  [...questions]
    .sort((a, b) => a.marks - b.marks || LEVEL_ORDER[a.difficulty] - LEVEL_ORDER[b.difficulty] || chapterSort(a.chapter, b.chapter))
    .forEach((q) => { if (!groups.has(q.marks)) groups.set(q.marks, []); groups.get(q.marks).push(q); });
  let n = 0;
  const sections = [...groups.entries()].map(([marks, qs]) => ({ marks, items: qs.map((q) => ({ ...q, no: ++n })) }));
  return sections;
}
const SECTION_NAMES = ["က", "ခ", "ဂ", "ဃ", "င", "စ", "ဆ", "ဇ", "ဈ", "ည"];

function renderPaper() {
  const p = currentPaper, showAns = $("#showAnswers").checked;
  const sections = orderedSections(p.questions);
  $("#paper").innerHTML = `
    <h2>${esc(p.title)}</h2>
    <div class="meta">${p.subject ? esc(p.subject) + " · " : ""}စုစုပေါင်း ${my(p.total)} မှတ်</div>
    ${sections.map((s, i) => `
      <h3>ပုဒ်မ (${SECTION_NAMES[i] || i + 1}) — မေးခွန်းတစ်ပုဒ်လျှင် ${my(s.marks)} မှတ်ဖိုး (${my(s.items.length)} ပုဒ်)</h3>
      <ol start="${s.items[0].no}">
        ${s.items.map((q) => `<li><span class="marks">[${my(q.marks)}]</span>${esc(q.question).replace(/\n/g, "<br>")}
          ${showAns ? `<div class="ans">${esc(q.answer || "(ဓာတ်ပုံထဲမှာ အဖြေမပါ)")}<br><small>အခန်း ${esc(my(q.chapter))} · ${LEVEL[q.difficulty]}</small></div>` : ""}
        </li>`).join("")}
      </ol>`).join("")}`;
}
$("#showAnswers").addEventListener("change", () => currentPaper && renderPaper());
$("#paperTitle").addEventListener("input", (e) => { if (currentPaper) { currentPaper.title = e.target.value; renderPaper(); } });
$("#reshuffle").addEventListener("click", () => currentPaper?.regen());

$$(".preset").forEach((b) => b.addEventListener("click", () => {
  const total = b.dataset.total === "custom" ? Number($("#customTotal").value) : Number(b.dataset.total);
  if (!total) return setStatus($("#genStatus"), "အမှတ်စုစုပေါင်း ထည့်ပါ", true);
  const run = () => {
    const chs = [...$("#presetChapters").selectedOptions].map((o) => o.value);
    const level = $("#presetLevel").value;
    const pool = bank.filter((q) => !chs.length || chs.includes(q.chapter));
    const picked = pickForTotal(pool, total, level);
    const got = picked.reduce((s, q) => s + q.marks, 0);
    const notes = got !== total ? [`ရှိတဲ့မေးခွန်းတွေနဲ့ ${my(total)} မှတ် အတိအကျ မပြည့်ပါ — ${my(got)} မှတ်သာ ရပါတယ်`] : [];
    showPaper(picked, `စာမေးပွဲ (${my(total)} မှတ်)`, run, notes);
  };
  run();
}));

// Blueprint (manual rows)
let blueprint = [{ chapter: "*", marks: "*", difficulty: "*", count: 1 }];
function renderBlueprint() {
  const chOpts = (v) => `<option value="*">အားလုံး</option>` + chapters().map(([c]) => `<option value="${esc(c)}" ${String(v) === String(c) ? "selected" : ""}>အခန်း ${esc(my(c || "?"))}</option>`).join("");
  const mkOpts = (v) => `<option value="*">မရွေး</option>` + marksValues().map((m) => `<option value="${m}" ${String(v) === String(m) ? "selected" : ""}>${my(m)} မှတ်</option>`).join("");
  const lvOpts = (v) => `<option value="*">မရွေး</option>` + Object.entries(LEVEL).map(([k, l]) => `<option value="${k}" ${v === k ? "selected" : ""}>${l}</option>`).join("");
  $("#blueprint").innerHTML = `<tr><th>အခန်း</th><th>အမှတ်</th><th>ခက်ခဲမှု</th><th>ပုဒ်ရေ</th><th></th></tr>` +
    blueprint.map((r, i) => `<tr data-i="${i}">
      <td><select data-f="chapter">${chOpts(r.chapter)}</select></td>
      <td><select data-f="marks">${mkOpts(r.marks)}</select></td>
      <td><select data-f="difficulty">${lvOpts(r.difficulty)}</select></td>
      <td><input data-f="count" type="number" min="1" value="${r.count}" style="width:5em"></td>
      <td><button data-del>✖</button></td></tr>`).join("");
  const known = blueprint.filter((r) => r.marks !== "*");
  $("#blueprintTotal").textContent = known.length === blueprint.length
    ? `စုစုပေါင်း ${my(blueprint.reduce((s, r) => s + Number(r.marks) * r.count, 0))} မှတ်` : "";
}
$("#blueprint").addEventListener("change", (e) => {
  const tr = e.target.closest("tr[data-i]"); if (!tr) return;
  const r = blueprint[tr.dataset.i], f = e.target.dataset.f;
  r[f] = f === "count" ? Math.max(1, Number(e.target.value) || 1) : e.target.value;
  renderBlueprint();
});
$("#blueprint").addEventListener("click", (e) => {
  if (!e.target.matches("[data-del]")) return;
  blueprint.splice(e.target.closest("tr").dataset.i, 1);
  if (!blueprint.length) blueprint.push({ chapter: "*", marks: "*", difficulty: "*", count: 1 });
  renderBlueprint();
});
$("#addRow").addEventListener("click", () => { blueprint.push({ chapter: "*", marks: "*", difficulty: "*", count: 1 }); renderBlueprint(); });
$("#blueprintBtn").addEventListener("click", () => {
  const rows = blueprint.map((r) => ({ ...r }));
  const run = () => { const { picked, missing } = pickByRows(bank, rows); showPaper(picked, "စာမေးပွဲ", run, missing); };
  run();
});

// Natural-language command → rows (Claude only parses; questions are always picked from the bank)
const COMMAND_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["rows", "total", "level", "title"],
  properties: {
    rows: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["chapter", "marks", "difficulty", "count"],
        properties: {
          chapter: { type: "string", description: "Chapter id from the list, or \"*\" for any" },
          marks: { type: "string", description: "Marks value from the list as a string, or \"*\" for any" },
          difficulty: { type: "string", enum: ["easy", "medium", "hard", "*"] },
          count: { type: "integer" },
        },
      },
    },
    total: { type: "number", description: "Requested total marks when the user asks only for a total (e.g. 100); otherwise 0" },
    level: { type: "string", enum: ["mixed", "easy", "medium", "hard"] },
    title: { type: "string", description: "Short exam title in Burmese" },
  },
};
$("#commandBtn").addEventListener("click", async () => {
  const st = $("#genStatus"), cmd = $("#command").value.trim();
  if (!cmd) return setStatus(st, "Command ရေးပါ", true);
  if (!bank.length) return setStatus(st, "မေးခွန်းဘဏ် ဗလာ ဖြစ်နေပါတယ်", true);
  const btn = $("#commandBtn");
  btn.disabled = true;
  setStatus(st, "⏳ Command ကို နားလည်အောင် ဖတ်နေပါတယ်...");
  try {
    const inventory = chapters().map(([c, t]) => {
      const qs = bank.filter((q) => q.chapter === c);
      const detail = marksValues().map((m) => {
        const byLv = Object.keys(LEVEL).map((l) => `${l}:${qs.filter((q) => q.marks === m && q.difficulty === l).length}`).join(" ");
        return qs.some((q) => q.marks === m) ? `  ${m} marks → ${byLv}` : "";
      }).filter(Boolean).join("\n");
      return `chapter "${c}" (${t || "untitled"}):\n${detail}`;
    }).join("\n");
    const plan = await askClaude({
      system: "You turn a teacher's exam request (usually in Burmese, with Burmese or Arabic digits) into selection rules over an existing question bank. Use only chapter ids and marks values that exist in the inventory. 'လွယ်' = easy, 'အလယ်' = medium, 'ခက်' = hard. If the teacher only asks for a total (e.g. ၁၀၀ မှတ်ဖိုး) without per-chapter counts, return empty rows and set total. If the teacher names chapters together with a total only, set total and put one row per chapter with count 0 so those chapters are used.",
      content: [{ type: "text", text: `Question bank inventory (counts per difficulty):\n${inventory}\n\nTeacher's request:\n${cmd}` }],
      schema: COMMAND_SCHEMA,
      maxTokens: 8000,
    });
    const rows = plan.rows.filter((r) => r.count > 0);
    const chs = plan.rows.filter((r) => r.chapter !== "*").map((r) => r.chapter);
    const title = plan.title || "စာမေးပွဲ";
    let run;
    if (!rows.length && plan.total > 0) {
      run = () => {
        const pool = bank.filter((q) => !chs.length || chs.includes(q.chapter));
        const picked = pickForTotal(pool, plan.total, plan.level);
        const got = picked.reduce((s, q) => s + q.marks, 0);
        showPaper(picked, title, run, got !== plan.total ? [`${my(plan.total)} မှတ် အတိအကျ မပြည့်ပါ — ${my(got)} မှတ်သာ ရပါတယ်`] : []);
      };
    } else {
      run = () => { const { picked, missing } = pickByRows(bank, rows); showPaper(picked, title, run, missing); };
    }
    run();
  } catch (e) {
    setStatus(st, "✖ " + apiErrorText(e), true);
  } finally {
    btn.disabled = false;
  }
});

// Saved papers
$("#savePaper").addEventListener("click", () => {
  if (!currentPaper) return;
  const { regen, ...p } = currentPaper;
  papers.unshift({ ...p, id: uid(), createdAt: new Date().toISOString() });
  save(LS.papers, papers);
  renderSavedPapers();
  setStatus($("#genStatus"), "✔ သိမ်းပြီးပါပြီ — ③ အဖြေစစ် မှာ ဒီစာစောင်ကို ရွေးနိုင်ပါပြီ");
});
function renderSavedPapers() {
  $("#savedPapers").innerHTML = papers.length ? papers.map((p) => `
    <li data-id="${p.id}"><span><b>${esc(p.title)}</b> · ${my(p.total)} မှတ် · ${my(p.questions.length)} ပုဒ် · <span class="hint">${new Date(p.createdAt).toLocaleString()}</span></span>
    <span><button data-open>ဖွင့်</button> <button data-del class="danger">ဖျက်</button></span></li>`).join("")
    : `<li class="hint">မရှိသေးပါ</li>`;
}
$("#savedPapers").addEventListener("click", (e) => {
  const li = e.target.closest("li[data-id]"); if (!li) return;
  const p = papers.find((x) => x.id === li.dataset.id);
  if (e.target.matches("[data-open]")) {
    currentPaper = { ...p, regen: () => {} };
    $("#paperTitle").value = p.title;
    renderPaper();
    $("#paperCard").classList.remove("hidden");
    $("#paperCard").scrollIntoView({ behavior: "smooth" });
  } else if (e.target.matches("[data-del]") && confirm("ဖျက်မှာ သေချာလား?")) {
    papers = papers.filter((x) => x.id !== p.id);
    save(LS.papers, papers);
    renderSavedPapers();
  }
});

// ---------- ③ check answers ----------
function renderCheckPapers() {
  $("#checkPaper").innerHTML = papers.length
    ? papers.map((p) => `<option value="${p.id}">${esc(p.title)} (${my(p.total)} မှတ်)</option>`).join("")
    : `<option value="">— ② မှာ စာစောင် အရင်သိမ်းပါ —</option>`;
}

const CHECK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["results", "overallFeedback"],
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["no", "studentAnswer", "awarded", "feedback"],
        properties: {
          no: { type: "integer" },
          studentAnswer: { type: "string", description: "Transcription of what the student wrote; empty if not attempted" },
          awarded: { type: "number" },
          feedback: { type: "string", description: "Short feedback in Burmese: what was right, what was missing" },
        },
      },
    },
    overallFeedback: { type: "string", description: "2-3 sentences in Burmese" },
  },
};

$("#checkBtn").addEventListener("click", async () => {
  const st = $("#checkStatus");
  const paper = papers.find((p) => p.id === $("#checkPaper").value);
  if (!paper) return setStatus(st, "မေးခွန်းစာစောင် ရွေးပါ", true);
  if (!checkImages.length) return setStatus(st, "အဖြေလွှာ ဓာတ်ပုံ ရွေးပါ", true);
  const btn = $("#checkBtn");
  btn.disabled = true;
  setStatus(st, "⏳ အဖြေလွှာကို ဖတ်ပြီး စစ်နေပါတယ်... (မိနစ်အနည်းငယ် ကြာနိုင်ပါတယ်)");
  try {
    const items = orderedSections(paper.questions).flatMap((s) => s.items);
    const key = items.map((q) => `### Question ${q.no} (${q.marks} marks)\nQuestion: ${q.question}\nModel answer: ${q.answer || "(no model answer in source — judge from subject knowledge and say so in feedback)"}`).join("\n\n");
    const blocks = await Promise.all(checkImages.map(toImageBlock));
    const res = await askClaude({
      system: `You are a fair, careful exam marker. The photos are a student's handwritten answer sheet (often in Burmese). Mark it against the answer key, which comes from the official source material.
- Read the student's handwriting carefully; match answers to question numbers as the student labeled them.
- Award marks for each question from 0 up to its maximum, in steps of 0.5. Give partial credit for answers that contain correct key points from the model answer, even if worded differently.
- Do not award marks for content not supported by the model answer.
- If a question was not attempted, award 0 and leave studentAnswer empty.
- Return one result for every question number in the key.
- Feedback in Burmese, short and specific.`,
      content: [...blocks, { type: "text", text: `Answer key (${items.length} questions, total ${paper.total} marks):\n\n${key}\n\nMark the student's answer sheet in the photos above.` }],
      schema: CHECK_SCHEMA,
      maxTokens: 64000,
    });
    renderResult(paper, items, res);
    setStatus(st, "✔ စစ်ပြီးပါပြီ — AI အမှတ်ပေးချက်ကို ဆရာ/ဆရာမ ပြန်လည်စစ်ဆေးပါ");
  } catch (e) {
    setStatus(st, "✖ " + apiErrorText(e), true);
  } finally {
    btn.disabled = false;
  }
});

function renderResult(paper, items, res) {
  const byNo = new Map(res.results.map((r) => [r.no, r]));
  let score = 0;
  const rows = items.map((q) => {
    const r = byNo.get(q.no) || { studentAnswer: "", awarded: 0, feedback: "မတွေ့ပါ" };
    const got = Math.max(0, Math.min(q.marks, Number(r.awarded) || 0));
    score += got;
    const mark = got === q.marks ? "✅" : got > 0 ? "🟡" : "❌";
    return `<tr><td>${my(q.no)}</td>
      <td>${esc(q.question).replace(/\n/g, "<br>")}
        <div class="fb"><b>ကျောင်းသားအဖြေ:</b> ${esc(r.studentAnswer || "(မဖြေ)")}</div>
        <div class="ans">${esc(q.answer)}</div>
        <div class="fb">${mark} ${esc(r.feedback)}</div></td>
      <td><b>${my(got)}</b>/${my(q.marks)}</td></tr>`;
  });
  const pct = paper.total ? Math.round((score / paper.total) * 100) : 0;
  const name = $("#studentName").value.trim();
  $("#result").innerHTML = `
    <h2>${esc(paper.title)}</h2>
    <div class="meta">${name ? "ကျောင်းသား: " + esc(name) + " · " : ""}${new Date().toLocaleDateString()}</div>
    <div class="score">${my(score)} / ${my(paper.total)} မှတ် (${my(pct)}%)</div>
    <p>${esc(res.overallFeedback)}</p>
    <table><tr><th>စဉ်</th><th>မေးခွန်း / အဖြေ</th><th>အမှတ်</th></tr>${rows.join("")}</table>`;
  $("#resultCard").classList.remove("hidden");
  $("#resultCard").scrollIntoView({ behavior: "smooth" });
}

// ---------- init ----------
renderBank();
renderSavedPapers();
renderCheckPapers();

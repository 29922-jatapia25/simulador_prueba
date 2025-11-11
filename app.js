// Simulador de prueba — App
const $ = (q) => document.querySelector(q);

let BANK = [];
let CURRENT_BANK_FILE = "questions.json";
const STORAGE_KEY_PREFIX = "simulador_state_v2_";

function randId(){
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let s = "Q";
  for (let i=0;i<7;i++) s += chars[Math.floor(Math.random()*chars.length)];
  return s;
}
function getStorageKey(){
  return STORAGE_KEY_PREFIX + CURRENT_BANK_FILE;
}
function dedupeBank(arr){
  const seenId = new Set();
  const cleaned = [];
  let fixedIds = 0, removedBad = 0;
  for (const q of arr){
    if (!q || !q.question || !Array.isArray(q.options)) { removedBad++; continue; }
    if (q.type === "tf") q.options = ["Verdadero","Falso"];
    let id = q.id || randId();
    while (seenId.has(id)) { id = randId(); fixedIds++; }
    q.id = id; seenId.add(id);
    cleaned.push(q);
  }
  return {cleaned, fixedIds, removedBad};
}

let EXAM = [];
let state = {
  idx: 0,
  answers: {},
  flagged: new Set(),
  startAt: null,
  timeLimit: 0,
  finished: false,
};

const fmt = (s) => String(s).padStart(2, "0");
const hhmmss = (sec) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s2 = sec % 60;
  return `${fmt(h)}:${fmt(m)}:${fmt(s2)}`;
};

async function loadBank(file = "questions.json") {
  CURRENT_BANK_FILE = file;
  const res = await fetch(file);
  if (!res.ok) throw new Error("No se pudo cargar " + file);
  const raw = await res.json();
  const {cleaned, fixedIds, removedBad} = dedupeBank(raw);
  BANK = cleaned;
  console.info(`Banco "${file}" cargado → ${BANK.length} preguntas (IDs ajustados: ${fixedIds}, inválidas: ${removedBad}).`);
  return BANK;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildExam(n = 50, shuffleAll = true) {
  const pool = shuffleAll ? shuffle(BANK) : BANK.slice();
  if (n > pool.length) {
    alert(`El banco tiene ${pool.length} preguntas; se usarán ${pool.length}.`);
    n = pool.length;
  }
  const chosen = pool.slice(0, n).map((q, i) => {
    const clone = {
      id: q.id,
      type: q.type,
      question: q.question,
      options: (q.type === "tf" ? ["Verdadero","Falso"] : (q.options || []).slice()),
      answerIndex: q.answerIndex,
      explanation: q.explanation || "",
      n: i + 1
    };
    if (!Array.isArray(clone.options) || clone.options.length === 0) {
      clone.options = ["—"];
      clone.answerIndex = 0;
    }
    const correctBefore = clone.options[clone.answerIndex];
    if (shuffleAll && clone.type === "mcq") {
      clone.options = shuffle(clone.options);
    }
    const newIdx = clone.options.findIndex(opt => opt === correctBefore);
    clone.answerIndex = newIdx >= 0 ? newIdx : 0;
    return clone;
  });
  return chosen;
}

function saveProgress() {
  const snapshot = {
    bank: CURRENT_BANK_FILE,
    EXAM,
    state: {
      ...state,
      flagged: Array.from(state.flagged || [])
    }
  };
  localStorage.setItem(getStorageKey(), JSON.stringify(snapshot));
}

function loadProgress() {
  const raw = localStorage.getItem(getStorageKey());
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw);
    const e = parsed && Array.isArray(parsed.EXAM) ? parsed.EXAM : null;
    const s = parsed && parsed.state ? parsed.state : null;
    if (!e || !s) return false;
    EXAM = e;
    state = {
      idx: Number.isInteger(s.idx) ? s.idx : 0,
      answers: (s.answers && typeof s.answers === 'object') ? s.answers : {},
      flagged: new Set(Array.isArray(s.flagged) ? s.flagged : []),
      startAt: s.startAt || Date.now(),
      timeLimit: Number.isFinite(s.timeLimit) ? s.timeLimit : 0,
      finished: !!s.finished
    };
    console.info("Progreso restaurado para banco:", CURRENT_BANK_FILE);
    return true;
  } catch (err) {
    console.error('No se pudo restaurar el progreso:', err);
    localStorage.removeItem(getStorageKey());
    return false;
  }
}

function renderGrid() {
  const grid = document.getElementById("grid");
  grid.innerHTML = "";
  EXAM.forEach((q, i) => {
    const btn = document.createElement("button");
    btn.textContent = q.n;
    if (state.idx === i) btn.classList.add("current");
    if (state.answers[q.id] !== undefined) btn.classList.add("answered");
    if (state.flagged && typeof state.flagged.has === 'function' && state.flagged.has(q.id)) btn.classList.add("flagged");
    btn.addEventListener("click", () => { state.idx = i; renderQuestion(); });
    grid.appendChild(btn);
  });
}

function renderQuestion() {
  const q = EXAM[state.idx];
  document.getElementById("qtext").innerHTML = `<strong>${q.n}.</strong> ${q.question}`;
  const ul = document.getElementById("options");
  ul.innerHTML = "";
  q.options.forEach((opt, i) => {
    const li = document.createElement("li");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "opt";
    input.id = `opt-${i}`;
    input.checked = state.answers[q.id] === i;
    const label = document.createElement("label");
    label.setAttribute("for", `opt-${i}`);
    label.textContent = opt;
    li.appendChild(input);
    li.appendChild(label);
    li.addEventListener("click", () => {
      state.answers[q.id] = i;
      renderGrid();
      renderProgress();
      saveProgress();
      li.classList.add("selected");
      setTimeout(()=>li.classList.remove("selected"), 200);
    });
    ul.appendChild(li);
  });
  renderGrid();
}

function renderProgress() {
  const answered = Object.keys(state.answers).length;
  document.getElementById("progress-text").textContent = `${answered} / ${EXAM.length}`;
  const pct = EXAM.length ? Math.round(100 * answered / EXAM.length) : 0;
  document.getElementById("progress-bar").style.width = `${pct}%`;
}

let ticker = null;
function startTimer() {
  if (state.timeLimit === 0) {
    document.getElementById("timer-text").textContent = "—";
    document.getElementById("timer-icon").textContent = "🕒";
    return;
  }
  ticker && clearInterval(ticker);
  ticker = setInterval(()=>{
    const elapsed = Math.floor((Date.now() - state.startAt) / 1000);
    const left = Math.max(0, state.timeLimit - elapsed);
    document.getElementById("timer-text").textContent = hhmmss(left);
    if (left <= 0) {
      clearInterval(ticker);
      submitExam(true);
    }
  }, 500);
}

function submitExam(auto = false) {
  state.finished = true;
  const elapsed = Math.floor((Date.now() - state.startAt) / 1000);
  const answered = Object.keys(state.answers).length;
  let correct = 0, wrong = 0, blank = EXAM.length - answered;
  EXAM.forEach(q => {
    const idx = state.answers[q.id];
    const chosen = idx !== undefined ? q.options[idx] : null;
    const isCorrect = chosen !== null && chosen === q.options[q.answerIndex];
    if (idx === undefined) return;
    if (isCorrect) correct++; else wrong++;
  });
  const score = EXAM.length ? Math.round(100 * correct / EXAM.length) : 0;
  document.getElementById("kpi-score").textContent = `${score}%`;
  document.getElementById("kpi-correct").textContent = correct;
  document.getElementById("kpi-wrong").textContent = wrong;
  document.getElementById("kpi-blank").textContent = blank;
  document.getElementById("kpi-time").textContent = hhmmss(elapsed);
  document.getElementById("exam").classList.add("hidden");
  document.getElementById("results").classList.remove("hidden");
  buildReview();
  saveProgress();
  if (auto) alert("Tiempo agotado. Se envió tu simulación automáticamente.");
}

function buildReview() {
  const box = document.getElementById("review");
  box.innerHTML = "";
  EXAM.forEach((q,i) => {
    const userIdx = state.answers[q.id];
    const userAns = userIdx !== undefined ? q.options[userIdx] : "—";
    const okAns = q.options[q.answerIndex];
    const ok = userAns === okAns;
    const item = document.createElement("div");
    item.className = "item";
    item.innerHTML = `<h4>${q.n}. ${q.question}
      <span class="tag ${ok ? "ok" : "bad"}">${ok ? "Correcta" : "Incorrecta"}</span>
    </h4>
    <div><strong>Tu respuesta:</strong> ${userAns}</div>
    <div><strong>Respuesta correcta:</strong> ${okAns}</div>
    <div class="info">${q.explanation || ""}</div>`;
    box.appendChild(item);
  });
}

function exportReview() {
  const html = `<!doctype html><html lang="es"><meta charset="utf-8"><title>Revisión</title>
  <style>body{font-family:system-ui;padding:24px;color:#111}
  h1{margin:0 0 8px}.item{border-top:1px solid #ddd;padding:8px 0}
  .tag{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px}
  .ok{background:#ecfdf3;color:#166534}.bad{background:#fef2f2;color:#991b1b}
  .muted{color:#6b7280;font-size:12px}</style>
  <h1>Revisión de simulación</h1>
  <p class="muted">${new Date().toLocaleString()}</p>
  ${document.getElementById("review").innerHTML}`;
  const blob = new Blob([html], {type:"text/html"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "revision_simulacion.html";
  a.click();
  setTimeout(()=>URL.revokeObjectURL(url), 800);
}

function clearAnswer() {
  const q = EXAM[state.idx];
  delete state.answers[q.id];
  renderQuestion();
  renderProgress();
  saveProgress();
}

async function main() {
  const bankSelect = document.getElementById("bank-select");
  CURRENT_BANK_FILE = bankSelect ? bankSelect.value || "questions.json" : "questions.json";
  await loadBank(CURRENT_BANK_FILE);

  if (loadProgress() && !state.finished) {
    document.getElementById("setup").classList.add("hidden");
    document.getElementById("exam").classList.remove("hidden");
    try {
      renderGrid();
      renderQuestion();
      renderProgress();
      startTimer();
    } catch (e) {
      console.error(e);
      localStorage.removeItem(getStorageKey());
      location.reload();
    }
  }

  if (bankSelect) {
    bankSelect.addEventListener("change", async (e)=>{
      const file = e.target.value;
      try {
        await loadBank(file);
        EXAM = [];
        state = { idx:0, answers:{}, flagged:new Set(), startAt:null, timeLimit:0, finished:false };
        localStorage.removeItem(getStorageKey());
        document.getElementById("setup").classList.remove("hidden");
        document.getElementById("exam").classList.add("hidden");
        document.getElementById("results").classList.add("hidden");
        document.getElementById("review").classList.add("hidden");
        document.getElementById("progress-text").textContent = "0 / 0";
        document.getElementById("progress-bar").style.width = "0%";
      } catch (err) {
        console.error(err);
        alert("No se pudo cargar el banco seleccionado.");
      }
    });
  }

  document.getElementById("btn-start").addEventListener("click", () => {
    const maxQ = BANK.length || 0;
    const n = Math.max(5, Math.min(parseInt(document.getElementById("num-questions").value || 50, 10), maxQ || 5));
    const noTimer = document.getElementById("no-timer").checked;
    const minutes = Math.max(5, parseInt(document.getElementById("time-limit").value || 60, 10));
    const shuf = document.getElementById("shuffle").checked;

    EXAM = buildExam(n, shuf);
    state = {
      idx: 0,
      answers: {},
      flagged: new Set(),
      finished: false,
      startAt: Date.now(),
      timeLimit: noTimer ? 0 : minutes * 60,
    };

    document.getElementById("setup").classList.add("hidden");
    document.getElementById("exam").classList.remove("hidden");
    renderQuestion();
    renderProgress();
    startTimer();
    saveProgress();
  });

  document.getElementById("prev").addEventListener("click", ()=>{
    state.idx = (state.idx - 1 + EXAM.length) % EXAM.length;
    renderQuestion();
    saveProgress();
  });

  document.getElementById("next").addEventListener("click", ()=>{
    state.idx = (state.idx + 1) % EXAM.length;
    renderQuestion();
    saveProgress();
  });

  document.getElementById("btn-submit").addEventListener("click", ()=>{
    if (confirm("¿Enviar simulación? No podrás cambiar respuestas.")) submitExam(false);
  });

  document.getElementById("btn-review").addEventListener("click", ()=>{
    document.getElementById("review").classList.toggle("hidden");
  });

  document.getElementById("btn-export").addEventListener("click", exportReview);

  document.getElementById("btn-restart").addEventListener("click", ()=>{
    localStorage.removeItem(getStorageKey());
    location.reload();
  });

  document.getElementById("btn-clear").addEventListener("click", clearAnswer);

  document.getElementById("btn-mark").addEventListener("click", ()=>{
    const q = EXAM[state.idx];
    if (state.flagged.has(q.id)) state.flagged.delete(q.id); else state.flagged.add(q.id);
    renderGrid();
    saveProgress();
  });

  document.getElementById("btn-help").addEventListener("click", ()=>{
    document.getElementById("helpDialog").showModal();
  });

  document.getElementById("btn-import").addEventListener("click", ()=>{
    document.getElementById("file-input").click();
  });

  document.getElementById("file-input").addEventListener("change", async (e)=>{
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!Array.isArray(data)) throw new Error("JSON inválido");
      const dep = dedupeBank(data);
      BANK = dep.cleaned;
      EXAM = [];
      state = { idx:0, answers:{}, flagged:new Set(), startAt:null, timeLimit:0, finished:false };
      alert(`Banco importado: ${BANK.length} preguntas. (IDs corregidos: ${dep.fixedIds}, inválidas: ${dep.removedBad})`);
    } catch (err) {
      alert("No se pudo importar el JSON: " + err.message);
    }
  });
}

main();

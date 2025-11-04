// Simulador de prueba — App
const $ = (q) => document.querySelector(q);
const $$ = (q) => Array.from(document.querySelectorAll(q));

let BANK = [];

function randId(){
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let s = "Q";
  for (let i=0;i<7;i++) s += chars[Math.floor(Math.random()*chars.length)];
  return s;
}
function normalizeText(t){
  return String(t||"").replace(/\s+/g," ").trim().toLowerCase();
}
function dedupeBank(arr){
  const seenText = new Set();
  const seenId = new Set();
  const cleaned = [];
  let removedByText = 0, fixedIds = 0, removedBad = 0;
  for (const q of arr){
    if (!q || !q.question || !Array.isArray(q.options)) { removedBad++; continue; }
    // normalize TF options if needed
    if (q.type === "tf") q.options = ["Verdadero","Falso"];
    // ensure id
    let id = q.id || randId();
    // fix duplicate ids
    while (seenId.has(id)) { id = randId(); fixedIds++; }
    q.id = id; seenId.add(id);
    const key = normalizeText(q.question);
    if (seenText.has(key)) { removedByText++; continue; }
    seenText.add(key);
    cleaned.push(q);
  }
  return {cleaned, removedByText, fixedIds, removedBad};
}

let EXAM = [];
let state = {
  idx: 0,
  answers: {},   // {id: optionIndex}
  flagged: new Set(),
  startAt: null,
  timeLimit: 0,  // seconds (0 = no timer)
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
  const res = await fetch(file);
  const raw = await res.json();
  const {cleaned, removedByText, fixedIds, removedBad} = dedupeBank(raw);
  BANK = cleaned;
  if (removedByText || fixedIds || removedBad) {
    console.info(`Banco depurado → ${BANK.length} preguntas (eliminadas por repetidas: ${removedByText}, IDs ajustados: ${fixedIds}, inválidas: ${removedBad}).`);
  }
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
    alert(`El banco tiene ${pool.length} preguntas únicas; se usarán ${pool.length}.`);
    n = pool.length;
  }
  const chosen = pool.slice(0, n).map((q, i) => {
    // Clone to avoid mutating BANK
    const clone = {
      id: q.id,
      type: q.type,
      question: q.question,
      options: (q.type === "tf" ? ["Verdadero","Falso"] : (q.options || []).slice()),
      answerIndex: q.answerIndex,
      explanation: q.explanation || "",
      n: i + 1
    };

    // Sanity checks
    if (!Array.isArray(clone.options) || clone.options.length === 0) {
      clone.options = ["—"];
      clone.answerIndex = 0;
    }

    // Guard: answerIndex must point to actual correct string BEFORE shuffle
    const correctBefore = clone.options[clone.answerIndex];

    // Shuffle options only for MCQ if requested
    if (shuffleAll && clone.type === "mcq") {
      clone.options = shuffle(clone.options);
    }

    // Remap answerIndex to the new index of the correct option
    const newIdx = clone.options.findIndex(opt => opt === correctBefore);
    clone.answerIndex = newIdx >= 0 ? newIdx : 0; // fallback safety

    return clone;
  });
  return chosen;
}


function saveProgress() {
  const snapshot = {
    EXAM,
    state: {
      ...state,
      flagged: Array.from(state.flagged || [])
    }
  };
  localStorage.setItem("simulador_state", JSON.stringify(snapshot));
}
function loadProgress() {
  const raw = localStorage.getItem("simulador_state");
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
    return true;
  } catch (err) {
    console.error('No se pudo restaurar el progreso:', err);
    localStorage.removeItem('simulador_state');
    return false;
  }
}

function renderGrid() {
  const grid = $("#grid");
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
  $("#qtext").innerHTML = `<strong>${q.n}.</strong> ${q.question}`;
  const ul = $("#options");
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
      setTimeout(()=>li.classList.remove("selected"), 250);
    });
    ul.appendChild(li);
  });
  renderGrid();
}

function renderProgress() {
  const answered = Object.keys(state.answers).length;
  $("#progress-text").textContent = `${answered} / ${EXAM.length}`;
  const pct = Math.round(100 * answered / EXAM.length);
  $("#progress-bar").style.width = `${pct}%`;
}

let ticker = null;
function startTimer() {
  if (state.timeLimit === 0) {
    $("#timer-text").textContent = "—";
    $("#timer-icon").textContent = "🕒";
    return;
  }
  ticker && clearInterval(ticker);
  ticker = setInterval(()=>{
    const elapsed = Math.floor((Date.now() - state.startAt) / 1000);
    const left = Math.max(0, state.timeLimit - elapsed);
    $("#timer-text").textContent = hhmmss(left);
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
  const score = Math.round(100 * correct / EXAM.length);
  $("#kpi-score").textContent = `${score}%`;
  $("#kpi-correct").textContent = correct;
  $("#kpi-wrong").textContent = wrong;
  $("#kpi-blank").textContent = blank;
  $("#kpi-time").textContent = hhmmss(elapsed);

  $("#exam").classList.add("hidden");
  $("#results").classList.remove("hidden");
  buildReview();
  saveProgress();
  if (auto) alert("Tiempo agotado. Se envió tu simulación automáticamente.");
}

function buildReview() {
  const box = $("#review");
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
  <style>body{font-family:Inter,system-ui;padding:24px;color:#111}h1{margin:0 0 8px}
  .item{border-top:1px solid #ddd;padding:12px 0}.tag{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px}
  .ok{background:#063;color:#b6f7d2}.bad{background:#700;color:#ffdcdc}.muted{color:#666}</style>
  <h1>Revisión de simulación</h1>
  <p class="muted">${new Date().toLocaleString()}</p>
  ${$("#review").innerHTML}`;
  const blob = new Blob([html], {type:"text/html"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "revision_simulacion.html"; a.click();
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
}

function clearAnswer() {
  const q = EXAM[state.idx];
  delete state.answers[q.id];
  renderQuestion(); renderProgress(); saveProgress();
}

async function main() {
  await loadBank();

  // Restore previous session if any
  if (loadProgress() && !state.finished) {
    $("#setup").classList.add("hidden");
    $("#exam").classList.remove("hidden");
    try { renderGrid(); renderQuestion(); renderProgress(); startTimer(); }
    catch (e) { console.error(e); localStorage.removeItem('simulador_state'); location.reload(); }
  }

  $("#btn-start").addEventListener("click", () => {
    const n = Math.max(5, Math.min(parseInt($("#num-questions").value || 50, 10), 120));
    const noTimer = $("#no-timer").checked;
    const minutes = Math.max(5, parseInt($("#time-limit").value || 60, 10));
    const shuf = $("#shuffle").checked;

    EXAM = buildExam(n, shuf);
    state = {
      idx: 0, answers:{}, flagged: new Set(), finished:false,
      startAt: Date.now(),
      timeLimit: noTimer ? 0 : minutes * 60,
    };

    $("#setup").classList.add("hidden");
    $("#exam").classList.remove("hidden");
    renderQuestion(); renderProgress(); startTimer(); saveProgress();
  });

  $("#prev").addEventListener("click", ()=>{
    state.idx = (state.idx - 1 + EXAM.length) % EXAM.length;
    renderQuestion(); saveProgress();
  });
  $("#next").addEventListener("click", ()=>{
    state.idx = (state.idx + 1) % EXAM.length;
    renderQuestion(); saveProgress();
  });

  $("#btn-submit").addEventListener("click", ()=>{
    if (confirm("¿Enviar simulación? No podrás cambiar respuestas.")) submitExam(false);
  });
  $("#btn-review").addEventListener("click", ()=> $("#review").classList.toggle("hidden"));
  $("#btn-export").addEventListener("click", exportReview);
  $("#btn-restart").addEventListener("click", ()=>{
    localStorage.removeItem("simulador_state");
    location.reload();
  });
  $("#btn-clear").addEventListener("click", clearAnswer);

  $("#btn-mark").addEventListener("click", ()=>{
    const q = EXAM[state.idx];
    if (state.flagged.has(q.id)) state.flagged.delete(q.id); else state.flagged.add(q.id);
    renderGrid(); saveProgress();
  });

  $("#btn-help").addEventListener("click", ()=> $("#helpDialog").showModal());

  $("#btn-import").addEventListener("click", ()=> $("#file-input").click());
  $("#file-input").addEventListener("change", async (e)=>{
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!Array.isArray(data)) throw new Error("JSON inválido");
      const dep = dedupeBank(data);
      BANK = dep.cleaned;
      alert(`Banco importado: ${BANK.length} preguntas. (Repetidas eliminadas: ${dep.removedByText}, IDs corregidos: ${dep.fixedIds}, inválidas: ${dep.removedBad})`);
    } catch (err) {
      alert("No se pudo importar el JSON: " + err.message);
    }
  });
}

main();

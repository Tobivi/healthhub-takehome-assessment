/* ─── AI Voice System — Conversation Frontend ───────────────────────────────
   Multi-turn, context-aware voice conversation with emotion detection.
   Each turn: User bubble (right) → AI bubble (left) with audio player.
─────────────────────────────────────────────────────────────────────────── */

const API_BASE = "http://localhost:8080";

// ─── Conversation State ─────────────────────────────────────────────────────
let conversationHistory = []; // [{role:"user"|"assistant", content:"..."}]
let turnCounter = 0;
let currentTurnId = null;

// ─── Recording State ────────────────────────────────────────────────────────
let isRecording  = false;
let isProcessing = false;
let mediaRecorder = null;
let audioChunks  = [];
let stream       = null;
let audioContext = null;
let analyser     = null;
let animFrame    = null;
let recTimer     = null;
let recSeconds   = 0;

// ─── Audio Player Instances (one per turn) ──────────────────────────────────
const audioInstances = {};
const turnBlobs      = {}; // recorded audio blob per voice turn
const turnIsAudio    = {}; // true if the turn was a voice recording

// ─── Session Timer ──────────────────────────────────────────────────────────
let sessionSecs = 0;
const sessionTimerEl = document.getElementById("sessionTimer");
setInterval(() => { sessionSecs++; sessionTimerEl.textContent = fmtTime(sessionSecs); }, 1000);

// ─── DOM Refs ───────────────────────────────────────────────────────────────
const micBtn          = document.getElementById("micBtn");
const micIcon         = document.getElementById("micIcon");
const inputField      = document.getElementById("inputField");
const inputPlaceholder= document.getElementById("inputPlaceholder");
const inputWaveformEl = document.getElementById("inputWaveform");
const textInput       = document.getElementById("textInput");
const sendBtn         = document.getElementById("sendBtn");
const newChatBtn      = document.getElementById("newChatBtn");
const welcomeMsg      = document.getElementById("welcomeMsg");
const messagesContainer = document.getElementById("messagesContainer");
const chatArea        = document.getElementById("chatArea");
const toastEl         = document.getElementById("toast");
const pSteps = [1,2,3,4,5].map(i => document.getElementById(`pStep${i}`));

// ─── Utilities ──────────────────────────────────────────────────────────────
function fmtTime(s) {
  return `${Math.floor(s/60).toString().padStart(2,"0")}:${(s%60).toString().padStart(2,"0")}`;
}

function fmtAudio(s) {
  if (!s || isNaN(s)) return "0:00";
  return `${Math.floor(s/60)}:${Math.floor(s%60).toString().padStart(2,"0")}`;
}

function showToast(msg, type = "", dur = 3000) {
  toastEl.textContent = msg;
  toastEl.className = `toast show ${type}`;
  setTimeout(() => { toastEl.className = "toast"; }, dur);
}

function scrollBottom() { chatArea.scrollTop = chatArea.scrollHeight; }

function getSupportedMime() {
  for (const t of ["audio/webm;codecs=opus","audio/webm","audio/ogg;codecs=opus","audio/mp4"]) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

function b64ToBlob(b64, mime = "audio/mpeg") {
  const bytes = atob(b64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

// ─── Pipeline ───────────────────────────────────────────────────────────────
function resetPipeline() { pSteps.forEach(s => s.className = "pipe-step"); }
function setPipe(idx)    { pSteps.forEach((s,i) => s.className = i < idx ? "pipe-step done" : i === idx ? "pipe-step active" : "pipe-step"); }
function setPipeDone()   { pSteps.forEach(s => s.className = "pipe-step done"); }

// ─── Create Turn Element ────────────────────────────────────────────────────
function createTurn() {
  turnCounter++;
  const id = `t${turnCounter}`;
  currentTurnId = id;

  const div = document.createElement("div");
  div.className = "msg-turn";
  div.id = id;
  div.innerHTML = `
    <!-- User row (right side) -->
    <div class="msg-row user-msg" id="${id}-ur">
      <div class="user-bubble" id="${id}-ub">

        <!-- State 1: Recording waveform -->
        <div class="bstate rec-state" id="${id}-s1">
          <div class="rec-header">
            <div class="rec-dot"></div>
            <span class="rec-label">Recording</span>
            <span class="rec-time" id="${id}-rt">00:00</span>
          </div>
          <canvas class="wave-canvas" id="${id}-wc" width="280" height="30"></canvas>
        </div>

        <!-- State 2: Processing dots -->
        <div class="bstate proc-state hidden" id="${id}-s2">
          <div class="proc-dots"><span></span><span></span><span></span></div>
          <span class="proc-label">Analyzing your message…</span>
        </div>

        <!-- State 3: Done — user audio player (voice) or typed text + emotion chip -->
        <div class="bstate done-state hidden" id="${id}-s3">
          <div class="user-audio-player hidden" id="${id}-uap">
            <button class="uap-play-btn" id="${id}-upb">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>
            </button>
            <div class="uap-track">
              <div class="uap-wave" id="${id}-uw"></div>
              <div class="uap-time" id="${id}-ut">0:00</div>
            </div>
          </div>
          <div class="user-text hidden" id="${id}-tx"></div>
          <div class="emotion-chip hidden" id="${id}-ec"></div>
        </div>

      </div>
      <div class="avatar user-av">U</div>
    </div>

    <!-- AI row (left side) — revealed after response -->
    <div class="msg-row ai-msg hidden" id="${id}-ar">
      <div class="avatar ai-av">🤖</div>
      <div class="ai-bubble" id="${id}-ab">

        <!-- Audio Player -->
        <div class="audio-player hidden" id="${id}-ap">
          <button class="play-btn" id="${id}-pb">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>
          </button>
          <div class="audio-track">
            <div class="static-wave" id="${id}-sw"></div>
            <div class="prog-bar" id="${id}-pgb">
              <div class="prog-fill" id="${id}-pgf"></div>
            </div>
            <div class="audio-time">
              <span id="${id}-ct">0:00</span>
              <span id="${id}-tt">0:00</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  `;
  return { el: div, id };
}

// ─── Live Waveform (microphone → canvas) ───────────────────────────────────
function startWaveDraw(canvasId) {
  if (!analyser) return;
  const cv   = document.getElementById(canvasId);
  const cv2  = inputWaveformEl;
  if (!cv) return;
  const ctx  = cv.getContext("2d");
  const ctx2 = cv2.getContext("2d");
  const buf  = analyser.frequencyBinCount;
  const data = new Uint8Array(buf);

  function draw() {
    analyser.getByteTimeDomainData(data);

    // Turn bubble waveform
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.lineWidth = 1.5; ctx.strokeStyle = "#ef4444";
    ctx.shadowColor = "#ef444450"; ctx.shadowBlur = 5;
    ctx.beginPath();
    const sl = cv.width / buf; let x = 0;
    for (let i = 0; i < buf; i++) {
      const y = (data[i] / 128) * cv.height / 2;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      x += sl;
    }
    ctx.lineTo(cv.width, cv.height / 2); ctx.stroke();

    // Input bar mini waveform
    ctx2.clearRect(0, 0, cv2.width, cv2.height);
    ctx2.lineWidth = 1.5; ctx2.strokeStyle = "#6366f1";
    ctx2.beginPath();
    const sl2 = cv2.width / buf; let x2 = 0;
    for (let i = 0; i < buf; i++) {
      const y = (data[i] / 128) * cv2.height / 2;
      i === 0 ? ctx2.moveTo(x2, y) : ctx2.lineTo(x2, y);
      x2 += sl2;
    }
    ctx2.lineTo(cv2.width, cv2.height / 2); ctx2.stroke();

    animFrame = requestAnimationFrame(draw);
  }
  draw();
}

function stopWaveDraw() { if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; } }

// ─── Start Recording ────────────────────────────────────────────────────────
async function startRecording() {
  if (isProcessing) { showToast("Please wait for the current response.", "error"); return; }
  if (isRecording)  { stopRecording(); return; }

  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch {
    showToast("Microphone access denied. Please allow mic permissions.", "error"); return;
  }

  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 512;
  audioContext.createMediaStreamSource(stream).connect(analyser);

  const mime = getSupportedMime();
  mediaRecorder = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
  audioChunks = [];
  mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
  mediaRecorder.start(100);

  isRecording = true;
  recSeconds  = 0;

  // Hide welcome, create turn
  welcomeMsg.classList.add("hidden");
  const { el, id } = createTurn();
  messagesContainer.appendChild(el);
  scrollBottom();

  recTimer = setInterval(() => {
    recSeconds++;
    const el = document.getElementById(`${id}-rt`);
    if (el) el.textContent = fmtTime(recSeconds);
  }, 1000);

  // Mic button → recording style
  micBtn.classList.add("recording");
  inputField.classList.add("recording-active");
  inputPlaceholder.classList.add("hidden");
  inputWaveformEl.style.display = "block";
  micIcon.innerHTML = `<rect x="6" y="6" width="12" height="12" rx="2" fill="white"/>`;

  startWaveDraw(`${id}-wc`);
  resetPipeline();
  setPipe(0);
}

// ─── Stop Recording ─────────────────────────────────────────────────────────
async function stopRecording() {
  if (!isRecording || !mediaRecorder) return;
  isRecording = false;

  clearInterval(recTimer);
  stopWaveDraw();
  stream.getTracks().forEach(t => t.stop());

  await new Promise(r => { mediaRecorder.onstop = r; if (mediaRecorder.state !== "inactive") mediaRecorder.stop(); });
  try { if (audioContext) await audioContext.close(); } catch (_) {}

  // Reset mic button
  micBtn.classList.remove("recording");
  inputField.classList.remove("recording-active");
  inputWaveformEl.style.display = "none";
  inputPlaceholder.classList.remove("hidden");
  micIcon.innerHTML = `
    <path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"/>
    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
    <line x1="12" y1="19" x2="12" y2="23"/>
    <line x1="8" y1="23" x2="16" y2="23"/>`;

  // Transition bubble → processing state
  const id = currentTurnId;
  document.getElementById(`${id}-s1`).classList.add("hidden");
  document.getElementById(`${id}-s2`).classList.remove("hidden");

  const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || "audio/webm" });
  turnBlobs[id]   = blob;
  turnIsAudio[id] = true;
  await processAudio(blob, id);
}

// ─── Process Audio ───────────────────────────────────────────────────────────
async function processAudio(blob, turnId) {
  isProcessing = true;
  micBtn.classList.add("processing");
  micBtn.title = "Processing…";

  setPipe(1);
  let si = 0;
  const pipeSteps = [1, 2, 3, 4];
  const stepInterval = setInterval(() => { if (si < pipeSteps.length) setPipe(pipeSteps[si++]); }, 2000);

  try {
    const fd = new FormData();
    fd.append("audio", blob, "recording.webm");
    fd.append("history", JSON.stringify(conversationHistory));

    const res = await fetch(`${API_BASE}/api/process`, { method: "POST", body: fd });
    clearInterval(stepInterval);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }

    const data = await res.json();
    conversationHistory.push({ role: "user",      content: data.transcript });
    conversationHistory.push({ role: "assistant",  content: data.response_text });

    await renderTurn(turnId, data);
    setPipeDone();
    showToast("Response ready!", "success", 1500);

  } catch (err) {
    clearInterval(stepInterval);
    // Show error in bubble
    const s2 = document.getElementById(`${turnId}-s2`);
    const s3 = document.getElementById(`${turnId}-s3`);
    if (s2) s2.classList.add("hidden");
    if (s3) {
      s3.classList.remove("hidden");
      const txEl = document.getElementById(`${turnId}-tx`);
      txEl.textContent = `⚠ ${err.message}`;
      txEl.classList.remove("hidden");
    }
    resetPipeline();
    showToast(`Error: ${err.message}`, "error", 5000);
    console.error("[ERROR]", err);
  } finally {
    isProcessing = false;
    micBtn.classList.remove("processing");
    micBtn.title = "Click to record";
  }
}

// ─── Render Turn Result ──────────────────────────────────────────────────────
async function renderTurn(id, data) {
  const cfg = data.emotion_config;

  // User bubble: switch to done state
  document.getElementById(`${id}-s2`).classList.add("hidden");
  document.getElementById(`${id}-s3`).classList.remove("hidden");

  // Voice turn → show user audio player; text turn → show typed text
  if (turnIsAudio[id] && turnBlobs[id]) {
    mountUserAudioPlayer(id, turnBlobs[id]);
  } else {
    const txEl = document.getElementById(`${id}-tx`);
    txEl.textContent = data.transcript;
    txEl.classList.remove("hidden");
  }

  // Emotion chip
  const chip = document.getElementById(`${id}-ec`);
  chip.innerHTML = `${cfg.emoji}&nbsp;<strong style="color:${cfg.color}">${cfg.label}</strong>&ensp;<span class="chip-conf">${data.emotion_confidence}%</span>`;
  chip.style.borderColor = cfg.color;
  chip.style.background  = cfg.color + "1a";
  chip.classList.remove("hidden");

  scrollBottom();
  await delay(350);

  // Show AI row — audio only, no text
  document.getElementById(`${id}-ar`).classList.remove("hidden");
  scrollBottom();

  if (data.audio_base64) mountAudioPlayer(id, data.audio_base64);

  scrollBottom();
}

// ─── Typewriter ──────────────────────────────────────────────────────────────
function typewriter(el, text, speed) {
  return new Promise(resolve => {
    el.textContent = "";
    let i = 0;
    const iv = setInterval(() => {
      if (i < text.length) { el.textContent += text[i++]; scrollBottom(); }
      else { clearInterval(iv); resolve(); }
    }, speed);
  });
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── User Audio Player (recorded voice in user bubble) ───────────────────────
function mountUserAudioPlayer(id, blob) {
  const audio   = new Audio(URL.createObjectURL(blob));
  const instKey = `u_${id}`;
  const playBtn = document.getElementById(`${id}-upb`);
  audioInstances[instKey] = { audio, playing: false, btn: playBtn };

  const player = document.getElementById(`${id}-uap`);
  const waveEl = document.getElementById(`${id}-uw`);
  const timeEl = document.getElementById(`${id}-ut`);

  audio.addEventListener("loadedmetadata", () => {
    timeEl.textContent = fmtAudio(audio.duration);
    buildStaticWave(waveEl);
    player.classList.remove("hidden");
    scrollBottom();
  });

  audio.addEventListener("timeupdate", () => {
    const pct = (audio.currentTime / audio.duration) * 100 || 0;
    tintWave(waveEl, pct);
    timeEl.textContent = fmtAudio(audio.currentTime);
  });

  audio.addEventListener("ended", () => {
    audioInstances[instKey].playing = false;
    setIcon(playBtn, false);
  });

  playBtn.addEventListener("click", () => {
    const inst = audioInstances[instKey];
    if (inst.playing) {
      audio.pause(); inst.playing = false; setIcon(playBtn, false);
    } else {
      Object.entries(audioInstances).forEach(([k, v]) => {
        if (k !== instKey && v.playing) { v.audio.pause(); v.playing = false; setIcon(v.btn, false); }
      });
      audio.play(); inst.playing = true; setIcon(playBtn, true);
    }
  });
}

// ─── AI Audio Player ──────────────────────────────────────────────────────────
function mountAudioPlayer(id, b64) {
  const audio   = new Audio(URL.createObjectURL(b64ToBlob(b64)));
  const playBtn = document.getElementById(`${id}-pb`);
  audioInstances[id] = { audio, playing: false, btn: playBtn };

  const player  = document.getElementById(`${id}-ap`);
  const pgFill  = document.getElementById(`${id}-pgf`);
  const pgBar   = document.getElementById(`${id}-pgb`);
  const ctEl    = document.getElementById(`${id}-ct`);
  const ttEl    = document.getElementById(`${id}-tt`);
  const swEl    = document.getElementById(`${id}-sw`);

  audio.addEventListener("loadedmetadata", () => {
    ttEl.textContent = fmtAudio(audio.duration);
    buildStaticWave(swEl);
    player.classList.remove("hidden");
    scrollBottom();
  });

  audio.addEventListener("timeupdate", () => {
    const pct = (audio.currentTime / audio.duration) * 100 || 0;
    pgFill.style.width = pct + "%";
    ctEl.textContent = fmtAudio(audio.currentTime);
    tintWave(swEl, pct);
  });

  audio.addEventListener("ended", () => {
    audioInstances[id].playing = false;
    setIcon(playBtn, false);
    pgFill.style.width = "0%";
    ctEl.textContent = "0:00";
  });

  playBtn.addEventListener("click", () => {
    const inst = audioInstances[id];
    if (inst.playing) {
      audio.pause(); inst.playing = false; setIcon(playBtn, false);
    } else {
      Object.entries(audioInstances).forEach(([k, v]) => {
        if (k !== id && v.playing) { v.audio.pause(); v.playing = false; setIcon(v.btn, false); }
      });
      audio.play(); inst.playing = true; setIcon(playBtn, true);
    }
  });

  pgBar.addEventListener("click", e => {
    if (!audio.duration) return;
    const r = pgBar.getBoundingClientRect();
    audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration;
  });

  // Auto-play
  setTimeout(() => {
    audio.play().then(() => { audioInstances[id].playing = true; setIcon(playBtn, true); }).catch(() => {});
  }, 200);
}

function setIcon(btn, playing) {
  btn.innerHTML = playing
    ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="white"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`
    : `<svg width="13" height="13" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>`;
}

function buildStaticWave(el) {
  el.innerHTML = "";
  [4,8,13,10,18,12,22,15,20,11,24,16,19,9,23,14,17,10,13,7,11,19,21,15,20,12,9,15,18,11].forEach(h => {
    const b = document.createElement("div");
    b.className = "sw-bar"; b.style.height = h + "px";
    el.appendChild(b);
  });
}

function tintWave(el, pct) {
  const bars = el.querySelectorAll(".sw-bar");
  const cut  = Math.round((pct / 100) * bars.length);
  bars.forEach((b, i) => { b.style.background = i < cut ? "rgba(99,102,241,0.85)" : "rgba(255,255,255,0.15)"; });
}

// ─── Text Input ──────────────────────────────────────────────────────────────
async function processText(text) {
  if (!text.trim() || isProcessing) return;
  isProcessing = true;
  micBtn.classList.add("processing");

  welcomeMsg.classList.add("hidden");
  const { el, id } = createTurn();
  // Skip recording state, go straight to processing
  document.getElementById(`${id}-s1`).classList.add("hidden");
  document.getElementById(`${id}-s2`).classList.remove("hidden");
  messagesContainer.appendChild(el);
  scrollBottom();

  resetPipeline(); setPipe(1);

  let si = 1;
  const stepInterval = setInterval(() => { if (si < 4) setPipe(si++); }, 1800);

  try {
    const fd = new FormData();
    fd.append("text", text.trim());
    fd.append("history", JSON.stringify(conversationHistory));

    const res = await fetch(`${API_BASE}/api/test`, { method: "POST", body: fd });
    clearInterval(stepInterval);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }

    const data = await res.json();
    conversationHistory.push({ role: "user",      content: data.transcript });
    conversationHistory.push({ role: "assistant",  content: data.response_text });

    await renderTurn(id, data);
    setPipeDone();
    showToast("Response ready!", "success", 1500);

  } catch (err) {
    clearInterval(stepInterval);
    const s2 = document.getElementById(`${id}-s2`);
    const s3 = document.getElementById(`${id}-s3`);
    if (s2) s2.classList.add("hidden");
    if (s3) {
      s3.classList.remove("hidden");
      const txEl = document.getElementById(`${id}-tx`);
      txEl.textContent = `⚠ ${err.message}`;
      txEl.classList.remove("hidden");
    }
    resetPipeline();
    showToast(`Error: ${err.message}`, "error", 5000);
  } finally {
    isProcessing = false;
    micBtn.classList.remove("processing");
  }
}

// ─── New Conversation ────────────────────────────────────────────────────────
function newConversation() {
  // Pause any playing audio
  Object.values(audioInstances).forEach(v => { try { v.audio.pause(); } catch (_) {} });
  Object.keys(audioInstances).forEach(k => delete audioInstances[k]);

  conversationHistory = [];
  turnCounter = 0;
  currentTurnId = null;
  Object.keys(turnBlobs).forEach(k => delete turnBlobs[k]);
  Object.keys(turnIsAudio).forEach(k => delete turnIsAudio[k]);
  messagesContainer.innerHTML = "";
  welcomeMsg.classList.remove("hidden");
  resetPipeline();
  showToast("New conversation started", "success", 1500);
}

// ─── Event Listeners ─────────────────────────────────────────────────────────
micBtn.addEventListener("click", () => { if (!isProcessing) isRecording ? stopRecording() : startRecording(); });

newChatBtn.addEventListener("click", newConversation);

sendBtn.addEventListener("click", () => {
  const val = textInput.value.trim();
  if (val) {
    textInput.value = "";
    textInput.classList.add("hidden");
    inputField.classList.remove("hidden");
    processText(val);
  } else {
    const vis = !textInput.classList.contains("hidden");
    textInput.classList.toggle("hidden", vis);
    inputField.classList.toggle("hidden", !vis);
    if (!vis) textInput.focus();
  }
});

textInput.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    const val = textInput.value.trim();
    if (val) { textInput.value = ""; textInput.classList.add("hidden"); inputField.classList.remove("hidden"); processText(val); }
  }
  if (e.key === "Escape") { textInput.classList.add("hidden"); inputField.classList.remove("hidden"); }
});

document.addEventListener("keydown", e => {
  if (e.target === textInput || e.ctrlKey || e.metaKey) return;
  if (e.code === "Space")  { e.preventDefault(); isProcessing ? null : isRecording ? stopRecording() : startRecording(); }
  if (e.code === "Escape" && isRecording) stopRecording();
});

// Demo hint chips
window.typeDemoText = text => {
  textInput.classList.remove("hidden");
  inputField.classList.add("hidden");
  textInput.value = text;
  textInput.focus();
};

// ─── Init ────────────────────────────────────────────────────────────────────
(async () => {
  try {
    const r = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(4000) });
    if (r.ok) showToast("✓ Backend connected", "success", 2500);
  } catch (_) {
    showToast("⚠ Backend not reachable — run start.sh first", "error", 6000);
  }

  if (navigator.permissions) {
    try {
      const p = await navigator.permissions.query({ name: "microphone" });
      if (p.state === "denied") showToast("Microphone blocked — enable in browser settings", "error", 5000);
    } catch (_) {}
  }
})();

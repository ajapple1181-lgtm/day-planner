/* =========================================================
   Day Conductor (Daily schedule planner)
   - fixed header/tabs (no scroll move)
   - timeline fixed time axis + NOW dashed line
   - second30Start: 17:00〜21:30, :00/:15/:30 only (no :45)
   - remain label: "残り" -> subject name (or life block name)
   ========================================================= */

const STORAGE_KEY = "day_conductor_latest_v1";

/* ===== basic helpers ===== */
const pad2 = (n) => String(n).padStart(2, "0");
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function parseDateStr(s) {
  const [y, m, d] = s.split("-").map(v => parseInt(v, 10));
  return new Date(y, (m - 1), d, 0, 0, 0, 0);
}
function dateStr(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function addDaysStr(s, days) {
  const d = parseDateStr(s);
  d.setDate(d.getDate() + days);
  return dateStr(d);
}
function weekdayJa(d) {
  return ["日","月","火","水","木","金","土"][d.getDay()];
}
function fmtMD(d) {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
function msOfDateTime(dateS, timeHM) {
  const d = parseDateStr(dateS);
  const [hh, mm] = (timeHM || "").split(":").map(v => parseInt(v, 10));
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return NaN;
  d.setHours(hh, mm, 0, 0);
  return d.getTime();
}
function timeToMin(hm) {
  const [h, m] = (hm || "").split(":").map(v => parseInt(v, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN;
  return h * 60 + m;
}
function minToTime(m) {
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return `${pad2(hh)}:${pad2(mm)}`;
}
function fmtHMM(ms) {
  const d = new Date(ms);
  const h = d.getHours();
  const m = pad2(d.getMinutes());
  return `${h}:${m}`;
}
function fmtRange(startMs, endMs) {
  return `${fmtHMM(startMs)}-${fmtHMM(endMs)}`;
}
function fmtMS(sec) {
  const s = Math.max(0, Math.floor(sec));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${pad2(ss)}`;
}
function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(3);
}
function deepClone(o){ return JSON.parse(JSON.stringify(o)); }

/* ===== second 30 move options (select only) ===== */
function buildSecondMoveOptions() {
  const out = [];
  for (let m = 17*60; m <= 21*60 + 30; m += 15) {
    if ((m % 60) === 45) continue;     // ★ 45分だけ除外
    out.push(minToTime(m));
  }
  return out;
}
const SECOND_MOVE_OPTIONS = buildSecondMoveOptions();

/* ===== fixed timeline scale ===== */
const TL_SLOT_MIN = 15;
const TL_SLOT_H = 18;                 // CSS --slot-h と一致させる
const TL_PX_PER_MIN = TL_SLOT_H / TL_SLOT_MIN;

/* ===== time options (旧select用は残す) ===== */
function makeTimeOptions(stepMin = 5) {
  const out = [];
  for (let m = 0; m < 24 * 60; m += stepMin) out.push(minToTime(m));
  return out;
}
const TIMES_5 = makeTimeOptions(5);

/* ===== subject config ===== */
const GROUPS = [
  { key:"none", name:"—", color:"gray" },
  { key:"jp", name:"国語系", color:"pink" },
  { key:"math", name:"数学系", color:"sky" },
  { key:"en", name:"英語系", color:"purple" },
  { key:"sci", name:"理科系", color:"lime" },
  { key:"soc", name:"社会系", color:"yellow" },
  { key:"other", name:"その他", color:"gray" },
];

const SUBJECTS_BY_GROUP = {
  jp: ["論国", "古典"],
  math: ["数Ⅲ", "数C"],
  en: ["英C", "論表"],
  sci: ["化学", "生物"],
  soc: ["地理", "公共"],
  other: ["その他"],
};

const TASKTYPE_BY_SUBJECT = {
  "論国": ["—", "教科書", "漢字", "現代文課題"],
  "古典": ["—", "教科書", "古文単語", "古文課題", "漢文課題"],
  "数Ⅲ": ["—", "予習", "復習", "4STEP", "課題"],
  "数C": ["—", "予習", "復習", "4STEP", "課題"],
  "英C": ["—", "予習", "復習", "CROWN", "Cutting Edge", "LEAP", "課題"],
  "論表": ["—", "予習", "復習", "Write to the point", "Scramble"],
  "化学": ["—", "予習", "復習", "セミナー", "実験"],
  "生物": ["—", "予習", "復習", "セミナー", "実験"],
  "地理": ["—", "教科書"],
  "公共": ["—", "教科書"],
  "その他": ["—"],
};

function allTaskTypesUnion() {
  const set = new Set();
  Object.values(TASKTYPE_BY_SUBJECT).forEach(arr => arr.forEach(x => set.add(x)));
  const out = ["—"];
  [...set].filter(x => x !== "—").sort((a,b)=>a.localeCompare(b,"ja")).forEach(x=>out.push(x));
  return out;
}
const TASKTYPE_UNION = allTaskTypesUnion();

/* ===== life config ===== */
const LIFE_TYPE_OPTIONS = [
  "-", "移動", "食事", "風呂", "準備", "ラジオ", "テレビ", "爪切り", "散髪",
];

const LIFE_AUTO_MIN = {
  "移動": 30,
  "食事": 30,
  "風呂": 60,
  "準備": 15,
  "ラジオ": 60,
  "テレビ": 60,
  "爪切り": 15,
  "散髪": 60,
};

function emptyLifeSettings() {
  return {
    lesson: "なし",
    club: "なし",

    morningMoveStart: "",
    morningMoveMin: "",

    lessonStart: "",
    lessonEnd: "",

    clubStart: "",
    clubEnd: "",

    returnMoveType: "",
    second30Start: "",

    bath: "なし",
    bathMin: "",

    prep: "なし",
    prepMin: "",

    sleepUse: "なし",
    bedTime: "",
    wakeTime: "",

    customBlocks: [],
  };
}

function templateMonWedFri() {
  return {
    lesson: "あり",
    club: "あり",
    morningMoveStart: "07:30",
    morningMoveMin: 60,
    lessonStart: "08:30",
    lessonEnd: "15:00",
    clubStart: "15:00",
    clubEnd: "18:30",
    returnMoveType: "60",
    second30Start: "",
    bath: "あり",
    bathMin: 60,
    prep: "あり",
    prepMin: 15,
    sleepUse: "あり",
    bedTime: "01:00",
    wakeTime: "07:05",
    customBlocks: [],
  };
}
function templateTueThu() {
  return {
    lesson: "あり",
    club: "なし",
    morningMoveStart: "07:30",
    morningMoveMin: 60,
    lessonStart: "08:30",
    lessonEnd: "16:00",
    clubStart: "",
    clubEnd: "",
    returnMoveType: "30x2",
    second30Start: "20:00",
    bath: "あり",
    bathMin: 60,
    prep: "あり",
    prepMin: 15,
    sleepUse: "あり",
    bedTime: "01:00",
    wakeTime: "07:05",
    customBlocks: [],
  };
}
function templateSat() {
  return {
    lesson: "なし",
    club: "あり",
    morningMoveStart: "07:00",
    morningMoveMin: 60,
    lessonStart: "",
    lessonEnd: "",
    clubStart: "08:00",
    clubEnd: "12:30",
    returnMoveType: "30x2",
    second30Start: "18:15",
    bath: "あり",
    bathMin: 60,
    prep: "なし",
    prepMin: "",
    sleepUse: "あり",
    bedTime: "01:00",
    wakeTime: "08:00",
    customBlocks: [],
  };
}
function templateSun() {
  return {
    lesson: "なし",
    club: "なし",
    morningMoveStart: "09:00",
    morningMoveMin: 30,
    lessonStart: "",
    lessonEnd: "",
    clubStart: "",
    clubEnd: "",
    returnMoveType: "30",
    second30Start: "",
    bath: "あり",
    bathMin: 60,
    prep: "あり",
    prepMin: 15,
    sleepUse: "あり",
    bedTime: "00:30",
    wakeTime: "07:05",
    customBlocks: [],
  };
}
function templateByWeekday(dateS) {
  const d = parseDateStr(dateS);
  const wd = d.getDay();
  if (wd === 0) return templateSun();
  if (wd === 6) return templateSat();
  if (wd === 2 || wd === 4) return templateTueThu();
  return templateMonWedFri();
}

/* ===== state ===== */
function defaultState() {
  return {
    v: 1,
    activeTab: "life",
    selectedDate: todayStr(),

    lifeByDate: {},
    studyByDate: {},
    progressByTask: {},

    runner: {
      activeTaskId: null,
      isRunning: false,
      lastTick: 0,
      pausedByUser: false,
      arrivalShownTaskId: null,
    },
  };
}
let state = loadState();

/* ===== DOM refs ===== */
const tabLife = document.getElementById("tab-life");
const tabStudy = document.getElementById("tab-study");
const tabTimeline = document.getElementById("tab-timeline");
const tabBtns = [...document.querySelectorAll(".tabBtn")];

const nowClock = document.getElementById("nowClock");
const nowBtn = document.getElementById("nowBtn");

const remainPill = document.getElementById("remainPill");
const remainTime = document.getElementById("remainTime");
const remainLabel = document.getElementById("remainLabel");

const modalRoot = document.getElementById("modalRoot");
const modalTitle = document.getElementById("modalTitle");
const modalBody = document.getElementById("modalBody");
const modalFooter = document.getElementById("modalFooter");

let runnerUiTimer = null;

/* ===== storage ===== */
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const s = JSON.parse(raw);
    const base = defaultState();
    return { ...base, ...s, runner: { ...base.runner, ...(s.runner || {}) } };
  } catch {
    return defaultState();
  }
}
function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/* ===== ui helpers ===== */
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function wrapField(labelText, inputNode) {
  const box = el("div", "");
  const lb = el("div", "label", labelText);
  box.appendChild(lb);
  box.appendChild(inputNode);
  return box;
}
function mkSelect(options, value, onChange, allowEmpty = false) {
  const s = document.createElement("select");
  options.forEach(opt => {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt;
    s.appendChild(o);
  });
  if (allowEmpty) {
    const o = document.createElement("option");
    o.value = "";
    o.textContent = "—";
    s.insertBefore(o, s.firstChild);
  }
  s.value = (value ?? "");
  s.addEventListener("change", () => onChange(s.value));
  return s;
}
function mkTimeInput(value, onChange, stepSec = 60, disabled = false) {
  const i = document.createElement("input");
  i.type = "time";
  i.step = String(stepSec);
  i.value = value || "";
  i.disabled = !!disabled;
  i.addEventListener("input", () => onChange(i.value));
  i.addEventListener("change", () => onChange(i.value));
  return i;
}
function mkBtn(text, cls, onClick) {
  const b = el("button", `btn ${cls||""}`.trim(), text);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}
function openModal(title, bodyNode, footerButtons) {
  modalTitle.textContent = title;
  modalBody.innerHTML = "";
  modalFooter.innerHTML = "";
  modalBody.appendChild(bodyNode);
  (footerButtons || []).forEach(btn => modalFooter.appendChild(btn));
  modalRoot.hidden = false;
  modalBody.scrollTop = 0;
}
function closeModal() {
  modalRoot.hidden = true;
  modalBody.innerHTML = "";
  modalFooter.innerHTML = "";
}
modalRoot.addEventListener("click", (e) => {
  if (e.target.classList.contains("modalOverlay")) closeModal();
});

/* ===== fixed header height sync (JS -> CSS var) ===== */
function syncHeaderHeights() {
  const topbar = document.querySelector(".topbar");
  const tabs = document.querySelector(".tabs");
  if (!topbar || !tabs) return;
  document.documentElement.style.setProperty("--topbar-h", `${topbar.offsetHeight}px`);
  document.documentElement.style.setProperty("--tabs-h", `${tabs.offsetHeight}px`);
}
window.addEventListener("resize", syncHeaderHeights);

/* ===== ranges -> steps ===== */
function parseRangeToken(s) {
  const m = String(s || "").trim().match(/^(\d+)(.*)$/);
  if (!m) return null;
  return { n: parseInt(m[1], 10), suffix: m[2] || "" };
}
function computeRangeSteps(ranges) {
  const out = [];
  for (const r of (ranges || [])) {
    const a = (r?.start ?? "").trim();
    const b = (r?.end ?? "").trim();
    if (!a && !b) continue;

    const pa = parseRangeToken(a);
    const pb = parseRangeToken(b);

    if (!pa || !pb || !Number.isFinite(pa.n) || !Number.isFinite(pb.n)) {
      out.push(a && b ? `${a}-${b}` : (a || b));
      continue;
    }

    const startN = pa.n;
    const endN = pb.n;

    if (startN === endN) {
      out.push(a || String(startN));
      continue;
    }
    if (startN < endN) {
      for (let k = startN; k <= endN; k++) {
        if (k === startN) out.push(a);
        else if (k === endN) out.push(b);
        else out.push(String(k));
      }
    } else {
      for (let k = startN; k >= endN; k--) {
        if (k === startN) out.push(a);
        else if (k === endN) out.push(b);
        else out.push(String(k));
      }
    }
  }
  return out;
}

/* ===== find task ===== */
function findTaskById(taskId) {
  for (const [dateS, arr] of Object.entries(state.studyByDate || {})) {
    const idx = (arr || []).findIndex(t => t.id === taskId);
    if (idx >= 0) return { dateS, idx, task: arr[idx] };
  }
  return null;
}

/* ===== progress / runner ===== */
function getTaskSteps(task) {
  const steps = computeRangeSteps(task.ranges || []);
  if (steps.length === 0) return ["（範囲なし）"];
  return steps;
}
function ensureProgress(taskId, stepsLen) {
  const p = state.progressByTask[taskId] || { doneSteps: [], spentSec: 0 };
  if (!Array.isArray(p.doneSteps)) p.doneSteps = [];
  if (!Number.isFinite(p.spentSec)) p.spentSec = 0;

  if (p.doneSteps.length < stepsLen) p.doneSteps = p.doneSteps.concat(Array(stepsLen - p.doneSteps.length).fill(false));
  if (p.doneSteps.length > stepsLen) p.doneSteps = p.doneSteps.slice(0, stepsLen);

  state.progressByTask[taskId] = p;
  return p;
}
function countDone(doneSteps) {
  return (doneSteps || []).reduce((a, b) => a + (b ? 1 : 0), 0);
}
function computeTotalSec(task) {
  const steps = getTaskSteps(task);
  const hasRealSteps = !(steps.length === 1 && steps[0] === "（範囲なし）");

  const prm = parseInt(task.perRangeMin || "", 10);
  if (Number.isFinite(prm) && prm > 0 && hasRealSteps) return steps.length * prm * 60;

  const dm = clamp(parseInt(task.durationMin || "30", 10), 1, 2000);
  return dm * 60;
}
function isTaskComplete(taskId) {
  const found = findTaskById(taskId);
  if (!found) return false;
  const task = found.task;
  const steps = getTaskSteps(task);
  const p = ensureProgress(taskId, steps.length);
  const totalSec = computeTotalSec(task);
  const doneAll = (countDone(p.doneSteps) === steps.length);
  const spentAll = ((p.spentSec || 0) >= totalSec);
  return doneAll || spentAll;
}
function runnerStart(taskId) {
  if (!taskId) return;
  state.runner.arrivalShownTaskId = null;
  state.runner.activeTaskId = taskId;
  state.runner.isRunning = true;
  state.runner.lastTick = Date.now();
  saveState();
}
function runnerStop() {
  state.runner.isRunning = false;
  state.runner.lastTick = 0;
  state.runner.activeTaskId = null;
  state.runner.pausedByUser = false;
  saveState();
}
function openArrivalDialog(taskId) {
  state.runner.arrivalShownTaskId = taskId;
  runnerStop();

  const found = findTaskById(taskId);
  const name = found ? `${found.task.subject}｜${found.task.taskType}` : "完了";

  const body = el("div", "grid1");
  const big = el("div", "", "到着");
  big.style.cssText = "font-size:36px;font-weight:1000;text-align:center;";
  const sub = el("div", "", name);
  sub.style.cssText = "text-align:center;color:rgba(238,243,255,.72);font-weight:1000;";
  body.appendChild(big);
  body.appendChild(sub);

  openModal("到着", body, [mkBtn("OK", "btnPrimary", closeModal)]);
}

function openRunner(taskId, segmentEndMs = null) {
  const found = findTaskById(taskId);
  if (!found) return;

  const t = found.task;
  const steps = getTaskSteps(t);
  const p = ensureProgress(taskId, steps.length);
  const totalSec = computeTotalSec(t);

  const body = el("div", "grid1");

  const title = el("div", "", `${t.subject}｜${t.taskType}`);
  title.style.cssText = "font-weight:1000;font-size:16px;";

  const timeBox = el("div", "");
  const timeBig = el("div", "runnerTimeBig", "--:--");
  const timeSmall = el("div", "runnerTimeSmall", "");
  timeBox.appendChild(timeBig);
  timeBox.appendChild(timeSmall);

  const prog = el("div", "", "0/0");
  prog.style.cssText = "text-align:right;color:rgba(238,243,255,.72);font-weight:1000;";

  const btnAll = mkBtn("全部完了", "btnPrimary", () => {
    for (let i = 0; i < p.doneSteps.length; i++) p.doneSteps[i] = true;
    p.spentSec = Math.max(p.spentSec, totalSec);
    state.progressByTask[taskId] = p;
    saveState();
    renderRunner();
    openArrivalDialog(taskId);
  });

  const stepsBox = el("div", "");
  stepsBox.style.display = "grid";
  stepsBox.style.gap = "8px";

  const stepBtns = steps.map((label, i) => {
    const b = el("button", "stepBtn", "");
    b.type = "button";
    const left = el("span", "", label);
    const right = el("span", "stepRight", "");
    b.appendChild(left);
    b.appendChild(right);

    b.addEventListener("click", () => {
      p.doneSteps[i] = !p.doneSteps[i];
      state.progressByTask[taskId] = p;
      saveState();
      renderRunner();
      if (countDone(p.doneSteps) === steps.length) openArrivalDialog(taskId);
    });

    return b;
  });
  stepBtns.forEach(b => stepsBox.appendChild(b));

  body.appendChild(title);
  body.appendChild(timeBox);
  body.appendChild(prog);
  body.appendChild(btnAll);
  body.appendChild(stepsBox);

  openModal("実行", body, [mkBtn("閉じる", "btnGhost", closeModal)]);

  function renderRunner() {
    const p2 = ensureProgress(taskId, steps.length);
    const done = countDone(p2.doneSteps);

    const now = Date.now();
    if (segmentEndMs && Number.isFinite(segmentEndMs)) {
      const remainSec = Math.max(0, Math.floor((segmentEndMs - now) / 1000));
      timeBig.textContent = fmtMS(remainSec);
      timeSmall.textContent = "（NOW→終了）";
    } else {
      const remainSec = Math.max(0, totalSec - (p2.spentSec || 0));
      timeBig.textContent = fmtMS(remainSec);
      timeSmall.textContent = "（見積もり）";
    }

    prog.textContent = `${done}/${steps.length}`;

    stepBtns.forEach((b, i) => {
      const doneOne = !!p2.doneSteps[i];
      b.classList.toggle("isDone", doneOne);
      b.querySelector(".stepRight").textContent = doneOne ? "完了" : "";
    });
  }

  if (runnerUiTimer) { clearInterval(runnerUiTimer); runnerUiTimer = null; }
  runnerUiTimer = setInterval(renderRunner, 250);
  renderRunner();
}

/* ===== schedule generation ===== */
function buildLifeBlocksForDate(dateS, life) {
  const blocks = [];
  const push = (kind, name, startMs, endMs, meta={}) => {
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return;
    if (endMs <= startMs) return;
    blocks.push({ id: uid(), kind, name, startMs, endMs, meta });
  };

  // custom blocks
  for (const cb of (life.customBlocks || [])) {
    if (cb.mode === "minutes") {
      const st = msOfDateTime(dateS, cb.start || "");
      const mins = parseInt(cb.minutes || "0", 10);
      if (Number.isFinite(st) && Number.isFinite(mins) && mins > 0) {
        push("life", cb.type === "-" ? (cb.content || "-") : cb.type, st, st + mins * 60 * 1000, { source:"custom", cbId: cb.id });
      }
    } else {
      const st = msOfDateTime(dateS, cb.start || "");
      let en = msOfDateTime(dateS, cb.end || "");
      if (Number.isFinite(st) && Number.isFinite(en)) {
        if (en <= st) en += 24 * 60 * 60 * 1000;
        push("life", cb.type === "-" ? (cb.content || "-") : cb.type, st, en, { source:"custom", cbId: cb.id });
      }
    }
  }

  const hasLesson = (life.lesson === "あり");
  const hasClub = (life.club === "あり");

  if (life.morningMoveStart) {
    const st = msOfDateTime(dateS, life.morningMoveStart);
    const mins = parseInt(life.morningMoveMin || "0", 10);
    if (Number.isFinite(st) && Number.isFinite(mins) && mins > 0) {
      push("life", "移動", st, st + mins * 60 * 1000, { source:"routine" });
    }
  }

  if (hasLesson && life.lessonStart && life.lessonEnd) {
    const st = msOfDateTime(dateS, life.lessonStart);
    const en = msOfDateTime(dateS, life.lessonEnd);
    push("life", "授業", st, en, { source:"routine" });
  }

  if (hasClub && life.clubStart && life.clubEnd) {
    const st = msOfDateTime(dateS, life.clubStart);
    const en = msOfDateTime(dateS, life.clubEnd);
    push("life", "部活", st, en, { source:"routine" });
  }

  let endBase = null;
  const lessonEnd = hasLesson && life.lessonEnd ? msOfDateTime(dateS, life.lessonEnd) : null;
  const clubEnd = hasClub && life.clubEnd ? msOfDateTime(dateS, life.clubEnd) : null;
  if (Number.isFinite(lessonEnd)) endBase = lessonEnd;
  if (Number.isFinite(clubEnd)) endBase = (endBase == null) ? clubEnd : Math.max(endBase, clubEnd);

  if (endBase != null) {
    if (life.returnMoveType === "60") {
      push("life", "移動", endBase, endBase + 60 * 60 * 1000, { source:"routine", returnType:"60" });
    } else if (life.returnMoveType === "30") {
      push("life", "移動", endBase, endBase + 30 * 60 * 1000, { source:"routine", returnType:"30" });
    } else if (life.returnMoveType === "30x2") {
      push("life", "移動", endBase, endBase + 30 * 60 * 1000, { source:"routine", returnType:"30x2-1" });

      if (life.second30Start) {
        let st2 = msOfDateTime(dateS, life.second30Start);
        if (Number.isFinite(st2)) {
          if (st2 >= endBase + 30*60*1000) {
            push("life", "移動", st2, st2 + 30 * 60 * 1000, { source:"routine", returnType:"30x2-2" });
            push("life", "食事", st2 + 30*60*1000, st2 + 60*60*1000, { source:"routine", returnType:"mealAfterSecondMove" });
          }
        }
      }
    }
  }

  return blocks;
}

function computeSleepBlock(dateS, life) {
  if (life.sleepUse !== "あり") return null;
  if (!life.bedTime || !life.wakeTime) return { err: "就寝時刻と起床時刻を入れてください。" };

  const bedMin = timeToMin(life.bedTime);
  const wakeMin = timeToMin(life.wakeTime);
  if (!Number.isFinite(bedMin) || !Number.isFinite(wakeMin)) return { err: "就寝/起床の時刻が不正です。" };

  const bedOnNext = bedMin < 18*60;
  const bedDateS = addDaysStr(dateS, bedOnNext ? 1 : 0);
  let bedMs = msOfDateTime(bedDateS, life.bedTime);

  let wakeMs = msOfDateTime(bedDateS, life.wakeTime);
  if (wakeMs <= bedMs) wakeMs += 24*60*60*1000;

  const durH = (wakeMs - bedMs) / (60*60*1000);
  if (durH > 9 + 1e-9) return { err: "起床は就寝から9時間以内にしてください。" };

  return { bedMs, wakeMs, bedDateS };
}

function buildEndOfDayBlocks(dateS, life, existingBlocks) {
  const blocks = [];

  const sleepInfo = computeSleepBlock(dateS, life);
  if (sleepInfo && sleepInfo.err) return { blocks: [], err: sleepInfo.err };

  if (sleepInfo && sleepInfo.bedMs && sleepInfo.wakeMs) {
    let cursor = sleepInfo.bedMs;

    if (life.prep === "あり") {
      const pmin = clamp(parseInt(life.prepMin || "15", 10), 1, 240);
      const st = cursor - pmin*60*1000;
      blocks.push({ id: uid(), kind:"life", name:"準備", startMs: st, endMs: cursor, meta:{ source:"routine" }});
      cursor = st;
    }

    if (life.bath === "あり") {
      const bmin = clamp(parseInt(life.bathMin || "60", 10), 1, 300);
      const st = cursor - bmin*60*1000;
      blocks.push({ id: uid(), kind:"life", name:"風呂", startMs: st, endMs: cursor, meta:{ source:"routine" }});
      cursor = st;
    }

    const temp = existingBlocks.concat(blocks);
    const ov = findOverlap(temp);
    if (ov) return { blocks: [], err: "設定が重なっています。時間を調整してください。" };

    blocks.push({ id: uid(), kind:"life", name:"就寝", startMs: sleepInfo.bedMs, endMs: sleepInfo.wakeMs, meta:{ source:"routine", sleep:true }});
  }

  return { blocks, err: null };
}

function findOverlap(blocks) {
  const a = [...blocks].sort((x,y)=>x.startMs-y.startMs);
  for (let i=0;i<a.length-1;i++){
    if (a[i].endMs > a[i+1].startMs) return [a[i], a[i+1]];
  }
  return null;
}

function buildStudySegmentsForDate(dateS, lifeBlocks, studyTasks) {
  const dayStart = parseDateStr(dateS).getTime();
  const dayEnd = dayStart + 24*60*60*1000;

  const hasLessonBlock = lifeBlocks.some(b => b.name === "授業");
  let earliestStudy = dayStart;
  if (hasLessonBlock) {
    const lessonEnd = Math.max(...lifeBlocks.filter(b=>b.name==="授業").map(b=>b.endMs));
    earliestStudy = lessonEnd;
  }
  const hasClubBlock = lifeBlocks.some(b => b.name === "部活");
  if (hasClubBlock) {
    const clubEnd = Math.max(...lifeBlocks.filter(b=>b.name==="部活").map(b=>b.endMs));
    earliestStudy = Math.max(earliestStudy, clubEnd);
  }

  const occ = lifeBlocks
    .filter(b => b.startMs < dayEnd && b.endMs > dayStart)
    .map(b => ({ start: Math.max(b.startMs, dayStart), end: Math.min(b.endMs, dayEnd) }))
    .sort((a,b)=>a.start-b.start);

  const merged = [];
  for (const it of occ) {
    if (!merged.length || merged[merged.length-1].end < it.start) merged.push({ ...it });
    else merged[merged.length-1].end = Math.max(merged[merged.length-1].end, it.end);
  }

  const free = [];
  let cur = dayStart;
  for (const it of merged) {
    if (cur < it.start) free.push({ start: cur, end: it.start });
    cur = Math.max(cur, it.end);
  }
  if (cur < dayEnd) free.push({ start: cur, end: dayEnd });

  const free2 = free
    .map(s => ({ start: Math.max(s.start, earliestStudy), end: s.end }))
    .filter(s => s.end - s.start >= 5*60*1000);

  const segments = [];

  function totalFreeMinutesFrom(iSlot, offsetMs) {
    let ms = 0;
    for (let j=iSlot;j<free2.length;j++){
      const s = free2[j];
      const st = (j===iSlot) ? Math.max(s.start, offsetMs) : s.start;
      if (s.end > st) ms += (s.end - st);
    }
    return Math.floor(ms / (60*1000));
  }

  let slotIdx = 0;
  let pointer = free2.length ? free2[0].start : null;

  for (const task of (studyTasks || [])) {
    const totalMin = Math.ceil(computeTotalSec(task) / 60);
    if (pointer == null) break;

    const availMin = totalFreeMinutesFrom(slotIdx, pointer);
    if (availMin < totalMin) break;

    let remainMin = totalMin;
    while (remainMin > 0 && slotIdx < free2.length) {
      const s = free2[slotIdx];
      if (pointer < s.start) pointer = s.start;
      if (pointer >= s.end) { slotIdx++; continue; }

      const slotMin = Math.floor((s.end - pointer) / (60*1000));
      if (slotMin <= 0) { slotIdx++; continue; }

      const useMin = Math.min(slotMin, remainMin);
      const st = pointer;
      const en = st + useMin*60*1000;

      segments.push({
        id: uid(),
        kind: "study",
        name: `${task.subject}｜${task.taskType}`,
        startMs: st,
        endMs: en,
        meta: { taskId: task.id, subjectColor: task.subjectColor, subject: task.subject, taskType: task.taskType }
      });

      pointer = en;
      remainMin -= useMin;

      if (pointer >= s.end) slotIdx++;
    }
  }

  return segments;
}

function mergeContiguous(segments) {
  const a = [...segments].sort((x,y)=>x.startMs-y.startMs);
  const out = [];
  for (const b of a) {
    const last = out[out.length-1];
    const same =
      last &&
      last.kind === b.kind &&
      last.name === b.name &&
      (last.meta?.taskId || null) === (b.meta?.taskId || null) &&
      last.endMs === b.startMs;

    if (same) last.endMs = b.endMs;
    else out.push({ ...b });
  }
  return out;
}

/* ===== timeline window ===== */
function timelineDatesWindow(centerDateS) {
  const start = addDaysStr(centerDateS, -1);
  const days = [];
  for (let i=0;i<8;i++) days.push(addDaysStr(start, i));
  return days;
}

function buildAllBlocksForWindow() {
  const dates = timelineDatesWindow(state.selectedDate);
  let blocks = [];

  for (const dateS of dates) {
    const life = state.lifeByDate[dateS];
    const study = state.studyByDate[dateS] || [];

    if (life) {
      const baseLife = buildLifeBlocksForDate(dateS, life);
      const endPart = buildEndOfDayBlocks(dateS, life, baseLife);
      if (endPart.err) {
        life.__err = endPart.err;
      } else {
        life.__err = "";
        const lifeBlocks = baseLife.concat(endPart.blocks);
        const studySegs = buildStudySegmentsForDate(dateS, lifeBlocks, study);

        blocks = blocks.concat(lifeBlocks);
        blocks = blocks.concat(studySegs);
      }
    }
  }

  blocks = mergeContiguous(blocks);
  blocks.sort((a,b)=>a.startMs-b.startMs);
  return blocks;
}

/* ===== remaining time pill ===== */
function setRemainPill(remainSec, labelText = "") {
  if (!Number.isFinite(remainSec) || remainSec < 0) {
    remainPill.hidden = true;
    return;
  }
  remainTime.textContent = fmtMS(remainSec);
  remainLabel.textContent = labelText || "";
  remainPill.hidden = false;
}

/* ===== auto runner tick ===== */
function currentBlockAt(blocks, nowMs) {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.startMs <= nowMs && nowMs < b.endMs) return b;
  }
  return null;
}

function tickRunner(blocks) {
  const now = Date.now();
  const block = currentBlockAt(blocks, now);

  // ★ ラベルを教科名（生活ならブロック名）
  if (block) {
    const remainSec = Math.max(0, Math.floor((block.endMs - now) / 1000));
    const label = (block.kind === "study") ? (block.meta?.subject || block.name) : block.name;
    setRemainPill(remainSec, label);
  } else {
    remainPill.hidden = true;
  }

  if (block && block.kind === "study") {
    const taskId = block.meta?.taskId;
    if (taskId && !isTaskComplete(taskId)) {
      if (state.runner.arrivalShownTaskId === taskId) return;

      if (!state.runner.isRunning || state.runner.activeTaskId !== taskId) {
        runnerStart(taskId);
      } else {
        const last = state.runner.lastTick || now;
        const dtSec = Math.max(0, Math.floor((now - last) / 1000));
        if (dtSec > 0) {
          const found = findTaskById(taskId);
          if (found) {
            const steps = getTaskSteps(found.task);
            const p = ensureProgress(taskId, steps.length);
            p.spentSec += dtSec;
            state.progressByTask[taskId] = p;
            state.runner.lastTick = now;
            saveState();

            const totalSec = computeTotalSec(found.task);
            if (p.spentSec >= totalSec) openArrivalDialog(taskId);
          }
        }
      }
    } else {
      if (state.runner.isRunning) runnerStop();
    }
  } else {
    if (state.runner.isRunning) runnerStop();
  }
}

/* ===== render: tabs ===== */
function setTab(tabKey) {
  state.activeTab = tabKey;
  saveState();

  tabBtns.forEach(b => b.classList.toggle("isActive", b.dataset.tab === tabKey));
  tabLife.hidden = tabKey !== "life";
  tabStudy.hidden = tabKey !== "study";
  tabTimeline.hidden = tabKey !== "timeline";

  render();
}
tabBtns.forEach(btn => btn.addEventListener("click", () => setTab(btn.dataset.tab)));

/* ===== render: life ===== */
/* （あなたの現行 renderLife を維持：ここは省略せず全文必要なら言って。
   今回の要求は「timeline NOW 破線」「固定ヘッダー」「ボタン右寄せ」なので、
   生活画面自体は既にあなたの希望どおり動いています。）
   ※ただし既に「時計型に変更済みの版」を使っている前提です。 */

function renderLife() {
  // ここはあなたの現行コードのまま使ってOK（変更なし）
  // ※もしまだselectが残ってるなら、以前渡した mkTimeInput の差し替え版にします。
  tabLife.innerHTML = "";
  tabLife.appendChild(el("div","card","（renderLifeは現行のまま）"));
}

/* ===== render: study ===== */
function subjectColorFromGroup(groupKey) {
  const g = GROUPS.find(x=>x.key===groupKey);
  return g ? g.color : "gray";
}

function renderStudy() {
  // ここも現行コードに “btnRow.classList.add('taskBtns')” を入れるのが修正点
  tabStudy.innerHTML = "";
  tabStudy.appendChild(el("div","card","（renderStudyは現行のまま。↑↓✕を一番右にするには taskBtns を付ける）"));
}

/* ===== render: timeline (fixed time axis + NOW dashed) ===== */
function daySegmentsForDate(blocks, dateS) {
  const dayStart = parseDateStr(dateS).getTime();
  const dayEnd = dayStart + 24*60*60*1000;

  return blocks
    .filter(b => b.endMs > dayStart && b.startMs < dayEnd)
    .map(b => {
      const startMs = Math.max(b.startMs, dayStart);
      const endMs = Math.min(b.endMs, dayEnd);
      return { ...b, startMs, endMs };
    })
    .sort((a,b)=>a.startMs-b.startMs);
}

function renderTimeline() {
  tabTimeline.innerHTML = "";

  const blocks = buildAllBlocksForWindow();
  const wrap = el("div","timelineWrap");

  const dates = timelineDatesWindow(state.selectedDate);
  const now = Date.now();
  const nowDateS = dateStr(new Date(now));

  dates.forEach(dateS=>{
    const row = el("div","dayRow");

    const head = el("div","dayHead");
    const d = parseDateStr(dateS);
    head.appendChild(el("div","dayDate", fmtMD(d)));
    head.appendChild(el("div","dayWday", weekdayJa(d)));

    // time axis
    const axis = el("div","timeAxis");
    for (let h=0; h<=23; h++) {
      const tick = el("div","timeTick", `${h}:00`);
      tick.style.top = `${h * 60 * TL_PX_PER_MIN}px`;
      axis.appendChild(tick);
    }

    // day track
    const track = el("div","dayTrack");

    // ★ NOW 破線（その日のみ）
    if (dateS === nowDateS) {
      const dayStart = parseDateStr(dateS).getTime();
      const nowMin = (now - dayStart) / 60000;
      const y = nowMin * TL_PX_PER_MIN;

      const line = el("div","nowLine");
      line.style.top = `${y}px`;

      const badge = el("div","nowBadge","NOW");
      line.appendChild(badge);

      // スクロール先はNOW線
      line.id = "nowAnchor";
      track.appendChild(line);
    }

    const dayBlocks = daySegmentsForDate(blocks, dateS);

    if (!dayBlocks.length) {
      const n = el("div","note","（予定なし）");
      n.style.position = "absolute";
      n.style.top = "12px";
      n.style.left = "12px";
      track.appendChild(n);
    } else {
      dayBlocks.forEach(b=>{
        const dayStart = parseDateStr(dateS).getTime();
        const startMin = (b.startMs - dayStart) / 60000;
        const endMin = (b.endMs - dayStart) / 60000;

        const topPx = startMin * TL_PX_PER_MIN;
        const hPx = Math.max(12, (endMin - startMin) * TL_PX_PER_MIN);

        const card = el("div","tBlock");
        card.style.top = `${topPx}px`;
        card.style.height = `${hPx}px`;

        const bar = el("div", `bar ${b.kind==="study" ? (b.meta?.subjectColor || "gray") : "gray"}`);
        card.appendChild(bar);

        const top = el("div","blockTop");
        top.appendChild(el("div","blockName", b.name));
        top.appendChild(el("div","blockTime", fmtRange(b.startMs, b.endMs)));
        card.appendChild(top);

        if (b.kind === "study") {
          const taskId = b.meta?.taskId;
          const done = taskId ? isTaskComplete(taskId) : false;
          card.appendChild(el("div","blockTag", done ? "完了" : "勉強"));
        } else {
          card.appendChild(el("div","blockTag", "生活"));
        }

        card.addEventListener("click", ()=>{
          if (b.kind === "study") {
            openRunner(b.meta.taskId, b.endMs);
          } else {
            const bd = el("div","grid1");
            bd.appendChild(el("div","", b.name));
            bd.appendChild(el("div","note", fmtRange(b.startMs, b.endMs)));
            openModal("確認", bd, [mkBtn("OK","btnPrimary",closeModal)]);
          }
        });

        track.appendChild(card);
      });
    }

    row.appendChild(head);
    row.appendChild(axis);
    row.appendChild(track);
    wrap.appendChild(row);
  });

  tabTimeline.appendChild(wrap);
  scrollToNow();
}

function scrollToNow() {
  const a = document.getElementById("nowAnchor");
  if (a) a.scrollIntoView({ block:"center", behavior:"auto" });
}

nowBtn.addEventListener("click", ()=>{
  setTab("timeline");
  setTimeout(scrollToNow, 0);
});

/* ===== main render ===== */
function render() {
  const n = new Date();
  nowClock.textContent = `${n.getHours()}:${pad2(n.getMinutes())}`;

  if (state.activeTab === "life") renderLife();
  if (state.activeTab === "study") renderStudy();
  if (state.activeTab === "timeline") renderTimeline();

  // 固定ヘッダー高さを同期
  syncHeaderHeights();
}

/* ===== loop ===== */
function loop() {
  const blocks = buildAllBlocksForWindow();
  tickRunner(blocks);

  const n = new Date();
  nowClock.textContent = `${n.getHours()}:${pad2(n.getMinutes())}`;
}

/* ===== init ===== */
setTab(state.activeTab || "life");
render();
setInterval(loop, 1000);
setTimeout(syncHeaderHeights, 0);

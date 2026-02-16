/* 1日の予定プランナー (GitHub Pages / localStorage)
   - 平日テンプレ: 起床/登校/授業(終了時刻はMWFとTuThで切替、全部編集可)
   - 勉強: 今日のタスク(分)を入力 → 放課後〜就寝を自動で組み立て（既存ブロックを避けて空きに詰める）
   - 睡眠は日付またぎ: 当日(就寝〜24:00) + 翌日(0:00〜起床) に分割生成
*/

const PX_PER_MIN = 2;
const SNAP_MIN = 5;
const STORAGE_KEY = "day_planner_v2";

const TYPE_META = {
  sleep: { label: "就寝", tag: "#sleep" },
  eat:   { label: "食事", tag: "#eat" },
  move:  { label: "移動", tag: "#move" },
  class: { label: "授業", tag: "#class" },
  club:  { label: "部活", tag: "#club" },
  prep:  { label: "準備", tag: "#prep" },
  bath:  { label: "風呂", tag: "#bath" },
  study: { label: "勉強", tag: "#study" },
};

// 生活のデフォルト分（設定で編集可）
// 平日テンプレの「移動7:30→授業8:30」に合わせ、moveは60分を初期値に。
const DEFAULT_DUR = {
  sleep: 420, // 7h
  eat:   30,
  move:  60,
  class: 50,
  club:  120,
  prep:  15,
  bath:  60,
  study: 60,
};

// 平日テンプレ（設定で編集可）
const DEFAULT_SCHOOL = {
  wakeTime: "06:50",
  commuteStart: "07:30",
  classStart: "08:30",
  endMWF: "15:00",
  endTuTh: "16:00",
};

// 放課後の自動挿入（設定で編集可）
const DEFAULT_AFTER = {
  enHomeMove: true, minHomeMove: 30,
  enDinner: true,   minDinner: 30,
  enBath: true,     minBath: 60,
  enPrep: true,     minPrep: 15,
};

const $ = (id) => document.getElementById(id);

function uid(prefix="id"){
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}
function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }
function snapMin(min){ return Math.round(min / SNAP_MIN) * SNAP_MIN; }

function minToTime(min){
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
}
function timeToMin(t){
  if(!t) return null;
  const [h,m] = t.split(":").map(Number);
  if(Number.isNaN(h) || Number.isNaN(m)) return null;
  return h*60 + m;
}
function fmtDur(min){
  const h = Math.floor(min/60);
  const m = min%60;
  if(h>0 && m>0) return `${h}h${String(m).padStart(2,"0")}m`;
  if(h>0) return `${h}h00m`;
  return `${m}m`;
}
function todayStr(){
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,"0");
  const dd = String(d.getDate()).padStart(2,"0");
  return `${yyyy}-${mm}-${dd}`;
}
function addDays(dateStr, add){
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + add);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,"0");
  const dd = String(d.getDate()).padStart(2,"0");
  return `${yyyy}-${mm}-${dd}`;
}
function dayOfWeek(dateStr){
  // 0=Sun,1=Mon,...6=Sat
  return new Date(`${dateStr}T00:00:00`).getDay();
}
function escapeHtml(str){
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function loadState(){
  const raw = localStorage.getItem(STORAGE_KEY);
  if(!raw){
    return {
      settings: {
        defaults: structuredClone(DEFAULT_DUR),
        school: structuredClone(DEFAULT_SCHOOL),
        after: structuredClone(DEFAULT_AFTER),
      },
      tasks: [],
      days: {},
      lastDate: todayStr(),
    };
  }
  try{
    const st = JSON.parse(raw);
    // migration
    st.settings ??= {};
    st.settings.defaults ??= structuredClone(DEFAULT_DUR);
    st.settings.school ??= structuredClone(DEFAULT_SCHOOL);
    st.settings.after ??= structuredClone(DEFAULT_AFTER);
    st.tasks ??= [];
    st.days ??= {};
    st.lastDate ??= todayStr();

    // task schema migration: totalUnits/doneUnits -> totalMin/doneMin
    for(const t of st.tasks){
      if(t.totalMin == null){
        if(t.totalUnits != null) t.totalMin = t.totalUnits;
        else t.totalMin = 30;
      }
      if(t.doneMin == null){
        if(t.doneUnits != null) t.doneMin = t.doneUnits;
        else t.doneMin = 0;
      }
      delete t.totalUnits;
      delete t.doneUnits;
      t.dueDate ??= null; // "YYYY-MM-DD" or null
    }

    return st;
  }catch{
    return {
      settings: {
        defaults: structuredClone(DEFAULT_DUR),
        school: structuredClone(DEFAULT_SCHOOL),
        after: structuredClone(DEFAULT_AFTER),
      },
      tasks: [],
      days: {},
      lastDate: todayStr(),
    };
  }
}
function saveState(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

let state = loadState();
let currentDate = state.lastDate || todayStr();

function blocksOf(date){
  state.days[date] ??= [];
  return state.days[date];
}

/* ---------- Timeline axis ---------- */
function buildTimeAxis(){
  const timeCol = $("timeCol");
  const grid = $("grid");
  timeCol.innerHTML = "";
  for(let h=0; h<=24; h++){
    const min = h*60;
    const y = min * PX_PER_MIN;
    const div = document.createElement("div");
    div.className = "timeLabel";
    div.style.top = `${y}px`;
    div.textContent = h===24 ? "24:00" : `${String(h).padStart(2,"0")}:00`;
    timeCol.appendChild(div);
  }
  timeCol.style.height = grid.style.height;
}

/* ---------- Rendering ---------- */
function render(){
  $("datePicker").value = currentDate;
  renderBlocks();
  renderSummary();
  renderTasks();
  refreshTaskLinkOptions();
  state.lastDate = currentDate;
  saveState();
}

function renderBlocks(){
  const layer = $("eventsLayer");
  layer.innerHTML = "";

  const blocks = blocksOf(currentDate).slice().sort((a,b)=>a.startMin-b.startMin);

  for(const blk of blocks){
    const meta = TYPE_META[blk.type] ?? {label: blk.type, tag: "#tag"};
    const el = document.createElement("div");
    el.className = "block" + (blk.done ? " done" : "");
    el.dataset.id = blk.id;

    const top = blk.startMin * PX_PER_MIN;
    const height = Math.max(blk.durationMin * PX_PER_MIN, 18);

    el.style.top = `${top}px`;
    el.style.height = `${height}px`;

    const title = blk.note?.trim()
      ? `${meta.label}：${blk.note.trim()}`
      : meta.label;

    const linked = blk.linkedTaskId
      ? state.tasks.find(t=>t.id===blk.linkedTaskId)
      : null;

    const linkedText = linked ? `リンク：${linked.title}` : null;
    const unitsText = (blk.units && linked) ? `進捗：${blk.units}分` : null;

    el.innerHTML = `
      <div class="blockHead">
        <span class="pill">${fmtDur(blk.durationMin)}</span>
        <span class="pill">${meta.tag}</span>
        ${blk.done ? `<span class="pill">完了</span>` : ``}
      </div>
      <div class="blockTitle">${escapeHtml(title)}</div>
      <div class="blockMeta">
        <span>${minToTime(blk.startMin)}–${minToTime(blk.startMin + blk.durationMin)}</span>
        ${linkedText ? `<span>${escapeHtml(linkedText)}</span>` : ``}
        ${unitsText ? `<span>${escapeHtml(unitsText)}</span>` : ``}
      </div>
      <div class="resizeHandle" title="下端ドラッグで時間変更"></div>
    `;

    el.addEventListener("click", (ev)=>{
      const isHandle = ev.target && ev.target.classList && ev.target.classList.contains("resizeHandle");
      if(isHandle) return;
      openEditDialog(blk.id);
    });

    attachDragResize(el);
    layer.appendChild(el);
  }
}

function renderSummary(){
  const sum = {};
  for(const k of Object.keys(TYPE_META)) sum[k]=0;

  for(const blk of blocksOf(currentDate)){
    if(sum[blk.type] == null) sum[blk.type]=0;
    sum[blk.type] += blk.durationMin;
  }

  const box = $("summary");
  box.innerHTML = "";

  const entries = Object.entries(sum).filter(([,v])=>v>0)
    .sort((a,b)=>b[1]-a[1]);

  if(entries.length===0){
    box.innerHTML = `<div class="hint">まだ何も入ってない</div>`;
    return;
  }

  for(const [type, minutes] of entries){
    const meta = TYPE_META[type] ?? {label:type, tag:"#tag"};
    const div = document.createElement("div");
    div.className = "summaryItem";
    div.innerHTML = `
      <div>
        <div><b>${escapeHtml(meta.label)}</b></div>
        <div class="tag">${escapeHtml(meta.tag)}</div>
      </div>
      <div><b>${fmtDur(minutes)}</b></div>
    `;
    box.appendChild(div);
  }
}

/* ---------- Drag & Resize ---------- */
function attachDragResize(el){
  const id = el.dataset.id;
  const handle = el.querySelector(".resizeHandle");
  let mode = null;
  let startY = 0;
  let baseStart = 0;
  let baseDur = 0;

  const onPointerDown = (ev)=>{
    ev.preventDefault();
    el.setPointerCapture(ev.pointerId);
    startY = ev.clientY;
    const blk = blocksOf(currentDate).find(b=>b.id===id);
    if(!blk) return;
    baseStart = blk.startMin;
    baseDur = blk.durationMin;
    mode = (ev.target === handle) ? "resize" : "drag";
  };

  const onPointerMove = (ev)=>{
    if(!mode) return;
    const dy = ev.clientY - startY;
    const dMin = snapMin(Math.round(dy / PX_PER_MIN));

    const blk = blocksOf(currentDate).find(b=>b.id===id);
    if(!blk) return;

    if(mode==="drag"){
      let newStart = snapMin(baseStart + dMin);
      newStart = clamp(newStart, 0, 24*60 - 5);
      blk.startMin = newStart;
      if(blk.startMin + blk.durationMin > 24*60){
        blk.startMin = 24*60 - blk.durationMin;
      }
    }else if(mode==="resize"){
      let newDur = snapMin(baseDur + dMin);
      newDur = clamp(newDur, 5, 24*60);
      if(baseStart + newDur > 24*60){
        newDur = 24*60 - baseStart;
        newDur = snapMin(newDur);
        newDur = Math.max(newDur, 5);
      }
      blk.durationMin = newDur;
    }
    render();
  };

  const onPointerUp = (ev)=>{
    if(!mode) return;
    mode = null;
    try{ el.releasePointerCapture(ev.pointerId); }catch{}
  };

  el.addEventListener("pointerdown", onPointerDown);
  el.addEventListener("pointermove", onPointerMove);
  el.addEventListener("pointerup", onPointerUp);
  el.addEventListener("pointercancel", onPointerUp);
}

/* ---------- Tasks ---------- */
function arrivalDialog(){
  alert("到着！ 全部完了しました。");
}

function renderTasks(){
  const list = $("tasksList");
  list.innerHTML = "";

  const showAll = $("chkShowAllTasks").checked;

  const tasks = showAll
    ? state.tasks.slice()
    : state.tasks.filter(t=>t.dueDate===currentDate);

  if(tasks.length===0){
    list.innerHTML = `<div class="hint">「この日にやること」を追加してください</div>`;
    return;
  }

  for(const t of tasks){
    const done = clamp(t.doneMin ?? 0, 0, t.totalMin);
    const total = t.totalMin;
    const isToday = (t.dueDate === currentDate);

    const div = document.createElement("div");
    div.className = "task";
    div.innerHTML = `
      <div class="taskTop">
        <div class="taskTitle">${escapeHtml(t.title)}${isToday ? "" : "（別日）"}</div>
        <div class="taskProg">${done}/${total}分</div>
      </div>
      <div class="taskBtns">
        <button class="btn" data-act="minus" data-id="${t.id}">-5</button>
        <button class="btn" data-act="plus"  data-id="${t.id}">+5</button>
        <button class="btn primary" data-act="finish" data-id="${t.id}">全部完了</button>
        <button class="btn danger" data-act="del" data-id="${t.id}">削除</button>
      </div>
    `;

    div.addEventListener("click", (ev)=>{
      const btn = ev.target.closest("button");
      if(!btn) return;
      const id = btn.dataset.id;
      const act = btn.dataset.act;
      const task = state.tasks.find(x=>x.id===id);
      if(!task) return;

      if(act==="minus"){
        task.doneMin = clamp((task.doneMin ?? 0) - 5, 0, task.totalMin);
      }else if(act==="plus"){
        task.doneMin = clamp((task.doneMin ?? 0) + 5, 0, task.totalMin);
        if(task.doneMin === task.totalMin) arrivalDialog();
      }else if(act==="finish"){
        task.doneMin = task.totalMin;
        arrivalDialog();
      }else if(act==="del"){
        for(const day of Object.keys(state.days)){
          for(const blk of state.days[day]){
            if(blk.linkedTaskId === id){
              blk.linkedTaskId = "";
              blk.units = null;
            }
          }
        }
        state.tasks = state.tasks.filter(x=>x.id!==id);
      }
      render();
    });

    list.appendChild(div);
  }
}

function refreshTaskLinkOptions(){
  const sel = $("blkTaskLink");
  if(!sel) return;
  const cur = sel.value;
  sel.innerHTML = `<option value="">（リンクしない）</option>`;
  for(const t of state.tasks){
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.title;
    sel.appendChild(opt);
  }
  sel.value = cur;
}

/* ---------- Add/Edit Block Dialog ---------- */
let editingBlockId = null;

function updateStudyLinkVisibility(){
  const type = $("blkType").value;
  $("studyLinkBox").style.display = (type==="study") ? "block" : "none";
}

function openNewDialog(){
  editingBlockId = null;
  $("dlgTitle").textContent = "ブロック追加";
  $("btnDelete").style.display = "none";
  $("blkType").value = "study";
  $("blkStart").value = "";
  $("blkDur").value = "";
  $("blkNote").value = "";
  $("blkTaskLink").value = "";
  $("blkUnits").value = "";
  $("blkDone").checked = false;
  updateStudyLinkVisibility();
  $("blockDialog").showModal();
}

function openEditDialog(id){
  const blk = blocksOf(currentDate).find(b=>b.id===id);
  if(!blk) return;
  editingBlockId = id;
  $("dlgTitle").textContent = "ブロック編集";
  $("btnDelete").style.display = "inline-flex";
  $("blkType").value = blk.type;
  $("blkStart").value = minToTime(blk.startMin);
  $("blkDur").value = blk.durationMin;
  $("blkNote").value = blk.note ?? "";
  $("blkTaskLink").value = blk.linkedTaskId ?? "";
  $("blkUnits").value = blk.units ?? "";
  $("blkDone").checked = !!blk.done;
  updateStudyLinkVisibility();
  $("blockDialog").showModal();
}

function autoPlaceStart(durationMin){
  const blocks = blocksOf(currentDate).slice().sort((a,b)=>a.startMin-b.startMin);
  let s = 0;
  for(const b of blocks){
    if(s + durationMin <= b.startMin) return s;
    s = Math.max(s, b.startMin + b.durationMin);
    s = snapMin(s);
    if(s >= 24*60) break;
  }
  if(s + durationMin <= 24*60) return s;
  return clamp(24*60 - durationMin, 0, 24*60 - 5);
}

function applyStudyProgress(blk){
  if(blk.type !== "study") return;
  if(!blk.linkedTaskId) return;
  const task = state.tasks.find(t=>t.id===blk.linkedTaskId);
  if(!task) return;

  const add = blk.units ?? blk.durationMin ?? 5;
  const before = task.doneMin ?? 0;
  task.doneMin = clamp(before + add, 0, task.totalMin);
  if(task.doneMin === task.totalMin){
    arrivalDialog();
  }
}

/* ---------- Auto build (school template + after-school study) ---------- */
const AK = {
  tplSleepAM: "tpl_sleep_am",
  tplCommute: "tpl_commute_am",
  tplClass: "tpl_class_day",
  autoHomeMove: "auto_home_move",
  autoDinner: "auto_dinner",
  autoBath: "auto_bath",
  autoPrep: "auto_prep",
  autoSleepPM: "auto_sleep_pm",
  autoStudyPrefix: "auto_study_",
};

function removeByAutoKey(date, keyOrPrefix){
  const arr = blocksOf(date);
  state.days[date] = arr.filter(b=>{
    if(!b.autoKey) return true;
    if(keyOrPrefix.endsWith("*")){
      const pref = keyOrPrefix.slice(0,-1);
      return !b.autoKey.startsWith(pref);
    }
    return b.autoKey !== keyOrPrefix;
  });
}

function findBlockByAutoKey(date, autoKey){
  return blocksOf(date).find(b=>b.autoKey===autoKey) ?? null;
}
function hasTypeBlockInRange(date, type, startMin, endMin){
  return blocksOf(date).some(b=>{
    if(b.type !== type) return false;
    const s=b.startMin, e=b.startMin+b.durationMin;
    return !(e<=startMin || endMin<=s);
  });
}

function ensureSchoolTemplate(date, overwrite=false){
  const dow = dayOfWeek(date);
  const isWeekday = dow>=1 && dow<=5;
  const sch = state.settings.school;
  const wakeMin = timeToMin(sch.wakeTime) ?? timeToMin(DEFAULT_SCHOOL.wakeTime);
  if(wakeMin != null){
    const existing = findBlockByAutoKey(date, AK.tplSleepAM);
    if(!existing || overwrite){
      if(existing){
        existing.type="sleep";
        existing.startMin=0;
        existing.durationMin=clamp(snapMin(wakeMin), 5, 24*60);
        existing.note="睡眠（起床まで）";
      }else{
        blocksOf(date).push({
          id: uid("blk"),
          type: "sleep",
          startMin: 0,
          durationMin: clamp(snapMin(wakeMin), 5, 24*60),
          note: "睡眠（起床まで）",
          done: false,
          autoKey: AK.tplSleepAM,
        });
      }
    }
  }

  if(!isWeekday) return;

  const commuteStartMin = timeToMin(sch.commuteStart) ?? timeToMin(DEFAULT_SCHOOL.commuteStart);
  const classStartMin = timeToMin(sch.classStart) ?? timeToMin(DEFAULT_SCHOOL.classStart);

  // 登校（移動）: commuteStart -> classStart
  if(commuteStartMin != null && classStartMin != null){
    const dur = classStartMin - commuteStartMin;
    const commuteDur = dur>0 ? snapMin(dur) : snapMin(state.settings.defaults.move ?? 60);

    const existing = findBlockByAutoKey(date, AK.tplCommute);
    if(!existing || overwrite){
      if(existing){
        existing.type="move";
        existing.startMin=snapMin(commuteStartMin);
        existing.durationMin=clamp(commuteDur,5,24*60);
        existing.note="登校";
      }else{
        blocksOf(date).push({
          id: uid("blk"),
          type:"move",
          startMin:snapMin(commuteStartMin),
          durationMin:clamp(commuteDur,5,24*60),
          note:"登校",
          done:false,
          autoKey: AK.tplCommute,
        });
      }
    }
  }

  // 授業: classStart -> end (MWF or TuTh)
  const endStr = (dow===2 || dow===4) ? sch.endTuTh : sch.endMWF;
  const endMin = timeToMin(endStr) ?? (dow===2||dow===4 ? timeToMin(DEFAULT_SCHOOL.endTuTh) : timeToMin(DEFAULT_SCHOOL.endMWF));
  if(classStartMin != null && endMin != null){
    const dur = endMin - classStartMin;
    const classDur = dur>0 ? snapMin(dur) : snapMin(state.settings.defaults.class ?? 50);

    const existing = findBlockByAutoKey(date, AK.tplClass);
    if(!existing || overwrite){
      if(existing){
        existing.type="class";
        existing.startMin=snapMin(classStartMin);
        existing.durationMin=clamp(classDur, 5, 24*60);
        existing.note="授業";
      }else{
        blocksOf(date).push({
          id: uid("blk"),
          type:"class",
          startMin:snapMin(classStartMin),
          durationMin:clamp(classDur,5,24*60),
          note:"授業",
          done:false,
          autoKey: AK.tplClass,
        });
      }
    }
  }
}

function getClassEndMin(date){
  // 1) その日の授業ブロックがあればそれを優先
  const cls = blocksOf(date)
    .filter(b=>b.type==="class")
    .sort((a,b)=>a.startMin-b.startMin)[0];
  if(cls) return cls.startMin + cls.durationMin;

  // 2) なければ設定値
  const dow = dayOfWeek(date);
  const sch = state.settings.school;
  const endStr = (dow===2||dow===4) ? sch.endTuTh : sch.endMWF;
  const endMin = timeToMin(endStr);
  if(endMin != null) return endMin;

  // 3) fallback
  return (dow===2||dow===4) ? 16*60 : 15*60;
}

function computeBedtimeMin(){
  // 起床時刻 - 睡眠時間(分) で就寝時刻を決める（0-1439）
  const wakeMin = timeToMin(state.settings.school.wakeTime) ?? timeToMin(DEFAULT_SCHOOL.wakeTime);
  const sleepMin = state.settings.defaults.sleep ?? DEFAULT_DUR.sleep;
  let bed = (wakeMin ?? 410) - sleepMin; // 410 = 06:50
  bed %= (24*60);
  if(bed<0) bed += 24*60;
  return snapMin(bed);
}

function getOccupiedIntervals(date, excludeAutoKeysPrefixes=[]){
  const ex = excludeAutoKeysPrefixes;
  const intervals = [];
  for(const b of blocksOf(date)){
    if(b.autoKey){
      const skip = ex.some(pref => b.autoKey.startsWith(pref));
      if(skip) continue;
    }
    intervals.push([b.startMin, b.startMin + b.durationMin]);
  }
  intervals.sort((a,b)=>a[0]-b[0]);
  return intervals;
}

function mergeIntervals(intervals){
  if(intervals.length===0) return [];
  const out = [intervals[0].slice()];
  for(let i=1;i<intervals.length;i++){
    const [s,e] = intervals[i];
    const last = out[out.length-1];
    if(s <= last[1]){
      last[1] = Math.max(last[1], e);
    }else{
      out.push([s,e]);
    }
  }
  return out;
}

function nextFreeRun(pointer, endLimit, mergedOcc){
  let t = pointer;

  for(const [s,e] of mergedOcc){
    if(t < s){
      const run = Math.max(0, Math.min(endLimit, s) - t);
      if(run>0) return {start:t, run};
      t = e;
      continue;
    }
    if(s <= t && t < e){
      t = e;
      continue;
    }
  }

  const run = Math.max(0, endLimit - t);
  if(run>0) return {start:t, run};
  return null;
}

function placeAutoBlock(date, spec, pointer, endLimit, mergedOcc){
  // spec: {type, note, durationMin, autoKey}
  const r = nextFreeRun(pointer, endLimit, mergedOcc);
  if(!r) return {placed:false, pointer};
  if(r.run < spec.durationMin) return {placed:false, pointer}; // 連続空きが足りない

  const blk = {
    id: uid("blk"),
    type: spec.type,
    startMin: snapMin(r.start),
    durationMin: snapMin(spec.durationMin),
    note: spec.note,
    done: false,
    autoKey: spec.autoKey,
  };
  blocksOf(date).push(blk);

  // occupied更新
  mergedOcc.push([blk.startMin, blk.startMin+blk.durationMin]);
  mergedOcc.sort((a,b)=>a[0]-b[0]);
  const m = mergeIntervals(mergedOcc);
  mergedOcc.length = 0;
  for(const it of m) mergedOcc.push(it);

  return {placed:true, pointer: blk.startMin + blk.durationMin};
}

function autoBuildForDate(date, overwrite=false){
  // 1) 平日テンプレ確保
  ensureSchoolTemplate(date, overwrite);

  // 2) 授業終了〜就寝の範囲で自動組立
  const classEnd = snapMin(getClassEndMin(date));
  const bedMin = computeBedtimeMin();
  const endLimit = (bedMin >= classEnd) ? bedMin : bedMin + 24*60; // 通常はbedMin > classEnd

  // 自動生成する対象を削除（上書きのときは放課後生活も消す）
  removeByAutoKey(date, AK.autoStudyPrefix + "*");
  removeByAutoKey(date, AK.autoSleepPM);
  if(overwrite){
    removeByAutoKey(date, AK.autoHomeMove);
    removeByAutoKey(date, AK.autoDinner);
    removeByAutoKey(date, AK.autoBath);
    removeByAutoKey(date, AK.autoPrep);
  }

  // occupied（自動study/sleepは除外済み。上書きで放課後生活を消したならそれも除外）
  const exclude = [AK.autoStudyPrefix];
  const occ = mergeIntervals(getOccupiedIntervals(date, exclude));

  // 3) 放課後の自動挿入（既に同種ブロックがあるなら重複しない）
  const after = state.settings.after;

  let pointer = classEnd;

  const fixedSpecs = [
    { key: AK.autoHomeMove, enabled: after.enHomeMove, type:"move", note:"帰宅", dur: after.minHomeMove },
    { key: AK.autoDinner,   enabled: after.enDinner,   type:"eat",  note:"夕食", dur: after.minDinner },
    { key: AK.autoBath,     enabled: after.enBath,     type:"bath", note:"風呂", dur: after.minBath },
    { key: AK.autoPrep,     enabled: after.enPrep,     type:"prep", note:"準備", dur: after.minPrep },
  ];

  for(const f of fixedSpecs){
    if(!f.enabled) continue;
    const already = hasTypeBlockInRange(date, f.type, classEnd, Math.min(bedMin, 24*60));
    if(already && !overwrite) continue;

    const res = placeAutoBlock(
      date,
      { type: f.type, note: f.note, durationMin: snapMin(f.dur), autoKey: f.key },
      pointer,
      Math.min(bedMin, 24*60),
      occ
    );
    if(res.placed) pointer = res.pointer;
  }

  // 4) 今日のタスクを順に詰める（空きに入るだけ。分割あり）
  const todayTasks = state.tasks.filter(t=>t.dueDate===date && (t.doneMin ?? 0) < t.totalMin);

  let shortage = 0;

  for(const task of todayTasks){
    let remain = task.totalMin - (task.doneMin ?? 0);
    remain = snapMin(remain);

    let part = 1;
    while(remain > 0){
      const r = nextFreeRun(pointer, Math.min(bedMin, 24*60), occ);
      if(!r){
        shortage += remain;
        remain = 0;
        break;
      }
      const chunk = snapMin(Math.min(remain, r.run, 120)); // 最大2hで分割
      if(chunk < 5){
        shortage += remain;
        remain = 0;
        break;
      }

      const blk = {
        id: uid("blk"),
        type: "study",
        startMin: snapMin(r.start),
        durationMin: chunk,
        note: task.title,
        linkedTaskId: task.id,
        units: chunk,         // 完了時に進捗+chunk分
        done: false,
        autoKey: `${AK.autoStudyPrefix}${task.id}_${part}`,
      };
      blocksOf(date).push(blk);

      // occupied更新
      occ.push([blk.startMin, blk.startMin + blk.durationMin]);
      occ.sort((a,b)=>a[0]-b[0]);
      const m = mergeIntervals(occ);
      occ.length = 0;
      for(const it of m) occ.push(it);

      pointer = blk.startMin + blk.durationMin;
      remain -= chunk;
      part++;
    }
  }

  // 5) 就寝（当日：就寝〜24:00）を生成（既にsleepがあれば重複しない）
  const dayEnd = 24*60;
  if(bedMin < dayEnd){
    const hasSleep = hasTypeBlockInRange(date, "sleep", bedMin, dayEnd);
    if(!hasSleep || overwrite){
      // overwriteなら既存sleepを消すのは危険なので、autoKeyのsleepPMだけ扱う
      const existing = findBlockByAutoKey(date, AK.autoSleepPM);
      const dur = snapMin(dayEnd - bedMin);
      if(existing){
        existing.type="sleep";
        existing.startMin=bedMin;
        existing.durationMin=dur;
        existing.note="睡眠（就寝）";
      }else{
        blocksOf(date).push({
          id: uid("blk"),
          type:"sleep",
          startMin: bedMin,
          durationMin: dur,
          note:"睡眠（就寝）",
          done:false,
          autoKey: AK.autoSleepPM,
        });
      }
    }
  }

  // 6) 翌日：0:00〜起床（睡眠）を生成（寝てから起きるまで）
  const next = addDays(date, 1);
  if(overwrite){
    // 翌朝の睡眠だけは上書き対象にする（ずれた場合に直せる）
    removeByAutoKey(next, AK.tplSleepAM);
  }
  ensureSchoolTemplate(next, false);

  render();

  if(shortage > 0){
    alert(`勉強が ${shortage}分 ぶん、就寝までに入りきりませんでした。`);
  }
}

/* ---------- Settings dialog ---------- */
function openSettings(){
  // time fields
  const sch = state.settings.school;
  $("setWake").value = sch.wakeTime ?? DEFAULT_SCHOOL.wakeTime;
  $("setCommuteStart").value = sch.commuteStart ?? DEFAULT_SCHOOL.commuteStart;
  $("setClassStart").value = sch.classStart ?? DEFAULT_SCHOOL.classStart;
  $("setEndMWF").value = sch.endMWF ?? DEFAULT_SCHOOL.endMWF;
  $("setEndTuTh").value = sch.endTuTh ?? DEFAULT_SCHOOL.endTuTh;

  // after-school auto fields
  const af = state.settings.after;
  $("enHomeMove").checked = !!af.enHomeMove;
  $("minHomeMove").value = af.minHomeMove ?? DEFAULT_AFTER.minHomeMove;

  $("enDinner").checked = !!af.enDinner;
  $("minDinner").value = af.minDinner ?? DEFAULT_AFTER.minDinner;

  $("enBath").checked = !!af.enBath;
  $("minBath").value = af.minBath ?? DEFAULT_AFTER.minBath;

  $("enPrep").checked = !!af.enPrep;
  $("minPrep").value = af.minPrep ?? DEFAULT_AFTER.minPrep;

  // duration defaults grid
  const box = $("settingsGrid");
  box.innerHTML = "";
  const defaults = state.settings.defaults;

  for(const key of Object.keys(TYPE_META)){
    const meta = TYPE_META[key];

    const label = document.createElement("div");
    label.className = "settingsLabel";
    label.textContent = `${meta.label}（${meta.tag}）`;

    const input = document.createElement("input");
    input.className = "input";
    input.type = "number";
    input.min = "5";
    input.step = "5";
    input.value = defaults[key] ?? DEFAULT_DUR[key] ?? 30;
    input.dataset.key = key;

    box.appendChild(label);
    box.appendChild(input);
  }

  $("settingsDialog").showModal();
}

function saveSettingsFromDialog(){
  // school
  state.settings.school.wakeTime = $("setWake").value || DEFAULT_SCHOOL.wakeTime;
  state.settings.school.commuteStart = $("setCommuteStart").value || DEFAULT_SCHOOL.commuteStart;
  state.settings.school.classStart = $("setClassStart").value || DEFAULT_SCHOOL.classStart;
  state.settings.school.endMWF = $("setEndMWF").value || DEFAULT_SCHOOL.endMWF;
  state.settings.school.endTuTh = $("setEndTuTh").value || DEFAULT_SCHOOL.endTuTh;

  // after
  state.settings.after.enHomeMove = $("enHomeMove").checked;
  state.settings.after.minHomeMove = snapMin(parseInt($("minHomeMove").value,10) || DEFAULT_AFTER.minHomeMove);

  state.settings.after.enDinner = $("enDinner").checked;
  state.settings.after.minDinner = snapMin(parseInt($("minDinner").value,10) || DEFAULT_AFTER.minDinner);

  state.settings.after.enBath = $("enBath").checked;
  state.settings.after.minBath = snapMin(parseInt($("minBath").value,10) || DEFAULT_AFTER.minBath);

  state.settings.after.enPrep = $("enPrep").checked;
  state.settings.after.minPrep = snapMin(parseInt($("minPrep").value,10) || DEFAULT_AFTER.minPrep);

  // defaults durations
  const inputs = $("settingsGrid").querySelectorAll("input[data-key]");
  for(const inp of inputs){
    const key = inp.dataset.key;
    const v = snapMin(parseInt(inp.value,10));
    if(Number.isFinite(v) && v>=5){
      state.settings.defaults[key] = v;
    }
  }

  render();
}

/* ---------- Init & Events ---------- */
function init(){
  buildTimeAxis();

  $("datePicker").value = currentDate;

  $("btnToday").addEventListener("click", ()=>{
    currentDate = todayStr();
    render();
  });

  $("datePicker").addEventListener("change", (ev)=>{
    currentDate = ev.target.value || todayStr();
    render();
  });

  $("btnAdd").addEventListener("click", openNewDialog);

  $("btnSettings").addEventListener("click", openSettings);
  $("btnSettingsClose").addEventListener("click", ()=>{
    saveSettingsFromDialog();
    $("settingsDialog").close();
  });

  $("btnReset").addEventListener("click", ()=>{
    state.settings.defaults = structuredClone(DEFAULT_DUR);
    state.settings.school = structuredClone(DEFAULT_SCHOOL);
    state.settings.after = structuredClone(DEFAULT_AFTER);
    render();
    $("settingsDialog").close();
  });

  $("blkType").addEventListener("change", updateStudyLinkVisibility);

  $("btnAutoPlace").addEventListener("click", ()=>{
    const type = $("blkType").value;
    const dur = parseInt($("blkDur").value,10);
    const durationMin = Number.isFinite(dur) ? snapMin(dur) : (state.settings.defaults[type] ?? 30);
    const s = autoPlaceStart(durationMin);
    $("blkStart").value = minToTime(s);
    if(!Number.isFinite(dur)) $("blkDur").value = durationMin;
  });

  $("btnCancel").addEventListener("click", ()=>{
    $("blockDialog").close();
  });

  $("btnDelete").addEventListener("click", ()=>{
    if(!editingBlockId) return;
    state.days[currentDate] = blocksOf(currentDate).filter(b=>b.id!==editingBlockId);
    editingBlockId = null;
    $("blockDialog").close();
    render();
  });

  $("blockForm").addEventListener("submit", (ev)=>{
    ev.preventDefault();

    const type = $("blkType").value;
    const startMinFromTime = timeToMin($("blkStart").value);
    const durRaw = parseInt($("blkDur").value,10);
    const durationMin = Number.isFinite(durRaw) ? snapMin(durRaw) : (state.settings.defaults[type] ?? 30);

    let startMin = (startMinFromTime==null) ? autoPlaceStart(durationMin) : snapMin(startMinFromTime);
    startMin = clamp(startMin, 0, 24*60 - 5);
    if(startMin + durationMin > 24*60){
      startMin = 24*60 - durationMin;
      startMin = snapMin(clamp(startMin,0,24*60-5));
    }

    const note = $("blkNote").value ?? "";

    const linkedTaskId = (type==="study") ? ($("blkTaskLink").value ?? "") : "";
    const unitsRaw = parseInt($("blkUnits").value,10);
    const units = (type==="study" && linkedTaskId && Number.isFinite(unitsRaw) && unitsRaw>0) ? snapMin(unitsRaw) : null;

    const done = $("blkDone").checked;

    if(editingBlockId){
      const blk = blocksOf(currentDate).find(b=>b.id===editingBlockId);
      if(!blk) return;
      const prevDone = !!blk.done;

      blk.type = type;
      blk.startMin = startMin;
      blk.durationMin = durationMin;
      blk.note = note;
      blk.linkedTaskId = linkedTaskId;
      blk.units = units;
      blk.done = done;

      // 手動編集したブロックはautoKeyを外す（自動生成に上書きされないように）
      // ただしテンプレや自動で作ったものを「編集できる」も満たすため、編集＝自分の意思で固定化とする
      // もし保持したいなら、この行をコメントアウトしてOK。
      blk.autoKey = null;

      if(!prevDone && done){
        applyStudyProgress(blk);
      }
    }else{
      const blk = {
        id: uid("blk"),
        type,
        startMin,
        durationMin,
        note,
        linkedTaskId,
        units,
        done,
        autoKey: null,
      };
      blocksOf(currentDate).push(blk);
      if(done){
        applyStudyProgress(blk);
      }
    }

    $("blockDialog").close();
    render();
  });

  $("taskForm").addEventListener("submit", (ev)=>{
    ev.preventDefault();
    const title = $("taskTitle").value.trim();
    const minutes = snapMin(parseInt($("taskMin").value,10));
    if(!title || !Number.isFinite(minutes) || minutes<=0) return;

    state.tasks.unshift({
      id: uid("task"),
      title,
      totalMin: minutes,
      doneMin: 0,
      dueDate: currentDate,
    });

    $("taskTitle").value = "";
    $("taskMin").value = "";
    render();
  });

  $("chkShowAllTasks").addEventListener("change", render);

  $("btnAutoBuild").addEventListener("click", ()=>{
    const overwrite = $("chkOverwrite").checked;
    autoBuildForDate(currentDate, overwrite);
  });

  // 初回は朝付近へスクロール
  setTimeout(()=>{
    const wrap = $("timelineWrap");
    wrap.scrollTop = 7*60*PX_PER_MIN - 120;
  }, 0);

  render();
}

init();

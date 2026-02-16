/* v3
  - 48時間連結表示（選択日 + 次の日）
  - #削除（タグに#を使わない）
  - ：削除（表示文字列からコロンを使わない）
  - 終了時刻を選べる（授業終了・就寝の当日オーバーライド）
  - 設定保存（localStorage）
  - 範囲入力（done/total）に寄せる
  - 勉強ブロックは範囲にリンク可、完了で進捗加算
*/

const PX_PER_MIN = 2;
const SNAP_MIN = 5;
const STORAGE_KEY = "day_planner_v3";

const TYPE_META = {
  sleep: { label: "就寝", tag: "sleep" },
  eat:   { label: "食事", tag: "eat" },
  move:  { label: "移動", tag: "move" },
  class: { label: "授業", tag: "class" },
  club:  { label: "部活", tag: "club" },
  prep:  { label: "準備", tag: "prep" },
  bath:  { label: "風呂", tag: "bath" },
  study: { label: "勉強", tag: "study" },
};

const DEFAULT_DUR = {
  sleep: 420,
  eat:   30,
  move:  60,
  class: 50,
  club:  120,
  prep:  15,
  bath:  60,
  study: 60,
};

const DEFAULT_SCHOOL = {
  wakeTime: "06:50",
  commuteStart: "07:30",
  classStart: "08:30",
  endMWF: "15:00",
  endTuTh: "16:00",
};

const DEFAULT_AFTER = {
  enHomeMove: true, minHomeMove: 30,
  enDinner: true,   minDinner: 30,
  enBath: true,     minBath: 60,
  enPrep: true,     minPrep: 15,
};

const AK = {
  tplSleepAM: "tpl_sleep_am",
  tplCommute: "tpl_commute_am",
  tplClass:   "tpl_class",
  autoHomeMove: "auto_home_move",
  autoDinner:   "auto_dinner",
  autoBath:     "auto_bath",
  autoPrep:     "auto_prep",
  autoSleepPM:  "auto_sleep_pm",
  autoStudyPrefix: "auto_study_",
};

const $ = (id)=>document.getElementById(id);

function uid(prefix="id"){
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}
function clamp(n,a,b){ return Math.max(a, Math.min(b,n)); }
function snapMin(min){ return Math.round(min / SNAP_MIN) * SNAP_MIN; }

function timeToMin(t){
  if(!t) return null;
  const [h,m] = t.split(":").map(Number);
  if(Number.isNaN(h) || Number.isNaN(m)) return null;
  return h*60 + m;
}
function minToTime(min){
  const h = Math.floor(min/60);
  const m = min%60;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
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
  d.setDate(d.getDate()+add);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,"0");
  const dd = String(d.getDate()).padStart(2,"0");
  return `${yyyy}-${mm}-${dd}`;
}
function dayOfWeek(dateStr){
  return new Date(`${dateStr}T00:00:00`).getDay(); // 0 Sun .. 6 Sat
}
function fmtDayLabel(dateStr){
  const d = new Date(`${dateStr}T00:00:00`);
  const w = ["日","月","火","水","木","金","土"][d.getDay()];
  const mm = String(d.getMonth()+1).padStart(2,"0");
  const dd = String(d.getDate()).padStart(2,"0");
  return `${mm}/${dd} ${w}`;
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
      ranges: [],      // {id,title,totalMin,doneMin,dueDate}
      days: {},        // {"YYYY-MM-DD":[blocks]}
      overrides: {},   // {"YYYY-MM-DD":{classEnd:"HH:MM"|null, bed:"HH:MM"|null}}
      lastDate: todayStr(),
    };
  }
  try{
    const st = JSON.parse(raw);
    st.settings ??= {};
    st.settings.defaults ??= structuredClone(DEFAULT_DUR);
    st.settings.school ??= structuredClone(DEFAULT_SCHOOL);
    st.settings.after ??= structuredClone(DEFAULT_AFTER);

    st.ranges ??= [];
    st.days ??= {};
    st.overrides ??= {};
    st.lastDate ??= todayStr();
    return st;
  }catch{
    return {
      settings: {
        defaults: structuredClone(DEFAULT_DUR),
        school: structuredClone(DEFAULT_SCHOOL),
        after: structuredClone(DEFAULT_AFTER),
      },
      ranges: [],
      days: {},
      overrides: {},
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
function overridesOf(date){
  state.overrides[date] ??= { classEnd: null, bed: null };
  return state.overrides[date];
}

/* ---------- 48h axis ---------- */
function buildTimeAxis(){
  const timeCol = $("timeCol");
  const grid = $("grid");
  timeCol.innerHTML = "";

  const base = currentDate;
  const next = addDays(currentDate, 1);

  // day marks
  const m0 = document.createElement("div");
  m0.className = "dayMark";
  m0.style.top = `${8}px`;
  m0.textContent = fmtDayLabel(base);
  timeCol.appendChild(m0);

  const m1 = document.createElement("div");
  m1.className = "dayMark";
  m1.style.top = `${(24*60*PX_PER_MIN) + 8}px`;
  m1.textContent = fmtDayLabel(next);
  timeCol.appendChild(m1);

  for(let h=0; h<=48; h++){
    const y = h*60*PX_PER_MIN;
    const div = document.createElement("div");
    div.className = "timeLabel";
    div.style.top = `${y}px`;
    const hh = h%24;
    div.textContent = `${String(hh).padStart(2,"0")}:00`;
    timeCol.appendChild(div);
  }
  timeCol.style.height = grid.style.height;

  // day separator line at 24:00
  const sep = document.createElement("div");
  sep.className = "daySeparator";
  sep.style.top = `${24*60*PX_PER_MIN}px`;
  $("grid").appendChild(sep);
}

/* ---------- render ---------- */
function render(){
  const next = addDays(currentDate,1);
  $("rangeTitle").textContent = `${fmtDayLabel(currentDate)} 〜 ${fmtDayLabel(next)}`;

  $("datePicker").value = currentDate;

  // override inputs
  const ov = overridesOf(currentDate);
  $("overrideClassEnd").value = ov.classEnd || "";
  $("overrideBed").value = ov.bed || "";

  // rebuild axis (date changes)
  $("grid").innerHTML = "";
  buildTimeAxis();

  renderBlocks48();
  renderSummary();
  renderRanges();

  refreshRangeLinkOptions();

  state.lastDate = currentDate;
  saveState();
}

function renderBlocks48(){
  const layer = $("eventsLayer");
  layer.innerHTML = "";

  const d0 = currentDate;
  const d1 = addDays(currentDate,1);

  const all = [
    ...blocksOf(d0).map(b=>({b, offset:0, date:d0})),
    ...blocksOf(d1).map(b=>({b, offset:1440, date:d1})),
  ].sort((x,y)=> (x.b.startMin+x.offset) - (y.b.startMin+y.offset));

  for(const it of all){
    const blk = it.b;
    const meta = TYPE_META[blk.type] ?? {label: blk.type, tag: "tag"};

    const el = document.createElement("div");
    el.className = "block" + (blk.done ? " done" : "");
    el.dataset.id = blk.id;
    el.dataset.date = it.date;

    const topMin = blk.startMin + it.offset;
    const top = topMin * PX_PER_MIN;
    const height = Math.max(blk.durationMin * PX_PER_MIN, 18);

    el.style.top = `${top}px`;
    el.style.height = `${height}px`;

    // ：を使わない
    const title = (blk.note && blk.note.trim())
      ? `${meta.label} ${blk.note.trim()}`
      : meta.label;

    const linked = blk.linkedRangeId
      ? state.ranges.find(r=>r.id===blk.linkedRangeId)
      : null;

    const linkedText = linked ? `リンク ${linked.title}` : null;
    const unitsText = (blk.units && linked) ? `進捗 ${blk.units}分` : null;

    el.innerHTML = `
      <div class="blockHead">
        <span class="pill">${fmtDur(blk.durationMin)}</span>
        <span class="pill">${escapeHtml(meta.tag)}</span>
        ${blk.done ? `<span class="pill">完了</span>` : ``}
      </div>
      <div class="blockTitle">${escapeHtml(title)}</div>
      <div class="blockMeta">
        <span>${minToTime(blk.startMin)}-${minToTime(blk.startMin + blk.durationMin)}</span>
        ${linkedText ? `<span>${escapeHtml(linkedText)}</span>` : ``}
        ${unitsText ? `<span>${escapeHtml(unitsText)}</span>` : ``}
      </div>
      <div class="resizeHandle"></div>
    `;

    el.addEventListener("click",(ev)=>{
      if(ev.target?.classList?.contains("resizeHandle")) return;
      openEditDialog(it.date, blk.id);
    });

    attachDragResize(el);
    layer.appendChild(el);
  }
}

function renderSummary(){
  // 集計は「選択日」だけ
  const sum = {};
  for(const k of Object.keys(TYPE_META)) sum[k]=0;

  for(const blk of blocksOf(currentDate)){
    sum[blk.type] = (sum[blk.type] ?? 0) + blk.durationMin;
  }

  const box = $("summary");
  box.innerHTML = "";

  const entries = Object.entries(sum).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]);
  if(entries.length===0){
    box.innerHTML = `<div class="subhint">未入力</div>`;
    return;
  }

  for(const [type, minutes] of entries){
    const meta = TYPE_META[type] ?? {label:type, tag:"tag"};
    const div = document.createElement("div");
    div.className = "summaryItem";
    div.innerHTML = `
      <div><b>${escapeHtml(meta.label)}</b></div>
      <div><b>${fmtDur(minutes)}</b></div>
    `;
    box.appendChild(div);
  }
}

function arrivalDialog(){
  alert("到着！ 全部完了しました。");
}

/* ---------- ranges (same-ish style: done/total, 全部完了) ---------- */
function renderRanges(){
  const list = $("rangesList");
  list.innerHTML = "";

  const ranges = state.ranges.filter(r=>r.dueDate===currentDate);
  if(ranges.length===0){
    list.innerHTML = `<div class="subhint">範囲を追加してください</div>`;
    return;
  }

  for(const r of ranges){
    const done = clamp(r.doneMin ?? 0, 0, r.totalMin);
    const total = r.totalMin;

    const div = document.createElement("div");
    div.className = "task";
    div.innerHTML = `
      <div class="taskTop">
        <div class="taskTitle">${escapeHtml(r.title)}</div>
        <div class="taskProg">${done}/${total}分</div>
      </div>
      <div class="taskBtns">
        <button class="btn" data-act="minus" data-id="${r.id}">-5</button>
        <button class="btn" data-act="plus" data-id="${r.id}">+5</button>
        <button class="btn primary" data-act="finish" data-id="${r.id}">全部完了</button>
        <button class="btn" data-act="edit" data-id="${r.id}">編集</button>
        <button class="btn danger" data-act="del" data-id="${r.id}">削除</button>
      </div>
    `;

    div.addEventListener("click",(ev)=>{
      const btn = ev.target.closest("button");
      if(!btn) return;
      const id = btn.dataset.id;
      const act = btn.dataset.act;
      const range = state.ranges.find(x=>x.id===id);
      if(!range) return;

      if(act==="minus"){
        range.doneMin = clamp((range.doneMin ?? 0) - 5, 0, range.totalMin);
      }else if(act==="plus"){
        range.doneMin = clamp((range.doneMin ?? 0) + 5, 0, range.totalMin);
        if(range.doneMin === range.totalMin) arrivalDialog();
      }else if(act==="finish"){
        range.doneMin = range.totalMin;
        arrivalDialog();
      }else if(act==="edit"){
        const newTitle = prompt("範囲名", range.title);
        if(newTitle == null) return;
        const newTotal = prompt("total(分)", String(range.totalMin));
        if(newTotal == null) return;
        const v = snapMin(parseInt(newTotal,10));
        if(!Number.isFinite(v) || v<5) return;
        range.title = newTitle.trim() || range.title;
        range.totalMin = v;
        range.doneMin = clamp(range.doneMin ?? 0, 0, range.totalMin);
      }else if(act==="del"){
        // unlink blocks
        for(const day of Object.keys(state.days)){
          for(const blk of state.days[day]){
            if(blk.linkedRangeId === id){
              blk.linkedRangeId = "";
              blk.units = null;
            }
          }
        }
        state.ranges = state.ranges.filter(x=>x.id!==id);
      }
      render();
    });

    list.appendChild(div);
  }
}

function refreshRangeLinkOptions(){
  // dialog select options depend on chosen day (current or next)
  const sel = $("blkRangeLink");
  if(!sel) return;

  const day = $("blkDay")?.value || currentDate;
  const cur = sel.value;

  sel.innerHTML = `<option value="">（リンクしない）</option>`;
  const ranges = state.ranges.filter(r=>r.dueDate===day);
  for(const r of ranges){
    const opt = document.createElement("option");
    opt.value = r.id;
    opt.textContent = r.title;
    sel.appendChild(opt);
  }
  sel.value = cur;
}

/* ---------- block dialog ---------- */
let editing = { date:null, id:null };

function updateStudyLinkVisibility(){
  const type = $("blkType").value;
  $("studyLinkBox").style.display = (type==="study") ? "block" : "none";
}

function fillDaySelect(){
  const sel = $("blkDay");
  const d0 = currentDate;
  const d1 = addDays(currentDate,1);

  sel.innerHTML = "";
  const o0 = document.createElement("option");
  o0.value = d0; o0.textContent = fmtDayLabel(d0);
  const o1 = document.createElement("option");
  o1.value = d1; o1.textContent = fmtDayLabel(d1);

  sel.appendChild(o0);
  sel.appendChild(o1);
}

function openNewDialog(){
  editing = {date:null, id:null};
  fillDaySelect();

  $("dlgTitle").textContent = "ブロック追加";
  $("btnDelete").style.display = "none";

  $("blkDay").value = currentDate;
  $("blkType").value = "study";
  $("blkStart").value = "17:00";
  $("blkDur").value = "60";
  $("blkNote").value = "";

  $("blkRangeLink").value = "";
  $("blkUnits").value = "60";
  $("blkDone").checked = false;

  updateStudyLinkVisibility();
  refreshRangeLinkOptions();

  $("blockDialog").showModal();
}

function openEditDialog(date, id){
  const blk = blocksOf(date).find(b=>b.id===id);
  if(!blk) return;

  editing = {date, id};
  fillDaySelect();

  $("dlgTitle").textContent = "ブロック編集";
  $("btnDelete").style.display = "inline-flex";

  $("blkDay").value = date;
  $("blkType").value = blk.type;
  $("blkStart").value = minToTime(blk.startMin);
  $("blkDur").value = String(blk.durationMin);
  $("blkNote").value = blk.note ?? "";

  $("blkRangeLink").value = blk.linkedRangeId ?? "";
  $("blkUnits").value = blk.units ?? "";
  $("blkDone").checked = !!blk.done;

  updateStudyLinkVisibility();
  refreshRangeLinkOptions();

  $("blockDialog").showModal();
}

function applyStudyProgress(blk){
  if(blk.type !== "study") return;
  if(!blk.linkedRangeId) return;

  const range = state.ranges.find(r=>r.id===blk.linkedRangeId);
  if(!range) return;

  const add = blk.units ?? blk.durationMin ?? 5;
  range.doneMin = clamp((range.doneMin ?? 0) + add, 0, range.totalMin);
  if(range.doneMin === range.totalMin) arrivalDialog();
}

/* ---------- drag/resize across 48h ---------- */
function attachDragResize(el){
  const id = el.dataset.id;
  const date = el.dataset.date;
  const handle = el.querySelector(".resizeHandle");

  let mode=null;
  let startY=0;
  let baseStart=0;
  let baseDur=0;

  const onDown = (ev)=>{
    ev.preventDefault();
    el.setPointerCapture(ev.pointerId);
    startY = ev.clientY;

    const blk = blocksOf(date).find(b=>b.id===id);
    if(!blk) return;

    baseStart = blk.startMin;
    baseDur = blk.durationMin;
    mode = (ev.target===handle) ? "resize" : "drag";
  };

  const onMove = (ev)=>{
    if(!mode) return;
    const dy = ev.clientY - startY;
    const dMin = snapMin(Math.round(dy / PX_PER_MIN));

    const blk = blocksOf(date).find(b=>b.id===id);
    if(!blk) return;

    if(mode==="drag"){
      let ns = snapMin(baseStart + dMin);
      ns = clamp(ns, 0, 24*60 - 5);
      blk.startMin = ns;
      if(blk.startMin + blk.durationMin > 24*60){
        blk.startMin = 24*60 - blk.durationMin;
      }
    }else{
      let nd = snapMin(baseDur + dMin);
      nd = clamp(nd, 5, 24*60);
      if(baseStart + nd > 24*60){
        nd = 24*60 - baseStart;
        nd = snapMin(Math.max(5, nd));
      }
      blk.durationMin = nd;
    }
    // 自動生成ブロックを触ったら固定化
    blk.autoKey = null;

    render();
  };

  const onUp = (ev)=>{
    if(!mode) return;
    mode=null;
    try{ el.releasePointerCapture(ev.pointerId); }catch{}
  };

  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointercancel", onUp);
}

/* ---------- auto build ---------- */
function removeByAutoKey(date, keyOrPrefix){
  state.days[date] = blocksOf(date).filter(b=>{
    if(!b.autoKey) return true;
    if(keyOrPrefix.endsWith("*")){
      const pref = keyOrPrefix.slice(0,-1);
      return !b.autoKey.startsWith(pref);
    }
    return b.autoKey !== keyOrPrefix;
  });
}
function findByAutoKey(date, autoKey){
  return blocksOf(date).find(b=>b.autoKey===autoKey) ?? null;
}
function mergeIntervals(intervals){
  if(intervals.length===0) return [];
  intervals.sort((a,b)=>a[0]-b[0]);
  const out=[intervals[0].slice()];
  for(let i=1;i<intervals.length;i++){
    const [s,e]=intervals[i];
    const last=out[out.length-1];
    if(s<=last[1]) last[1]=Math.max(last[1],e);
    else out.push([s,e]);
  }
  return out;
}
function occupied(date, excludePrefix=null){
  const ints=[];
  for(const b of blocksOf(date)){
    if(excludePrefix && b.autoKey && b.autoKey.startsWith(excludePrefix)) continue;
    ints.push([b.startMin, b.startMin+b.durationMin]);
  }
  return mergeIntervals(ints);
}
function nextFreeRun(pointer, endLimit, occ){
  let t=pointer;
  for(const [s,e] of occ){
    if(t < s){
      const run = Math.max(0, Math.min(endLimit,s) - t);
      if(run>0) return {start:t, run};
      t = e;
      continue;
    }
    if(s<=t && t<e){
      t = e;
      continue;
    }
  }
  const run = Math.max(0, endLimit - t);
  if(run>0) return {start:t, run};
  return null;
}
function placeAuto(date, spec, pointer, endLimit, occ){
  const r = nextFreeRun(pointer, endLimit, occ);
  if(!r || r.run < spec.durationMin) return {placed:false, pointer};

  const blk = {
    id: uid("blk"),
    type: spec.type,
    startMin: snapMin(r.start),
    durationMin: snapMin(spec.durationMin),
    note: spec.note,
    done:false,
    autoKey: spec.autoKey,
    linkedRangeId: spec.linkedRangeId ?? "",
    units: spec.units ?? null,
  };
  blocksOf(date).push(blk);

  occ.push([blk.startMin, blk.startMin+blk.durationMin]);
  const m = mergeIntervals(occ);
  occ.length=0; for(const it of m) occ.push(it);

  return {placed:true, pointer: blk.startMin+blk.durationMin};
}

function ensureWeekdayTemplate(date, overwrite=false){
  const dow = dayOfWeek(date);
  const isWeekday = dow>=1 && dow<=5;
  const sch = state.settings.school;

  // sleep 0->wake
  const wakeMin = timeToMin(sch.wakeTime) ?? timeToMin(DEFAULT_SCHOOL.wakeTime);
  if(wakeMin != null){
    const ex = findByAutoKey(date, AK.tplSleepAM);
    if(!ex || overwrite){
      const dur = snapMin(clamp(wakeMin, 5, 24*60));
      if(ex){
        ex.type="sleep"; ex.startMin=0; ex.durationMin=dur; ex.note="睡眠"; ex.autoKey=AK.tplSleepAM;
      }else{
        blocksOf(date).push({id:uid("blk"),type:"sleep",startMin:0,durationMin:dur,note:"睡眠",done:false,autoKey:AK.tplSleepAM});
      }
    }
  }

  if(!isWeekday) return;

  const commuteStart = timeToMin(sch.commuteStart) ?? timeToMin(DEFAULT_SCHOOL.commuteStart);
  const classStart = timeToMin(sch.classStart) ?? timeToMin(DEFAULT_SCHOOL.classStart);

  // commute
  if(commuteStart!=null && classStart!=null){
    const dur = snapMin(Math.max(5, classStart-commuteStart));
    const ex = findByAutoKey(date, AK.tplCommute);
    if(!ex || overwrite){
      if(ex){
        ex.type="move"; ex.startMin=snapMin(commuteStart); ex.durationMin=dur; ex.note="登校"; ex.autoKey=AK.tplCommute;
      }else{
        blocksOf(date).push({id:uid("blk"),type:"move",startMin:snapMin(commuteStart),durationMin:dur,note:"登校",done:false,autoKey:AK.tplCommute});
      }
    }
  }

  // class
  const endStr = (dow===2 || dow===4) ? sch.endTuTh : sch.endMWF;
  const endMin = timeToMin(endStr) ?? ((dow===2||dow===4)?16*60:15*60);

  if(classStart!=null && endMin!=null){
    const dur = snapMin(Math.max(5, endMin-classStart));
    const ex = findByAutoKey(date, AK.tplClass);
    if(!ex || overwrite){
      if(ex){
        ex.type="class"; ex.startMin=snapMin(classStart); ex.durationMin=dur; ex.note="授業"; ex.autoKey=AK.tplClass;
      }else{
        blocksOf(date).push({id:uid("blk"),type:"class",startMin:snapMin(classStart),durationMin:dur,note:"授業",done:false,autoKey:AK.tplClass});
      }
    }
  }
}

function getClassEndMin(date){
  const ov = overridesOf(date);
  if(ov.classEnd){
    const m = timeToMin(ov.classEnd);
    if(m!=null) return snapMin(m);
  }
  const cls = blocksOf(date).filter(b=>b.type==="class").sort((a,b)=>a.startMin-b.startMin)[0];
  if(cls) return cls.startMin+cls.durationMin;

  const dow = dayOfWeek(date);
  return (dow===2||dow===4) ? 16*60 : 15*60;
}

function computeBedMin(date){
  const ov = overridesOf(date);
  if(ov.bed){
    const m = timeToMin(ov.bed);
    if(m!=null) return snapMin(m);
  }
  // default: wake - sleepDur
  const wakeMin = timeToMin(state.settings.school.wakeTime) ?? timeToMin(DEFAULT_SCHOOL.wakeTime);
  const sleepDur = state.settings.defaults.sleep ?? DEFAULT_DUR.sleep;
  let bed = (wakeMin ?? 410) - sleepDur;
  bed %= (24*60);
  if(bed<0) bed += 24*60;
  return snapMin(bed);
}

function autoBuild(date, overwrite=false){
  const next = addDays(date,1);

  // templates
  ensureWeekdayTemplate(date, overwrite);
  ensureWeekdayTemplate(next, false); // 翌朝の睡眠が見える

  // remove auto blocks on date
  removeByAutoKey(date, AK.autoStudyPrefix+"*");
  removeByAutoKey(date, AK.autoSleepPM);
  if(overwrite){
    removeByAutoKey(date, AK.autoHomeMove);
    removeByAutoKey(date, AK.autoDinner);
    removeByAutoKey(date, AK.autoBath);
    removeByAutoKey(date, AK.autoPrep);
  }

  const classEnd = getClassEndMin(date);
  const bedMin = computeBedMin(date);

  // auto range is classEnd -> bedMin (same day only)
  const endLimit = bedMin; // 0-1439

  // occupied excluding auto study (already removed)
  const occ = occupied(date, AK.autoStudyPrefix);

  let pointer = classEnd;

  // after blocks
  const af = state.settings.after;
  const fixed = [
    {enabled:af.enHomeMove, type:"move", note:"帰宅", dur:af.minHomeMove, autoKey:AK.autoHomeMove},
    {enabled:af.enDinner,   type:"eat",  note:"夕食", dur:af.minDinner,   autoKey:AK.autoDinner},
    {enabled:af.enBath,     type:"bath", note:"風呂", dur:af.minBath,     autoKey:AK.autoBath},
    {enabled:af.enPrep,     type:"prep", note:"準備", dur:af.minPrep,     autoKey:AK.autoPrep},
  ];
  for(const f of fixed){
    if(!f.enabled) continue;
    const res = placeAuto(date, {type:f.type,note:f.note,durationMin:snapMin(f.dur),autoKey:f.autoKey}, pointer, endLimit, occ);
    if(res.placed) pointer = res.pointer;
  }

  // ranges -> study blocks (split ok)
  const ranges = state.ranges.filter(r=>r.dueDate===date && (r.doneMin ?? 0) < r.totalMin);

  let shortage = 0;

  for(const r of ranges){
    let remain = snapMin(r.totalMin - (r.doneMin ?? 0));
    let part = 1;

    while(remain > 0){
      const free = nextFreeRun(pointer, endLimit, occ);
      if(!free){
        shortage += remain;
        break;
      }

      const chunk = snapMin(Math.min(remain, free.run, 120));
      if(chunk < 5){
        shortage += remain;
        break;
      }

      const res = placeAuto(
        date,
        {
          type:"study",
          note:r.title,
          durationMin:chunk,
          autoKey:`${AK.autoStudyPrefix}${r.id}_${part}`,
          linkedRangeId:r.id,
          units:chunk
        },
        pointer,
        endLimit,
        occ
      );
      if(!res.placed){
        shortage += remain;
        break;
      }

      pointer = res.pointer;
      remain -= chunk;
      part++;
    }
  }

  // sleep PM (bed->24:00) (auto key only)
  const exSleep = findByAutoKey(date, AK.autoSleepPM);
  const durSleep = snapMin(Math.max(5, (24*60) - bedMin));
  if(!exSleep){
    blocksOf(date).push({
      id: uid("blk"),
      type:"sleep",
      startMin: bedMin,
      durationMin: durSleep,
      note:"睡眠",
      done:false,
      autoKey: AK.autoSleepPM
    });
  }else{
    exSleep.type="sleep"; exSleep.startMin=bedMin; exSleep.durationMin=durSleep; exSleep.note="睡眠";
  }

  render();

  if(shortage>0){
    alert(`就寝までに ${shortage}分 入りきりませんでした`);
  }
}

/* ---------- init & events ---------- */
function openSettings(){
  const sch = state.settings.school;
  $("setWake").value = sch.wakeTime ?? DEFAULT_SCHOOL.wakeTime;
  $("setCommuteStart").value = sch.commuteStart ?? DEFAULT_SCHOOL.commuteStart;
  $("setClassStart").value = sch.classStart ?? DEFAULT_SCHOOL.classStart;
  $("setEndMWF").value = sch.endMWF ?? DEFAULT_SCHOOL.endMWF;
  $("setEndTuTh").value = sch.endTuTh ?? DEFAULT_SCHOOL.endTuTh;

  const af = state.settings.after;
  $("enHomeMove").checked = !!af.enHomeMove;
  $("minHomeMove").value = af.minHomeMove ?? DEFAULT_AFTER.minHomeMove;
  $("enDinner").checked = !!af.enDinner;
  $("minDinner").value = af.minDinner ?? DEFAULT_AFTER.minDinner;
  $("enBath").checked = !!af.enBath;
  $("minBath").value = af.minBath ?? DEFAULT_AFTER.minBath;
  $("enPrep").checked = !!af.enPrep;
  $("minPrep").value = af.minPrep ?? DEFAULT_AFTER.minPrep;

  const grid = $("defaultsGrid");
  grid.innerHTML = "";
  const defs = state.settings.defaults;
  for(const k of Object.keys(TYPE_META)){
    const meta = TYPE_META[k];
    const label = document.createElement("div");
    label.className = "settingsLabel";
    label.textContent = meta.label;

    const input = document.createElement("input");
    input.className = "input";
    input.type = "number";
    input.min = "5";
    input.step = "5";
    input.value = defs[k] ?? DEFAULT_DUR[k] ?? 30;
    input.dataset.key = k;

    grid.appendChild(label);
    grid.appendChild(input);
  }

  $("settingsDialog").showModal();
}

function saveSettingsFromDialog(){
  state.settings.school.wakeTime = $("setWake").value || DEFAULT_SCHOOL.wakeTime;
  state.settings.school.commuteStart = $("setCommuteStart").value || DEFAULT_SCHOOL.commuteStart;
  state.settings.school.classStart = $("setClassStart").value || DEFAULT_SCHOOL.classStart;
  state.settings.school.endMWF = $("setEndMWF").value || DEFAULT_SCHOOL.endMWF;
  state.settings.school.endTuTh = $("setEndTuTh").value || DEFAULT_SCHOOL.endTuTh;

  state.settings.after.enHomeMove = $("enHomeMove").checked;
  state.settings.after.minHomeMove = snapMin(parseInt($("minHomeMove").value,10) || DEFAULT_AFTER.minHomeMove);

  state.settings.after.enDinner = $("enDinner").checked;
  state.settings.after.minDinner = snapMin(parseInt($("minDinner").value,10) || DEFAULT_AFTER.minDinner);

  state.settings.after.enBath = $("enBath").checked;
  state.settings.after.minBath = snapMin(parseInt($("minBath").value,10) || DEFAULT_AFTER.minBath);

  state.settings.after.enPrep = $("enPrep").checked;
  state.settings.after.minPrep = snapMin(parseInt($("minPrep").value,10) || DEFAULT_AFTER.minPrep);

  const inputs = $("defaultsGrid").querySelectorAll("input[data-key]");
  for(const inp of inputs){
    const k = inp.dataset.key;
    const v = snapMin(parseInt(inp.value,10));
    if(Number.isFinite(v) && v>=5) state.settings.defaults[k] = v;
  }

  saveState();
  render();
}

function init(){
  // top
  $("datePicker").value = currentDate;

  $("btnToday").addEventListener("click", ()=>{
    currentDate = todayStr();
    render();
  });
  $("datePicker").addEventListener("change",(ev)=>{
    currentDate = ev.target.value || todayStr();
    render();
  });

  $("btnSettings").addEventListener("click", openSettings);
  $("btnSettingsClose").addEventListener("click", ()=>{
    saveSettingsFromDialog();
    $("settingsDialog").close();
  });
  $("btnReset").addEventListener("click", ()=>{
    state.settings.defaults = structuredClone(DEFAULT_DUR);
    state.settings.school = structuredClone(DEFAULT_SCHOOL);
    state.settings.after = structuredClone(DEFAULT_AFTER);
    saveState();
    render();
    $("settingsDialog").close();
  });

  // overrides (save immediately)
  $("overrideClassEnd").addEventListener("change",(ev)=>{
    overridesOf(currentDate).classEnd = ev.target.value || null;
    saveState();
  });
  $("overrideBed").addEventListener("change",(ev)=>{
    overridesOf(currentDate).bed = ev.target.value || null;
    saveState();
  });

  $("btnAutoBuild").addEventListener("click", ()=>{
    const overwrite = $("chkOverwrite").checked;
    autoBuild(currentDate, overwrite);
  });

  // ranges
  $("rangeForm").addEventListener("submit",(ev)=>{
    ev.preventDefault();
    const title = $("rangeTitleInput").value.trim();
    const total = snapMin(parseInt($("rangeTotalInput").value,10));
    if(!title || !Number.isFinite(total) || total<5) return;

    state.ranges.unshift({
      id: uid("rng"),
      title,
      totalMin: total,
      doneMin: 0,
      dueDate: currentDate,
    });

    $("rangeTitleInput").value = "";
    $("rangeTotalInput").value = "";
    saveState();
    render();
  });

  // block dialog
  $("btnAdd").addEventListener("click", openNewDialog);
  $("blkType").addEventListener("change", updateStudyLinkVisibility);
  $("blkDay").addEventListener("change", ()=>{
    refreshRangeLinkOptions();
  });

  $("btnCancel").addEventListener("click", ()=> $("blockDialog").close());

  $("btnDelete").addEventListener("click", ()=>{
    if(!editing.date || !editing.id) return;
    state.days[editing.date] = blocksOf(editing.date).filter(b=>b.id!==editing.id);
    editing = {date:null,id:null};
    saveState();
    $("blockDialog").close();
    render();
  });

  $("blockForm").addEventListener("submit",(ev)=>{
    ev.preventDefault();

    const day = $("blkDay").value || currentDate;
    const type = $("blkType").value;
    const startMin = snapMin(timeToMin($("blkStart").value) ?? 0);
    const dur = snapMin(parseInt($("blkDur").value,10) || 60);
    const note = $("blkNote").value ?? "";

    const linkedRangeId = (type==="study") ? ($("blkRangeLink").value ?? "") : "";
    const units = (type==="study" && linkedRangeId)
      ? snapMin(parseInt($("blkUnits").value,10) || dur)
      : null;

    const done = $("blkDone").checked;

    let blk = null;

    if(editing.date && editing.id){
      // if day changed, move block
      const oldArr = blocksOf(editing.date);
      const idx = oldArr.findIndex(b=>b.id===editing.id);
      if(idx>=0){
        blk = oldArr[idx];
        oldArr.splice(idx,1);
        blocksOf(day).push(blk);
      }
    }

    if(!blk){
      blk = { id: uid("blk") };
      blocksOf(day).push(blk);
    }

    const prevDone = !!blk.done;

    blk.type = type;
    blk.startMin = clamp(startMin, 0, 24*60 - 5);
    blk.durationMin = clamp(dur, 5, 24*60 - blk.startMin);
    blk.note = note;
    blk.linkedRangeId = linkedRangeId;
    blk.units = units;
    blk.done = done;

    // 手動編集は固定化
    blk.autoKey = null;

    if(!prevDone && done){
      applyStudyProgress(blk);
    }

    editing = {date:null,id:null};
    saveState();
    $("blockDialog").close();
    render();
  });

  // scroll start around morning
  setTimeout(()=>{
    $("timelineWrap").scrollTop = 7*60*PX_PER_MIN - 120;
  },0);

  render();
}

init();

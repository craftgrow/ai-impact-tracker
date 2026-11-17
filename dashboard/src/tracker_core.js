/* ============================================================
   MODULE: tracker_core
   Pure(ish) logic: DOM helpers, formatting, filtering,
   aggregation, and the usage-grade model. No rendering here.
   ============================================================ */

/* ---------- DOM + formatting helpers ---------- */
var $=function(s,el){return (el||document).querySelector(s);};
var $$=function(s,el){return Array.prototype.slice.call((el||document).querySelectorAll(s));};
/* Null-safe event binding: a missing element is a soft no-op, never a crash. */
function on(sel,ev,fn){ var el=(typeof sel==='string')?$(sel):sel; if(el)el.addEventListener(ev,fn); return el; }
function setText(sel,txt){ var el=$(sel); if(el)el.textContent=txt; }
function setHTML(sel,html){ var el=$(sel); if(el)el.innerHTML=html; }

function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function num(n,d){ n=+n||0; return n.toLocaleString('en-US',{maximumFractionDigits:d==null?0:d,minimumFractionDigits:d==null?0:d}); }
function fmtTok(n){ n=+n||0;
  /* a billions tier: '31,811M' is the same unreadable-at-scale problem the
     comparison anchors had — the unit has to climb with the number. */
  if(n>=1e9)  return num(n/1e9,2)+'B';
  if(n>=1e6)  return num(n/1e6,n>=1e7?0:1)+'M';
  if(n>=1000) return num(n/1000,0)+'k';
  return num(n,0); }
function modelKey(m){ m=(m||'').toLowerCase(); if(m.indexOf('opus')>=0)return 'opus'; if(m.indexOf('sonnet')>=0)return 'sonnet'; if(m.indexOf('haiku')>=0)return 'haiku'; if(m.indexOf('fable')>=0)return 'fable'; return 'other'; }
function co2g(wh){ return wh*(rates.gridIntensity/1000); }  // g CO2e = Wh × (g/kWh)/1000
function parseDate(s){ var d=new Date(s); return isNaN(d)?new Date(0):d; }
function fmtDate(s){ var d=parseDate(s); return d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); }
function fmtDateShort(s){ var d=parseDate(s); return d.toLocaleDateString('en-US',{month:'short',day:'numeric'}); }
function clamp(v,a,b){return v<a?a:(v>b?b:v);}

/* ---------- colour: two separate jobs, two separate scales ----------
   MODEL_COL is categorical — each model owns a hue, and that hue means
   "this model" everywhere it appears (donut, session bars, drill rows).
   PROJ_RAMP is sequential — a single forest→sage ramp walked in rank
   order, so the by-project list reads as a ranking rather than as five
   unrelated categories. Keeping the two scales disjoint is what stops a
   project bar from rendering in the exact orange that means "Opus". */
var MODEL_COL={opus:'#C87A53',sonnet:'#708271',haiku:'#8B9C87',fable:'#C9A15A',other:'#A7AB9F'};
var PROJ_RAMP=['#2F4E3A','#3E5E4A','#4E6E58','#5E7A5C','#708271','#849377','#98A48D','#ACB4A4'];
var PAL=PROJ_RAMP;
function colorFor(key,i){ return PROJ_RAMP[Math.min(i,PROJ_RAMP.length-1)]; }
/* Rank-ordered: position 0 is darkest. Callers pass the row index. */
function colorForRank(i,n){
  if(!n||n<2) return PROJ_RAMP[1];
  var span=Math.min(n,PROJ_RAMP.length)-1;
  return PROJ_RAMP[Math.round(i/(n-1)*span)];
}
/* Retained for callers that have a label but no rank (drill-down, legends).
   Stable per label so a project keeps its hue across filters. */
function colorForKey(key){
  var s=String(key||''), h=0;
  for(var i=0;i<s.length;i++){ h=(h*31+s.charCodeAt(i))>>>0; }
  return PROJ_RAMP[h%PROJ_RAMP.length];
}

/* ---------- view state ---------- */
var state={range:'week',from:'',to:'',compare:true,project:'__all',model:'__all',search:'',sort:'timestamp',dir:-1};

/* ============================================================
   Time windows — one source of truth.

   Every range resolves to a half-open [start, end) pair in LOCAL
   time, so a session logged at 11pm lands in the day the user
   actually worked. `all` returns null, meaning "no bound".
   ============================================================ */
var RANGES=[
  {id:'today',     label:'Today',        prev:'yesterday'},
  {id:'week',      label:'This week',    prev:'last week'},
  {id:'month',     label:'This month',   prev:'last month'},
  {id:'lastmonth', label:'Last month',   prev:'the month before'},
  {id:'d30',       label:'Last 30 days', prev:'the prior 30 days'},
  {id:'all',       label:'All-time',     prev:null},
  {id:'custom',    label:'Custom',       prev:'the prior period'}
];
function rangeDef(id){
  for(var i=0;i<RANGES.length;i++) if(RANGES[i].id===id) return RANGES[i];
  return RANGES[1];
}
function startOfDay(d){ var x=new Date(d); x.setHours(0,0,0,0); return x; }
function addDays(d,n){ var x=new Date(d); x.setDate(x.getDate()+n); return x; }
/* Parse a yyyy-mm-dd field as LOCAL midnight (new Date('2026-08-02') is UTC). */
function parseDayInput(s){
  var m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s||'').trim());
  return m? new Date(+m[1], +m[2]-1, +m[3], 0,0,0,0) : null;
}
function toDayInput(d){
  if(!d)return '';
  var p=function(n){return (n<10?'0':'')+n;};
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());
}

/* Resolve a range id to [start,end). `prev` shifts it one period back.
   Returns null for an unbounded or incomplete window. */
function rangeWindow(range, prev){
  var now=new Date(), s, e;
  if(range==='all') return null;
  if(range==='today'){ s=startOfDay(now); e=addDays(s,1); }
  else if(range==='week'){ var dow=now.getDay(), back=(dow===0?6:dow-1);
    s=addDays(startOfDay(now),-back); e=addDays(s,7); }
  else if(range==='month'){ s=new Date(now.getFullYear(),now.getMonth(),1); e=new Date(now.getFullYear(),now.getMonth()+1,1); }
  else if(range==='lastmonth'){ s=new Date(now.getFullYear(),now.getMonth()-1,1); e=new Date(now.getFullYear(),now.getMonth(),1); }
  else if(range==='d30'){ e=addDays(startOfDay(now),1); s=addDays(e,-30); }
  else if(range==='custom'){
    var a=parseDayInput(state.from), b=parseDayInput(state.to);
    if(!a&&!b) return null;
    s=a||new Date(1970,0,1);
    e=b?addDays(b,1):addDays(startOfDay(now),1);   // `to` is inclusive
    if(e<=s){ var t=s; s=addDays(e,-1); e=addDays(t,1); }  // tolerate reversed inputs
  }
  else return null;

  if(prev){
    /* Calendar months step back by month; everything else by its own span. */
    if(range==='month'||range==='lastmonth'){ e=s; s=new Date(s.getFullYear(),s.getMonth()-1,1); }
    else { var span=e.getTime()-s.getTime(); e=s; s=new Date(s.getTime()-span); }
  }
  return [s,e];
}

/* Human label for whatever window is showing — used in the header. */
function rangeLabel(){
  var w=rangeWindow(state.range,false);
  if(!w){
    if(state.range==='custom') return 'pick a start and end date';
    var ts=DATA.map(function(x){return parseDate(x.timestamp).getTime();}).filter(function(n){return n>0;});
    if(!ts.length) return 'no data yet';
    return fmtDate(new Date(Math.min.apply(null,ts)))+' → '+fmtDate(new Date(Math.max.apply(null,ts)));
  }
  var last=addDays(w[1],-1);
  return (startOfDay(w[0]).getTime()===startOfDay(last).getTime())
    ? fmtDate(w[0])
    : fmtDate(w[0])+' → '+fmtDate(last);
}
function prevLabel(){ return rangeDef(state.range).prev || 'the previous period'; }

/* ---------- filtering ---------- */
function inRange(e){
  var w=rangeWindow(state.range,false);
  if(!w) return true;                     // all-time, or an unfinished custom range
  var d=parseDate(e.timestamp);
  return d>=w[0] && d<w[1];
}
function filtered(){
  var s=state.search.toLowerCase();
  return DATA.filter(function(e){
    if(!inRange(e))return false;
    if(state.project!=='__all' && e.project!==state.project)return false;
    if(state.model!=='__all' && modelKey(e.model)!==state.model)return false;
    if(s && String(e.context||'').toLowerCase().indexOf(s)<0 && String(e.project||'').toLowerCase().indexOf(s)<0)return false;
    return true;
  });
}
function totals(list){
  var t={wh:0,ml:0,tok:0,co2:0,n:list.length};
  list.forEach(function(e){ t.wh+=+e.energy_wh||0; t.ml+=+e.water_ml||0; t.tok+=+e.total_tokens||0; t.co2+=co2g(+e.energy_wh||0); });
  return t;
}

/* ---------- previous-period comparison (for KPI delta chips) ---------- */
function matchesNonRange(e){
  var s=state.search.toLowerCase();
  if(state.project!=='__all' && e.project!==state.project)return false;
  if(state.model!=='__all' && modelKey(e.model)!==state.model)return false;
  if(s && String(e.context||'').toLowerCase().indexOf(s)<0 && String(e.project||'').toLowerCase().indexOf(s)<0)return false;
  return true;
}
function prevTotals(){
  if(!state.compare) return null;
  var w=rangeWindow(state.range,true); if(!w)return null;
  return totals(DATA.filter(function(e){ var d=parseDate(e.timestamp); return d>=w[0]&&d<w[1]&&matchesNonRange(e); }));
}
function aggBy(list,keyFn){
  var m={}; list.forEach(function(e){ var k=keyFn(e)||'—'; m[k]=(m[k]||0)+(+e.energy_wh||0); });
  return Object.keys(m).map(function(k){return {key:k,wh:m[k]};}).sort(function(a,b){return b.wh-a.wh;});
}

/* Multi-metric grouping — the by-project card lets you rank on any of
   energy, water, carbon or session count, so one pass collects them all. */
function aggFull(list,keyFn){
  var m={};
  list.forEach(function(e){
    var k=keyFn(e)||'—';
    if(!m[k]) m[k]={key:k,wh:0,ml:0,co2:0,tok:0,n:0};
    var wh=+e.energy_wh||0;
    m[k].wh+=wh; m[k].ml+=+e.water_ml||0; m[k].co2+=co2g(wh);
    m[k].tok+=+e.total_tokens||0; m[k].n++;
  });
  return Object.keys(m).map(function(k){return m[k];});
}
/* How each rankable metric is labelled and formatted, in one place. */
var PROJ_METRICS={
  wh :{key:'wh', label:'Energy',   low:'energy',   fmt:function(v){return v>=1000?num(v/1000,2)+' kWh':num(v,1)+' Wh';}},
  ml :{key:'ml', label:'Water',    low:'water',    fmt:function(v){return v>=1000?num(v/1000,2)+' L':num(v,0)+' mL';}},
  /* 'low' is spelled out rather than derived — toLowerCase() turns CO₂e into co₂e */
  co2:{key:'co2',label:'CO₂e',     low:'CO₂e',     fmt:function(v){return v>=1000?num(v/1000,2)+' kg':num(v,0)+' g';}},
  n  :{key:'n',  label:'Sessions', low:'sessions', fmt:function(v){return num(v,0)+' session'+(v===1?'':'s');}}
};
function pctOfAll(wh){ var all=totals(DATA).wh||1; return num(wh/all*100,1); }

/* ============================================================
   Efficiency — how much energy each session spent per unit of work.
   ============================================================ */

/* Effective Wh per million tokens for one entry: the one honest
   efficiency number this log shape can support. Null if tokens missing. */
function effRate(e){
  var t=+e.total_tokens||0; if(t<=0)return null;
  return (+e.energy_wh||0)*1e6/t;
}
function effRateOf(list){ var t=totals(list); return t.tok>0 ? t.wh*1e6/t.tok : null; }

/* Time-ordered efficiency points plus a trailing rolling mean. */
function effSeries(list,window){
  window=window||5;
  var pts=list.slice().sort(function(a,b){return parseDate(a.timestamp)-parseDate(b.timestamp);})
    .map(function(e){ var r=effRate(e); return r==null?null:{t:parseDate(e.timestamp).getTime(),r:r,mk:modelKey(e.model),e:e}; })
    .filter(Boolean);
  var acc=[];
  pts.forEach(function(p,i){
    acc.push(p.r); if(acc.length>window)acc.shift();
    p.roll=acc.reduce(function(s,v){return s+v;},0)/acc.length;
    p.i=i;
  });
  return pts;
}

/* Right-sizing: heavy-model sessions small enough that a lighter model
   would plausibly have done the job. Never claims a saving that isn't there. */
var RIGHTSIZE_TOKENS = 60000;
function rightSizing(list){
  var lighter={opus:'sonnet',fable:'haiku',sonnet:'haiku'};
  var n=0, actual=0, alt=0, byProj={};
  list.forEach(function(e){
    var k=modelKey(e.model), to=lighter[k]; if(!to)return;
    var tok=+e.total_tokens||0; if(tok<=0||tok>RIGHTSIZE_TOKENS)return;
    var wh=+e.energy_wh||0;
    var altWh=tok*((rates.models[to]&&rates.models[to].bl)||145)/1e6;
    if(altWh>=wh)return;
    n++; actual+=wh; alt+=altWh;
    byProj[e.project]=(byProj[e.project]||0)+(wh-altWh);
  });
  var top=Object.keys(byProj).sort(function(a,b){return byProj[b]-byProj[a];})[0]||null;
  return {n:n,actual:actual,alt:alt,saved:actual-alt,topProject:top,threshold:RIGHTSIZE_TOKENS};
}

/* ---------- input/output split coverage ----------
   The context split is only real when entries carry input_tokens /
   output_tokens. Back-solving it from energy alone yields nonsense for any
   entry logged with a blended rate, so we report coverage instead of
   inventing a number. */
function splitStats(list){
  var got=[], inTok=0, outTok=0, inWh=0, outWh=0;
  list.forEach(function(e){
    var i=+e.input_tokens||0, o=+e.output_tokens||0;
    if(i<=0&&o<=0)return;
    got.push(e);
    var m=rates.models[modelKey(e.model)]||rates.models.other;
    inTok+=i; outTok+=o; inWh+=i*m.inp/1e6; outWh+=o*m.out/1e6;
  });
  return {n:got.length,total:list.length,inTok:inTok,outTok:outTok,inWh:inWh,outWh:outWh,list:got};
}

/* Entries whose effective rate sits within 1% of their model's blended
   constant were almost certainly logged without a real split — those
   estimates read high, and saying so is more useful than hiding it. */
function blendedCount(list){
  var n=0;
  list.forEach(function(e){
    var r=effRate(e); if(r==null)return;
    var m=rates.models[modelKey(e.model)]||rates.models.other;
    if(m.bl>0 && Math.abs(r-m.bl)/m.bl<0.01) n++;
  });
  return n;
}

/* ---------- usage grade ----------
   Scale tuned so an all-Opus, no-mitigation default lands ~C ("room to improve"),
   A+ = lean models + lean sessions + mitigation, F = heaviest models + huge sessions + none. */
function computeGrade(list){
  var t=totals(list);
  if(!t.n) return {letter:'—',score:0,cls:'gr-c',why:'No sessions in this view.',s_model:0,s_sess:0,s_mit:0,rate:0,avg:0,done:0,total:0};
  var rate = t.tok>0 ? t.wh/(t.tok/1e6) : 145;        // effective Wh per 1M tokens
  var s_model = clamp((240-rate)/(240-50),0,1)*50;    // lighter models → higher
  var avg = t.wh/t.n;
  /* The session-size test is SUSPENDED. Its 30 Wh threshold was calibrated when
     one log entry meant one self-reported turn; since the transcript importer
     landed, an entry is a whole session, so the test compares against the wrong
     unit and scores 0 however lean the work is. In testing, a real log's average fell by half
     across three refreshes without the letter moving a point. Scoring
     it would be scoring noise, so the grade is computed over the two components
     that still mean something and rescaled to 100. Restore this (and drop the
     rescale) once the threshold is re-derived from session-level data. */
  var SESSION_TEST_SUSPENDED = true;
  var s_sess = clamp((30-avg)/(30-3),0,1)*30;          // leaner sessions → higher (unscored while suspended)
  var done=0,tot=0; MIT.forEach(function(c){c.acts.forEach(function(a){tot++; if(checks[a.id])done++;});});
  var s_mit = tot? (done/tot)*20 : 0;                  // mitigation commitment
  var scored = SESSION_TEST_SUSPENDED ? (s_model+s_mit) : (s_model+s_sess+s_mit);
  var scoreMax = SESSION_TEST_SUSPENDED ? 70 : 100;
  var score = Math.round(scored/scoreMax*100);
  var why;
  var parts = SESSION_TEST_SUSPENDED ? [['model',s_model/50],['mit',s_mit/20]]
                                    : [['model',s_model/50],['sess',s_sess/30],['mit',s_mit/20]];
  var worst=parts.sort(function(a,b){return a[1]-b[1];})[0][0];
  if(score>=90) why='Efficient model mix and lean sessions — strong, keep it up.';
  else if(worst==='model') why='Heavier models dominate (~'+num(rate,0)+' Wh per M tokens) — use Sonnet/Haiku for simpler tasks.';
  else if(worst==='sess') why='Sessions run large (~'+num(avg,1)+' Wh avg) — batch questions and reuse outputs.';
  else if(worst==='mit' && s_model>=45) why='Model mix is efficient (~'+num(rate,0)+' Wh per M tokens). Commit to actions below to raise this further.';
  else why='Commit to more mitigation actions below to raise your grade.';
  return {letter:letterFor(score),score:score,cls:gradeClass(score),why:why,
          suspended: SESSION_TEST_SUSPENDED ? 'session size' : null,
          s_model:Math.round(s_model),s_sess:Math.round(s_sess),s_mit:Math.round(s_mit),
          rate:rate,avg:avg,done:done,total:tot};
}
function letterFor(s){ return s>=90?'A+':s>=85?'A':s>=80?'A-':s>=75?'B+':s>=70?'B':s>=65?'B-':s>=60?'C+':s>=55?'C':s>=50?'C-':s>=45?'D+':s>=40?'D':s>=35?'D-':'F'; }
function gradeClass(s){ return s>=80?'gr-a':s>=65?'gr-b':s>=50?'gr-c':s>=35?'gr-d':'gr-f'; }
/* Grade card gradient — the card is the one filled surface on the page, so it
   carries the verdict in colour as well as in the letter. */
var GRADE_GRAD={
  'gr-a':'linear-gradient(158deg,#3E5E4A,#24402F)',
  'gr-b':'linear-gradient(158deg,#4F6B41,#2F4629)',
  'gr-c':'linear-gradient(158deg,#8A6B2E,#563F1C)',
  'gr-d':'linear-gradient(158deg,#A05A32,#65361D)',
  'gr-f':'linear-gradient(158deg,#8E3B2B,#551F16)'
};

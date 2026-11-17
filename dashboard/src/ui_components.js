/* ============================================================
   MODULE: ui_components
   All rendering: KPI cards, sticky rollup, rotating comparisons,
   SVG charts, drill-down, table, mitigation checklist,
   methodology panel, filter selects, and the master render().
   Every renderer is null-safe: a missing mount point is skipped.
   ============================================================ */

/* ---------- elemental motifs ----------
   A pulse for energy, a ripple for water, drifting bands for carbon.
   Drawn as inline SVG at very low opacity so they read as paper
   texture behind the number, not as a second thing to look at.
   All motion lives in CSS, so prefers-reduced-motion stills them. */
function kpiMotif(kind,col){
  var s='<svg class="kpi-motif" viewBox="0 0 104 104" aria-hidden="true" focusable="false">';
  if(kind==='energy'){
    s+='<circle class="km-ring" cx="52" cy="52" r="22" stroke="'+col+'"/>'+
       '<circle class="km-ring km-ring2" cx="52" cy="52" r="22" stroke="'+col+'"/>'+
       '<path d="M57 26 39 56h11l-3 22 19-30H55z" fill="'+col+'"/>';
  }else if(kind==='water'){
    s+='<defs><clipPath id="kmDrop"><path d="M52 20c13 15 21 26 21 36a21 21 0 0 1-42 0c0-10 8-21 21-36z"/></clipPath></defs>'+
       '<path d="M52 20c13 15 21 26 21 36a21 21 0 0 1-42 0c0-10 8-21 21-36z" fill="none" stroke="'+col+'" stroke-width="2.5"/>'+
       '<g clip-path="url(#kmDrop)">'+
       '<path class="km-wave" d="M-40 58q20-7 40 0t40 0 40 0 40 0v46h-160z" fill="'+col+'"/>'+
       '<path class="km-wave km-wave2" d="M-40 64q20 7 40 0t40 0 40 0 40 0v46h-160z" fill="'+col+'"/>'+
       '</g>';
  }else{
    s+='<g class="km-haze" fill="'+col+'">'+
       '<circle cx="40" cy="50" r="16"/><circle cx="60" cy="45" r="20"/>'+
       '<circle cx="74" cy="54" r="13"/><rect x="24" y="49" width="62" height="19" rx="9.5"/></g>'+
       '<g class="km-haze km-haze2" stroke="'+col+'" stroke-width="5" stroke-linecap="round">'+
       '<path d="M22 80h32"/></g>'+
       '<g class="km-haze km-haze3" stroke="'+col+'" stroke-width="5" stroke-linecap="round">'+
       '<path d="M38 92h34"/></g>';
  }
  return s+'</svg>';
}


/* ============================================================
   MAGNITUDE-AWARE COMPARISONS
   A fixed anchor reads well across about one order of magnitude and turns to
   noise outside it: "616 phone charges" is a picture, "16,775 phone charges"
   is just a number with commas in it. So each metric carries a ladder of
   anchors spanning several magnitudes, and we pick whichever lands closest to
   ~8 — comfortably inside the 1-100 band a reader can hold in their head.
   Anchors are tagged by family (object / time / journey / share) and we take
   at most one per family, so two anchors shown together frame the same
   quantity two different ways rather than twice the same way.
   ============================================================ */
var ANCHORS = {
  energy: [                                                  /* per unit, Wh */
    {u:10,      f:'object',  one:'hour of a 10 W LED bulb',          many:'hours of a 10 W LED bulb',
     s:'10 Wh per hour · a 10 W LED run for 60 minutes'},
    {u:12,      f:'object',  one:'phone charge',                     many:'phone charges',
     s:'12 Wh per full charge · a 3,300 mAh cell at 3.85 V, plus charger loss'},
    {u:50,      f:'object',  one:'hour of a laptop running',         many:'hours of a laptop running',
     s:'50 Wh per hour · mid-range notebook under load, ENERGY STAR range'},
    {u:100,     f:'object',  one:'electric-kettle boil',             many:'electric-kettle boils',
     s:'100 Wh per boil · a 2 kW kettle for about 3 minutes'},
    {u:700,     f:'object',  one:'warm wash cycle',                  many:'warm wash cycles',
     s:'0.7 kWh per cycle · ENERGY STAR front-loader, warm wash'},
    {u:1500,    f:'time',    one:'day of a fridge running',          many:'days of a fridge running',
     s:'1.5 kWh per day · ENERGY STAR mid-size refrigerator'},
    {u:3500,    f:'object',  one:'tumble-dryer load',                many:'tumble-dryer loads',
     s:'3.5 kWh per load · standard electric vented dryer'},
    {u:28980,   f:'time',    one:"day of a US home's electricity",   many:"days of a US home's electricity",
     s:'29 kWh per day · 881 kWh/month divided by 30.4, US EIA RECS'},
    {u:202860,  f:'time',    one:"week of a US home's electricity",  many:"weeks of a US home's electricity",
     s:'203 kWh per week · derived from the US EIA monthly average'},
    {u:881000,  f:'time',    one:"month of a US home's electricity", many:"months of a US home's electricity",
     s:'881 kWh per month · US EIA average residential consumption'},
    {u:10572000,f:'time',    one:"year of a US home's electricity",  many:"years of a US home's electricity",
     s:'10,572 kWh per year · 881 kWh/month x 12, US EIA'},
    {u:285.7,   f:'journey', one:'mile in an electric car',          many:'miles in an electric car',
     s:'286 Wh per mile · 3.5 mi/kWh, US EPA combined efficiency'},
    {u:49714,   f:'journey', one:'Seattle-to-Portland drive in an EV', many:'Seattle-to-Portland drives in an EV',
     s:'49.7 kWh per trip · 174 miles at 3.5 mi/kWh'}
  ],
  water: [                                                   /* per unit, mL */
    {u:240,     f:'object',  one:'glass of water',                   many:'glasses of water',
     s:'240 mL · a standard 8 oz tumbler'},
    {u:500,     f:'object',  one:'500 mL bottle',                    many:'500 mL bottles',
     s:'500 mL · a standard single-serve bottle'},
    {u:100,     f:'time',    one:'second of a running kitchen tap',  many:'seconds of a running kitchen tap',
     s:'100 mL per second · 6 L/min, EPA WaterSense tap'},
    {u:6000,    f:'time',    one:'minute of a running kitchen tap',  many:'minutes of a running kitchen tap',
     s:'6 L per minute · EPA WaterSense maximum tap flow'},
    {u:15000,   f:'object',  one:'dishwasher cycle',                 many:'dishwasher cycles',
     s:'15 L per cycle · ENERGY STAR certified dishwasher'},
    {u:50000,   f:'object',  one:'load of laundry',                  many:'loads of laundry',
     s:'50 L per load · efficient front-loading washer'},
    {u:65000,   f:'time',    one:'eight-minute shower',              many:'eight-minute showers',
     s:'65 L per shower · 8.1 L/min WaterSense showerhead for 8 minutes'},
    {u:150000,  f:'object',  one:'filled bathtub',                   many:'filled bathtubs',
     s:'150 L · a standard tub filled to normal depth'},
    {u:310000,  f:'time',    one:"day of one person's household water", many:"days of one person's household water",
     s:'310 L per person per day · US EPA residential average'},
    {u:1000000, f:'object',  one:'cubic metre of water',             many:'cubic metres of water',
     s:'1,000 L · one cubic metre, the unit on a water bill'}
  ],
  carbon: [                                              /* per unit, g CO2e */
    {u:57,      f:'object',  one:'tree-day of reabsorption',         many:'tree-days of reabsorption',
     s:'57 g per day · a mature tree absorbing ~21 kg CO2e a year'},
    {u:170,     f:'journey', one:'km flown in economy',              many:'km flown in economy',
     s:'170 g per passenger-km · UK DEFRA short-haul economy factor'},
    {u:251,     f:'journey', one:'km in a petrol car',               many:'km in a petrol car',
     s:'251 g per km · UK DEFRA average petrol car'},
    {u:404,     f:'journey', one:'mile in an average car',           many:'miles in an average car',
     s:'404 g per mile · US EPA typical passenger vehicle'},
    {u:2300,    f:'object',  one:'beef burger',                      many:'beef burgers',
     s:'2.3 kg per burger · a 110 g beef patty, farm to plate'},
    {u:7300,    f:'time',    one:'day of an average diet',           many:'days of an average diet',
     s:'7.3 kg per day · a mixed omnivorous diet'},
    {u:12603,   f:'time',    one:'day of typical US driving',        many:'days of typical US driving',
     s:'12.6 kg per day · 11,500 miles a year at 400 g/mile'},
    {u:21000,   f:'time',    one:'tree-year of reabsorption',        many:'tree-years of reabsorption',
     s:'21 kg per year · one mature tree, full growing year'},
    {u:41096,   f:'time',    one:"day of one American's whole footprint", many:"days of one American's whole footprint",
     s:'41 kg per day · 15 t a year divided by 365'},
    {u:70296,   f:'journey', one:'Seattle-to-Portland drive',        many:'Seattle-to-Portland drives',
     s:'70.3 kg per trip · 174 miles at 404 g/mile'},
    {u:1600000, f:'journey', one:'transatlantic round trip',         many:'transatlantic round trips',
     s:'1.6 t per trip · round-trip economy, London to New York'}
  ]
};
var CMP_TARGET = 8;   /* the quotient we aim for; 1-100 is the readable band */

/* Returns up to n {a,q} picks, best first, one per family where possible. */
function pickAnchors(metric, value, n){
  n = n || 2;
  var list = ANCHORS[metric] || [];
  function band(lo, hi){
    return list.map(function(a){
          var q = a.u > 0 ? value / a.u : 0;
          /* distance in orders of magnitude from the target quotient */
          var d = q > 0 ? Math.abs(Math.log(q / CMP_TARGET) / Math.LN10) : 99;
          return {a:a, q:q, d:d};
        })
        .filter(function(x){ return x.q >= lo && x.q < hi; })
        .sort(function(x,y){ return x.d - y.d; });
  }
  var scored = band(0.05, 10000);
  /* A short range (Today) or a near-empty log can leave the readable band with
     one or two survivors, which is how the strip used to end up showing the
     same framing twice. Widen rather than repeat: a looser comparison still
     informs, and the printed quotient tells the reader how loose it is. */
  if(scored.length < Math.min(n, 3)) scored = band(0.002, 1e7);
  var out = [], seen = {};
  scored.forEach(function(x){ if(out.length<n && !seen[x.a.f]){ seen[x.a.f]=1; out.push(x); } });
  /* families ran out before n - backfill with the next best regardless */
  scored.forEach(function(x){ if(out.length<n && out.indexOf(x)<0) out.push(x); });
  return out;
}

function anchorPhrase(x){
  /* one decimal only where it carries information: "6 bottles", not "6.0
     bottles", and "0.5 minutes" becomes "30 seconds" rather than a fraction
     of a unit nobody counts in fractions. */
  var q=x.q, dp = q<10 ? 1 : 0, str = num(q, dp);
  if(dp===1 && Math.abs(q-Math.round(q))<0.05) str = num(q,0);
  return '<b>'+str+'</b> '+(parseFloat(str)===1 ? x.a.one : x.a.many);
}

/* One line, two framings: "≈ 6.9 days of a US home's electricity · 705 miles in an electric car" */
function cmpText(metric, value, n){
  var picks = pickAnchors(metric, value, n);
  return picks.length ? picks.map(anchorPhrase).join(' · ') : '';
}


/* ============================================================
   VERDICT BAND
   The page's thesis, above everything else. A first-time visitor arrives with
   one question — "is this a lot?" — and the honest answer is a share of their
   own year, not a count of phone charges. Falls back to the best single
   comparison when no baseline has been set, because an unanswered question is
   still better served by a picture than by a raw kWh figure.
   ============================================================ */
function renderVerdict(list){
  var host=$('#verdict'); if(!host) return;
  var t=totals(list);
  if(!t.n){ host.hidden=true; return; }
  host.hidden=false;

  var whTxt = t.wh>=1000 ? num(t.wh/1000,2)+' kWh' : num(t.wh,1)+' Wh';
  var lead, sub;

  /* share of the user's own yearly footprint — the real answer when we have it */
  var share=null;
  try{
    var annual=annualizeAI(list), mine=lifeModel().mine;
    if(annual>0 && mine>0) share=annual/mine*100;
  }catch(e){ share=null; }

  if(share!==null){
    lead='Your AI use is <strong>'+heroPct(share)+'</strong> of your yearly footprint.';
    sub='<b>'+whTxt+'</b> over '+rangeLabel()+' — about '+cmpText('energy',t.wh,1)+'.';
  }else{
    lead='Your AI use so far: <strong>'+whTxt+'</strong>.';
    sub='About '+cmpText('energy',t.wh,1)+'. '+
        '<button class="vd-link" id="vdBaseline">Set a baseline</button> to see what share of your year that is.';
  }

  /* direction of travel, when a previous period exists to compare against */
  var pv=prevTotals();
  if(pv && pv.wh>0.05 && t.wh>0.05){
    var pct=(t.wh-pv.wh)/pv.wh*100, lbl=prevLabel();
    var word=Math.abs(pct)<3?'about level with':(pct>0?'up '+num(Math.abs(pct),0)+'% on':'down '+num(Math.abs(pct),0)+'% on');
    sub+=' <span class="vd-trend">'+word+' '+lbl+'.</span>';
  }

  setHTML('#vdLead',lead);
  setHTML('#vdSub',sub);

  var b=$('#vdBaseline');
  if(b && !b.dataset.wired){
    b.dataset.wired='1';
    b.addEventListener('click',function(){
      var target=$('#life'); if(target) target.scrollIntoView({behavior:'smooth',block:'start'});
    });
  }
}

/* ---------- KPI cards ---------- */
function renderKPIs(list){
  var t=totals(list);
  var phones=t.wh/C_PHONE_WH, ledH=t.wh/C_LED_W, bottles=t.ml/C_BOTTLE_ML, miles=t.co2/C_MILE_G;
  var whTxt = t.wh>=1000? num(t.wh/1000,2)+' <span class="u">kWh</span>' : num(t.wh,1)+' <span class="u">Wh</span>';
  var mlTxt = t.ml>=1000? num(t.ml/1000,2)+' <span class="u">L</span>' : num(t.ml,0)+' <span class="u">mL</span>';
  var co2Txt= t.co2>=1000? num(t.co2/1000,2)+' <span class="u">kg</span>' : num(t.co2,0)+' <span class="u">g</span>';
  /* period-over-period delta chip (energy) — only when a previous period exists */
  var deltaHtml='';
  var pv=prevTotals();
  if(pv && (pv.wh>0.05 || t.wh>0.05)){
    var lbl=prevLabel();
    if(pv.wh<=0.05){ deltaHtml='<span class="delta flat" title="No usage '+lbl+'">new</span>'; }
    else{
      var pct=(t.wh-pv.wh)/pv.wh*100;
      var cls=Math.abs(pct)<3?'flat':(pct>0?'up':'down');
      var arrow=Math.abs(pct)<3?'≈':(pct>0?'▲':'▼');
      deltaHtml='<span class="delta '+cls+'" title="'+num(t.wh,1)+' Wh vs '+num(pv.wh,1)+' Wh '+lbl+'">'+arrow+' '+num(Math.abs(pct),0)+'% vs '+lbl+'</span>';
    }
  }
  var cards=[
    {k:'Energy',dot:'var(--teal)',motif:'energy',v:whTxt+deltaHtml,cmp:'≈ '+cmpText('energy',t.wh,2)},
    {k:'Water',dot:'var(--sky)',motif:'water',v:mlTxt,cmp:'≈ '+cmpText('water',t.ml,2)+'<span class="cmp-note">cooling + power generation</span>'},
    {k:'Carbon (est.)',dot:'var(--amber)',motif:'carbon',v:co2Txt,cmp:'≈ '+cmpText('carbon',t.co2,2)+'<span class="cmp-note">at '+num(rates.gridIntensity,0)+' g/kWh</span>'},
    {k:'Tokens',dot:'var(--violet)',v:fmtTok(t.tok)+' <span class="u">tok</span>',cmp:'across <b>'+num(t.n,0)+'</b> logged sessions'},
    {k:'Avg / session',dot:'var(--leaf)',v:(t.n?num(t.wh/t.n,1):'0')+' <span class="u">Wh</span>',cmp:'typical footprint of one AI working session'}
  ];
  var html=cards.map(function(c){
    return '<div class="kpi" style="--accent:'+c.dot+'">'+(c.motif?kpiMotif(c.motif,c.dot):'')+
           '<div class="k"><span class="dot" style="background:'+c.dot+';color:'+c.dot+'"></span>'+c.k+'</div>'+
           '<div class="v">'+c.v+'</div><div class="cmp">'+c.cmp+'</div></div>';
  }).join('');
  /* The grade card keeps the calm forest surface at every grade — only the
     letter and the progress bar carry the good/warn/bad tint. A poor grade
     should be legible, not the loudest thing on the page. */
  var g=computeGrade(list);
  html='<div class="kpi gradecard g-'+g.cls.slice(3)+'">'+
        '<div class="k"><span class="dot"></span>Usage grade</div>'+
        '<div class="gletter">'+g.letter+'</div><div class="gscore">'+g.score+' / 100 optimized</div>'+
        '<div class="gbar"><i style="width:'+g.score+'%"></i></div>'+
        '<div class="gwhy">'+g.why+'</div>'+
        (g.suspended ? '<div class="gsusp">'+g.suspended+' test suspended &mdash; see methodology</div>' : '')+
        '</div>' + html;
  setHTML('#kpis',html);
}

/* ---------- compact rollup chips (sticky header) ---------- */
function renderMini(list){
  var t=totals(list), g=computeGrade(list);
  var whTxt = t.wh>=1000? num(t.wh/1000,1)+'<small>kWh</small>' : num(t.wh,0)+'<small>Wh</small>';
  var mlTxt = t.ml>=1000? num(t.ml/1000,1)+'<small>L</small>' : num(t.ml,0)+'<small>mL</small>';
  var co2Txt= t.co2>=1000? num(t.co2/1000,1)+'<small>kg</small>' : num(t.co2,0)+'<small>g CO₂e</small>';
  var tokTxt= t.tok>=1e6? num(t.tok/1e6,1)+'<small>M</small>' : (t.tok>=1000? num(t.tok/1000,0)+'<small>k</small>' : num(t.tok,0));
  var avgTxt= (t.n? num(t.wh/t.n,1):'0')+'<small>Wh</small>';
  var chips=[['Energy',whTxt],['Water',mlTxt],['Carbon',co2Txt],['Tokens',tokTxt],['Avg / session',avgTxt]];
  var html=chips.map(function(c){return '<div class="mchip"><span class="ml">'+c[0]+'</span><span class="mv">'+c[1]+'</span></div>';}).join('');
  html+='<div class="mchip gradechip '+g.cls+'" title="Usage grade '+g.letter+' — '+esc(g.why)+'"><span class="ml">Grade</span><span class="mv">'+g.letter+'</span></div>';
  setHTML('#miniKpis',html);
}

/* ---------- rotating comparison examples ---------- */
var cmpTimer=null, CMP={};
var CMP_N = 5;                          /* examples offered per metric */
var CMP_KEYS = ['energy','water','carbon'];
var cmpPos = {energy:0, water:0, carbon:0};
var cmpHeld = false;                    /* reader took control */

/* "1 glasses of water" is the kind of detail that quietly undermines every
   other number on the page. Formats the value and agrees the noun with it. */
function plu(v,dp,one,many){
  var s=num(v,dp);
  return s+' '+(parseFloat(s)===1 ? one : (many||one+'s'));
}
function renderCompare(list){
  var t=totals(list);
  var e=$('#cbig-energy'); if(e) e.innerHTML = t.wh>=1000? num(t.wh/1000,2)+' kWh' : num(t.wh,1)+' Wh';
  var w=$('#cbig-water'); if(w) w.innerHTML = t.ml>=1000? num(t.ml/1000,2)+' L' : num(t.ml,0)+' mL';
  var c=$('#cbig-carbon'); if(c) c.innerHTML = t.co2>=1000? num(t.co2/1000,2)+' kg' : num(t.co2,0)+' g';
  /* The KPI card above prints ONE fixed anchor per metric; this panel offers
     several framings of the same number so the two read as complementary. */
  CMP.energy = pickAnchors('energy', t.wh,  CMP_N);
  CMP.water  = pickAnchors('water',  t.ml,  CMP_N);
  CMP.carbon = pickAnchors('carbon', t.co2, CMP_N);
  CMP_KEYS.forEach(buildTrack);
  wireCompare();
  if(!cmpTimer && !cmpHeld) cmpTimer = setInterval(cmpTick, 4200);
}

function cmpSlideHtml(x){
  var src = x.a.s
    ? '<button class="csrc" type="button" aria-label="Where this figure comes from" data-fig="'+esc(x.a.s)+'">i</button>'
    : '';
  return '<div class="cslide"><span class="cq">≈ '+anchorPhrase(x)+'</span>'+src+'</div>';
}

/* All the slides live side by side in a flex row, so the track is always as
   tall as the LONGEST phrase and the card cannot change height when the
   example changes. That was the jump: the old markup swapped text into one
   .cval with min-height:18px, and because .compare is a grid, one card
   wrapping to two lines grew the whole row. */
function buildTrack(k){
  var picks = CMP[k] || [], tr = $('#track-'+k), dots = $('#dots-'+k);
  if(!tr) return;
  tr.innerHTML = picks.map(cmpSlideHtml).join('');
  if(cmpPos[k] == null || cmpPos[k] >= picks.length) cmpPos[k] = 0;
  if(dots) dots.innerHTML = picks.map(function(_,i){
    return '<i class="'+(i===cmpPos[k]?'on':'')+'" data-i="'+i+'" role="button" tabindex="0"'+
           ' aria-label="Example '+(i+1)+' of '+picks.length+'"></i>';
  }).join('');
  cmpGo(k, cmpPos[k], false);
}

function cmpGo(k, i, smooth){
  var tr=$('#track-'+k), n=(CMP[k]||[]).length;
  if(!tr || !n) return;
  i = ((i % n) + n) % n;
  cmpPos[k] = i;
  var left = i * tr.clientWidth;
  if(tr.scrollTo) tr.scrollTo({left:left, behavior: smooth ? 'smooth' : 'auto'});
  else tr.scrollLeft = left;
  cmpPaintDots(k);
  cmpSyncNav(k);
}

function cmpPaintDots(k){
  var dots=$('#dots-'+k); if(!dots) return;
  Array.prototype.forEach.call(dots.children, function(d,i){
    d.className = (i===cmpPos[k] ? 'on' : '');
  });
}

/* One example means nothing to step through, so the controls go away rather
   than sit there dead. */
function cmpSyncNav(k){
  var wrap=$('.cx-'+k); if(!wrap) return;
  var n=(CMP[k]||[]).length, only = n<2;
  var nav=wrap.querySelector('.cnav');
  if(nav) nav.style.visibility = only ? 'hidden' : 'visible';
  var prev=wrap.querySelector('.cprev'), next=wrap.querySelector('.cnext');
  if(prev) prev.disabled = only;
  if(next) next.disabled = only;
}

function cmpTick(){
  if(cmpHeld || document.hidden) return;
  CMP_KEYS.forEach(function(k){
    if((CMP[k]||[]).length > 1) cmpGo(k, cmpPos[k]+1, true);
  });
}

/* The moment the reader takes control, stop moving things under their finger.
   Deliberately permanent for the session: an auto-cycle that resumes after a
   timeout steals the card back just as someone starts reading it. */
function cmpHold(){
  cmpHeld = true;
  if(cmpTimer){ clearInterval(cmpTimer); cmpTimer = null; }
}

function cmpShowSrc(cx, btn){
  var fig = btn.getAttribute('data-fig') || '';
  var box = cx.querySelector('.csrcbox');
  if(!box){ box = document.createElement('div'); box.className = 'csrcbox'; cx.appendChild(box); }
  var alreadyOpen = box.classList.contains('on') && box.getAttribute('data-for') === fig;
  $$('.csrcbox.on').forEach(function(b){ b.classList.remove('on'); });
  if(alreadyOpen) return;
  var parts = fig.split('·');
  box.innerHTML = '<span class="sfig">'+esc(parts[0].trim())+'</span>' +
    (parts.length>1 ? '<span class="ssrc">'+esc(parts.slice(1).join('·').trim())+'</span>' : '');
  box.setAttribute('data-for', fig);
  box.classList.add('on');
}

var cmpWired = false;
function wireCompare(){
  if(cmpWired) return;
  var strip = $('#compareStrip'); if(!strip) return;
  cmpWired = true;

  function keyOf(el){
    var cx = el.closest ? el.closest('.cx') : null;
    if(!cx) return null;
    var m = cx.className.match(/cx-(energy|water|carbon)/);
    return m ? {k:m[1], cx:cx} : null;
  }

  strip.addEventListener('click', function(ev){
    var b = ev.target.closest && ev.target.closest('.cprev,.cnext,.csrc,.cdots > i');
    if(!b) return;
    var hit = keyOf(b); if(!hit) return;
    if(b.classList.contains('csrc')){ cmpShowSrc(hit.cx, b); return; }
    cmpHold();
    if(b.classList.contains('cprev'))      cmpGo(hit.k, cmpPos[hit.k]-1, true);
    else if(b.classList.contains('cnext')) cmpGo(hit.k, cmpPos[hit.k]+1, true);
    else                                   cmpGo(hit.k, +b.getAttribute('data-i'), true);
  });

  /* dots are focusable, so they answer to the keyboard too */
  strip.addEventListener('keydown', function(ev){
    if(ev.key!=='Enter' && ev.key!==' ') return;
    var t = ev.target;
    if(!t.getAttribute || t.getAttribute('data-i')===null) return;
    var hit = keyOf(t); if(!hit) return;
    ev.preventDefault(); cmpHold();
    cmpGo(hit.k, +t.getAttribute('data-i'), true);
  });

  /* close a source popover on any unrelated click */
  document.addEventListener('click', function(ev){
    if(ev.target.closest && ev.target.closest('.csrc,.csrcbox')) return;
    $$('.csrcbox.on').forEach(function(b){ b.classList.remove('on'); });
  });

  CMP_KEYS.forEach(function(k){
    var tr = $('#track-'+k); if(!tr) return;
    var t = null;
    /* a swipe moves scrollLeft without going through cmpGo, so read the
       resting position back and resync the dots */
    tr.addEventListener('scroll', function(){
      if(t) clearTimeout(t);
      t = setTimeout(function(){
        var w = tr.clientWidth || 1, i = Math.round(tr.scrollLeft / w);
        if(i !== cmpPos[k]){ cmpPos[k] = i; cmpPaintDots(k); cmpHold(); }
      }, 90);
    }, {passive:true});
    tr.addEventListener('keydown', function(ev){
      if(ev.key==='ArrowRight'){ ev.preventDefault(); cmpHold(); cmpGo(k, cmpPos[k]+1, true); }
      else if(ev.key==='ArrowLeft'){ ev.preventDefault(); cmpHold(); cmpGo(k, cmpPos[k]-1, true); }
    });
    tr.addEventListener('pointerdown', cmpHold);
  });

  /* slide width is a percentage of the track, so a resize invalidates every
     scroll offset; re-snap without animating */
  var rt = null;
  window.addEventListener('resize', function(){
    if(rt) clearTimeout(rt);
    rt = setTimeout(function(){ CMP_KEYS.forEach(function(k){ cmpGo(k, cmpPos[k], false); }); }, 120);
  });
}

/* Charts are drawn in viewBox units and scaled to the panel, so on a phone a
   9-unit label lands at ~4px. Narrowing the viewBox on narrow hosts keeps the
   rendered type at a readable size without a second set of font rules. */
function chartUnits(host){ return (host && host.clientWidth && host.clientWidth<430) ? 380 : 640; }

/* Round a max up to the next 1/2/2.5/5 × 10^n so axis ticks divide evenly
   into four readable steps. */
function niceCeil(v){
  if(!(v>0)) return 1;
  var mag=Math.pow(10,Math.floor(Math.log(v)/Math.LN10)), f=v/mag;
  var step = f<=1?1 : f<=2?2 : f<=2.5?2.5 : f<=5?5 : 10;
  return step*mag;
}

/* ---------- cumulative area chart (SVG) ---------- */
function renderCumulative(list){
  var host=$('#cumChart'); if(!host)return;
  var pts=list.slice().sort(function(a,b){return parseDate(a.timestamp)-parseDate(b.timestamp);});
  if(!pts.length){ host.innerHTML='<div class="empty">No data in this view.</div>'; setText('#cumHint',''); return; }
  /* 300 units made this the tallest thing in the Trends row by a wide margin
     and left the panel beside it looking stranded. 240 still reads clearly
     and brings the two panels close to the same height. */
  var W=chartUnits(host),H=W<500?200:260,padL=46,padR=14,padT=16,padB=30;
  var t0=parseDate(pts[0].timestamp).getTime(), t1=parseDate(pts[pts.length-1].timestamp).getTime();
  if(t1===t0)t1=t0+1;
  var cum=0, series=pts.map(function(e){ cum+=+e.energy_wh||0; return {t:parseDate(e.timestamp).getTime(),y:cum}; });
  /* Round the axis up to a friendly step so the ticks read 0/50/100/150/200
     rather than 0/38/76/114/152. The line then stops short of the top edge,
     which also gives the stroke somewhere to breathe. */
  var maxY=niceCeil(cum||1);
  var X=function(t){return padL+(t-t0)/(t1-t0)*(W-padL-padR);};
  var Y=function(y){return H-padB-(y/maxY)*(H-padT-padB);};
  var line=series.map(function(p,i){return (i?'L':'M')+X(p.t).toFixed(1)+' '+Y(p.y).toFixed(1);}).join(' ');
  var area=line+' L'+X(series[series.length-1].t).toFixed(1)+' '+Y(0)+' L'+X(series[0].t).toFixed(1)+' '+Y(0)+' Z';
  var grid='';
  /* one decimal only when the tick step genuinely needs it, so the zero tick
     prints "0" rather than "0.0" */
  var tickDp = (maxY/4) < 10 ? 1 : 0;
  for(var g=0;g<=4;g++){ var yy=padT+(H-padT-padB)*g/4; var val=maxY*(1-g/4);
    grid+='<line x1="'+padL+'" y1="'+yy+'" x2="'+(W-padR)+'" y2="'+yy+'" stroke="var(--line-soft)"/>'+
          '<text x="'+(padL-8)+'" y="'+(yy+3)+'" text-anchor="end" fill="var(--mut)" font-size="9" font-family="var(--mono)">'+num(val,val===0?0:tickDp)+'</text>'; }
  /* a dot on the final point so the area's right edge reads as an endpoint
     rather than as a clipped chart */
  var last=series[series.length-1];
  var endCap='<circle cx="'+X(last.t).toFixed(1)+'" cy="'+Y(last.y).toFixed(1)+'" r="3.4" fill="var(--panel)" stroke="var(--teal)" stroke-width="2.2"/>';
  var svg='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Cumulative energy over time">'+
    '<defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1">'+
    '<stop offset="0" stop-color="var(--teal)" stop-opacity=".45"/><stop offset="1" stop-color="var(--teal)" stop-opacity="0"/></linearGradient></defs>'+
    grid+'<path d="'+area+'" fill="url(#ag)"/>'+'<path d="'+line+'" pathLength="1" fill="none" stroke="var(--teal)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'+endCap+
    '<text x="'+padL+'" y="'+(H-8)+'" fill="var(--mut2)" font-size="9" font-family="var(--mono)">'+fmtDateShort(pts[0].timestamp)+'</text>'+
    '<text x="'+(W-padR)+'" y="'+(H-8)+'" text-anchor="end" fill="var(--mut2)" font-size="9" font-family="var(--mono)">'+fmtDateShort(pts[pts.length-1].timestamp)+'</text>'+
    '</svg>';
  host.innerHTML=svg;
  setText('#cumHint',num(cum,1)+' Wh total');
}

/* ---------- by project \u2014 one compact ranked row each ----------
   Single-line rows keep this panel the same height as the chart beside it,
   and the metric toggle lets the same ranking be read as energy, water,
   carbon or plain session count. */
var projBarsExpanded=false;
var projMetric='wh';
/* 6, not 8: with a real log the ranked list ran ~164px taller than the
   chart beside it, and a 'top N' list is more scannable at six anyway.
   The rest stay one click away behind the 'N more' toggle. */
var PROJ_CAP=6;

function renderProjectBars(list){
  var host=$('#projBars'); if(!host)return;
  var M=PROJ_METRICS[projMetric]||PROJ_METRICS.wh;
  var agg=aggFull(list,function(e){return e.project;})
            .sort(function(a,b){return b[M.key]-a[M.key];});

  $$('#projMetric button').forEach(function(b){ b.classList.toggle('on', b.dataset.metric===projMetric); });

  if(!agg.length){
    host.innerHTML='<div class="empty">No data in this view.</div>';
    setHTML('#projSub','Where your footprint concentrates<span class="click-hint"> \u2014 click a row to drill down</span>.');
    return;
  }

  var total=agg.reduce(function(s,a){return s+a[M.key];},0)||1;
  var max=agg[0][M.key]||1;
  var showAll = projBarsExpanded || agg.length<=PROJ_CAP+2;
  var shown = showAll? agg : agg.slice(0,PROJ_CAP);

  var rows=shown.map(function(a,i){
    var v=a[M.key], sel=state.project===a.key?' sel':'';
    var col=colorForRank(i,shown.length);
    var pct=v/total*100;
    return '<div class="prow'+sel+'" data-proj="'+esc(a.key)+'" role="button" tabindex="0" '+
      'aria-pressed="'+(sel?'true':'false')+'" '+
      'title="'+esc(a.key)+' \u2014 '+M.fmt(v)+' \u00b7 '+num(pct,1)+'% of '+M.low+' \u00b7 '+a.n+' session'+(a.n===1?'':'s')+'">'+
      '<span class="rk">'+(i+1)+'</span>'+
      '<span class="pn">'+esc(a.key)+'</span>'+
      '<span class="track"><span class="fill" style="width:'+Math.max(2,v/max*100)+'%;background:linear-gradient(90deg,'+col+','+col+'cc)"></span></span>'+
      '<span class="pv">'+M.fmt(v)+'<span class="pc">'+num(pct,0)+'%</span></span>'+
      '</div>';
  }).join('');

  var hiddenN=agg.length-shown.length;
  var foot='<div class="pbar-foot">'+
    '<span><b>'+agg.length+'</b> project'+(agg.length===1?'':'s')+' \u00b7 top one is <b>'+num(agg[0][M.key]/total*100,0)+'%</b> of '+M.low+'</span>'+
    (hiddenN>0 || projBarsExpanded
      ? '<button class="btn tiny morebtn" id="projMore">'+
        (projBarsExpanded? '\u2191 Top '+PROJ_CAP+' only' : '\u2193 '+hiddenN+' more')+'</button>'
      : '')+
    '</div>';

  host.innerHTML=rows+foot;
  setHTML('#projSub','Ranked by '+M.low+'<span class="click-hint"> \u2014 click a row to drill into that project</span>.');

  function pick(el){
    var p=el.getAttribute('data-proj');
    state.project = (state.project===p)?'__all':p;
    var ps=$('#projSel'); if(ps) ps.value = state.project;
    render();
    if(state.project!=='__all'){ var d=$('#drill'); if(d) d.scrollIntoView({behavior:'smooth',block:'center'}); }
  }
  $$('.prow',host).forEach(function(el){
    el.addEventListener('click',function(){ pick(el); });
    el.addEventListener('keydown',function(ev){
      if(ev.key==='Enter'||ev.key===' '){ ev.preventDefault(); pick(el); }
    });
  });
  on('#projMore','click',function(){ projBarsExpanded=!projBarsExpanded; renderProjectBars(filtered()); });
}

/* ---------- per-session bar chart, with dates and a detail strip ----------
   Bars sit in date order (one per session, not one per day), so the axis
   labels are drawn at the bars they actually belong to rather than on a
   linear time scale that would lie about spacing. The heaviest sessions
   are marked, and clicking any bar shows what that session was. */
var tsSel=null;                                     /* selected session key */
function sessKey(e){ return e.timestamp+'|'+(e.context||'').slice(0,40); }

function renderSessions(list){
  var host=$('#tsChart'); if(!host)return;
  var pts=list.slice().sort(function(a,b){return parseDate(a.timestamp)-parseDate(b.timestamp);});
  if(!pts.length){
    host.innerHTML='<div class="empty">No data in this view.</div>';
    setText('#tsHint',''); renderSessionDetail(null); return;
  }

  var W=chartUnits(host),H=W<500?168:216,padT=18,padB=34,padL=6,padR=6;
  var plotH=H-padT-padB;
  var max=Math.max.apply(null,pts.map(function(e){return +e.energy_wh||0;}))||1;
  var n=pts.length, step=(W-padL-padR)/n, gap=n>90?0.6:(n>40?1.2:2.4);
  var bw=Math.max(1,step-gap);

  /* the three heaviest sessions get a marker so peaks are findable */
  var heavy={};
  pts.slice().sort(function(a,b){return (+b.energy_wh||0)-(+a.energy_wh||0);})
     .slice(0,3).forEach(function(e){ heavy[sessKey(e)]=1; });

  var bars='',marks='';
  pts.forEach(function(e,i){
    var wh=+e.energy_wh||0;
    var h=Math.max(wh>0?1:0, wh/max*plotH);
    var x=padL+i*step, y=H-padB-h;
    var k=sessKey(e), isSel=(tsSel===k);
    bars+='<rect class="bar'+(isSel?' sel':'')+'" data-k="'+esc(k)+'" data-i="'+i+'" '+
      'x="'+x.toFixed(1)+'" y="'+y.toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+h.toFixed(1)+'" rx="1.6" '+
      'fill="'+MODEL_COL[modelKey(e.model)]+'" style="animation-delay:'+Math.min(i*8,600)+'ms">'+
      '<title>'+fmtDateShort(e.timestamp)+' · '+esc(e.project)+' · '+num(wh,1)+' Wh</title></rect>';
    if(heavy[k]){
      marks+='<circle cx="'+(x+bw/2).toFixed(1)+'" cy="'+(y-6).toFixed(1)+'" r="2.2" fill="var(--ink-soft)" opacity=".55"/>';
    }
  });

  /* date ticks: up to 6 labels, placed at the bar whose date they name,
     de-duplicated so a busy day doesn't print the same label twice */
  var want=Math.min(W<500?3:6,n), ticks='', lastLabel='';
  for(var q=0;q<want;q++){
    var idx=want===1?0:Math.round(q*(n-1)/(want-1));
    var lab=fmtDateShort(pts[idx].timestamp);
    if(lab===lastLabel) continue;
    lastLabel=lab;
    var tx=padL+idx*step+bw/2;
    var anchor=q===0?'start':(q===want-1?'end':'middle');
    var lx=q===0?padL:(q===want-1?W-padR:tx);
    ticks+='<line x1="'+tx.toFixed(1)+'" y1="'+(H-padB)+'" x2="'+tx.toFixed(1)+'" y2="'+(H-padB+4)+'" stroke="var(--line)"/>'+
      '<text x="'+lx.toFixed(1)+'" y="'+(H-padB+16)+'" text-anchor="'+anchor+'" fill="var(--mut2)" font-size="9" font-family="var(--mono)">'+lab+'</text>';
  }

  host.innerHTML='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Energy per session over time">'+
    bars+marks+
    '<line x1="'+padL+'" y1="'+(H-padB)+'" x2="'+(W-padR)+'" y2="'+(H-padB)+'" stroke="var(--line)"/>'+
    ticks+
    '<text x="'+padL+'" y="'+(H-6)+'" fill="var(--mut2)" font-size="8.5" font-family="var(--mono)">'+n+' sessions in date order, evenly spaced · ● marks the 3 heaviest</text>'+
    '</svg>';

  setText('#tsHint','peak '+num(max,1)+' Wh');

  /* keep any selection that still exists in this view, else fall back to the peak */
  var byKey={}; pts.forEach(function(e){ byKey[sessKey(e)]=e; });
  var current = (tsSel && byKey[tsSel]) ? byKey[tsSel] : null;
  renderSessionDetail(current, current? null : pts.slice().sort(function(a,b){return (+b.energy_wh||0)-(+a.energy_wh||0);})[0]);

  $$('#tsChart rect.bar').forEach(function(r){
    r.addEventListener('click',function(){
      var k=r.getAttribute('data-k');
      tsSel = (tsSel===k)? null : k;
      renderSessions(filtered());
    });
  });
}

/* The strip under the chart: what that session actually was.
   With nothing selected it shows the heaviest session in view, so the
   panel answers "what was my biggest day" without a click. */
function renderSessionDetail(sel,fallback){
  var host=$('#tsDetail'); if(!host)return;
  var e=sel||fallback;
  if(!e){ host.innerHTML='<div class="td-empty">No sessions in this view.</div>'; return; }
  var mk=modelKey(e.model);
  host.innerHTML=
    '<div class="td-h">'+
      '<span class="td-d">'+(sel?'Selected':'Heaviest session')+' · '+fmtDate(e.timestamp)+'</span>'+
      '<span class="td-p"><span class="td-sw" style="background:'+MODEL_COL[mk]+'"></span> '+esc(e.project)+'</span>'+
      '<span class="td-n">'+num(e.energy_wh,1)+' Wh · '+num(e.water_ml,0)+' mL · '+fmtTok(e.total_tokens)+' tok</span>'+
    '</div>'+
    '<div class="td-c">'+(e.context? esc(e.context) : '<span class="td-empty">No context recorded for this session.</span>')+'</div>'+
    (sel? '' : '<div class="td-d click-hint" style="margin-top:6px">Click any bar to inspect a different session</div>');
}

/* ---------- model donut (click a slice or legend row to filter) ---------- */
function renderModelDonut(list){
  var host=$('#modelDonut'), leg=$('#modelLegend'); if(!host||!leg)return;
  var m={}; list.forEach(function(e){ var k=modelKey(e.model); m[k]=(m[k]||0)+(+e.energy_wh||0); });
  var keys=Object.keys(m).filter(function(k){return m[k]>0;}).sort(function(a,b){return m[b]-m[a];});
  var tot=keys.reduce(function(s,k){return s+m[k];},0);
  if(!tot){host.innerHTML='<div class="empty">No data.</div>';leg.innerHTML='';return;}
  var cx=90,cy=90,r=64,sw=26,C=2*Math.PI*r, off=0;
  var arcs=keys.map(function(k){
    var frac=m[k]/tot, len=frac*C, sel=(state.model===k)?' class="sel"':'';
    var seg='<circle'+sel+' data-mk="'+k+'" cx="'+cx+'" cy="'+cy+'" r="'+r+'" fill="none" stroke="'+MODEL_COL[k]+'" stroke-width="'+sw+'" '+
      'stroke-dasharray="'+len.toFixed(2)+' '+(C-len).toFixed(2)+'" stroke-dashoffset="'+(-off).toFixed(2)+'" transform="rotate(-90 '+cx+' '+cy+')"><title>'+(rates.models[k]?rates.models[k].label:k)+' '+Math.round(frac*100)+'% — click to filter</title></circle>';
    off+=len; return seg;
  }).join('');
  host.classList.toggle('hasSel', state.model!=='__all');
  host.innerHTML='<svg viewBox="0 0 180 180" style="max-width:210px;margin:0 auto">'+arcs+
    '<text x="90" y="86" text-anchor="middle" fill="var(--ink)" font-size="20" font-weight="700" font-family="var(--mono)">'+(tot>=1000?num(tot/1000,1)+'k':num(tot,0))+'</text>'+
    '<text x="90" y="104" text-anchor="middle" fill="var(--mut)" font-size="9" font-family="var(--mono)">Wh total</text></svg>';
  leg.innerHTML=keys.map(function(k){
    return '<div class="li'+(state.model===k?' sel':'')+'" data-mk="'+k+'" title="Click to filter by this model"><span class="sw" style="background:'+MODEL_COL[k]+'"></span>'+(rates.models[k]?rates.models[k].label:k)+'<span class="n">'+num(m[k],1)+' Wh · '+Math.round(m[k]/tot*100)+'%</span></div>';
  }).join('');
  function toggleModel(k){
    state.model = (state.model===k)?'__all':k;
    var ms=$('#modelSel'); if(ms) ms.value=state.model;
    render();
  }
  $$('[data-mk]',host).concat($$('[data-mk]',leg)).forEach(function(el){
    el.addEventListener('click',function(){ toggleModel(el.getAttribute('data-mk')); });
  });
}

/* ---------- efficiency trend: Wh per million tokens over time ---------- */
function renderEfficiency(list){
  var host=$('#effChart'); if(!host)return;
  var pts=effSeries(list,5);
  if(pts.length<2){
    host.innerHTML='<div class="empty">Needs at least two sessions with token counts in this view.</div>';
    setText('#effHint',''); return;
  }
  var W=chartUnits(host),H=W<500?176:220,padL=48,padR=14,padT=14,padB=28;
  var maxR=Math.max.apply(null,pts.map(function(p){return p.r;}))||1;
  var t0=pts[0].t, t1=pts[pts.length-1].t; if(t1===t0)t1=t0+1;
  var X=function(t){return padL+(t-t0)/(t1-t0)*(W-padL-padR);};
  var Y=function(r){return H-padB-(r/maxR)*(H-padT-padB);};

  var grid='';
  for(var g=0;g<=4;g++){ var yy=padT+(H-padT-padB)*g/4, val=maxR*(1-g/4);
    grid+='<line x1="'+padL+'" y1="'+yy+'" x2="'+(W-padR)+'" y2="'+yy+'" stroke="var(--line-soft)"/>'+
      '<text x="'+(padL-6)+'" y="'+(yy+3)+'" text-anchor="end" fill="var(--mut2)" font-size="9" font-family="var(--mono)">'+num(val,0)+'</text>'; }

  var dots=pts.map(function(p){
    return '<circle cx="'+X(p.t).toFixed(1)+'" cy="'+Y(p.r).toFixed(1)+'" r="3.2" fill="'+MODEL_COL[p.mk]+'" opacity=".88" style="animation-delay:'+Math.min(280+p.i*9,900)+'ms">'+
      '<title>'+esc(p.e.project)+' · '+fmtDateShort(p.e.timestamp)+' · '+num(p.r,0)+' Wh per M tokens ('+esc(p.e.model)+')</title></circle>';
  }).join('');
  var roll=pts.map(function(p,i){return (i?'L':'M')+X(p.t).toFixed(1)+' '+Y(p.roll).toFixed(1);}).join(' ');

  host.innerHTML='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Energy per million tokens over time">'+
    grid+'<path d="'+roll+'" pathLength="1" fill="none" stroke="var(--leaf)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'+dots+
    '<text x="'+padL+'" y="'+(H-8)+'" fill="var(--mut2)" font-size="9" font-family="var(--mono)">'+fmtDateShort(pts[0].e.timestamp)+'</text>'+
    '<text x="'+(W-padR)+'" y="'+(H-8)+'" text-anchor="end" fill="var(--mut2)" font-size="9" font-family="var(--mono)">'+fmtDateShort(pts[pts.length-1].e.timestamp)+'</text>'+
    '</svg>';

  var overall=effRateOf(list);
  var half=Math.floor(pts.length/2);
  var avg=function(a){return a.reduce(function(s,p){return s+p.r;},0)/(a.length||1);};
  var ea=avg(pts.slice(0,half)), la=avg(pts.slice(half)), dir='';
  if(ea>0){ var ch=(la-ea)/ea*100;
    dir = Math.abs(ch)<5 ? ' · holding steady'
        : (ch<0 ? ' · <span class="down">▼ '+num(-ch,0)+'% leaner</span> than earlier'
                : ' · <span class="up">▲ '+num(ch,0)+'% heavier</span> than earlier'); }
  setHTML('#effHint',num(overall,0)+' Wh per M tokens overall'+dir);
}

/* ---------- right-sizing + context-split coverage ---------- */
function renderContextCost(list){
  var host=$('#ctxBody'); if(!host)return;
  var rs=rightSizing(list), sp=splitStats(list), bl=blendedCount(list);
  var cards='';

  cards+='<div class="cx-card"><div class="cxk">Right-sizing</div>'+
    (rs.n
      ? '<div class="cxv">'+num(rs.saved,1)+' <span class="u">Wh</span></div>'+
        '<div class="cxd"><b>'+rs.n+'</b> small session'+(rs.n===1?'':'s')+' (under '+fmtTok(rs.threshold)+' tokens) ran on a heavier model. '+
        'A lighter one would have used about '+num(rs.alt,1)+' Wh instead of '+num(rs.actual,1)+' Wh'+
        (rs.topProject?' — most of it in <b>'+esc(rs.topProject)+'</b>':'')+'.</div>'
      : '<div class="cxv ok">✓</div><div class="cxd">No small sessions on oversized models in this view — model choice already matches the work.</div>')+
    '</div>';

  cards+='<div class="cx-card"><div class="cxk">Context vs. generation</div>'+
    (sp.n
      ? '<div class="cxv">'+num(sp.inWh/(sp.inWh+sp.outWh||1)*100,0)+'<span class="u">% context</span></div>'+
        '<div class="cxd">Across '+sp.n+' of '+sp.total+' sessions carrying a real token split: '+
        fmtTok(sp.inTok)+' in ('+num(sp.inWh,1)+' Wh) vs '+fmtTok(sp.outTok)+' out ('+num(sp.outWh,1)+' Wh). '+
        'A high context share means you are paying to re-send material rather than to generate new work.</div>'
      : '<div class="cxv pending">—</div><div class="cxd"><b>Not measurable yet.</b> None of these '+sp.total+' sessions record '+
        '<span class="mono">input_tokens</span> / <span class="mono">output_tokens</span> separately, and back-solving the split from total energy '+
        'gives nonsense for any entry costed with a blended rate. The tracker skill now logs both fields, so this fills in as new sessions land.</div>')+
    '</div>';

  if(bl){
    cards+='<div class="cx-card warn"><div class="cxk">Estimate quality</div>'+
      '<div class="cxv">'+bl+' <span class="u">of '+list.length+'</span></div>'+
      '<div class="cxd">sessions were costed with a <b>blended</b> rate rather than a real input/output split. '+
      'The blended constants sit close to the pure <i>output</i> rate, so those entries read <b>high</b> — a ceiling, not a measurement.</div></div>';
  }
  host.innerHTML=cards;
}

/* ---------- drill-down panel ---------- */
function renderDrill(list){
  var d=$('#drill'); if(!d)return;
  if(state.project==='__all'){ d.classList.add('hidden'); d.innerHTML=''; return; }
  d.classList.remove('hidden');
  var t=totals(list);
  var first=list.slice().sort(function(a,b){return parseDate(a.timestamp)-parseDate(b.timestamp);});
  var span = first.length? (fmtDate(first[0].timestamp)+' → '+fmtDate(first[first.length-1].timestamp)) : '—';
  var topSessions=list.slice().sort(function(a,b){return (+b.energy_wh||0)-(+a.energy_wh||0);}).slice(0,3);
  d.innerHTML=
    '<div class="dh"><h2>🔎 '+esc(state.project)+'</h2>'+
      '<button class="btn" id="clearProj">✕ Clear project filter</button></div>'+
    '<div class="mini">'+
      '<div class="m"><div class="k">Energy</div><div class="v">'+num(t.wh,1)+' <span class="u" style="font-size:12px;color:var(--mut)">Wh</span></div></div>'+
      '<div class="m"><div class="k">Water</div><div class="v">'+num(t.ml,0)+' <span class="u" style="font-size:12px;color:var(--mut)">mL</span></div></div>'+
      '<div class="m"><div class="k">Carbon</div><div class="v">'+num(t.co2,0)+' <span class="u" style="font-size:12px;color:var(--mut)">g</span></div></div>'+
      '<div class="m"><div class="k">Sessions</div><div class="v">'+num(t.n,0)+'</div></div>'+
      '<div class="m"><div class="k">Tokens</div><div class="v">'+(t.tok>=1e6?num(t.tok/1e6,1)+'M':num(t.tok,0))+'</div></div>'+
      '<div class="m"><div class="k">Share of all energy</div><div class="v">'+pctOfAll(t.wh)+'%</div></div>'+
    '</div>'+
    '<div class="small mut" style="margin:4px 2px 12px">Active '+span+'</div>'+
    '<div class="cols">'+
      '<div><div class="colhead">Model mix in this project</div>'+modelRows(list)+'</div>'+
      '<div><div class="colhead">Heaviest sessions</div>'+
      topSessions.map(function(e){return '<div class="src" style="display:flex;justify-content:space-between;gap:12px"><span class="ctx">'+fmtDateShort(e.timestamp)+' — '+esc(e.context)+'</span><span class="mono" style="color:var(--leaf);white-space:nowrap">'+num(e.energy_wh,1)+' Wh</span></div>';}).join('')+
      '</div>'+
    '</div>';
  on('#clearProj','click',function(){ state.project='__all'; var ps=$('#projSel'); if(ps) ps.value='__all'; render(); });
}
/* per-model energy rows used inside the drill panel */
function modelRows(list){
  var m={}; list.forEach(function(e){ var k=modelKey(e.model); m[k]=(m[k]||0)+(+e.energy_wh||0); });
  var keys=Object.keys(m).filter(function(k){return m[k]>0;}).sort(function(a,b){return m[b]-m[a];});
  var tot=keys.reduce(function(s,k){return s+m[k];},0)||1;
  var max=keys.length?m[keys[0]]:1;
  if(!keys.length) return '<div class="empty">No data.</div>';
  return keys.map(function(k){
    return '<div class="dm"><span class="dml"><span class="sw" style="background:'+MODEL_COL[k]+'"></span>'+(rates.models[k]?rates.models[k].label:k)+'</span>'+
      '<div class="track"><div class="fill" style="width:'+Math.max(2,m[k]/max*100)+'%;background:'+MODEL_COL[k]+'"></div></div>'+
      '<span class="dmn">'+num(m[k],1)+' Wh · '+Math.round(m[k]/tot*100)+'%</span></div>';
  }).join('');
}

/* ---------- sessions table ---------- */
function renderTable(list){
  var tb=$('#tbody'); if(!tb)return;
  var rows=list.slice().sort(function(a,b){
    var k=state.sort, av=a[k], bv=b[k];
    if(k==='timestamp'){av=parseDate(a.timestamp);bv=parseDate(b.timestamp);}
    if(k==='co2'){av=co2g(+a.energy_wh||0);bv=co2g(+b.energy_wh||0);}
    if(typeof av==='string'){return state.dir*av.localeCompare(bv);}
    return state.dir*((av||0)-(bv||0));
  });
  tb.innerHTML=rows.map(function(e){
    return '<tr><td>'+fmtDateShort(e.timestamp)+'</td>'+
      '<td><span class="tag">'+esc(e.project)+'</span></td>'+
      '<td class="mono small">'+esc(e.model)+'</td>'+
      '<td class="num">'+num(e.total_tokens,0)+'</td>'+
      '<td class="num">'+num(e.energy_wh,1)+'</td>'+
      '<td class="num">'+num(e.water_ml,1)+'</td>'+
      '<td class="num">'+num(co2g(+e.energy_wh||0),1)+'</td>'+
      '<td class="ctx small">'+esc(e.context)+'</td></tr>';
  }).join('') || '<tr><td colspan="8" class="empty">No sessions match the current filters.</td></tr>';
  setText('#rowCount',rows.length+' rows');
}

/* ---------- mitigation checklist ---------- */
function renderMitigation(){
  var host=$('#mitCats'); if(!host)return;
  var total=0, done=0;
  host.innerHTML=MIT.map(function(cat){
    return '<div class="mcat"><h4><span class="ci" style="background:'+cat.bg+'">'+cat.icon+'</span>'+cat.title+'</h4>'+
      '<div class="cd">'+cat.desc+'</div>'+
      cat.acts.map(function(a){
        total++; var on_=!!checks[a.id]; if(on_)done++;
        return '<label class="act'+(on_?' done':'')+'" data-act="'+a.id+'"><input type="checkbox" '+(on_?'checked':'')+' data-cb="'+a.id+'">'+
          '<span><span class="a-t">'+a.t+'</span><br><span class="a-i">'+a.i+'</span></span></label>';
      }).join('')+'</div>';
  }).join('');
  $$('[data-cb]',host).forEach(function(cb){
    cb.addEventListener('change',function(){ checks[cb.getAttribute('data-cb')]=cb.checked; save(LS_CHECKS,checks); renderMitigation(); renderKPIs(filtered()); renderMini(filtered()); });
  });
  var pct=total?Math.round(done/total*100):0;
  var bar=$('#mitProg'); if(bar)bar.style.width=pct+'%';
  setText('#mitProgTxt',done+' / '+total+' committed ('+pct+'%)');
}

/* ---------- methodology (editable) ---------- */
function renderMethodology(){
  var rr=$('#rateRows'); if(!rr)return;
  var mk=Object.keys(rates.models);
  rr.innerHTML=mk.map(function(k){ var m=rates.models[k];
    return '<tr><td>'+esc(m.label)+'</td>'+
      '<td class="num"><input class="rate" data-m="'+k+'" data-f="inp" value="'+m.inp+'"></td>'+
      '<td class="num"><input class="rate" data-m="'+k+'" data-f="out" value="'+m.out+'"></td>'+
      '<td class="num"><input class="rate" data-m="'+k+'" data-f="bl" value="'+m.bl+'"></td></tr>';
  }).join('');
  setHTML('#factorRows',
    '<tr><td>Water factor (mL per Wh)</td><td class="num"><input class="rate" data-factor="waterFactor" value="'+rates.waterFactor+'"></td></tr>'+
    '<tr><td>Grid carbon intensity (g CO₂e / kWh)</td><td class="num"><input class="rate" data-factor="gridIntensity" value="'+rates.gridIntensity+'"></td></tr>'+
    '<tr><td>Skill load cost (tokens / display)</td><td class="num mono">'+num(CONFIG.skillLoadTokens,0)+'</td></tr>');
  setHTML('#methNote','At <b>'+num(rates.gridIntensity,0)+' g/kWh</b>, <b>1 kWh</b> of AI energy ≈ <b>'+num(rates.gridIntensity,0)+' g CO₂e</b> ≈ <b>'+num(rates.gridIntensity/C_MILE_G,1)+' car-miles</b>. Lower this value if your provider runs on cleaner energy.');
  $$('.rate').forEach(function(inp){
    inp.addEventListener('change',function(){
      var v=parseFloat(inp.value); if(isNaN(v))return;
      if(inp.dataset.factor){ rates[inp.dataset.factor]=v; }
      else { rates.models[inp.dataset.m][inp.dataset.f]=v; }
      save(LS_RATES,rates); render(); renderMethodology();
    });
  });
}

/* ---------- filter selects ---------- */
function fillSelects(){
  var ps=$('#projSel'), ms=$('#modelSel'); if(!ps||!ms)return;
  var projs=Array.from(new Set(DATA.map(function(e){return e.project;}))).filter(Boolean).sort();
  ps.innerHTML='<option value="__all">All projects</option>'+projs.map(function(p){return '<option value="'+esc(p)+'">'+esc(p)+'</option>';}).join('');
  ps.value=state.project;
  var mods=Array.from(new Set(DATA.map(function(e){return modelKey(e.model);})));
  var labels={opus:'Opus',sonnet:'Sonnet',haiku:'Haiku',fable:'Fable',other:'Other'};
  ms.innerHTML='<option value="__all">All models</option>'+mods.map(function(m){return '<option value="'+m+'">'+(labels[m]||m)+'</option>';}).join('');
  ms.value=state.model;
}

/* ---------- master render ---------- */
function render(){
  var list=filtered();
  renderKPIs(list);
  renderMini(list);
  renderCompare(list);
  renderDrill(list);
  renderCumulative(list);
  renderProjectBars(list);
  renderSessions(list);
  renderModelDonut(list);
  renderEfficiency(list);
  renderContextCost(list);
  renderFootprint(list);
  renderVerdict(list);
  renderTable(list);
  setText('#srcName',srcName);
  setText('#rangeLabel',rangeLabel());
}

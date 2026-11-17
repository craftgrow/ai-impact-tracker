/* ============================================================
   MODULE: footprint
   The real-life footprint panel — two deliberately separate views:

   1. CONTEXT  — your annual household/personal emissions next to your
      logged AI emissions, at true scale. Nothing is netted. This exists
      to answer "how big is my AI use, really?", not to cancel it out.

   2. AVOIDED  — an opt-in ledger of real-world reductions you've chosen
      (keeping a car instead of replacing it, driving less than average,
      eating lower on the food chain, buying clean power). Shown side by
      side with the AI number but NEVER subtracted from it: a watt-hour
      spent is spent, and avoided emissions elsewhere don't un-spend it.

   Everything the user types lives in localStorage on this device only.
   ============================================================ */

/* ---------- unit helpers ---------- */
function kgTxt(kg){
  kg=+kg||0;
  if(Math.abs(kg)>=1000) return num(kg/1000,2)+' t';
  if(Math.abs(kg)>=1)    return num(kg,0)+' kg';
  return num(kg,2)+' kg';
}
function saveLife(){ save(LS_LIFE,life); }
/* Percentages below a tenth of a point read as noise — say so instead. */
/* Small shares are shown to two significant figures rather than collapsed to
   "under 0.01%". The old wording was accurate but inert: every month read the
   same, a measured figure and an estimate 1.7× larger printed identically, and
   nobody could tell whether they were going up or down. */
function fmtPct(p){
  if(!(p>0)) return '0%';
  if(p<0.1)  return sharePrecise(p);
  return num(p,p<10?1:0)+'%';
}
/* Same number as fmtPct, but glyph-short so it can be set very large.
   "under 0.01%" reads fine in a sentence and terribly at 58px. */
function heroPct(p){
  if(!(p>0))  return '0%';
  if(p<0.1)   return sharePrecise(p);  // the zeros ARE the point — show them
  if(p<1)     return num(p,2)+'%';
  if(p>99 && p<100) return '>99%';     // never round 99.5% up to a flat "100%"
  return num(p,p<10?1:0)+'%';
}
/* The complement, stated so it never rounds to a flat "100%" — sitting a
   "0%" and a "100%" next to each other in the same sentence reads as a bug
   even when both are correctly rounded. */
function restPct(p){
  if(!(p>0)) return '100%';   // nothing logged yet — the rest really is all of it
  if(p<0.01) return '99.99%+';
  if(p<0.1)  return '99.9%+';
  if(p<1)    return num(100-p,2)+'%';
  return num(100-p,(100-p)<10?1:0)+'%';
}
/* Big multipliers rounded to 2 significant figures — "15,000×" not "14,797×". */
function bigX(r){
  r=+r||0;
  if(r<10)   return num(r,1)+'×';
  if(r<1000) return num(Math.round(r/10)*10,0)+'×';
  var mag=Math.pow(10,Math.floor(Math.log(r)/Math.LN10)-1);
  return num(Math.round(r/mag)*mag,0)+'×';
}
function dietKg(key){ var d=LIFE_F.dietKgDay; return (d&&d[key]!=null)?d[key]:d.medium; }

/* ---------- the model ----------
   Returns annual kg CO2e by category for the whole household, plus a
   per-person share. Driving, flights and diet are treated as the user's
   own; home energy is a household total that the household shares. */
function lifeModel(){
  var people = Math.max(1,(+life.adults||0)+(+life.children||0));

  var cleanFrac = clamp((+life.renewablePct||0)/100,0,1);
  var elecKg = (+life.elecKwhMo||0)*12*(+life.gridG||LIFE_F.gridUS)/1000*(1-cleanFrac);
  var gasKg  = (+life.gasCfMo||0)*12*LIFE_F.gasGPerCf/1000;
  var homeKg = elecKg+gasKg;

  var miles=+life.milesYr||0, driveKg=0;
  if(life.carType==='bev'){
    driveKg = miles*LIFE_F.evKwhPerMile*(+life.gridG||LIFE_F.gridUS)/1000;
  } else if(life.carType==='hybrid'){
    driveKg = miles*LIFE_F.carGPerMile*0.6/1000;
  } else if(life.carType==='ice'){
    /* scale the EPA per-mile figure by how far this car is from 22.2 mpg */
    var mpg=+life.mpg||22.2; if(mpg<=0)mpg=22.2;
    driveKg = miles*LIFE_F.carGPerMile*(22.2/mpg)/1000;
  }

  var flyKg  = (+life.flightsLong||0)*LIFE_F.flightLongKg
             + (+life.flightsShort||0)*LIFE_F.flightShortKg;

  var foodKg = dietKg(life.diet)*365;
  var otherKg= +life.otherKg||0;

  /* Home energy is a household cost the household shares; driving, flights,
     food and other consumption are counted as this person's own. */
  var mine = homeKg/people + driveKg + flyKg + foodKg + otherKg;

  return {
    people:people,
    cats:[
      {k:'Home energy',  kg:homeKg/people, note:'household total '+kgTxt(homeKg)+' shared across '+people+(people===1?' person':' people'), col:'#C87A53'},
      {k:'Driving',      kg:driveKg,       note:miles?num(miles,0)+' mi/yr':'no car', col:'#708271'},
      {k:'Flights',      kg:flyKg,         note:((+life.flightsLong||0)+' long-haul, '+(+life.flightsShort||0)+' short-haul round trips'), col:'#6E8B90'},
      {k:'Food',         kg:foodKg,        note:num(dietKg(life.diet),2)+' kg/day diet', col:'#C9A15A'},
      {k:'Everything else', kg:otherKg,    note:'goods, services, public infrastructure — adjustable', col:'#7C6F94'}
    ],
    homeKg:homeKg, driveKg:driveKg, flyKg:flyKg, foodKg:foodKg, otherKg:otherKg,
    mine:mine
  };
}

/* ---------- avoided-emissions ledger ----------
   Each line is a reduction the user has actually chosen, measured against
   a baseline they set themselves. Directional, and never netted against AI. */
function avoidedModel(){
  var rows=[];

  /* Keeping the current car rather than replacing it defers the
     manufacturing emissions of the car not bought. It is a DEFERRAL,
     not a removal — spread over the years the car is kept. */
  if(life.keepInsteadOfNew && life.carType!=='none'){
    var yrs=Math.max(1,+life.carKeptYears||1);
    var embodied = (life.carType==='bev')?LIFE_F.embodiedBevKg:LIFE_F.embodiedIceKg;
    rows.push({
      k:'Kept your car instead of buying new',
      kg:embodied/yrs,
      detail:kgTxt(embodied)+' of manufacturing emissions spread over '+yrs+' year'+(yrs===1?'':'s')+' of keeping it',
      caveat:'A deferral, not a removal — and a much more efficient replacement can pay its manufacturing back over time.'
    });
  }

  /* Driving less than your own stated baseline. */
  var baseMi=+life.baseMilesYr||0, mi=+life.milesYr||0;
  if(baseMi>mi){
    var perMile = life.carType==='bev' ? LIFE_F.evKwhPerMile*(+life.gridG||LIFE_F.gridUS)
                : life.carType==='hybrid' ? LIFE_F.carGPerMile*0.6
                : LIFE_F.carGPerMile*(22.2/(+life.mpg||22.2));
    rows.push({
      k:'Drove less than your baseline',
      kg:(baseMi-mi)*perMile/1000,
      detail:num(baseMi-mi,0)+' fewer miles than your '+num(baseMi,0)+' mi/yr baseline',
      caveat:'Only counts if those miles genuinely did not happen — not if they moved to another vehicle.'
    });
  }

  /* Eating lower on the food chain than your baseline diet. */
  var bd=dietKg(life.baseDiet), cd=dietKg(life.diet);
  if(bd>cd){
    rows.push({
      k:'Ate lower on the food chain',
      kg:(bd-cd)*365,
      detail:num(bd,2)+' → '+num(cd,2)+' kg CO₂e/day (Scarborough et al. 2023)',
      caveat:'Standardised to 2,000 kcal/day; your real diet will differ.'
    });
  }

  /* Clean electricity actually purchased. */
  var cf=clamp((+life.renewablePct||0)/100,0,1);
  if(cf>0){
    rows.push({
      k:'Bought clean electricity',
      kg:(+life.elecKwhMo||0)*12*(+life.gridG||LIFE_F.gridUS)/1000*cf,
      detail:Math.round(cf*100)+'% of '+num((+life.elecKwhMo||0)*12,0)+' kWh/yr on a renewable tariff',
      caveat:'Certificate-based tariffs vary a lot in whether they add new generation. Contracts that fund new build count for more.'
    });
  }

  /* Flights not taken vs. your own baseline. */
  var bf=+life.baseFlightsLong||0, f=+life.flightsLong||0;
  if(bf>f){
    rows.push({
      k:'Took fewer long-haul flights',
      kg:(bf-f)*LIFE_F.flightLongKg,
      detail:(bf-f)+' fewer long-haul round trip'+((bf-f)===1?'':'s')+' than your baseline of '+bf,
      caveat:'One transatlantic round trip ≈ 1.6 t CO₂e (Wynes & Nicholas 2017); radiative forcing could push this higher.'
    });
  }

  var total=rows.reduce(function(s,r){return s+r.kg;},0);
  return {rows:rows,total:total};
}

/* ============================================================
   Rendering
   ============================================================ */

function renderFootprint(list){
  var host=$('#lifeBody'); if(!host)return;
  var t=totals(list);
  var aiKg=t.co2/1000;                                  // AI CO2e in the current view, kg
  var aiAnnualKg=annualizeAI(list);                     // annualised, for a fair yearly comparison

  /* tab state */
  $$('#lifeTabs button').forEach(function(b){ b.classList.toggle('on', b.dataset.lifeview===life.view); });

  host.innerHTML = lifeFormHTML() +
    (life.view==='avoided' ? avoidedHTML(aiKg,aiAnnualKg) : contextHTML(aiKg,aiAnnualKg));
  wireLifeInputs();
  updateSharePill(aiAnnualKg);
}

/* The sticky-header pill carries the AI share to every part of the page.
   Driven from the same numbers as the panel so the two can never disagree.
   Hidden when either side of the ratio is missing — no logged sessions in the
   current view (common: a range or filter that matches nothing) or no footprint
   baseline at all. A stale percentage left sitting in the header while the page
   below it shows an empty range is worse than showing nothing. */
function updateSharePill(aiAnnualKg){
  var pill=$('#aiSharePill'); if(!pill)return;
  var lifeTotal=lifeModel().mine;

  if(!(lifeTotal>0) || !(aiAnnualKg>0)){ pill.hidden=true; return; }

  var pct=aiAnnualKg/lifeTotal*100;
  pill.hidden=false;
  var v=pill.querySelector('.ap-v'); if(v) v.textContent=heroPct(pct);
  pill.title='AI is '+fmtPct(pct)+' of your estimated '+kgTxt(lifeTotal)+
    '/yr footprint — click for the breakdown';

  if(!pill.dataset.wired){
    pill.dataset.wired='1';
    pill.addEventListener('click',function(){
      /* Land on the hero — the breakdown the pill actually promises. The
         section top puts the optional profile form in the way, which reads as
         a form to fill in rather than an answer. Falls back to the section
         when the hero isn't rendered (the avoided-emissions view). */
      var target=$('.lf-hero')||$('#life');
      if(target) target.scrollIntoView({behavior:'smooth',block:'start'});
    });
  }
}

/* Annualise the AI footprint from the actual logged span, so a one-week
   view isn't compared against a full year of driving. */
function annualizeAI(list){
  if(!list.length)return 0;
  var ts=list.map(function(e){return parseDate(e.timestamp).getTime();}).sort(function(a,b){return a-b;});
  var days=(ts[ts.length-1]-ts[0])/86400000;
  if(days<1)days=1;
  var kg=totals(list).co2/1000;
  return kg*365/days;
}

function lifeFormHTML(){
  function n(id,label,val,hint,step){
    return '<label class="lf"><span class="lfl">'+label+'</span>'+
      '<input type="number" class="lfi" data-life="'+id+'" value="'+esc(val)+'" step="'+(step||'1')+'" min="0">'+
      (hint?'<span class="lfh">'+hint+'</span>':'')+'</label>';
  }
  function sel(id,label,val,opts,hint){
    return '<label class="lf"><span class="lfl">'+label+'</span>'+
      '<select class="lfi" data-life="'+id+'">'+opts.map(function(o){
        return '<option value="'+o[0]+'"'+(String(val)===String(o[0])?' selected':'')+'>'+o[1]+'</option>';
      }).join('')+'</select>'+(hint?'<span class="lfh">'+hint+'</span>':'')+'</label>';
  }
  var diets=[['high','High meat'],['medium','Medium meat'],['low','Low meat / flexitarian'],['vegetarian','Vegetarian'],['vegan','Vegan']];
  var cars=[['none','No car'],['ice','Petrol / diesel'],['hybrid','Hybrid'],['bev','Electric']];

  var base = life.view==='avoided' ? '<div class="lf-grp"><div class="lf-gh">Your baselines <span class="lfh">what you are comparing against — set these yourself</span></div><div class="lf-grid">'+
      n('baseMilesYr','Baseline miles / year',life.baseMilesYr,'US average is '+num(LIFE_F.milesYr,0),'100')+
      sel('baseDiet','Baseline diet',life.baseDiet,diets,'the diet you moved away from')+
      n('baseFlightsLong','Baseline long-haul trips / yr',life.baseFlightsLong,'flights you would otherwise take','1')+
    '</div></div>' : '';

  return '<details class="lf-form"'+(life.filled?'':' open')+'>'+
    '<summary>Your profile <span class="lfh">optional · stays in this browser · nothing is uploaded</span></summary>'+
    '<div class="lf-grp"><div class="lf-gh">Household</div><div class="lf-grid">'+
      n('adults','Adults',life.adults)+
      n('children','Children',life.children,'shares the home total across more people')+
    '</div></div>'+
    '<div class="lf-grp"><div class="lf-gh">Home energy</div><div class="lf-grid">'+
      n('elecKwhMo','Electricity kWh / month',life.elecKwhMo,'US average '+num(LIFE_F.elecKwhMo,0),'10')+
      n('gridG','Your grid, g CO₂e / kWh',life.gridG,'US average '+num(LIFE_F.gridUS,0),'5')+
      n('renewablePct','% on a renewable tariff',life.renewablePct,'0–100','5')+
      n('gasCfMo','Natural gas ft³ / month',life.gasCfMo,'US average '+num(LIFE_F.gasCfMo,0)+' · 0 if none','100')+
    '</div></div>'+
    '<div class="lf-grp"><div class="lf-gh">Getting around</div><div class="lf-grid">'+
      sel('carType','Vehicle',life.carType,cars)+
      n('milesYr','Miles / year',life.milesYr,'US average '+num(LIFE_F.milesYr,0),'100')+
      n('mpg','MPG (petrol/diesel only)',life.mpg,'US average 22.2','0.1')+
      n('carKeptYears','Years you have kept it',life.carKeptYears,'used by the avoided ledger','1')+
      n('flightsLong','Long-haul round trips / yr',life.flightsLong,'transatlantic-class','1')+
      n('flightsShort','Short-haul round trips / yr',life.flightsShort,'','1')+
    '</div></div>'+
    '<div class="lf-grp"><div class="lf-gh">Food &amp; everything else</div><div class="lf-grid">'+
      sel('diet','Diet',life.diet,diets,'Scarborough et al. 2023, per 2,000 kcal')+
      n('otherKg','Other consumption, kg CO₂e / yr',life.otherKg,'goods, services, infrastructure','100')+
    '</div></div>'+
    '<div class="lf-grp"><div class="lf-gh">Your AI use</div><div class="lf-grid">'+
      n('claudeSharePct','% of your AI use that is Claude',life.claudeSharePct,
        'only Claude is logged here — 100 if it is the only assistant you use','5')+
    '</div></div>'+
    base+
    '<div class="lf-actions">'+
      '<label class="lf-chk"><input type="checkbox" data-life="keepInsteadOfNew"'+(life.keepInsteadOfNew?' checked':'')+'> I am keeping my current car rather than replacing it</label>'+
      '<button class="btn" id="lifeSetupBtn">🌱 Quick setup</button>'+
      '<button class="btn" id="lifeReset">↺ Reset profile</button>'+
    '</div>'+
  '</details>';
}

/* Share formatter for the monthly strip. fmtPct collapses everything small to
   "under 0.01%", which is right in prose and useless for a trend — every month
   would read identically. Two significant figures instead, so movement shows. */
function sharePrecise(p){
  if(!(p>0)) return '0%';
  if(p>=1)   return num(p,1)+'%';
  var s=p.toPrecision(2);
  if(s.indexOf('e')>=0) s=p.toFixed(6);      // avoid 5.5e-7 leaking into the UI
  return s.replace(/0+$/,'').replace(/\.$/,'')+'%';
}

/* ---------- all-AI extrapolation ----------
   The log only ever contains Claude. When the user says Claude is some fraction
   of their AI use, gross up to a whole-AI estimate — kept strictly separate from
   the measured figure, and returning null when there is nothing to estimate. */
function allAIEstimate(aiAnnualKg,lifeTotal){
  var share=+life.claudeSharePct;
  if(!(share>0)||share>=100) return null;          // Claude-only: nothing to add
  if(!(aiAnnualKg>0)||!(lifeTotal>0)) return null;
  var estKg=aiAnnualKg/(share/100);
  return { share:share, kg:estKg, pct:estKg/lifeTotal*100, otherKg:estKg-aiAnnualKg };
}

/* ---------- month-by-month share ----------
   Deliberately reads the WHOLE log, not the filtered view: the question this
   answers is "am I trending up or down", which a one-week range cannot show.
   Each month is measured against a month's worth of the life baseline. */
function monthlyShareRows(lifeTotal){
  if(!(lifeTotal>0)) return [];
  var byM={};
  DATA.forEach(function(e){
    var d=parseDate(e.timestamp);
    if(!d||isNaN(d.getTime())) return;
    var k=d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2);
    (byM[k]=byM[k]||[]).push(e);
  });
  var keys=Object.keys(byM).sort();
  if(keys.length<2) return [];                     // one month is not a trend
  keys=keys.slice(-6);
  var budget=lifeTotal/12;
  var now=new Date();
  var curKey=now.getFullYear()+'-'+('0'+(now.getMonth()+1)).slice(-2);
  return keys.map(function(k,i){
    var kg=totals(byM[k]).co2/1000;
    var pct=kg/budget*100;
    var prev=i>0 ? totals(byM[keys[i-1]]).co2/1000 : null;
    var delta=(prev!=null&&prev>0) ? (kg-prev)/prev*100 : null;
    var parts=k.split('-');
    return {
      key:k, kg:kg, pct:pct, delta:delta,
      label:new Date(+parts[0],+parts[1]-1,1).toLocaleDateString('en-US',{month:'short'}),
      partial:k===curKey
    };
  });
}

function monthlyShareHTML(lifeTotal){
  var rows=monthlyShareRows(lifeTotal);
  if(!rows.length) return '';
  var max=Math.max.apply(null,rows.map(function(r){return r.pct;}))||1;
  var body=rows.map(function(r){
    var d='';
    if(r.delta!=null){
      var up=r.delta>0, flat=Math.abs(r.delta)<1;
      d=flat ? '<span class="lm-d flat">— level</span>'
             : '<span class="lm-d '+(up?'up':'down')+'">'+(up?'↑':'↓')+' '+num(Math.abs(r.delta),0)+'%</span>';
    }
    return '<div class="lm-row">'+
      '<span class="lm-m">'+esc(r.label)+(r.partial?'<i title="This month is still in progress">*</i>':'')+'</span>'+
      '<span class="lm-track"><span class="lm-fill" style="width:'+Math.max(2,r.pct/max*100)+'%"></span></span>'+
      '<span class="lm-p">'+sharePrecise(r.pct)+'</span>'+d+
    '</div>';
  }).join('');
  var last=rows[rows.length-1];
  var foot = last.delta==null ? ''
    : (Math.abs(last.delta)<1 ? 'Your AI share is holding steady month to month.'
      : last.delta>0 ? 'Your AI share rose <b>'+num(last.delta,0)+'%</b> in the most recent month.'
                     : 'Your AI share fell <b>'+num(Math.abs(last.delta),0)+'%</b> in the most recent month.');

  return '<div class="lf-months">'+
      '<div class="lm-head">Month by month'+
        '<span>share of a month\'s footprint · whole log, ignores the range above</span></div>'+
      '<div class="lm-rows">'+body+'</div>'+
      (foot?'<div class="lm-foot">'+foot+(last.partial?' The current month is still filling up.':'')+'</div>':'')+
    '</div>';
}

/* ---------- view 1: context ---------- */
function contextHTML(aiKg,aiAnnualKg){
  var m=lifeModel();
  var cats=m.cats.filter(function(c){return c.kg>0;}).sort(function(a,b){return b.kg-a.kg;});
  var lifeTotal=m.mine;
  if(lifeTotal<=0){
    return '<div class="empty">Fill in a little of the profile above to see your AI use in context.</div>';
  }
  var pct = lifeTotal>0 ? aiAnnualKg/lifeTotal*100 : 0;
  var ratio = aiAnnualKg>0 ? lifeTotal/aiAnnualKg : 0;
  var max = Math.max(cats.length?cats[0].kg:0, aiAnnualKg);

  var bars = cats.map(function(c){
    return '<div class="lrow"><div class="ltop"><b>'+esc(c.k)+'</b><span class="n">'+kgTxt(c.kg)+'<span class="lp"> · '+num(c.kg/lifeTotal*100,0)+'%</span></span></div>'+
      '<div class="track"><div class="fill" style="width:'+Math.max(1.2,c.kg/max*100)+'%;background:'+c.col+'"></div></div>'+
      '<div class="lnote">'+esc(c.note)+'</div></div>';
  }).join('');

  /* The AI bar is almost always far too small to see at true scale — which is
     itself the finding. Draw it honestly (a hairline), then state the
     magnification needed to make it visible rather than faking the width. */
  var trueW = aiAnnualKg/max*100;
  var mag = trueW>0 ? Math.round(20/trueW) : 0;
  bars += '<div class="lrow ai"><div class="ltop"><b>⚡ Your AI use</b><span class="n">'+kgTxt(aiAnnualKg)+
    '<span class="lp"> · '+fmtPct(pct)+'</span></span></div>'+
    '<div class="track"><div class="fill" style="width:'+Math.max(0.35,trueW)+'%;background:var(--teal)"></div></div>'+
    '<div class="lnote">annualised from '+kgTxt(aiKg)+' logged in the current view, drawn at true scale'+
    (mag>4?' — it would need to be magnified about '+bigX(mag)+' to be visible next to the bars above':'')+'</div></div>';

  var headline;
  if(ratio>=1000){
    headline='Next to the rest of your life, your logged AI use is a <b>rounding error</b> — '+
      'roughly <b>'+bigX(ratio)+'</b> smaller than everything else you do in a year.';
  } else if(ratio>=1){
    headline='Your everyday life emits about <b>'+bigX(ratio)+'</b> what your logged AI use does.';
  } else {
    headline='Your logged AI use is the larger share here — worth a second look at the profile above.';
  }

  /* The hero states the share once, at size. Everything below it is evidence.
     The big number and this sentence are one continuous phrase, so the caption
     underneath stays a label and doesn't repeat the sentence back. */
  var heroSay = ratio>=1
    ? 'of your estimated <b>'+kgTxt(lifeTotal)+'/yr</b> footprint is AI. '+
      'Driving, heating, flying and food are the other <b>'+restPct(pct)+'</b> — '+
      'that is where your leverage is.'
    : 'of your estimated <b>'+kgTxt(lifeTotal)+'/yr</b> footprint is AI — a large enough '+
      'share that it is worth checking the profile above reflects your real life.';

  /* All-AI estimate sits BELOW the measured number and is labelled as an
     estimate everywhere it appears. The measured figure is the headline; this
     never replaces it and the two are never added into a single number. */
  var est=allAIEstimate(aiAnnualKg,lifeTotal);
  var estHTML = est ? '<div class="lh-est">'+
      '<span class="le-tag">Estimated</span>'+
      '<span class="le-txt">Across <b>all</b> AI tools you use, roughly <b>'+heroPct(est.pct)+'</b> '+
        '('+kgTxt(est.kg)+'/yr) — if Claude is about <b>'+num(est.share,0)+'%</b> of your AI use. '+
        'The other tools are not logged here, so that part is your estimate, not a measurement.</span>'+
    '</div>' : '';

  return '<div class="lf-hero">'+
      '<div class="lh-fig"><div class="lh-pct">'+heroPct(pct)+'</div>'+
        '<div class="lh-cap">'+(est?'Claude · measured':'AI share of your year')+'</div></div>'+
      '<div class="lh-say">'+heroSay+'</div>'+
      estHTML+
    '</div>'+
    monthlyShareHTML(lifeTotal)+
    '<div class="lf-head"><div class="lf-big">'+headline+'</div>'+
      '<div class="lf-sub">AI accounts for <b>'+fmtPct(pct)+'</b> of your estimated <b>'+kgTxt(lifeTotal)+'/yr</b> personal footprint. '+
      'Nothing here cancels anything out — this is scale, not accounting. '+
      'The practical read: the levers above the AI line are where your real leverage is.</div></div>'+
    '<div class="lbars">'+bars+'</div>'+
    '<div class="lf-note"><span class="ni">📐</span><span>The AI figure is annualised so a one-week view isn\'t compared against a full year of driving. '+
      'Every real-world factor is a population average, not a meter reading — treat the <b>order of magnitude</b> as the finding, and edit the profile to match your life. '+
      'Sources are in the Methodology panel.</span></div>';
}

/* ---------- view 2: avoided-emissions ledger ---------- */
function avoidedHTML(aiKg,aiAnnualKg){
  var a=avoidedModel();
  var body;
  if(!a.rows.length){
    body='<div class="empty">No reductions recorded yet. Set a baseline above that differs from your current numbers — fewer miles than your baseline, a lower-impact diet, a renewable tariff — or tick the car box.</div>';
  } else {
    var max=Math.max.apply(null,a.rows.map(function(r){return r.kg;}))||1;
    body='<div class="lbars">'+a.rows.sort(function(x,y){return y.kg-x.kg;}).map(function(r){
      return '<div class="lrow"><div class="ltop"><b>'+esc(r.k)+'</b><span class="n">'+kgTxt(r.kg)+'<span class="lp"> /yr</span></span></div>'+
        '<div class="track"><div class="fill" style="width:'+Math.max(1.2,r.kg/max*100)+'%;background:var(--leaf)"></div></div>'+
        '<div class="lnote">'+esc(r.detail)+'</div>'+
        '<div class="lcav">⚠ '+esc(r.caveat)+'</div></div>';
    }).join('')+'</div>';
  }

  var cmp = aiAnnualKg>0
    ? 'That is <b>'+bigX(a.total/aiAnnualKg)+'</b> your annualised AI footprint of '+kgTxt(aiAnnualKg)+' — sitting beside it, not cancelling it.'
    : 'Log some AI sessions to see this beside your AI footprint.';

  return '<div class="lf-warn"><span class="ni">⚖</span><span><b>These are not offsets, and nothing here is subtracted from your AI number.</b> '+
      'Energy your AI use consumed was consumed; reductions elsewhere are separate real-world wins. '+
      'The two are shown side by side so you can see relative size — never netted.</span></div>'+
    '<div class="lf-head"><div class="lf-big">About <b>'+kgTxt(a.total)+'</b> of CO₂e avoided per year.</div>'+
      '<div class="lf-sub">'+cmp+'</div></div>'+
    body+
    '<div class="lf-note"><span class="ni">📐</span><span>Every line is measured against a baseline <b>you</b> set, so it is only as honest as that baseline. '+
      'Avoided emissions are inherently counterfactual — they describe a world that did not happen. Treat them as directional.</span></div>';
}

/* ---------- input wiring ---------- */
function wireLifeInputs(){
  $$('[data-life]').forEach(function(el){
    var key=el.getAttribute('data-life');
    var ev=(el.type==='checkbox'||el.tagName==='SELECT')?'change':'input';
    el.addEventListener(ev,function(){
      if(el.type==='checkbox') life[key]=el.checked;
      else if(el.tagName==='SELECT') life[key]=el.value;
      else { var v=parseFloat(el.value); life[key]=isNaN(v)?0:Math.max(0,v); }
      life.filled=true; saveLife();
      /* Re-render only the results half, so focus and caret stay put. */
      repaintLifeResults();
    });
  });
  on('#lifeReset','click',function(){
    for(var k in LIFE_DEFAULT) life[k]=LIFE_DEFAULT[k];
    saveLife(); renderFootprint(filtered()); toast('↺ Profile reset');
  });
}
/* ============================================================
   Baseline setup — the six-question first-run form
   ============================================================
   Writes straight into `life`, the same object the profile panel edits, so
   there is exactly one profile and no second source of truth to reconcile. */
var baseScrim=null;

function openBaseline(){
  baseScrim=baseScrim||$('#baseScrim');
  if(!baseScrim)return;
  /* seed every control from the current profile, so re-opening shows what
     they last said rather than resetting them to the defaults */
  $$('[data-base]').forEach(function(el){
    var v=life[el.getAttribute('data-base')];
    if(v!=null) el.value=v;
  });
  baseScrim.classList.remove('hidden');
  document.body.style.overflow='hidden';
  updateBaselinePreview();
  var first=$('#bqAdults'); if(first) setTimeout(function(){first.focus();},60);
}

function closeBaseline(){
  baseScrim=baseScrim||$('#baseScrim');
  if(!baseScrim)return;
  baseScrim.classList.add('hidden');
  document.body.style.overflow='';
}

/* Read the form into a throwaway copy of the profile so the preview can be
   costed without committing anything the user might still cancel. */
function baselineDraft(){
  var draft={};
  for(var k in life) draft[k]=life[k];
  $$('[data-base]').forEach(function(el){
    var k=el.getAttribute('data-base');
    if(el.tagName==='SELECT'){
      draft[k]=(k==='diet'||k==='carType') ? el.value : (parseFloat(el.value)||0);
    } else {
      var v=parseFloat(el.value);
      draft[k]=isNaN(v)?0:Math.max(0,v);
    }
  });
  return draft;
}

function updateBaselinePreview(){
  var host=$('#bqPreview'); if(!host)return;
  var keep=life, draft=baselineDraft();
  life=draft;                                   // cost the draft, then put it back
  var total=0; try{ total=lifeModel().mine; }catch(e){ total=0; }
  life=keep;
  if(!(total>0)){ host.innerHTML=''; return; }
  host.innerHTML='<span class="bp-l">Your baseline</span>'+
    '<span class="bp-v">'+kgTxt(total)+'<span class="bp-u">CO₂e / yr</span></span>'+
    '<span class="bp-n">what your AI use gets measured against</span>';
}

function saveBaseline(){
  var draft=baselineDraft();
  for(var k in draft) life[k]=draft[k];
  life.filled=true;
  saveLife();
  closeBaseline();
  renderFootprint(filtered());
  var sec=$('.lf-hero')||$('#life');
  if(sec) sec.scrollIntoView({behavior:'smooth',block:'start'});
  toast('🌱 Baseline saved — your AI use is now measured against your life');
}

function repaintLifeResults(){
  var host=$('#lifeBody'); if(!host)return;
  var det=host.querySelector('.lf-form');
  var list=filtered(), t=totals(list);
  var html=(life.view==='avoided')
    ? avoidedHTML(t.co2/1000,annualizeAI(list))
    : contextHTML(t.co2/1000,annualizeAI(list));
  /* wipe everything after the form, then append fresh results */
  while(det && det.nextSibling) host.removeChild(det.nextSibling);
  var wrap=document.createElement('div');
  wrap.innerHTML=html;
  while(wrap.firstChild) host.appendChild(wrap.firstChild);
}

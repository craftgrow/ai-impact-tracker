/* ============================================================
   MODULE: exporters
   Getting data in and out: import (file / paste / drag-drop),
   export (JSON download), reset, and PDF export. Plus the
   event wiring and init sequence — this module runs last.
   ============================================================ */

/* ---------- shared loader — file picker, paste box, drag-drop ---------- */
function ingest(parsed, label){
  var arr = Array.isArray(parsed) ? parsed : (parsed && parsed.entries) || [];
  if(!arr.length) throw new Error('No entries found. Expected {"entries":[…]} or a plain array.');
  // light validation: keep only object rows, coerce numeric fields
  arr = arr.filter(function(e){ return e && typeof e==='object'; }).map(function(e){
    var row = {
      timestamp: e.timestamp || e.time || e.date || '',
      project: e.project || 'Unlabeled',
      model: e.model || 'other',
      energy_wh: +e.energy_wh||0, water_ml:+e.water_ml||0,
      total_tokens:+e.total_tokens||0, context:e.context||''
    };
    /* optional per-token detail — kept only when present, so the dashboard
       can tell "no split logged" apart from "the split is zero" */
    ['input_tokens','output_tokens','cached_tokens'].forEach(function(k){
      if(e[k]) row[k]=+e[k]||0;
    });
    return row;
  });
  DATA = arr; srcName = label; save(LS_DATA,DATA); save(LS_SRC,srcName);
  state.project='__all'; fillSelects(); render(); save(LS_OB,1);
  return arr.length;
}
function parseLoose(text){
  text=String(text||'').trim();
  if(!text) throw new Error('Nothing to load yet.');
  text=text.replace(/^```(?:json)?/i,'').replace(/```$/,'').trim(); // tolerate code fences
  try{ return JSON.parse(text); }
  catch(e){
    // fall back to NDJSON / one-object-per-line (also tolerant of trailing commas)
    var arr=[],ok=0;
    text.split(/\r?\n/).forEach(function(l){
      l=l.trim().replace(/,\s*$/,''); if(!l||l==='['||l===']'||l==='{'||l==='}')return;
      try{ var o=JSON.parse(l); if(o&&typeof o==='object')  {arr.push(o);ok++;} }catch(_){}
    });
    if(ok) return arr;
    throw new Error('That doesn’t look like valid JSON yet.');
  }
}
function loadFromText(text, label){ return ingest(parseLoose(text), label); }
function loadFile(f, done){
  var rd=new FileReader();
  rd.onload=function(){ try{ var n=loadFromText(rd.result, f.name); done&&done(null,n); }
    catch(err){ done&&done(err); } };
  rd.onerror=function(){ done&&done(new Error('Could not read the file.')); };
  rd.readAsText(f);
}
on('#fileIn','change',function(e){
  var f=e.target.files[0]; if(!f)return;
  loadFile(f,function(err,n){
    if(err){ toast('✕ Could not import: '+err.message); }
    else { closeOnboarding(); toast('✓ Loaded '+n+' entries from '+f.name); }
    e.target.value=''; // allow re-importing the same file
  });
});

/* ---------- paste-log modal ---------- */
var pasteScrim=$('#pasteScrim');
function openPaste(){ setText('#pasteErr',''); if(!pasteScrim)return; pasteScrim.classList.remove('hidden'); document.body.style.overflow='hidden'; setTimeout(function(){var pb=$('#pasteBox'); if(pb)pb.focus();},30); }
function closePaste(){ if(!pasteScrim)return; pasteScrim.classList.add('hidden'); document.body.style.overflow=''; }
on('#obPaste','click',function(){ closeOnboarding(); openPaste(); });
on('#pasteClose','click',closePaste);
on('#pasteCancel','click',closePaste);
on(pasteScrim,'click',function(e){ if(e.target===pasteScrim)closePaste(); });
on('#pasteLoad','click',function(){
  var box=$('#pasteBox'), err=$('#pasteErr'); if(!box||!err)return;
  var txt=box.value.trim();
  if(!txt){ err.textContent='Paste your log JSON first.'; return; }
  try{ var n=loadFromText(txt,'pasted log'); err.className='paste-err paste-ok'; err.textContent='✓ Loaded '+n+' entries.';
       setTimeout(function(){ closePaste(); err.className='paste-err'; box.value=''; },700); }
  catch(e2){ err.className='paste-err'; err.textContent='✕ '+e2.message; }
});
/* live preview as the user types/pastes */
on('#pasteBox','input',function(){
  var box=$('#pasteBox'), err=$('#pasteErr'); if(!box||!err)return;
  var t=box.value.trim();
  if(!t){ err.className='paste-err'; err.textContent=''; return; }
  try{ var p=parseLoose(t); var arr=Array.isArray(p)?p:((p&&p.entries)||[]);
       err.className='paste-err paste-ok'; err.textContent='✓ '+arr.length+' entr'+(arr.length===1?'y':'ies')+' detected — ready to load'; }
  catch(e){ err.className='paste-err'; err.textContent='… waiting for valid JSON'; }
});
/* one-tap: copy the exact prompt to ask Claude for your log */
on('#pastePrompt','click',function(){
  copyText('Print the full contents of my '+CONFIG.logFileName+' impact log as raw JSON only — no commentary — so I can paste it into the AI Impact dashboard.',
    'Prompt copied — paste it to Claude, then paste the reply back here');
});
function copyText(text,msg){
  if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(text).then(function(){toast(msg);},function(){legacyCopy(text,msg);}); }
  else legacyCopy(text,msg);
}
function legacyCopy(text,msg){ var ta=document.createElement('textarea'); ta.value=text; document.body.appendChild(ta); ta.select(); try{document.execCommand('copy');toast(msg);}catch(e){toast('Copy not supported — select & copy manually');} document.body.removeChild(ta); }
var _toastT;
function toast(msg){ var t=$('#toast'); if(!t)return; t.textContent=msg; t.classList.add('on'); clearTimeout(_toastT); _toastT=setTimeout(function(){t.classList.remove('on');},2600); }

/* ---------- drag & drop anywhere on the page ---------- */
var dropHint=$('#dropHint'), dragDepth=0;
function isFileDrag(e){ return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types||[],'Files')>=0; }
window.addEventListener('dragenter',function(e){ if(!isFileDrag(e)||!dropHint)return; e.preventDefault(); dragDepth++; dropHint.classList.add('on'); });
window.addEventListener('dragover',function(e){ if(isFileDrag(e))e.preventDefault(); });
window.addEventListener('dragleave',function(e){ if(!isFileDrag(e)||!dropHint)return; dragDepth=Math.max(0,dragDepth-1); if(!dragDepth)dropHint.classList.remove('on'); });
window.addEventListener('drop',function(e){
  if(!isFileDrag(e))return; e.preventDefault(); dragDepth=0; if(dropHint)dropHint.classList.remove('on');
  var f=e.dataTransfer.files[0]; if(!f)return;
  loadFile(f,function(err,n){
    if(err){ toast('✕ Could not import: '+err.message); }
    else { closeOnboarding(); closePaste(); toast('✓ Loaded '+n+' entries from '+f.name); }
  });
});

/* ---------- generic dropdown menus (Data + Export PDF) ---------- */
function makeMenu(btnSel,menuSel){
  var btn=$(btnSel), menu=$(menuSel); if(!btn||!menu)return {close:function(){}};
  function openM(){ menu.classList.add('open'); btn.setAttribute('aria-expanded','true'); }
  function closeM(){ menu.classList.remove('open'); btn.setAttribute('aria-expanded','false'); }
  btn.addEventListener('click',function(e){ e.stopPropagation(); menu.classList.contains('open')?closeM():openM(); });
  document.addEventListener('click',function(e){ if(!menu.contains(e.target)&&e.target!==btn)closeM(); });
  document.addEventListener('keydown',function(e){ if(e.key==='Escape')closeM(); });
  return {close:closeM};
}
var dataMenu=makeMenu('#dataBtn','#dataMenu');


/* ---------- saving a file ----------
   Inside a published Claude artifact the viewer frame is never granted a
   direct download: an <a download> or a script-driven save silently does
   nothing. The downloads capability mediates it instead — the viewer sees a
   confirmation and may decline. The same file opened locally has no
   capability, so keep the anchor path as the fallback and let each context
   use what actually works. */
function saveFile(filename, data, okMsg){
  function anchor(){
    try{
      var blob = (data instanceof Blob) ? data : new Blob([data]);
      var a=document.createElement('a'), u=URL.createObjectURL(blob);
      a.href=u; a.download=filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function(){ URL.revokeObjectURL(u); },1000);
      if(okMsg) toast(okMsg);
    }catch(err){ toast('✕ Could not save the file'); }
  }
  try{
    if(window.claude && typeof window.claude.use === 'function'){
      window.claude.use('downloads').then(function(dl){
        if(!dl){ anchor(); return; }                 /* not granted here */
        dl.save({filename:filename, data:data}).then(
          function(){ if(okMsg) toast(okMsg); },
          function(err){
            var code = (err && err.code) || 'error';
            if(code==='declined') return;             /* the viewer said no */
            toast('✕ Save failed ('+code+')');
          });
      }, anchor);
      return;
    }
  }catch(err){ /* fall through */ }
  anchor();
}

/* ---------- data menu actions ---------- */
on('#dmPaste','click',function(){ dataMenu.close(); openPaste(); });
on('#dmImport','click',function(){ setTimeout(dataMenu.close,0); }); // label opens the file dialog
on('#dmExport','click',function(){
  dataMenu.close();
  var blob=new Blob([JSON.stringify({entries:DATA},null,1)],{type:'application/json'});
  saveFile('environmental-impact-log.json', blob, '✓ Log exported ('+DATA.length+' entries)');
});
/* two-step confirm: first click arms, second click within 3s executes */
var _resetArm=null;
on('#dmReset','click',function(){
  var b=$('#dmReset'); if(!b)return;
  if(!b.classList.contains('arm')){
    b.classList.add('arm'); b.childNodes[0].nodeValue='↺ Click again to confirm ';
    clearTimeout(_resetArm);
    _resetArm=setTimeout(function(){ b.classList.remove('arm'); b.childNodes[0].nodeValue='↺ Reload baked log'; },3000);
    return;
  }
  clearTimeout(_resetArm); b.classList.remove('arm'); b.childNodes[0].nodeValue='↺ Reload baked log';
  dataMenu.close();
  DATA=SEED.slice(); srcName=CONFIG.seedSourceLabel; save(LS_DATA,DATA); save(LS_SRC,srcName);
  state.project='__all'; fillSelects(); render();
  toast('✓ Reloaded the baked-in log ('+DATA.length+' entries)');
});

/* ---------- theme toggle ---------- */
var LS_THEME='eid_theme_v1';
function applyThemeIcon(){
  var b=$('#themeBtn'); if(!b)return;
  var dark=document.documentElement.getAttribute('data-theme')==='dark';
  b.textContent=dark?'☀️':'🌙';
  b.title=dark?'Switch to light mode':'Switch to dark mode';
}
on('#themeBtn','click',function(){
  var el=document.documentElement;
  var next=el.getAttribute('data-theme')==='dark'?'light':'dark';
  el.setAttribute('data-theme',next);
  try{localStorage.setItem(LS_THEME,next);}catch(e){}
  applyThemeIcon(); render(); // re-render so SVG charts pick up new palette
});
applyThemeIcon();

/* ---------- onboarding ---------- */
var obScrim=$('#obScrim');
function openOnboarding(){ if(!obScrim)return; obScrim.classList.remove('hidden'); document.body.style.overflow='hidden'; }
function closeOnboarding(){ if(!obScrim)return; obScrim.classList.add('hidden'); document.body.style.overflow=''; save(LS_OB,1); }
on('#helpBtn','click',openOnboarding);
on('#obClose','click',closeOnboarding);
on('#obExplore','click',closeOnboarding);

/* ---------- baseline setup ---------- */
on('#obBaseline','click',function(){ closeOnboarding(); openBaseline(); });
on('#baseClose','click',closeBaseline);
on('#baseSkip','click',function(){ closeBaseline(); toast('Using national averages — tune anytime under Real life'); });
on('#baseSave','click',saveBaseline);
on('#baseScrim','click',function(e){ if(e.target===$('#baseScrim'))closeBaseline(); });
/* live baseline preview as they answer */
$$('[data-base]').forEach(function(el){
  el.addEventListener(el.tagName==='SELECT'?'change':'input', updateBaselinePreview);
});
/* an obvious way back in once the first-run modal is gone */
on('#lifeSetupBtn','click',openBaseline);
/* Import-my-log button is a <label for="fileIn"> — closing on click still lets the file dialog open */
on('#obImport','click',function(){ setTimeout(closeOnboarding,0); });
on(obScrim,'click',function(e){ if(e.target===obScrim)closeOnboarding(); });
document.addEventListener('keydown',function(e){ if(e.key==='Escape'&&obScrim&&!obScrim.classList.contains('hidden'))closeOnboarding(); });
if(!load(LS_OB,0))openOnboarding();

/* ---------- filter & sort event wiring ---------- */
/* ---------- time range: presets, custom window, compare toggle ---------- */
function syncRangeUI(){
  $$('#rangeSeg button').forEach(function(b){ b.classList.toggle('on', b.dataset.range===state.range); });
  var row=$('#customRow'); if(row) row.classList.toggle('hidden', state.range!=='custom');
  var f=$('#dtFrom'), t=$('#dtTo');
  if(f && f.value!==state.from) f.value=state.from||'';
  if(t && t.value!==state.to)   t.value=state.to||'';
  var c=$('#cmpToggle'); if(c) c.checked=!!state.compare;
  setText('#rangeLabel', rangeLabel());
  var hint=$('#dtHint');
  if(hint){
    var w=rangeWindow('custom',false);
    hint.textContent = state.range!=='custom' ? ''
      : (!w ? 'Pick at least one date — leave the other open-ended.'
            : Math.round((w[1]-w[0])/86400000)+' day window');
  }
}
function setRange(id){ state.range=id; saveView(); syncRangeUI(); render(); }
function saveView(){ save(LS_VIEW,{range:state.range,from:state.from,to:state.to,compare:state.compare}); }

on('#rangeSeg','click',function(e){ var b=e.target.closest('button'); if(!b)return; setRange(b.dataset.range); });
on('#dtFrom','change',function(){ state.from=this.value; state.range='custom'; saveView(); syncRangeUI(); render(); });
on('#dtTo','change',  function(){ state.to=this.value;   state.range='custom'; saveView(); syncRangeUI(); render(); });
on('#dtClear','click',function(){ state.from=''; state.to=''; saveView(); syncRangeUI(); render(); });
on('#cmpToggle','change',function(){ state.compare=this.checked; saveView(); render(); });
on('#projSel','change',function(){ state.project=this.value; render(); });
on('#modelSel','change',function(){ state.model=this.value; render(); });
on('#searchIn','input',function(){ state.search=this.value; render(); });
$$('#tbl th').forEach(function(th){ th.addEventListener('click',function(){
  var k=th.dataset.sort; if(state.sort===k){state.dir*=-1;}else{state.sort=k;state.dir=(k==='timestamp'||k==='energy_wh'||k==='water_ml'||k==='total_tokens'||k==='co2')?-1:1;}
  renderTable(filtered());
});});

/* ---------- sticky header: condense on scroll + section tracking ----------
   Two jobs, one scroll listener:

   1. Past the header's resting position the bar condenses, dropping the
      range controls behind a pill so it costs ~90px instead of ~180.
   2. Whichever section currently owns the top of the reading area is marked
      in the nav. The old version used IntersectionObserver ratios, which
      left nothing marked at scroll 0 (no section was intersecting enough)
      and picked the *biggest* visible section rather than the one you are
      actually reading. Comparing section tops against a line just below the
      bar is both simpler and matches what the eye expects. */
(function(){
  var head=$('#secNav'); if(!head)return;
  var links={}; $$('#secNav a[data-nav]').forEach(function(a){ links[a.getAttribute('data-nav')]=a; });
  var ids=['kpis','trends','life','sessions','actions','method'];
  var pill=$('#rangePill');
  var manualUntil=0;      /* after a nav click, trust the click briefly */

  function setActive(id){
    for(var k in links) links[k].classList.toggle('active',k===id);
  }

  /* the section whose top has passed the reading line; falls back to the
     first one so something is always marked, including at the very top */
  function currentSection(){
    var line=head.getBoundingClientRect().height+24, best=ids[0];
    for(var i=0;i<ids.length;i++){
      var el=document.getElementById(ids[i]); if(!el)continue;
      if(el.getBoundingClientRect().top<=line) best=ids[i];
    }
    /* bottom of the page always belongs to the last section, otherwise a
       short final section can never win */
    if(window.innerHeight+window.scrollY>=document.body.scrollHeight-4) best=ids[ids.length-1];
    return best;
  }

  var restY=0;
  function measure(){
    var wasCondensed=head.classList.contains('condensed');
    if(wasCondensed) head.classList.remove('condensed');
    restY=head.offsetTop;
    if(wasCondensed) head.classList.add('condensed');
  }

  function onScroll(){
    head.classList.toggle('condensed', window.scrollY>restY+4);
    if(Date.now()>manualUntil) setActive(currentSection());
  }

  $$('#secNav a[data-nav]').forEach(function(a){
    a.addEventListener('click',function(){
      setActive(a.getAttribute('data-nav'));
      manualUntil=Date.now()+700;   /* let the smooth scroll land first */
    });
  });

  /* the pill reopens the collapsed range controls */
  if(pill){
    pill.addEventListener('click',function(){
      var open=head.classList.toggle('sh-expanded');
      pill.setAttribute('aria-expanded',open?'true':'false');
    });
    /* picking a range closes it again, and keeps the pill label honest */
    on('#rangeSeg','click',function(){
      setTimeout(function(){
        var b=$('#rangeSeg button.on');
        if(b) pill.textContent=b.textContent.replace(/…$/,'')+' ▾';
        if(!$('#customRow')||$('#customRow').classList.contains('hidden')){
          head.classList.remove('sh-expanded'); pill.setAttribute('aria-expanded','false');
        }
      },0);
    });
    var b0=$('#rangeSeg button.on'); if(b0) pill.textContent=b0.textContent.replace(/…$/,'')+' ▾';
  }

  window.addEventListener('scroll',onScroll,{passive:true});
  window.addEventListener('resize',function(){ measure(); onScroll(); });
  measure(); onScroll();
})();

/* ---------- PDF export menu ---------- */
var pdfMenu=makeMenu('#pdfBtn','#pdfMenu');
$$('#pdfMenu button[data-print]').forEach(function(b){
  b.addEventListener('click',function(){
    var mode=b.getAttribute('data-print'); pdfMenu.close();
    document.body.setAttribute('data-print',mode);
    function clear(){ document.body.removeAttribute('data-print'); window.removeEventListener('afterprint',clear); }
    window.addEventListener('afterprint',clear);
    setTimeout(function(){ window.print(); },60);
    setTimeout(clear,4000); // safety net if afterprint doesn't fire
  });
});

/* ---------- redraw charts when the layout width changes ----------
   Chart geometry is picked from the measured panel width, so a rotation or a
   window resize needs a repaint. Debounced, and only when the width actually
   moved — mobile browsers fire resize on every address-bar nudge. */
(function(){
  var lastW=window.innerWidth, t=null;
  window.addEventListener('resize',function(){
    if(Math.abs(window.innerWidth-lastW)<24)return;
    lastW=window.innerWidth;
    clearTimeout(t); t=setTimeout(function(){ render(); },180);
  });
})();

/* ---------- by-project metric toggle ---------- */
on('#projMetric','click',function(e){
  var b=e.target.closest('button'); if(!b)return;
  projMetric=b.getAttribute('data-metric');
  renderProjectBars(filtered());
});

/* ---------- life-footprint view tabs ---------- */
on('#lifeTabs','click',function(e){
  var b=e.target.closest('button'); if(!b)return;
  life.view=b.getAttribute('data-lifeview'); saveLife();
  renderFootprint(filtered());
});

/* ---------- init ---------- */
setText('#buildStamp','Dashboard generated '+(BUILT||'—')+' · '+SEED.length+' logged sessions baked in.');
/* restore the saved view (range / custom window / compare) before first paint */
(function(){
  var v=load(LS_VIEW,null); if(!v)return;
  if(v.range && rangeDef(v.range).id===v.range) state.range=v.range;
  if(typeof v.from==='string') state.from=v.from;
  if(typeof v.to==='string')   state.to=v.to;
  if(typeof v.compare==='boolean') state.compare=v.compare;
})();
syncRangeUI();
fillSelects();
renderMitigation();
renderMethodology();
render();

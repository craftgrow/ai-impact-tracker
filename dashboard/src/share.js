/* ============================================================
   MODULE: share
   "Share my impact" — draws a 1080×1080 summary card on a <canvas>
   and hands it back as a PNG.

   Deliberately narrow: totals, grade, one comparison, the date range.
   No project names, no session context, no model breakdown — the card
   is meant to be postable without a second thought about what it leaks.

   Everything is drawn with canvas primitives (no emoji, no webfonts, no
   images), so the export looks the same on every machine and the file
   stays self-contained and offline.
   ============================================================ */

var SHARE_W=1080, SHARE_H=1080;

/* Fixed brand palette — the card looks the same whether the dashboard is
   in light or dark mode, so shared images stay recognisable. */
var SH={
  ink:'#F2EFE6', inkSoft:'rgba(242,239,230,.76)', mut:'rgba(242,239,230,.52)',
  teal:'#9CC49A', sky:'#93B7BE', amber:'#E3BE7C',
  line:'rgba(242,239,230,.16)'
};
/* Card background gradient follows the grade, matching the dashboard's
   grade card so the two obviously belong to the same tool. */
var SHARE_GRAD={
  'gr-a':['#2E5340','#16281E'], 'gr-b':['#3F5B36','#1D2A18'],
  'gr-c':['#6B5326','#2E2312'], 'gr-d':['#7E4526','#331B10'],
  'gr-f':['#722F22','#2C110C']
};

function shareFont(size,weight,mono){
  return (weight||600)+' '+size+'px '+(mono
    ? 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace'
    : 'Inter,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif');
}
function roundRect(c,x,y,w,h,r){
  c.beginPath();
  if(c.roundRect){ c.roundRect(x,y,w,h,r); return; }
  c.moveTo(x+r,y); c.arcTo(x+w,y,x+w,y+h,r); c.arcTo(x+w,y+h,x,y+h,r);
  c.arcTo(x,y+h,x,y,r); c.arcTo(x,y,x+w,y,r); c.closePath();
}

/* ---- the three elemental motifs, drawn as static marks ----
   Solid silhouettes rather than outlines: at 34px on a busy gradient a
   1-2px stroke disappears, and these have to read at thumbnail size. */
function shareIcon(c,kind,x,y,s,col){
  c.save(); c.translate(x,y); c.scale(s/40,s/40);
  c.strokeStyle=col; c.fillStyle=col; c.lineJoin='round'; c.lineCap='round';
  if(kind==='energy'){
    c.globalAlpha=.32; c.lineWidth=2.4;
    c.beginPath(); c.arc(20,20,17,0,Math.PI*2); c.stroke();
    c.globalAlpha=1;
    c.beginPath(); c.moveTo(23.6,3.5); c.lineTo(10.5,22.5); c.lineTo(18.4,22.5);
    c.lineTo(16.4,36.5); c.lineTo(29.5,17.5); c.lineTo(21.6,17.5); c.closePath(); c.fill();
  }else if(kind==='water'){
    /* teardrop: two curves down the sides into a bottom semicircle */
    c.beginPath();
    c.moveTo(20,3);
    c.bezierCurveTo(27.5,13,31,19.5,31,23.5);
    c.arc(20,23.5,11,0,Math.PI,false);
    c.bezierCurveTo(9,19.5,12.5,13,20,3);
    c.closePath(); c.fill();
    /* a lighter band across the belly reads as a water line */
    c.globalAlpha=.34; c.fillStyle='#0C1512';
    c.beginPath(); c.moveTo(9.6,25); c.quadraticCurveTo(14.6,21.6,20,25);
    c.quadraticCurveTo(25.4,28.4,30.4,25); c.lineTo(30.4,21); c.lineTo(9.6,21); c.closePath(); c.fill();
  }else{
    /* cloud: three puffs on a rounded base, then two drifting wisps */
    [[14,20,7],[22.5,17.5,9],[29,21,6]].forEach(function(p){
      c.beginPath(); c.arc(p[0],p[1],p[2],0,Math.PI*2); c.fill();
    });
    roundRect(c,7,20,26,8,4); c.fill();
    c.globalAlpha=.5; c.lineWidth=2.6;
    c.beginPath(); c.moveTo(9,33); c.lineTo(22,33); c.stroke();
    c.beginPath(); c.moveTo(16,38); c.lineTo(31,38); c.stroke();
  }
  c.restore();
}

/* ---- one metric block: icon, label, big value, sub-line ---- */
function shareMetric(c,x,y,kind,col,label,value,sub){
  shareIcon(c,kind,x+1,y-26,36,col);
  c.textAlign='left'; c.textBaseline='alphabetic';
  c.fillStyle=SH.mut; c.font=shareFont(20,700,true);
  c.fillText(label.toUpperCase(),x+52,y);
  c.fillStyle=SH.ink; c.font=shareFont(62,800);
  c.fillText(value,x,y+70);
  c.fillStyle=SH.inkSoft; c.font=shareFont(23,500);
  c.fillText(sub,x,y+108);
}

/* ---- the whole card ---- */
function drawShareCard(canvas){
  var c=canvas.getContext('2d'); if(!c)return null;
  var list=filtered(), t=totals(list), g=computeGrade(list);
  var pair=SHARE_GRAD[g.cls]||SHARE_GRAD['gr-c'];

  c.clearRect(0,0,SHARE_W,SHARE_H);
  var bg=c.createLinearGradient(0,0,SHARE_W*.55,SHARE_H);
  bg.addColorStop(0,pair[0]); bg.addColorStop(1,pair[1]);
  c.fillStyle=bg; c.fillRect(0,0,SHARE_W,SHARE_H);

  /* soft light from the top-left, so the flat fill gets some depth */
  var glow=c.createRadialGradient(210,150,10,210,150,760);
  glow.addColorStop(0,'rgba(255,255,255,.11)'); glow.addColorStop(1,'rgba(255,255,255,0)');
  c.fillStyle=glow; c.fillRect(0,0,SHARE_W,SHARE_H);

  var M=84;                                   /* page margin */

  /* header */
  c.textAlign='left'; c.textBaseline='alphabetic';
  c.fillStyle=SH.mut; c.font=shareFont(21,700,true);
  c.fillText('MY AI ENVIRONMENTAL FOOTPRINT',M,M+30);
  c.fillStyle=SH.ink; c.font=shareFont(58,800);
  c.fillText(rangeDef(state.range).label,M,M+100);
  c.fillStyle=SH.inkSoft; c.font=shareFont(23,500);
  c.fillText(rangeLabel()+'  ·  '+num(t.n,0)+' logged session'+(t.n===1?'':'s'),M,M+138);

  c.strokeStyle=SH.line; c.lineWidth=1.5;
  c.beginPath(); c.moveTo(M,M+176); c.lineTo(SHARE_W-M,M+176); c.stroke();

  /* three metrics down the left, grade badge on the right */
  var whTxt = t.wh>=1000? num(t.wh/1000,2)+' kWh' : num(t.wh,1)+' Wh';
  var mlTxt = t.ml>=1000? num(t.ml/1000,2)+' L'   : num(t.ml,0)+' mL';
  var coTxt = t.co2>=1000? num(t.co2/1000,2)+' kg': num(t.co2,0)+' g';

  var y0=330, gap=196;
  shareMetric(c,M,y0,'energy',SH.teal,'Energy',whTxt,
    '≈ '+num(t.wh/C_PHONE_WH,0)+' smartphone charges');
  shareMetric(c,M,y0+gap,'water',SH.sky,'Water',mlTxt,
    '≈ '+num(t.ml/C_BOTTLE_ML,1)+' × 500 mL bottles');
  shareMetric(c,M,y0+gap*2,'carbon',SH.amber,'Carbon',coTxt,
    '≈ '+num(t.co2/C_MILE_G,1)+' miles in an average car');

  /* grade badge */
  var bw=232, bh=232, bx=SHARE_W-M-bw, by=y0-42;
  c.fillStyle='rgba(255,255,255,.08)'; roundRect(c,bx,by,bw,bh,30); c.fill();
  c.strokeStyle=SH.line; c.lineWidth=2; roundRect(c,bx,by,bw,bh,30); c.stroke();
  c.textAlign='center'; c.textBaseline='alphabetic';
  c.fillStyle=SH.mut; c.font=shareFont(18,700,true);
  c.fillText('USAGE GRADE',bx+bw/2,by+46);
  c.fillStyle=SH.ink; c.font=shareFont(104,800);
  c.fillText(g.letter,bx+bw/2,by+154);
  c.fillStyle=SH.inkSoft; c.font=shareFont(21,700,true);
  c.fillText(g.score+' / 100',bx+bw/2,by+194);

  /* two supporting stats under the badge — the badge alone left the
     right-hand column looking half-finished */
  var sy=by+bh+52;
  var stats=[['AVG / SESSION',(t.n?num(t.wh/t.n,1):'0')+' Wh'],
             ['TOKENS',fmtTok(t.tok)]];
  var pv=prevTotals();
  if(pv && pv.wh>0.05){
    var pct=(t.wh-pv.wh)/pv.wh*100;
    stats[1]=['VS '+prevLabel().toUpperCase(),
              (Math.abs(pct)<3?'≈ flat':(pct>0?'▲ ':'▼ ')+num(Math.abs(pct),0)+'%')];
  }
  stats.forEach(function(s,i){
    var yy=sy+i*74;
    c.textAlign='right';
    c.fillStyle=SH.mut; c.font=shareFont(17,700,true);
    c.fillText(s[0],SHARE_W-M,yy);
    c.fillStyle=SH.ink; c.font=shareFont(34,800);
    c.fillText(s[1],SHARE_W-M,yy+38);
  });

  /* footer */
  c.strokeStyle=SH.line; c.lineWidth=1.5;
  c.beginPath(); c.moveTo(M,SHARE_H-M-82); c.lineTo(SHARE_W-M,SHARE_H-M-82); c.stroke();
  c.textAlign='left'; c.fillStyle=SH.ink; c.font=shareFont(26,700);
  c.fillText('Measure your own AI footprint',M,SHARE_H-M-36);
  c.fillStyle=SH.mut; c.font=shareFont(19,500,true);
  c.fillText('AI Impact Tracker · estimates, not meter readings · runs entirely offline',M,SHARE_H-M);

  return {t:t,g:g};
}

/* ---- caption text, so the numbers can travel as words too ---- */
function shareCaption(){
  var t=totals(filtered()), g=computeGrade(filtered());
  return 'My AI use for '+rangeLabel()+': '+
    (t.wh>=1000?num(t.wh/1000,2)+' kWh':num(t.wh,1)+' Wh')+' of energy, '+
    (t.ml>=1000?num(t.ml/1000,2)+' L':num(t.ml,0)+' mL')+' of water and '+
    (t.co2>=1000?num(t.co2/1000,2)+' kg':num(t.co2,0)+' g')+' CO₂e across '+
    num(t.n,0)+' sessions — usage grade '+g.letter+'. '+
    'Estimates, measured with a self-contained offline dashboard. #AIfootprint';
}

/* ---- modal wiring ---- */
var shareScrim=$('#shareScrim');
function openShare(){
  if(!shareScrim)return;
  var cv=$('#shareCanvas'); if(cv) drawShareCard(cv);
  var t=totals(filtered());
  setText('#shareMeta',rangeLabel()+' · '+num(t.n,0)+' sessions · 1080 × 1080 PNG');
  shareScrim.classList.remove('hidden'); document.body.style.overflow='hidden';
}
function closeShare(){
  if(!shareScrim)return;
  shareScrim.classList.add('hidden'); document.body.style.overflow='';
}
function shareFilename(){
  return 'ai-impact-'+rangeLabel().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')+'.png';
}
on('#shareBtn','click',openShare);
on('#shareClose','click',closeShare);
on(shareScrim,'click',function(e){ if(e.target===shareScrim)closeShare(); });
document.addEventListener('keydown',function(e){
  if(e.key==='Escape'&&shareScrim&&!shareScrim.classList.contains('hidden'))closeShare();
});

on('#shareDownload','click',function(){
  var cv=$('#shareCanvas'); if(!cv)return;
  /* a Blob rather than a data: URL — saveFile hands it over without reading
     it, which matters for a full-size share card */
  try{
    if(cv.toBlob){
      cv.toBlob(function(blob){
        if(!blob){ toast('✕ Could not build the image'); return; }
        saveFile(shareFilename(), blob, '✓ Image saved');
      },'image/png');
    }else{
      saveFile(shareFilename(), cv.toDataURL('image/png'), '✓ Image saved');
    }
  }catch(err){ toast('✕ Could not save the image'); }
});

on('#shareCopy','click',function(){
  var cv=$('#shareCanvas'); if(!cv)return;
  /* Clipboard image support is uneven — fall back to the download path
     rather than leaving the button doing nothing. */
  if(!(navigator.clipboard&&window.ClipboardItem&&cv.toBlob)){
    toast('Copying images isn\'t supported here — use Download instead'); return;
  }
  cv.toBlob(function(blob){
    if(!blob){ toast('✕ Could not build the image'); return; }
    try{
      navigator.clipboard.write([new ClipboardItem({'image/png':blob})])
        .then(function(){ toast('✓ Image copied'); },
              function(){ toast('Copy was blocked — use Download instead'); });
    }catch(err){ toast('Copy was blocked — use Download instead'); }
  },'image/png');
});

on('#shareCaption','click',function(){ copyText(shareCaption(),'✓ Caption copied'); });

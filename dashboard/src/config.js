/* ============================================================
   MODULE: config
   Central configuration, defaults, and persistence.
   - CONFIG is injected at build time from config/config.json
     (the CONFIG build placeholder below). Every value has a
     fallback default so the dashboard runs out-of-the-box
     even if the placeholder is never replaced.
   - SEED is injected at build time from a log file
     (the SEED build placeholder below).
   ============================================================ */

/* ---------- build-time injections ---------- */
var SEED = /*__SEED__*/[];
var BUILT = /*__BUILT__*/null;
var INJECTED = /*__CONFIG__*/null;

/* ---------- configurable values with hard fallbacks ---------- */
function cfg(path, fallback){
  var cur = INJECTED;
  for (var i = 0; i < path.length; i++){
    if (!cur || typeof cur !== 'object' || !(path[i] in cur)) return fallback;
    cur = cur[path[i]];
  }
  return (cur === null || cur === undefined) ? fallback : cur;
}

var CONFIG = {
  logFileName:   cfg(['logFileName'], '.environmental-impact-log.json'),
  seedSourceLabel: cfg(['seedSourceLabel'], 'sample data'),
  skillLoadTokens: cfg(['skillLoadTokens'], 2500)
};

var DEFAULT_RATES = {
  models: cfg(['rates','models'], {
    'opus':   {label:'Claude Opus 4.x',   inp:50, out:250, bl:240},
    'sonnet': {label:'Claude Sonnet 4.x', inp:30, out:150, bl:145},
    'haiku':  {label:'Claude Haiku 4.x',  inp:10, out:50,  bl:50},
    'fable':  {label:'Claude Fable 5',    inp:30, out:150, bl:145},
    'other':  {label:'Other / unknown',   inp:30, out:150, bl:145}
  }),
  waterFactor:   cfg(['rates','waterFactor'], 1.7),   // mL per Wh
  gridIntensity: cfg(['rates','gridIntensity'], 400)  // g CO2e per kWh
};

/* comparison constants (see Sources in the Methodology panel) */
var CMP_K = cfg(['comparisons'], {});
var C_PHONE_WH = CMP_K.phoneChargeWh || 12;
var C_LED_W    = CMP_K.ledBulbW      || 10;
var C_BOTTLE_ML= CMP_K.bottleMl      || 500;
var C_CUP_ML   = CMP_K.cupMl         || 240;
var C_MILE_G   = CMP_K.carMileG      || 404;
var C_KETTLE_WH= CMP_K.kettleBoilWh  || 100;

/* ---------- real-world (life) footprint factors ----------
   Every value is sourced in config/config.json under `_notes.life` and is
   restated in the Methodology panel. Hard fallbacks keep the panel working
   even when no config is injected. */
var LIFE_F = {
  gridUS:        cfg(['life','gridUS'], 367),      // g CO2e/kWh — US average generation (EIA 2023)
  elecKwhMo:     cfg(['life','elecKwhMo'], 881),   // US household average (EPA)
  gasCfMo:       cfg(['life','gasCfMo'], 4717),    // cubic feet/month, US household average (EPA)
  gasGPerCf:     cfg(['life','gasGPerCf'], 54.4),  // 0.12 lb CO2 per cubic foot (EPA)
  carGPerMile:   cfg(['life','carGPerMile'], 400), // EPA typical passenger vehicle
  milesYr:       cfg(['life','milesYr'], 11500),   // EPA average annual mileage
  evKwhPerMile:  cfg(['life','evKwhPerMile'], 0.35),
  embodiedIceKg: cfg(['life','embodiedIceKg'], 6000),
  embodiedBevKg: cfg(['life','embodiedBevKg'], 10000),
  vehicleLifeYears: cfg(['life','vehicleLifeYears'], 12),
  flightLongKg:  cfg(['life','flightLongKg'], 1600),
  flightShortKg: cfg(['life','flightShortKg'], 300),
  dietKgDay:     cfg(['life','dietKgDay'], {high:10.24,medium:7.3,low:5.86,vegetarian:3.8,vegan:2.47}),
  otherConsumptionKg: cfg(['life','otherConsumptionKg'], 4000),
  usPerCapitaKg: cfg(['life','usPerCapitaKg'], 15000)
};

/* Default life profile. Every field is optional and never leaves this browser. */
var LIFE_DEFAULT = {
  filled: false,            // has the user engaged with the form yet
  view: 'context',          // 'context' | 'avoided'
  adults: 1,
  children: 0,
  elecKwhMo: LIFE_F.elecKwhMo,
  gridG: LIFE_F.gridUS,
  renewablePct: 0,
  gasCfMo: LIFE_F.gasCfMo,
  diet: 'medium',
  carType: 'ice',           // 'none' | 'ice' | 'hybrid' | 'bev'
  milesYr: LIFE_F.milesYr,
  mpg: 22.2,
  carKeptYears: 3,          // how long they have had the current car
  keepInsteadOfNew: false,  // opt in to the deferred-manufacturing credit
  flightsLong: 0,
  flightsShort: 0,
  otherKg: LIFE_F.otherConsumptionKg,
  /* This tool only ever measures Claude. If the user splits their work across
     several assistants, their real AI footprint is larger than anything in the
     log — claudeSharePct is what lets us say so with a number instead of a
     shrug. 100 = Claude only, in which case no estimate is shown at all. */
  claudeSharePct: 100,
  /* self-set baselines — only used by the avoided-emissions ledger */
  baseMilesYr: LIFE_F.milesYr,
  baseDiet: 'high',
  baseFlightsLong: 0
};

/* ---------- localStorage persistence (safe: private mode etc.) ---------- */
var LS_DATA='eid_data_v1', LS_RATES='eid_rates_v1', LS_CHECKS='eid_checks_v1', LS_SRC='eid_src_v1', LS_OB='eid_onboarded_v1', LS_LIFE='eid_life_v1', LS_VIEW='eid_view_v1';
function load(k,f){ try{var v=localStorage.getItem(k);return v?JSON.parse(v):f;}catch(e){return f;} }
function save(k,v){ try{localStorage.setItem(k,JSON.stringify(v));}catch(e){} }

function mergeRates(saved){
  var r=JSON.parse(JSON.stringify(DEFAULT_RATES));
  if(saved){
    if(saved.waterFactor!=null)r.waterFactor=saved.waterFactor;
    if(saved.gridIntensity!=null)r.gridIntensity=saved.gridIntensity;
    if(saved.models)for(var k in saved.models){ if(r.models[k])for(var f in saved.models[k])r.models[k][f]=saved.models[k][f]; }
  }
  return r;
}

var rates  = mergeRates(load(LS_RATES,null));
var checks = load(LS_CHECKS,{});

/* life profile: saved values win, but any field the user has never seen
   falls back to the default so a new field never lands as undefined. */
var life = (function(){
  var l={}, saved=load(LS_LIFE,null)||{};
  for(var k in LIFE_DEFAULT) l[k] = (saved[k]===undefined||saved[k]===null) ? LIFE_DEFAULT[k] : saved[k];
  return l;
})();

/* In "logged data" mode the baked SEED is the source of truth — it is refreshed
   from the live log on every re-bake, so it must NOT be shadowed by an old
   localStorage copy. We only keep localStorage when the user has an ACTIVE
   manual import (a real filename or "pasted log"). Known auto-labels fall
   through to the fresh SEED. */
var AUTO_SRCS = {'my logged data':1,'sample data':1};
var savedSrc  = load(LS_SRC,null);
var savedData = load(LS_DATA,null);
var isImport  = savedSrc && !AUTO_SRCS[savedSrc];
var srcName   = isImport ? savedSrc : CONFIG.seedSourceLabel;
var DATA      = (isImport && savedData && savedData.length) ? savedData : SEED.slice();

/* ---------- mitigation checklist content ---------- */
var MIT=[
  {id:'ai',title:'AI-workflow choices',icon:'🤖',bg:'rgba(112,130,113,.18)',desc:'The fastest lever you control directly — every choice here cuts energy at the source.',acts:[
    {id:'ai1',t:'Use a lighter model (Haiku/Sonnet) for simple tasks',i:'up to ~5× less energy vs Opus'},
    {id:'ai2',t:'Batch related questions into one session',i:'fewer cold starts & repeated context'},
    {id:'ai3',t:'Edit & reuse prior outputs instead of regenerating',i:'avoids full re-compute'},
    {id:'ai4',t:'Be specific up front to avoid retry loops',i:'cuts wasted round-trips'},
    {id:'ai5',t:'Prefer text over image/video generation when it works',i:'media is far heavier per request'},
    {id:'ai6',t:'Trim pasted context you don’t actually need',i:'fewer input tokens'}
  ]},
  {id:'life',title:'Personal energy & lifestyle',icon:'🏡',bg:'rgba(62,94,74,.16)',desc:'Your AI footprint is tiny next to these — the highest-leverage personal reductions.',acts:[
    {id:'lf1',t:'Switch to a renewable electricity tariff / community solar',i:'can cut home power emissions sharply'},
    {id:'lf2',t:'Home efficiency: LEDs, insulation, smart thermostat',i:'hundreds of kg CO₂e/yr'},
    {id:'lf3',t:'Drive less — combine trips, transit, bike, or EV',i:'~404 g CO₂ per car-mile avoided'},
    {id:'lf4',t:'Shift toward more plant-based meals',i:'food is ~10–30% of a footprint'},
    {id:'lf5',t:'Fly less — one long-haul flight can dwarf a year of AI',i:'~1–3 t CO₂e per long flight'},
    {id:'lf6',t:'Lower heating/cooling a couple degrees',i:'easy standing reduction'}
  ]},
  {id:'off',title:'Offsets & clean energy',icon:'🌱',bg:'rgba(201,161,90,.20)',desc:'Reduce first — then neutralize the remainder with credible, verifiable purchases.',acts:[
    {id:'of1',t:'Prioritize durable carbon *removal* over cheap avoidance credits',i:'higher real climate value'},
    {id:'of2',t:'Buy only third-party-verified offsets (Gold Standard / vetted Verra)',i:'avoids junk credits'},
    {id:'of3',t:'Support removal marketplaces (e.g. Frontier-style CDR funds)',i:'scales new removal capacity'},
    {id:'of4',t:'Treat offsets as a last resort, not a license to emit',i:'reduction > compensation'},
    {id:'of5',t:'Scrutinize claims — many offsets under-deliver',i:'demand additionality & permanence'}
  ]},
  {id:'adv',title:'Advocacy & org-level',icon:'📣',bg:'rgba(110,139,144,.18)',desc:'Systemic change beats individual action — push the levers above your own usage.',acts:[
    {id:'ad1',t:'Ask AI providers to publish per-query energy/water & use renewables',i:'transparency drives efficiency'},
    {id:'ad2',t:'Push workplace green-compute policies (right-size models, low-carbon scheduling)',i:'org-scale savings'},
    {id:'ad3',t:'Prefer vendors powered by renewable energy',i:'shifts demand to clean grids'},
    {id:'ad4',t:'Support grid decarbonization & data-center transparency policy',i:'biggest structural lever'},
    {id:'ad5',t:'Share tools like this to normalize measuring impact',i:'awareness compounds'}
  ]}
];

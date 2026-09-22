(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SFCModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const RESOLUTION = 20;
  const MAX_ROUNDS = 6;
  const ZEUS_COST = 10_000_000;

  // Starfleet Commander wiki base stats/costs. Cost is Ore + Crystal + Hydrogen.
  // Zeus RF is from the Zeus Class wiki page. Defenses do not award DSP.
  const UNITS = {
    'Hermes Probe':       {kind:'ship', hull:100,     shield:0,      weapon:0,      cost:1_000,      zeusRF:1250},
    'Artemis':            {kind:'ship', hull:400,     shield:10,     weapon:50,     cost:4_000,      zeusRF:200},
    'Atlas':              {kind:'ship', hull:400,     shield:10,     weapon:5,      cost:4_000,      zeusRF:250},
    'Apollo':             {kind:'ship', hull:850,     shield:25,     weapon:150,    cost:8_500,      zeusRF:100},
    'Zagreus':            {kind:'ship', hull:800,     shield:5,      weapon:1,      cost:9_000,      zeusRF:500},
    'Charon':             {kind:'ship', hull:800,     shield:25,     weapon:1,      cost:9_000,      zeusRF:1250},
    'Hercules':           {kind:'ship', hull:1200,    shield:25,     weapon:5,      cost:12_000,     zeusRF:250},
    'Dionysus':           {kind:'ship', hull:1600,    shield:10,     weapon:1,      cost:18_000,     zeusRF:250},
    'Gaia':               {kind:'ship', hull:3000,    shield:100,    weapon:50,     cost:40_000,     zeusRF:250},
    'Carmanor':           {kind:'ship', hull:3600,    shield:100,    weapon:10,     cost:36_000,     zeusRF:125},
    'Poseidon':           {kind:'ship', hull:2700,    shield:50,     weapon:400,    cost:29_000,     zeusRF:33},
    'Athena':             {kind:'ship', hull:6000,    shield:200,    weapon:1000,   cost:60_000,     zeusRF:30},
    'Ares':               {kind:'ship', hull:7500,    shield:500,    weapon:1000,   cost:90_000,     zeusRF:25},
    'Hades':              {kind:'ship', hull:7000,    shield:400,    weapon:700,    cost:85_000,     zeusRF:15},
    'Prometheus':         {kind:'ship', hull:11000,   shield:500,    weapon:2000,   cost:125_000,    zeusRF:5},
    'Zeus':               {kind:'ship', hull:900000,  shield:50000,  weapon:200000, cost:10_000_000, zeusRF:1, heavy:true},
    'Hephaestus':         {kind:'ship', hull:4000000, shield:150000, weapon:0,      cost:50_000_000, zeusRF:1, heavy:true},
    'Missile Battery':    {kind:'defense', hull:200,   shield:20,    weapon:80,     cost:2_000,      zeusRF:200},
    'Laser Cannon':       {kind:'defense', hull:200,   shield:25,    weapon:100,    cost:2_000,      zeusRF:200},
    'Pulse Cannon':       {kind:'defense', hull:800,   shield:100,   weapon:250,    cost:8_000,      zeusRF:100},
    'Particle Cannon':    {kind:'defense', hull:800,   shield:500,   weapon:150,    cost:8_000,      zeusRF:100},
    'Gauss Cannon':       {kind:'defense', hull:3500,  shield:200,   weapon:1100,   cost:37_000,     zeusRF:50},
    'Plasma Cannon':      {kind:'defense', hull:10000, shield:300,   weapon:3000,   cost:130_000,    zeusRF:1},
    'Decoy':              {kind:'defense', hull:2000,  shield:2000,  weapon:0,      cost:20_000,     zeusRF:1},
    'Large Decoy':        {kind:'defense', hull:10000, shield:10000, weapon:0,      cost:100_000,    zeusRF:1}
  };

  const ALIASES = (() => {
    const a = {};
    for (const k of Object.keys(UNITS)) a[normalize(k)] = k;
    Object.assign(a, {
      'hermes': 'Hermes Probe', 'hermesclass': 'Hermes Probe', 'probe': 'Hermes Probe',
      'artemisclass': 'Artemis', 'artemisfighter': 'Artemis',
      'atlasclass': 'Atlas', 'atlascargo': 'Atlas',
      'apolloclass': 'Apollo', 'apollofighter': 'Apollo',
      'zagreusclass': 'Zagreus', 'zagreusrecycler': 'Zagreus',
      'charonclass': 'Charon', 'charontransport': 'Charon',
      'herculesclass': 'Hercules', 'herculescargo': 'Hercules',
      'dionysusclass': 'Dionysus', 'dionysusrecycler': 'Dionysus',
      'gaiaclass': 'Gaia', 'gaiacolonyship': 'Gaia',
      'carmanorclass': 'Carmanor', 'carmanorcargo': 'Carmanor',
      'poseidonclass': 'Poseidon', 'poseidoncruiser': 'Poseidon',
      'athenaclass': 'Athena', 'athenabattleship': 'Athena',
      'aresclass': 'Ares', 'aresbomber': 'Ares',
      'hadesclass': 'Hades', 'hadesbattleship': 'Hades',
      'prometheusclass': 'Prometheus', 'prometheusdestroyer': 'Prometheus', 'prom': 'Prometheus',
      'zeusclass': 'Zeus',
      'hephaestusclass': 'Hephaestus', 'hephaestusclassattackplatform': 'Hephaestus', 'heph': 'Hephaestus',
      'missile': 'Missile Battery', 'missilebattery': 'Missile Battery', 'missileturret': 'Missile Battery',
      'laser': 'Laser Cannon', 'lasercannon': 'Laser Cannon', 'laserturret': 'Laser Cannon',
      'pulse': 'Pulse Cannon', 'pulsecannon': 'Pulse Cannon',
      'particle': 'Particle Cannon', 'particlecannon': 'Particle Cannon',
      'gauss': 'Gauss Cannon', 'gausscannon': 'Gauss Cannon',
      'plasma': 'Plasma Cannon', 'plasmacannon': 'Plasma Cannon', 'plasmaturret': 'Plasma Cannon',
      'largedecoy': 'Large Decoy'
    });
    return a;
  })();

  function normalize(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function scaled(x, tech) { return x * (1 + 0.1 * Number(tech || 0)); }
  function rfContinue(r) { return !r || r <= 1 ? 0 : (r - 1) / r; }

  function parseCount(v) {
    if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? v : NaN;
    let s = String(v || '').trim().replace(/,/g, '').replace(/\s+/g, '');
    if (!s) return NaN;
    const m = s.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*([a-zA-Z]*)$/i);
    if (!m) return NaN;
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n < 0) return NaN;
    const suffix = m[2].toLowerCase();
    const mult = {
      '':1, k:1e3, m:1e6, b:1e9, t:1e12,
      q:1e15, qa:1e15, quadrillion:1e15,
      qi:1e18, quintillion:1e18,
      sx:1e21, sextillion:1e21,
      sp:1e24, septillion:1e24
    }[suffix];
    return mult ? n * mult : NaN;
  }

  function parseRoster(text) {
    const comp = {};
    const unknown = [];
    const lines = String(text || '').split(/\r?\n/);
    for (let raw of lines) {
      let line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      line = line.replace(/[•|]/g, ' ').replace(/\s+/g, ' ').trim();
      let namePart = '', countPart = '';
      let m = line.match(/^(.+?)\s*[:=]\s*([\d.,eE+\-]+\s*[a-zA-Z]*)$/);
      if (m) { namePart = m[1]; countPart = m[2]; }
      else {
        m = line.match(/^([\d.,eE+\-]+\s*[a-zA-Z]*)\s*(?:x|×)?\s+(.+)$/i);
        if (m) { countPart = m[1]; namePart = m[2]; }
        else {
          m = line.match(/^(.+?)\s+(?:x|×)?\s*([\d.,eE+\-]+\s*[a-zA-Z]*)$/i);
          if (m) { namePart = m[1]; countPart = m[2]; }
        }
      }
      if (!namePart) { unknown.push(raw); continue; }
      const key = ALIASES[normalize(namePart.replace(/\bclass\b/ig, ''))] || ALIASES[normalize(namePart)];
      const count = parseCount(countPart);
      if (!key || !Number.isFinite(count)) { unknown.push(raw); continue; }
      comp[key] = (comp[key] || 0) + count;
    }
    return {composition: comp, unknown};
  }


  // Battle reports are copied from HTML tables in several different text layouts
  // depending on browser/device. This parser intentionally accepts both row-style
  // entries ("Athena Class Battleship 50,000") and table-style copies where unit
  // names and counts appear in adjacent lines/columns. The first attacker/defender
  // snapshot is used so later-round repeats are not added to the starting fleet.
  const REPORT_UNIT_TERMS = (() => {
    const preferred = {
      'Hermes Probe':['hermes probe','hermes'],
      'Missile Battery':['missile battery','missile turret','missile'],
      'Laser Cannon':['laser cannon','laser turret','laser'],
      'Pulse Cannon':['pulse cannon','pulse'],
      'Particle Cannon':['particle cannon','particle'],
      'Gauss Cannon':['gauss cannon','gauss'],
      'Plasma Cannon':['plasma cannon','plasma turret','plasma'],
      'Large Decoy':['large decoy'],
      'Decoy':['decoy']
    };
    for (const key of Object.keys(UNITS)) {
      if (!preferred[key]) preferred[key] = [key.toLowerCase().split(/\s+/)[0]];
    }
    return Object.entries(preferred).map(([key,terms])=>({key,terms}));
  })();

  function escapeRegExp(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function reportUnitMatches(line) {
    const src=String(line||'');
    const found=[];
    for(const entry of REPORT_UNIT_TERMS){
      for(const term of entry.terms){
        const pattern=term.split(/\s+/).map(escapeRegExp).join('\\s+');
        const re=new RegExp('\\b'+pattern+'\\b','ig');
        let m;
        while((m=re.exec(src))){found.push({key:entry.key,index:m.index,end:m.index+m[0].length,length:m[0].length});if(!m[0].length)re.lastIndex++;}
      }
    }
    found.sort((a,b)=>a.index-b.index||b.length-a.length);
    const kept=[];
    for(const f of found){
      if(kept.some(k=>f.index<k.end&&f.end>k.index))continue;
      kept.push(f);
    }
    return kept.sort((a,b)=>a.index-b.index);
  }

  function reportNumberTokens(line) {
    const src=String(line||'');
    const out=[];
    const re=/(?:^|[\s|>])([+-]?(?:(?:\d{1,3}(?:,\d{3})+)|(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:e[+-]?\d+)?\s*(?:quadrillion|quintillion|sextillion|septillion|Qi|Qa|Sx|Sp|[KMBTQ])?)(?=$|[\s|<])/ig;
    let m;
    while((m=re.exec(src))){
      const raw=m[1].trim();
      const value=parseCount(raw);
      if(Number.isFinite(value)){
        const offset=m[0].indexOf(m[1]);
        out.push({raw,value,index:m.index+offset,end:m.index+offset+m[1].length});
      }
      if(!m[0].length)re.lastIndex++;
    }
    return out;
  }

  function detectReportSide(line) {
    const s=String(line||'').trim();
    if(!s||s.length>120)return null;
    if(/^(?:attacker|attacking\s+fleet|attackers)\b/i.test(s))return 'attacker';
    if(/^(?:defender|defending\s+fleet|defenders)\b/i.test(s))return 'defender';
    return null;
  }

  function extractTech(line, tech) {
    const src=String(line||'');
    const defs=[
      ['weapons',/(?:weapons?|weapon\s+tech(?:nology)?)\s*[:=]?\s*(\d{1,3})/i],
      ['shield',/(?:shields?|shield\s+tech(?:nology)?)\s*[:=]?\s*(\d{1,3})/i],
      ['armor',/(?:armor|armour|armor\s+tech(?:nology)?|armour\s+tech(?:nology)?)\s*[:=]?\s*(\d{1,3})/i]
    ];
    let hit=false;
    for(const [k,re] of defs){const m=src.match(re);if(m){tech[k]=Number(m[1]);hit=true;}}
    return hit;
  }

  function looksLikeTechHeader(line){
    const s=String(line||'').toLowerCase();
    return /weapon/.test(s)&&/shield/.test(s)&&/(?:armor|armour)/.test(s);
  }

  function parseReportSection(lines) {
    const composition={}, tech={};
    const pending=[];
    let pendingTech=false;
    let stoppedAtRound=false;

    const setFirst=(key,count)=>{if(key&&Number.isFinite(count)&&count>=0&&composition[key]===undefined)composition[key]=count;};
    const queue=(keys)=>{for(const k of keys)if(composition[k]===undefined&&!pending.includes(k))pending.push(k);};
    const consumePending=(nums)=>{
      let used=0;
      while(pending.length&&used<nums.length){setFirst(pending.shift(),nums[used++].value);}
      return used;
    };

    for(let i=0;i<lines.length;i++){
      let line=String(lines[i]||'').replace(/\u00a0/g,' ').trim();
      if(!line)continue;
      if(/^round\s+\d+\b/i.test(line)&&Object.keys(composition).length){stoppedAtRound=true;break;}

      const nums=reportNumberTokens(line);
      const hadTech=extractTech(line,tech);
      if(pendingTech&&nums.length>=3&&!reportUnitMatches(line).length){
        tech.weapons=nums[0].value;tech.shield=nums[1].value;tech.armor=nums[2].value;pendingTech=false;continue;
      }
      if(looksLikeTechHeader(line)&&!hadTech&&nums.length<3){pendingTech=true;continue;}

      const units=reportUnitMatches(line);
      if(!units.length){
        if(pending.length&&nums.length)consumePending(nums);
        continue;
      }

      if(units.length===1){
        const u=units[0];
        if(nums.length){
          const before=nums.filter(n=>n.end<=u.index);
          const after=nums.filter(n=>n.index>=u.end);
          const prefix=line.slice(0,u.index).trim();
          const prefixCount=/^[\d.,eE+\-]+\s*(?:quadrillion|quintillion|sextillion|septillion|Qi|Qa|Sx|Sp|[KMBTQ])?\s*(?:x|×)?$/i.test(prefix);
          const chosen=prefixCount&&before.length?before[before.length-1]:(after[0]||before[before.length-1]);
          if(chosen)setFirst(u.key,chosen.value);else queue([u.key]);
        }else queue([u.key]);
        continue;
      }

      // Multiple class names on one copied table row. If counts are on the same
      // line, associate each name with the first number before the next class;
      // otherwise queue the names for the following count row(s).
      let assigned=0;
      for(let j=0;j<units.length;j++){
        const start=units[j].end,end=j+1<units.length?units[j+1].index:Infinity;
        const n=nums.find(x=>x.index>=start&&x.index<end);
        if(n){setFirst(units[j].key,n.value);assigned++;}
      }
      if(assigned<units.length)queue(units.filter(u=>composition[u.key]===undefined).map(u=>u.key));
    }
    return {composition,tech,stoppedAtRound};
  }

  function parseBattleReport(text) {
    const lines=String(text||'').replace(/\r/g,'').split('\n');
    const segments=[];
    let current=null;
    let prelude=[];
    for(const raw of lines){
      const side=detectReportSide(raw);
      if(side){
        if(current)segments.push(current);
        current={side,lines:[raw]};
      }else if(current)current.lines.push(raw);else prelude.push(raw);
    }
    if(current)segments.push(current);

    const result={attacker:null,defender:null,unassigned:null,hasSideMarkers:segments.length>0};
    if(segments.length){
      for(const side of ['attacker','defender']){
        const seg=segments.find(x=>x.side===side);
        if(seg)result[side]=parseReportSection(seg.lines);
      }
    }else{
      const parsed=parseReportSection(prelude);
      if(Object.keys(parsed.composition).length)result.unassigned=parsed;
    }
    return result;
  }

  function makeState(count, hullMax, shieldMax) {
    const bins = Array.from({length: RESOLUTION + 1}, () => ({count:0, hullSum:0, shieldSum:0, hitWeight:0}));
    bins[RESOLUTION] = {count, hullSum:count, shieldSum:count * shieldMax, hitWeight:0};
    return {bins, hullMax, shieldMax};
  }

  function cloneState(state) {
    return {hullMax:state.hullMax, shieldMax:state.shieldMax, bins:state.bins.map(b => ({...b}))};
  }

  function stateCount(state) { return state.bins.reduce((s,b) => s + b.count, 0); }

  // Abramowitz-Stegun erf approximation, enough for PMF tail work here.
  function erf(x) {
    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    const a1=0.254829592, a2=-0.284496736, a3=1.421413741, a4=-1.453152027, a5=1.061405429, p=0.3275911;
    const t = 1/(1+p*x);
    const y = 1-(((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t*Math.exp(-x*x);
    return sign*y;
  }
  function normalCDF(z) { return 0.5 * (1 + erf(z / Math.SQRT2)); }

  function hitDistribution(lambda, killHits) {
    if (!(lambda > 0)) return [{k:0,p:1}];
    killHits = Math.max(1, Math.ceil(killHits));
    if (killHits === 1) return [{k:0,p:Math.exp(-lambda)}, {k:1,p:1-Math.exp(-lambda), tail:true}];

    const out = [];
    if (lambda <= 30) {
      let p = Math.exp(-lambda), sum = 0;
      const maxUseful = Math.min(killHits - 1, Math.max(8, Math.ceil(lambda + 9*Math.sqrt(lambda) + 8)), 300);
      for (let k=0; k<=maxUseful; k++) {
        if (k > 0) p *= lambda / k;
        if (p > 1e-16) out.push({k,p});
        sum += p;
      }
      const tail = Math.max(0, 1 - sum);
      if (tail > 1e-14) {
        if (maxUseful >= killHits - 1) out.push({k:killHits,p:tail,tail:true});
        else out.push({k:maxUseful+1,p:tail,approx:true});
      }
      return renorm(out);
    }

    const sd = Math.sqrt(lambda);
    // If the kill threshold is far below the mean, essentially all ships die.
    if (killHits < lambda - 9*sd) return [{k:killHits,p:1,tail:true}];
    const start = Math.max(0, Math.floor(lambda - 8*sd));
    const end = Math.min(killHits - 1, Math.ceil(lambda + 8*sd), 2000);
    let sum = 0;
    if (start > 0) {
      const pLow = normalCDF((start - 0.5 - lambda)/sd);
      if (pLow > 1e-14) { out.push({k:start,p:pLow,approx:true}); sum += pLow; }
    }
    for (let k=start; k<=end; k++) {
      const hi = normalCDF((k + 0.5 - lambda)/sd);
      const lo = normalCDF((k - 0.5 - lambda)/sd);
      const p = Math.max(0, hi-lo);
      if (p > 1e-14) { out.push({k,p,approx:true}); sum += p; }
    }
    const tail = Math.max(0, 1-sum);
    if (tail > 1e-14) out.push({k:killHits,p:tail,tail:true,approx:true});
    return renorm(out);
  }

  function renorm(arr) {
    const s = arr.reduce((a,x)=>a+x.p,0);
    if (!(s>0)) return [{k:0,p:1}];
    for (const x of arr) x.p /= s;
    return arr;
  }

  function binIndex(hullFrac) {
    if (!(hullFrac > 0)) return 0;
    return Math.max(1, Math.min(RESOLUTION, Math.ceil(hullFrac * RESOLUTION - 1e-12)));
  }

  function applyAttackGroup(state, totalShots, damage, bypassShield=false) {
    const total = stateCount(state);
    if (!(total > 0) || !(totalShots > 0) || !(damage > 0)) return;
    const lambda = totalShots / total;
    const next = Array.from({length: RESOLUTION + 1}, () => ({count:0,hullSum:0,shieldSum:0,hitWeight:0}));

    for (let i=1;i<=RESOLUTION;i++) {
      const b = state.bins[i];
      if (!(b.count > 0)) continue;
      const avgHullFrac = Math.min(1, Math.max(0, b.hullSum / b.count));
      const avgShield = Math.max(0, b.shieldSum / b.count);
      const oldHitProb = Math.min(1, Math.max(0, b.hitWeight / b.count));
      const durability = avgHullFrac * state.hullMax + (bypassShield ? 0 : avgShield);
      const killHits = Math.max(1, Math.ceil(durability / damage - 1e-12));
      const dist = hitDistribution(lambda, killHits);

      for (const o of dist) {
        const mass = b.count * o.p;
        if (!(mass > 0)) continue;
        const k = o.k;
        let hullFrac = avgHullFrac, shield = avgShield;
        if (o.tail && k >= killHits) {
          next[0].count += mass;
          continue;
        }
        const raw = k * damage;
        if (bypassShield) {
          hullFrac -= raw / state.hullMax;
        } else {
          const absorbed = Math.min(shield, raw);
          shield -= absorbed;
          hullFrac -= (raw - absorbed) / state.hullMax;
        }
        if (!(hullFrac > 0)) {
          next[0].count += mass;
          continue;
        }
        const j = binIndex(hullFrac);
        const newHitProb = k > 0 ? 1 : oldHitProb;
        next[j].count += mass;
        next[j].hullSum += mass * hullFrac;
        next[j].shieldSum += mass * shield;
        next[j].hitWeight += mass * newHitProb;
      }
    }
    state.bins = next;
  }

  function explodeAndReset(state) {
    const out = Array.from({length: RESOLUTION + 1}, () => ({count:0,hullSum:0,shieldSum:0,hitWeight:0}));
    for (let i=1;i<=RESOLUTION;i++) {
      const b = state.bins[i];
      if (!(b.count > 0)) continue;
      const f = Math.min(1, Math.max(0, b.hullSum / b.count));
      const pHit = Math.min(1, Math.max(0, b.hitWeight / b.count));
      const pExplode = f < 0.70 ? pHit * (1-f) : 0;
      const survive = b.count * (1-pExplode);
      if (!(survive > 0)) continue;
      out[i].count = survive;
      out[i].hullSum = survive * f;
      out[i].shieldSum = survive * state.shieldMax;
      out[i].hitWeight = 0;
    }
    state.bins = out;
  }

  function applyZeusToHeavy(state, hits, zWeapon) {
    applyAttackGroup(state, hits, zWeapon, false);
    explodeAndReset(state);
  }

  function threatValue(comp, defenderTech, attackerTech) {
    const zShield = scaled(UNITS.Zeus.shield, (attackerTech || {}).shield || 0);
    let total = 0;
    for (const [name,count] of Object.entries(comp || {})) {
      const u = UNITS[name];
      if (!u || !(count > 0) || !(u.weapon > 0)) continue;
      const damage = scaled(u.weapon, (defenderTech || {}).weapons || 0);
      // The combat engine ignores an individual shot at or below 1% of target shielding.
      if (damage <= 0.01 * zShield) continue;
      total += count * damage;
    }
    return total;
  }

  function initialZeusShotFactor(comp) {
    const total = Object.values(comp).reduce((a,b)=>a+b,0);
    if (!(total>0)) return 1;
    let c = 0;
    for (const [name,count] of Object.entries(comp)) {
      const u = UNITS[name];
      c += (count/total) * rfContinue(u ? u.zeusRF : 1);
    }
    c = Math.min(0.999999999999, Math.max(0,c));
    return 1/(1-c);
  }

  function simulate(input) {
    const comp0 = {...input.composition};
    const z0 = Number(input.zeusCount);
    const atk = input.attackerTech || {weapons:0,shield:0,armor:0};
    const def = input.defenderTech || {weapons:0,shield:0,armor:0};
    const rfSigma = Number(input.rfSigma || 0); // 0 = mean; positive is conservative lower attacker RF.
    if (!(z0 > 0)) throw new Error('Zeus count must be positive.');

    const zBase = UNITS.Zeus;
    const zHull = scaled(zBase.hull, atk.armor);
    const zShield = scaled(zBase.shield, atk.shield);
    const zWeapon = scaled(zBase.weapon, atk.weapons);
    const zState = makeState(z0, zHull, zShield);

    const defenders = {};
    const heavy = {};
    for (const [name,count] of Object.entries(comp0)) {
      if (!(count > 0) || !UNITS[name]) continue;
      defenders[name] = count;
      const u=UNITS[name];
      const targetHull=scaled(u.hull,def.armor), targetShield=scaled(u.shield,def.shield);
      const zeusEffective = zWeapon > 0.01*targetShield;
      const oneHit = zeusEffective && zWeapon >= targetHull + targetShield;
      if (!oneHit) heavy[name] = makeState(count, targetHull, targetShield);
    }

    const initialDSP = Object.entries(defenders).reduce((s,[name,c]) => {
      const u=UNITS[name]; return s + (u.kind==='ship' ? c*u.cost/1000 : 0);
    },0);
    const initialShipValue = initialDSP*1000;
    const initialTargets = Object.values(defenders).reduce((a,b)=>a+b,0);
    const initialThreat = threatValue(defenders, def, atk);
    const roundDetails=[];

    for (let round=1; round<=MAX_ROUNDS; round++) {
      const startDef = {};
      for (const [name,c] of Object.entries(defenders)) if (c>1e-12) startDef[name]=c;
      const totalDef = Object.values(startDef).reduce((a,b)=>a+b,0);
      const aliveZ = stateCount(zState);
      if (!(aliveZ>1e-12) || !(totalDef>1e-12)) break;

      // Defender fires using start-of-round counts (combat is simultaneous).
      for (const [name,count] of Object.entries(startDef)) {
        const u=UNITS[name];
        let damage = scaled(u.weapon, def.weapons);
        if (!(damage>0)) continue;
        // <= 1% of target shielding is ineffective.
        if (damage <= 0.01*zShield) continue;
        applyAttackGroup(zState, count, damage, false);
      }
      explodeAndReset(zState);

      // Zeus expected rapid-fire chain against the start-of-round defender mix.
      let cRF=0;
      for (const [name,count] of Object.entries(startDef)) cRF += (count/totalDef)*rfContinue(UNITS[name].zeusRF);
      cRF=Math.min(0.999999999999,Math.max(0,cRF));
      let zShots = aliveZ/(1-cRF);
      // Wiki LBA says final RF shots get a 2% standard-deviation Gaussian variation.
      // In deterministic mode rfSigma=0. Positive values represent a conservative low-shot sensitivity case.
      zShots *= Math.max(0, 1 - 0.02*Math.max(0,rfSigma));
      zShots = Math.max(aliveZ, zShots);
      const lambda = zShots/totalDef;

      for (const [name,countStart] of Object.entries(startDef)) {
        const u=UNITS[name];
        const hits = countStart*lambda;
        if (heavy[name]) {
          const targetShield=scaled(u.shield,def.shield);
          if (zWeapon > 0.01*targetShield) applyZeusToHeavy(heavy[name], hits, zWeapon);
          defenders[name]=stateCount(heavy[name]);
        } else {
          // In normal AWS ranges this covers every listed unit except Zeus/Hephaestus, matching the wiki.
          defenders[name]=countStart*Math.exp(-lambda);
        }
      }

      const shipDSPRemaining = Object.entries(defenders).reduce((s,[name,c])=>{
        const u=UNITS[name]; return s+(u.kind==='ship'?c*u.cost/1000:0);
      },0);
      const aliveAfter = stateCount(zState);
      const remainingThreat = threatValue(defenders, def, atk);
      roundDetails.push({
        round,
        aliveZeus:aliveAfter,
        zeusSurvival:aliveAfter/z0,
        totalDefenders:Object.values(defenders).reduce((a,b)=>a+b,0),
        dspDestroyed:initialDSP-shipDSPRemaining,
        dspDestroyedFraction:initialDSP>0?(initialDSP-shipDSPRemaining)/initialDSP:0,
        threatRemaining:remainingThreat,
        threatDestroyedFraction:initialThreat>0?1-remainingThreat/initialThreat:1
      });
    }

    const aliveZ = stateCount(zState);
    const remainingDSP = Object.entries(defenders).reduce((s,[name,c])=>{
      const u=UNITS[name]; return s+(u.kind==='ship'?c*u.cost/1000:0);
    },0);
    const remainingTargets = Object.values(defenders).reduce((a,b)=>a+b,0);
    const destroyedDSP = Math.max(0,initialDSP-remainingDSP);
    const survival = Math.max(0,Math.min(1,aliveZ/z0));
    return {
      zeusCount:z0,
      zeusSurvival:survival,
      zeusLossFraction:1-survival,
      zeusLosses:z0-aliveZ,
      zeusResourcesLost:(z0-aliveZ)*ZEUS_COST,
      initialDSP,
      destroyedDSP,
      dspDestroyedFraction:initialDSP>0?destroyedDSP/initialDSP:0,
      initialShipValue,
      remainingTargets,
      targetDestroyedFraction:initialTargets>0?1-remainingTargets/initialTargets:0,
      initialThreat,
      remainingThreat:threatValue(defenders, def, atk),
      threatDestroyedFraction:initialThreat>0?1-threatValue(defenders, def, atk)/initialThreat:1,
      efficiencyPerCommittedZeus:z0>0?destroyedDSP/z0:0,
      efficiencyPerLostZeus:(z0-aliveZ)>0?destroyedDSP/(z0-aliveZ):Infinity,
      roundDetails,
      defenders
    };
  }

  function autoRange(comp, attackerTech, defenderTech, survivalTarget=0.9999, rfSigma=0) {
    const total=Object.values(comp).reduce((a,b)=>a+b,0);
    const shotFactor=initialZeusShotFactor(comp);
    let center=Math.max(1,total/Math.max(1,shotFactor));
    let lo=Math.max(1,center/50), hi=Math.max(lo*10,center*20);
    for (let i=0;i<14;i++) {
      const r=simulate({composition:comp,zeusCount:hi,attackerTech,defenderTech,rfSigma});
      if (r.zeusSurvival>=survivalTarget && (r.initialDSP===0 || r.dspDestroyedFraction>=0.999)) break;
      hi*=2;
    }
    return {lo,hi,center};
  }

  function sweep(input) {
    const points=Math.max(12,Math.min(100,Number(input.points||45)));
    const range=input.range || autoRange(input.composition,input.attackerTech,input.defenderTech,input.survivalTarget,input.rfSigma);
    const lo=Math.max(1,range.lo), hi=Math.max(lo*1.0001,range.hi);
    const l0=Math.log(lo), l1=Math.log(hi), out=[];
    for(let i=0;i<points;i++){
      const z=Math.exp(l0+(l1-l0)*i/(points-1));
      out.push(simulate({...input,zeusCount:z}));
    }
    return {points:out,range:{lo,hi}};
  }

  function findBreakpoint(input, destructionFraction, survivalTarget, lo, hi) {
    function ok(z){
      const r=simulate({...input,zeusCount:z});
      return {ok:r.zeusSurvival>=survivalTarget && r.dspDestroyedFraction>=destructionFraction,r};
    }
    let h=hi, chk=ok(h), grow=0;
    while(!chk.ok && grow<20){ h*=2; chk=ok(h); grow++; }
    if(!chk.ok) return null;
    let l=Math.max(1,lo);
    // Ensure low bound is infeasible; if not, shrink it.
    let lowChk=ok(l), shrink=0;
    while(lowChk.ok && l>1 && shrink<20){ h=l; l=Math.max(1,l/2); lowChk=ok(l); shrink++; }
    for(let i=0;i<28;i++){
      const m=Math.sqrt(l*h);
      const c=ok(m);
      if(c.ok) h=m; else l=m;
      if(h/l < 1.00001) break;
    }
    return ok(h).r;
  }

  function breakpointTable(input, fractions, survivalTarget, range) {
    return fractions.map(f=>({fraction:f,result:findBreakpoint(input,f,survivalTarget,range.lo,range.hi)}));
  }

  function findKnee(points, survivalTarget) {
    const feasible = (points || []).filter(p => p.zeusSurvival >= survivalTarget && Number.isFinite(p.zeusCount))
      .slice().sort((a,b)=>a.zeusCount-b.zeusCount);
    if (feasible.length < 3) return feasible[0] || null;
    const xs = feasible.map(p=>Math.log(Math.max(1,p.zeusCount)));
    const ys = feasible.map(p=>p.dspDestroyedFraction);
    const xmin=xs[0], xmax=xs[xs.length-1], ymin=ys[0], ymax=ys[ys.length-1];
    if (!(xmax>xmin) || !(ymax>ymin+1e-8)) return feasible[0];
    let best=null;
    for(let i=1;i<feasible.length-1;i++){
      const xn=(xs[i]-xmin)/(xmax-xmin);
      const yn=(ys[i]-ymin)/(ymax-ymin);
      const score=yn-xn;
      const dy=ys[i+1]-ys[i-1];
      const dx=xs[i+1]-xs[i-1];
      const gainPer10PctZeus=dx>0 ? dy/dx*Math.log(1.10) : 0;
      const candidate={...feasible[i],kneeScore:score,gainPer10PctZeus};
      if(!best || candidate.kneeScore>best.kneeScore) best=candidate;
    }
    return best || feasible[0];
  }

  function frontierMatrix(input, destructionFractions, survivalTargets, range) {
    return survivalTargets.map(survivalTarget => ({
      survivalTarget,
      rows: breakpointTable(input, destructionFractions, survivalTarget, range)
    }));
  }

  return {UNITS,parseCount,parseRoster,parseBattleReport,simulate,sweep,autoRange,breakpointTable,frontierMatrix,findKnee,threatValue,formatCount,initialZeusShotFactor};

  function formatCount(x) {
    if (!Number.isFinite(x)) return '—';
    const abs=Math.abs(x);
    const units=[['Sp',1e24],['Sx',1e21],['Qi',1e18],['Qa',1e15],['T',1e12],['B',1e9],['M',1e6],['K',1e3]];
    for(const [s,v] of units) if(abs>=v) return (x/v).toLocaleString(undefined,{maximumFractionDigits:3})+s;
    return x.toLocaleString(undefined,{maximumFractionDigits:0});
  }
});

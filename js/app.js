(function(){
  'use strict';
  const M=Object.assign({},window.SFCUnits,window.SFCBattleReportParser,window.SFCCombat,window.SFCOptimizer);
  const $=id=>document.getElementById(id);
  const sample=`# Sample NPC\nHades: 100M\nAthena: 50M\nPrometheus: 10M\nGauss Cannon: 200M\nPlasma Cannon: 20M\nLarge Decoy: 1`;
  const DEFAULT_DESTRUCTION_LEVELS=[.25,.5,.75,.9,.95,.99];
  const DEFAULT_SURVIVAL_LEVELS=[.99,.999,.9999,.99999];
  let lastSweep=null,lastCfg=null,lastKnee=null,lastReportParse=null;

  function tech(prefix){return {weapons:+$(prefix+'w').value||0,shield:+$(prefix+'s').value||0,armor:+$(prefix+'a').value||0};}
  function pct(x,d=4){return Number.isFinite(x)?(100*x).toLocaleString(undefined,{minimumFractionDigits:Math.min(2,d),maximumFractionDigits:d})+'%':'—';}
  function pp(x,d=2){return Number.isFinite(x)?(100*x).toLocaleString(undefined,{maximumFractionDigits:d})+' pp':'—';}
  function num(x,d=2){return Number.isFinite(x)?x.toLocaleString(undefined,{maximumFractionDigits:d}):'—';}

  function parse(){
    const p=M.parseRoster($('roster').value);
    const n=Object.keys(p.composition).length;
    if(!n){$('parseStatus').textContent='No recognized units yet.';$('parseStatus').className='status error';return null;}
    const total=Object.values(p.composition).reduce((a,b)=>a+b,0);
    $('parseStatus').textContent=`${n} unit types · ${M.formatCount(total)} total targets`+(p.unknown.length?` · ${p.unknown.length} unparsed line(s)`:'');
    $('parseStatus').className=p.unknown.length?'status error':'status';
    return p;
  }

  function config(comp){return {composition:comp,attackerTech:tech('a'),defenderTech:tech('d'),survivalTarget:+$('survival').value,rfSigma:+$('rfSigma').value};}


  function compositionToRoster(comp){
    return Object.entries(comp||{}).filter(([,c])=>Number.isFinite(c)&&c>=0).map(([name,count])=>`${name}: ${String(count)}`).join('\n');
  }

  function reportSideCard(label,key,data){
    if(!data||!Object.keys(data.composition||{}).length)return '';
    const entries=Object.entries(data.composition);
    const total=entries.reduce((s,[,c])=>s+c,0);
    const techs=data.tech||{};
    const techBits=[['W',techs.weapons],['S',techs.shield],['A',techs.armor]].filter(([,v])=>Number.isFinite(v)).map(([k,v])=>`${k}${v}`);
    const list=entries.slice(0,7).map(([name,count])=>`<li><span>${name}</span><strong>${M.formatCount(count)}</strong></li>`).join('');
    const more=entries.length>7?`<li class="more"><span>+ ${entries.length-7} more classes</span></li>`:'';
    return `<article class="report-side-card"><div class="report-side-head"><div><span class="side-label">${label}</span><strong>${entries.length} types · ${M.formatCount(total)} units</strong></div><span class="tech-pill">${techBits.length?techBits.join(' · '):'AWS not detected'}</span></div><ul>${list}${more}</ul><button class="ghost import-side-btn" type="button" data-report-side="${key}">Use ${label.toLowerCase()} as NPC fleet</button></article>`;
  }

  function parseBattleReportUI(){
    const text=$('reportText').value.trim();
    if(!text){$('reportStatus').textContent='Paste a report first.';$('reportStatus').className='status error';$('reportPreview').classList.add('hidden');return;}
    const parsed=M.parseBattleReport(text);lastReportParse=parsed;
    const available=[];
    if(parsed.attacker&&Object.keys(parsed.attacker.composition).length)available.push(['Attacker','attacker',parsed.attacker]);
    if(parsed.defender&&Object.keys(parsed.defender.composition).length)available.push(['Defender','defender',parsed.defender]);
    if(parsed.unassigned&&Object.keys(parsed.unassigned.composition).length)available.push(['Detected fleet','unassigned',parsed.unassigned]);
    if(!available.length){
      $('reportStatus').textContent='No currently supported ship/defense classes were recognized. Try copying the fleet table together with its Attacker/Defender heading.';
      $('reportStatus').className='status error';$('reportPreview').classList.add('hidden');return;
    }
    $('reportStatus').textContent=`Found ${available.map(([label,,d])=>`${label.toLowerCase()}: ${Object.keys(d.composition).length} class${Object.keys(d.composition).length===1?'':'es'}`).join(' · ')}.`;
    $('reportStatus').className='status';
    $('reportPreview').innerHTML=available.map(([label,key,data])=>reportSideCard(label,key,data)).join('');
    $('reportPreview').classList.remove('hidden');
  }

  function applyReportSide(key){
    const data=lastReportParse&&lastReportParse[key];
    if(!data||!Object.keys(data.composition||{}).length)return;
    $('roster').value=compositionToRoster(data.composition);
    const t=data.tech||{};
    if(Number.isFinite(t.weapons))$('dw').value=t.weapons;
    if(Number.isFinite(t.shield))$('ds').value=t.shield;
    if(Number.isFinite(t.armor))$('da').value=t.armor;
    parse();
    const foundTech=['weapons','shield','armor'].filter(k=>Number.isFinite(t[k])).length;
    $('reportStatus').textContent=`Imported ${Object.keys(data.composition).length} unit classes into the NPC fleet${foundTech===3?' and loaded NPC AWS tech levels':foundTech?' and loaded the detected NPC tech levels':' (AWS was not present, so existing NPC tech settings were kept)'}.`;
    $('reportStatus').className='status success';
    $('roster').scrollIntoView({behavior:'smooth',block:'center'});
  }

  function readLevels(id,defaults){
    const raw=$(id).value.split(/[\s,;]+/).map(x=>x.trim()).filter(Boolean);
    const vals=[];
    for(const token of raw){
      let v=Number(token.replace('%',''));
      if(!Number.isFinite(v))continue;
      if(v>1)v/=100;
      if(v>0&&v<=1)vals.push(v);
    }
    const unique=[...new Set(vals.map(v=>+v.toFixed(9)))].sort((a,b)=>a-b).slice(0,10);
    return unique.length?unique:defaults.slice();
  }

  function renderMetrics(sweep,bps,target,knee,cfg){
    const feasible=sweep.points.filter(p=>p.zeusSurvival>=target);
    const best=feasible.reduce((a,b)=>!a||b.dspDestroyedFraction>a.dspDestroyedFraction?b:a,null);
    const first=bps.find(x=>x.result);
    const cards=[
      ['Survival constraint',pct(target,5)],
      ['Efficiency-knee Zeus',knee?M.formatCount(knee.zeusCount):'—'],
      ['Knee DSP destroyed',knee?pct(knee.dspDestroyedFraction,3):'—'],
      ['Knee threat removed',knee?pct(knee.threatDestroyedFraction,3):'—'],
      ['Max DSP in sweep',best?pct(best.dspDestroyedFraction,3):'—'],
      ['Initial Zeus RF shots / Zeus',num(M.initialZeusShotFactor(cfg.composition),2)+'×'],
      ['First configured breakpoint',first?M.formatCount(first.result.zeusCount):'—']
    ];
    $('metrics').innerHTML=cards.map(([k,v])=>`<div class="metric"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('');
  }

  function renderKnee(knee){
    if(!knee){$('kneeSummary').innerHTML='<p class="hint">No feasible knee point was found in the current sweep.</p>';return;}
    $('kneeSummary').innerHTML=`
      <div class="knee-main"><span class="knee-count">${M.formatCount(knee.zeusCount)}</span><span class="knee-label">Zeus committed</span></div>
      <div class="knee-facts">
        <div><span>${pct(knee.zeusSurvival,5)}</span><small>Zeus survival</small></div>
        <div><span>${pct(knee.dspDestroyedFraction,3)}</span><small>Ship DSP destroyed</small></div>
        <div><span>${pct(knee.threatDestroyedFraction,3)}</span><small>Threat removed</small></div>
        <div><span>${M.formatCount(knee.zeusLosses)}</span><small>Expected Zeus lost</small></div>
        <div><span>${pp(knee.gainPer10PctZeus,2)}</span><small>Approx. DSP gain for +10% Zeus here</small></div>
      </div>`;
  }

  function renderTable(rows){
    $('breakpoints').innerHTML=rows.map(({fraction,result:r})=>{
      if(!r)return `<tr><td>${pct(fraction,1)}</td><td colspan="5">Not reached in search range</td></tr>`;
      return `<tr><td>${pct(fraction,1)}</td><td>${M.formatCount(r.zeusCount)}</td><td>${pct(r.zeusSurvival,5)}</td><td>${M.formatCount(r.zeusLosses)}</td><td>${pct(r.threatDestroyedFraction,3)}</td><td>${num(r.efficiencyPerCommittedZeus,3)}</td></tr>`;
    }).join('');
  }

  function renderMatrix(matrix,destructionLevels){
    $('matrixHead').innerHTML='<tr><th>DSP destroyed</th>'+matrix.map(col=>`<th>${pct(col.survivalTarget,4)} survival</th>`).join('')+'</tr>';
    $('matrixBody').innerHTML=destructionLevels.map((fraction,rowIndex)=>{
      const cells=matrix.map(col=>{
        const r=col.rows[rowIndex]&&col.rows[rowIndex].result;
        return `<td>${r?M.formatCount(r.zeusCount):'—'}</td>`;
      }).join('');
      return `<tr><td>${pct(fraction,1)}</td>${cells}</tr>`;
    }).join('');
  }

  function renderRoundTable(knee){
    if(!knee||!knee.roundDetails.length){$('roundTable').innerHTML='<tr><td colspan="5">No combat rounds simulated.</td></tr>';return;}
    $('roundTable').innerHTML=knee.roundDetails.map(r=>`<tr><td>${r.round}</td><td>${pct(r.zeusSurvival,5)}</td><td>${pct(r.dspDestroyedFraction,3)}</td><td>${pct(r.threatDestroyedFraction,3)}</td><td>${M.formatCount(r.totalDefenders)}</td></tr>`).join('');
  }

  function samePoint(a,b){return !!a&&!!b&&Math.abs(Math.log(a.zeusCount/b.zeusCount))<1e-10;}

  function renderChart(points,target,knee){
    const W=960,H=440,m={l:68,r:24,t:24,b:54};
    const surv=points.map(p=>p.zeusSurvival), dsp=points.map(p=>p.dspDestroyedFraction);
    const xmin=Math.max(0.9,Math.min(...surv)-0.002), xmax=1;
    const ymin=0,ymax=Math.min(1,Math.max(.1,Math.max(...dsp)*1.03));
    const x=v=>m.l+(W-m.l-m.r)*(v-xmin)/(xmax-xmin||1), y=v=>H-m.b-(H-m.t-m.b)*(v-ymin)/(ymax-ymin||1);
    let path='';points.forEach((p,i)=>{path+=(i?'L':'M')+x(p.zeusSurvival).toFixed(2)+','+y(p.dspDestroyedFraction).toFixed(2)+' ';});
    const xticks=5,yticks=5;let grid='';
    for(let i=0;i<=xticks;i++){const v=xmin+(xmax-xmin)*i/xticks;grid+=`<line x1="${x(v)}" y1="${m.t}" x2="${x(v)}" y2="${H-m.b}" class="gridline"/><text x="${x(v)}" y="${H-m.b+23}" text-anchor="middle" class="axis">${(100*v).toFixed(v>0.999?3:1)}%</text>`;}
    for(let i=0;i<=yticks;i++){const v=ymin+(ymax-ymin)*i/yticks;grid+=`<line x1="${m.l}" y1="${y(v)}" x2="${W-m.r}" y2="${y(v)}" class="gridline"/><text x="${m.l-10}" y="${y(v)+4}" text-anchor="end" class="axis">${(100*v).toFixed(0)}%</text>`;}
    const tx=x(target);
    const circles=points.map(p=>{
      const isK=samePoint(p,knee), good=p.zeusSurvival>=target;
      return `<circle cx="${x(p.zeusSurvival)}" cy="${y(p.dspDestroyedFraction)}" r="${isK?7:(good?4.8:3.3)}" class="${isK?'pt-knee':(good?'pt-good':'pt-muted')}"><title>${M.formatCount(p.zeusCount)} Zeus\nSurvival ${(100*p.zeusSurvival).toFixed(5)}%\nDSP destroyed ${(100*p.dspDestroyedFraction).toFixed(3)}%\nThreat removed ${(100*p.threatDestroyedFraction).toFixed(3)}%</title></circle>`;
    }).join('');
    $('chart').innerHTML=`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"><style>.axis{fill:#94a8b7;font:12px system-ui}.gridline{stroke:#243746;stroke-width:1}.curve{fill:none;stroke:#87a7ba;stroke-width:2}.target{stroke:#73e0ad;stroke-dasharray:6 5;stroke-width:1.4}.pt-good{fill:#73e0ad;stroke:#071019;stroke-width:1.5}.pt-muted{fill:#62798b;stroke:#071019;stroke-width:1}.pt-knee{fill:#ffd07a;stroke:#071019;stroke-width:2}.label{fill:#c8d7df;font:13px system-ui;font-weight:600}</style>${grid}<line x1="${tx}" y1="${m.t}" x2="${tx}" y2="${H-m.b}" class="target"/><path d="${path}" class="curve"/>${circles}<text x="${(m.l+W-m.r)/2}" y="${H-10}" text-anchor="middle" class="label">Zeus survival</text><text x="18" y="${(m.t+H-m.b)/2}" text-anchor="middle" transform="rotate(-90 18 ${(m.t+H-m.b)/2})" class="label">Defender ship DSP destroyed</text></svg>`;
  }

  function renderCommitmentChart(points,target,knee){
    const W=960,H=420,m={l:68,r:24,t:24,b:58};
    const logs=points.map(p=>Math.log10(Math.max(1,p.zeusCount))), ys=points.map(p=>p.dspDestroyedFraction);
    const xmin=Math.min(...logs),xmax=Math.max(...logs),ymax=Math.min(1,Math.max(.1,Math.max(...ys)*1.03));
    const xlog=v=>m.l+(W-m.l-m.r)*(v-xmin)/(xmax-xmin||1), y=v=>H-m.b-(H-m.t-m.b)*v/(ymax||1);
    let grid='';
    for(let i=0;i<=5;i++){const lv=xmin+(xmax-xmin)*i/5;const count=Math.pow(10,lv);grid+=`<line x1="${xlog(lv)}" y1="${m.t}" x2="${xlog(lv)}" y2="${H-m.b}" class="gridline"/><text x="${xlog(lv)}" y="${H-m.b+23}" text-anchor="middle" class="axis">${M.formatCount(count)}</text>`;}
    for(let i=0;i<=5;i++){const v=ymax*i/5;grid+=`<line x1="${m.l}" y1="${y(v)}" x2="${W-m.r}" y2="${y(v)}" class="gridline"/><text x="${m.l-10}" y="${y(v)+4}" text-anchor="end" class="axis">${(100*v).toFixed(0)}%</text>`;}
    let path='';points.forEach((p,i)=>{path+=(i?'L':'M')+xlog(Math.log10(Math.max(1,p.zeusCount))).toFixed(2)+','+y(p.dspDestroyedFraction).toFixed(2)+' ';});
    const circles=points.map(p=>{const isK=samePoint(p,knee),good=p.zeusSurvival>=target;return `<circle cx="${xlog(Math.log10(Math.max(1,p.zeusCount)))}" cy="${y(p.dspDestroyedFraction)}" r="${isK?7:(good?4.5:3.2)}" class="${isK?'pt-knee':(good?'pt-good':'pt-muted')}"><title>${M.formatCount(p.zeusCount)} Zeus\nSurvival ${(100*p.zeusSurvival).toFixed(5)}%\nDSP ${(100*p.dspDestroyedFraction).toFixed(3)}%</title></circle>`;}).join('');
    const kneeLine=knee?`<line x1="${xlog(Math.log10(knee.zeusCount))}" y1="${m.t}" x2="${xlog(Math.log10(knee.zeusCount))}" y2="${H-m.b}" class="kneeline"/>`:'';
    $('commitmentChart').innerHTML=`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"><style>.axis{fill:#94a8b7;font:12px system-ui}.gridline{stroke:#243746;stroke-width:1}.curve{fill:none;stroke:#87a7ba;stroke-width:2}.kneeline{stroke:#ffd07a;stroke-dasharray:5 5;stroke-width:1.3}.pt-good{fill:#73e0ad;stroke:#071019;stroke-width:1.5}.pt-muted{fill:#62798b;stroke:#071019;stroke-width:1}.pt-knee{fill:#ffd07a;stroke:#071019;stroke-width:2}.label{fill:#c8d7df;font:13px system-ui;font-weight:600}</style>${grid}${kneeLine}<path d="${path}" class="curve"/>${circles}<text x="${(m.l+W-m.r)/2}" y="${H-10}" text-anchor="middle" class="label">Zeus committed (log scale)</text><text x="18" y="${(m.t+H-m.b)/2}" text-anchor="middle" transform="rotate(-90 18 ${(m.t+H-m.b)/2})" class="label">Defender ship DSP destroyed</text></svg>`;
  }

  function exportCSV(){
    if(!lastSweep)return;
    const header=['zeus_count','zeus_survival','zeus_losses','dsp_destroyed_fraction','threat_destroyed_fraction','dsp_per_committed_zeus','knee_candidate'];
    const lines=[header.join(',')];
    for(const p of lastSweep.points){lines.push([p.zeusCount,p.zeusSurvival,p.zeusLosses,p.dspDestroyedFraction,p.threatDestroyedFraction,p.efficiencyPerCommittedZeus,samePoint(p,lastKnee)?1:0].join(','));}
    const blob=new Blob([lines.join('\n')],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download='sfc-zeus-frontier.csv';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),0);
  }

  function run(){
    const parsed=parse();if(!parsed)return;
    const cfg=config(parsed.composition);
    $('runBtn').disabled=true;$('runBtn').textContent='Calculating…';
    try{
      const destructionLevels=readLevels('dspLevels',DEFAULT_DESTRUCTION_LEVELS);
      const survivalLevels=readLevels('survivalLevels',DEFAULT_SURVIVAL_LEVELS);
      const sw=M.sweep({...cfg,points:72});
      const bps=M.breakpointTable(cfg,destructionLevels,cfg.survivalTarget,sw.range);
      const matrix=M.frontierMatrix(cfg,destructionLevels,survivalLevels,sw.range);
      const knee=M.findKnee(sw.points,cfg.survivalTarget);
      lastSweep=sw;lastCfg=cfg;lastKnee=knee;
      renderChart(sw.points,cfg.survivalTarget,knee);
      renderCommitmentChart(sw.points,cfg.survivalTarget,knee);
      renderTable(bps);renderMatrix(matrix,destructionLevels);renderKnee(knee);renderRoundTable(knee);renderMetrics(sw,bps,cfg.survivalTarget,knee,cfg);
      $('results').classList.remove('hidden');$('results').scrollIntoView({behavior:'smooth',block:'start'});
    }catch(e){$('parseStatus').textContent=e.message||String(e);$('parseStatus').className='status error';}
    finally{$('runBtn').disabled=false;$('runBtn').textContent='Calculate frontier';}
  }

  $('sampleBtn').addEventListener('click',()=>{$('roster').value=sample;parse();});
  $('reportToggleBtn').addEventListener('click',()=>{$('reportImporter').classList.toggle('hidden');if(!$('reportImporter').classList.contains('hidden'))$('reportText').focus();});
  $('reportCloseBtn').addEventListener('click',()=>{$('reportImporter').classList.add('hidden');});
  $('parseReportBtn').addEventListener('click',parseBattleReportUI);
  $('reportPreview').addEventListener('click',e=>{const btn=e.target.closest('[data-report-side]');if(btn)applyReportSide(btn.dataset.reportSide);});
  $('runBtn').addEventListener('click',run);
  $('exportBtn').addEventListener('click',exportCSV);
  $('roster').addEventListener('input',parse);
  $('roster').value=sample;parse();
})();

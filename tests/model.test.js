'use strict';
const assert=require('assert');
const M=require('../model.js');

function near(a,b,eps=1e-9){assert(Math.abs(a-b)<=eps,`${a} != ${b}`);}

near(M.parseCount('2.5M'),2.5e6);
near(M.parseCount('10Qi'),1e19);
near(M.parseCount('3e12'),3e12);

const parsed=M.parseRoster(`Athena Class Battleship 50M\n10M Hades\nGauss Cannon = 2M\nnot a unit: 5`);
assert.strictEqual(parsed.composition.Athena,50e6);
assert.strictEqual(parsed.composition.Hades,10e6);
assert.strictEqual(parsed.composition['Gauss Cannon'],2e6);
assert.strictEqual(parsed.unknown.length,1);

const battleReport=M.parseBattleReport(`Combat Report
Attacker Alex [1:2:3]
Weapons: 20 Shield: 19 Armor: 18
Zeus Class 1,000,000

Defender NPC
Weapons: 12 Shield: 13 Armor: 14
Athena Class Battleship 50,000
Hades Class Battleship 20,000
Gauss Cannon 100,000
Large Decoy 1
Round 1
Attacker
Zeus 900,000`);
assert.strictEqual(battleReport.attacker.composition.Zeus,1e6);
assert.strictEqual(battleReport.attacker.tech.weapons,20);
assert.strictEqual(battleReport.attacker.tech.shield,19);
assert.strictEqual(battleReport.attacker.tech.armor,18);
assert.strictEqual(battleReport.defender.composition.Athena,50000);
assert.strictEqual(battleReport.defender.composition.Hades,20000);
assert.strictEqual(battleReport.defender.composition['Gauss Cannon'],100000);
assert.strictEqual(battleReport.defender.composition['Large Decoy'],1);
assert.strictEqual(battleReport.defender.tech.weapons,12);
assert.strictEqual(battleReport.defender.stoppedAtRound,true);

const copiedTable=M.parseBattleReport(`Attacker
Weapons Shield Armor
20 20 20
Zeus Artemis Hades
1,000 2,000 3,000
Defender
Weapons Shield Armor
12 13 14
Athena Hades Gauss Cannon Plasma Cannon Large Decoy
50M 20M 100M 2M 1`);
assert.deepStrictEqual(copiedTable.attacker.tech,{weapons:20,shield:20,armor:20});
assert.strictEqual(copiedTable.attacker.composition.Zeus,1000);
assert.strictEqual(copiedTable.attacker.composition.Artemis,2000);
assert.strictEqual(copiedTable.attacker.composition.Hades,3000);
assert.strictEqual(copiedTable.defender.composition.Athena,50e6);
assert.strictEqual(copiedTable.defender.composition.Hades,20e6);
assert.strictEqual(copiedTable.defender.composition['Gauss Cannon'],100e6);
assert.strictEqual(copiedTable.defender.composition['Plasma Cannon'],2e6);
assert.strictEqual(copiedTable.defender.composition['Large Decoy'],1);
assert.deepStrictEqual(copiedTable.defender.tech,{weapons:12,shield:13,armor:14});

const noMarkers=M.parseBattleReport(`Athena
Hades
50,000
20,000`);
assert(noMarkers.unassigned);
assert.strictEqual(noMarkers.unassigned.composition.Athena,50000);
assert.strictEqual(noMarkers.unassigned.composition.Hades,20000);

const cfg={
  composition:{Hades:1e7,Athena:5e6,Prometheus:1e6,'Gauss Cannon':2e7,'Plasma Cannon':2e6},
  attackerTech:{weapons:20,shield:20,armor:20},
  defenderTech:{weapons:20,shield:20,armor:20},
  survivalTarget:.999,
  rfSigma:0
};
const sw=M.sweep({...cfg,points:24});
assert.strictEqual(sw.points.length,24);
for(const p of sw.points){
  assert(p.zeusSurvival>=0&&p.zeusSurvival<=1);
  assert(p.dspDestroyedFraction>=0&&p.dspDestroyedFraction<=1+1e-10);
  assert(p.threatDestroyedFraction>=0&&p.threatDestroyedFraction<=1+1e-10);
}
for(let i=1;i<sw.points.length;i++){
  assert(sw.points[i].dspDestroyedFraction+1e-8>=sw.points[i-1].dspDestroyedFraction,'DSP destruction should be monotone in Zeus count for fixture');
  assert(sw.points[i].zeusSurvival+1e-8>=sw.points[i-1].zeusSurvival,'Zeus survival should be monotone in Zeus count for fixture');
}

const bp=M.breakpointTable(cfg,[.5],.999,sw.range)[0].result;
assert(bp,'50% breakpoint should be reachable');
assert(bp.dspDestroyedFraction>=.5-1e-7);
assert(bp.zeusSurvival>=.999-1e-7);

const knee=M.findKnee(sw.points,.999);
assert(knee,'knee should exist');
assert(knee.zeusSurvival>=.999-1e-10);

const harmless=M.simulate({
  composition:{'Large Decoy':1e6},
  zeusCount:1e5,
  attackerTech:{weapons:20,shield:20,armor:20},
  defenderTech:{weapons:20,shield:20,armor:20}
});
near(harmless.zeusSurvival,1);
near(harmless.initialThreat,0);
near(harmless.threatDestroyedFraction,1);

console.log('model tests passed');

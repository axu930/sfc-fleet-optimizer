(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SFCUnits = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ZEUS_COST = 10_000_000;

  // Starfleet Commander wiki base stats/costs. Cost is Ore + Crystal + Hydrogen.
  // Ore and crystal are kept separately so the debris field can be reported
  // by resource while preserving the combined cost used by combat/DSP.
  // Zeus RF is from the Zeus Class wiki page. Defenses do not award DSP.
  const UNITS = {
    'Hermes Probe': {kind:'ship', hull:100, shield:0, weapon:0, ore:0, crystal:1_000, cost:1_000, zeusRF:1250},
    'Artemis': {kind:'ship', hull:400, shield:10, weapon:50, ore:3_000, crystal:1_000, cost:4_000, zeusRF:200},
    'Atlas': {kind:'ship', hull:400, shield:10, weapon:5, ore:2_000, crystal:2_000, cost:4_000, zeusRF:250},
    'Apollo': {kind:'ship', hull:850, shield:25, weapon:150, ore:6_000, crystal:2_500, cost:8_500, zeusRF:100},
    'Zagreus': {kind:'ship', hull:800, shield:5, weapon:1, ore:5_000, crystal:3_000, cost:9_000, zeusRF:500},
    'Charon': {kind:'ship', hull:800, shield:25, weapon:1, ore:5_000, crystal:3_000, cost:9_000, zeusRF:1250},
    'Hercules': {kind:'ship', hull:1200, shield:25, weapon:5, ore:6_000, crystal:6_000, cost:12_000, zeusRF:250},
    'Dionysus': {kind:'ship', hull:1600, shield:10, weapon:1, ore:10_000, crystal:6_000, cost:18_000, cargo:20_000, zeusRF:250},
    'Gaia': {kind:'ship', hull:3000, shield:100, weapon:50, ore:10_000, crystal:20_000, cost:40_000, zeusRF:250},
    'Carmanor': {kind:'ship', hull:3600, shield:100, weapon:10, ore:18_000, crystal:18_000, cost:36_000, zeusRF:125},
    'Poseidon': {kind:'ship', hull:2700, shield:50, weapon:400, ore:20_000, crystal:7_000, cost:29_000, zeusRF:33},
    'Athena': {kind:'ship', hull:6000, shield:200, weapon:1000, ore:45_000, crystal:15_000, cost:60_000, zeusRF:30},
    'Ares': {kind:'ship', hull:7500, shield:500, weapon:1000, ore:50_000, crystal:25_000, cost:90_000, zeusRF:25},
    'Hades': {kind:'ship', hull:7000, shield:400, weapon:700, ore:30_000, crystal:40_000, cost:85_000, zeusRF:15},
    'Prometheus': {kind:'ship', hull:11000, shield:500, weapon:2000, ore:60_000, crystal:50_000, cost:125_000, zeusRF:5},
    'Zeus': {kind:'ship', hull:900000, shield:50000, weapon:200000, ore:5_000_000, crystal:4_000_000, cost:10_000_000, zeusRF:1, heavy:true},
    'Hephaestus': {kind:'ship', hull:4000000, shield:150000, weapon:0, ore:20_000_000, crystal:20_000_000, cost:50_000_000, zeusRF:1, heavy:true},
    'Missile Battery': {kind:'defense', hull:200, shield:20, weapon:80, ore:2_000, crystal:0, cost:2_000, zeusRF:200},
    'Laser Cannon': {kind:'defense', hull:200, shield:25, weapon:100, ore:1_500, crystal:500, cost:2_000, zeusRF:200},
    'Pulse Cannon': {kind:'defense', hull:800, shield:100, weapon:250, ore:6_000, crystal:2_000, cost:8_000, zeusRF:100},
    'Particle Cannon': {kind:'defense', hull:800, shield:500, weapon:150, ore:2_000, crystal:6_000, cost:8_000, zeusRF:100},
    'Gauss Cannon': {kind:'defense', hull:3500, shield:200, weapon:1100, ore:20_000, crystal:15_000, cost:37_000, zeusRF:50},
    'Plasma Cannon': {kind:'defense', hull:10000, shield:300, weapon:3000, ore:50_000, crystal:50_000, cost:130_000, zeusRF:1},
    'Decoy': {kind:'defense', hull:2000, shield:2000, weapon:0, ore:10_000, crystal:10_000, cost:20_000, zeusRF:1},
    'Large Decoy': {kind:'defense', hull:10000, shield:10000, weapon:0, ore:50_000, crystal:50_000, cost:100_000, zeusRF:1}
  };

  function normalize(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  const ALIASES = (() => {
    const aliases = {};
    for (const name of Object.keys(UNITS)) aliases[normalize(name)] = name;
    Object.assign(aliases, {
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
    return aliases;
  })();

  function scaled(value, tech) {
    return value * (1 + 0.1 * Number(tech || 0));
  }

  function rfContinue(rapidFire) {
    return !rapidFire || rapidFire <= 1 ? 0 : (rapidFire - 1) / rapidFire;
  }

  const WORD_UNITS = [
    ['nonillion', 1e30], ['octillion', 1e27], ['septillion', 1e24],
    ['sextillion', 1e21], ['quintillion', 1e18], ['quadrillion', 1e15],
    ['trillion', 1e12], ['billion', 1e9], ['million', 1e6], ['thousand', 1e3]
  ];
  const ABBREVIATED_UNITS = [
    ['n', 1e30], ['o', 1e27], ['S', 1e24], ['s', 1e21], ['Q', 1e18],
    ['q', 1e15], ['t', 1e12], ['b', 1e9], ['m', 1e6], ['k', 1e3]
  ];

  function decimal(value, useGrouping) {
    return value.toLocaleString('en-US', {useGrouping, maximumFractionDigits:3});
  }

  function scientific(value) {
    return value.toExponential(2).replace(/(\.\d*?[1-9])0+e/, '$1e').replace(/\.0+e/, 'e');
  }

  function formatCount(value, format='abbrev') {
    if (!Number.isFinite(value)) return '—';
    if (format === 'raw') return decimal(value, false);
    if (format === 'commas') return decimal(value, true);
    if (format === 'scientific') return scientific(value);
    const units = format === 'words' ? WORD_UNITS : ABBREVIATED_UNITS;
    const suffix = format === 'words' ? ' ' : '';
    const abs = Math.abs(value);
    for (const [label, magnitude] of units) {
      if (abs >= magnitude) return decimal(value / magnitude, false) + suffix + label;
    }
    return decimal(value, format === 'commas');
  }

  return {UNITS, ALIASES, ZEUS_COST, normalize, scaled, rfContinue, formatCount};
});

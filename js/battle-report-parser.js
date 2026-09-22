(function (root, factory) {
  const units = typeof module === 'object' && module.exports ? require('./units.js') : root.SFCUnits;
  const api = factory(units);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SFCBattleReportParser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (units) {
  'use strict';

  const {UNITS, ALIASES, normalize} = units;

  function parseCount(value) {
    if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : NaN;
    const source = String(value || '').trim().replace(/,/g, '').replace(/\s+/g, '');
    if (!source) return NaN;
    const match = source.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*([a-zA-Z]*)$/i);
    if (!match) return NaN;
    const number = Number(match[1]);
    if (!Number.isFinite(number) || number < 0) return NaN;
    const suffix = match[2].toLowerCase();
    const multiplier = {
      '':1, k:1e3, m:1e6, b:1e9, t:1e12,
      q:1e15, qa:1e15, quadrillion:1e15,
      qi:1e18, quintillion:1e18,
      sx:1e21, sextillion:1e21,
      sp:1e24, septillion:1e24
    }[suffix];
    return multiplier ? number * multiplier : NaN;
  }

  function parseRoster(text) {
    const composition = {};
    const unknown = [];
    const lines = String(text || '').split(/\r?\n/);
    for (const raw of lines) {
      let line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      line = line.replace(/[•|]/g, ' ').replace(/\s+/g, ' ').trim();
      let namePart = '';
      let countPart = '';
      let match = line.match(/^(.+?)\s*[:=]\s*([\d.,eE+\-]+\s*[a-zA-Z]*)$/);
      if (match) {
        namePart = match[1];
        countPart = match[2];
      } else {
        match = line.match(/^([\d.,eE+\-]+\s*[a-zA-Z]*)\s*(?:x|×)?\s+(.+)$/i);
        if (match) {
          countPart = match[1];
          namePart = match[2];
        } else {
          match = line.match(/^(.+?)\s+(?:x|×)?\s*([\d.,eE+\-]+\s*[a-zA-Z]*)$/i);
          if (match) {
            namePart = match[1];
            countPart = match[2];
          }
        }
      }
      if (!namePart) {
        unknown.push(raw);
        continue;
      }
      const key = ALIASES[normalize(namePart.replace(/\bclass\b/ig, ''))] || ALIASES[normalize(namePart)];
      const count = parseCount(countPart);
      if (!key || !Number.isFinite(count)) {
        unknown.push(raw);
        continue;
      }
      composition[key] = (composition[key] || 0) + count;
    }
    return {composition, unknown};
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
    return Object.entries(preferred).map(([key, terms]) => ({key, terms}));
  })();

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function reportUnitMatches(line) {
    const source = String(line || '');
    const found = [];
    for (const entry of REPORT_UNIT_TERMS) {
      for (const term of entry.terms) {
        const pattern = term.split(/\s+/).map(escapeRegExp).join('\\s+');
        const expression = new RegExp('\\b' + pattern + '\\b', 'ig');
        let match;
        while ((match = expression.exec(source))) {
          found.push({key:entry.key, index:match.index, end:match.index + match[0].length, length:match[0].length});
          if (!match[0].length) expression.lastIndex++;
        }
      }
    }
    found.sort((a, b) => a.index - b.index || b.length - a.length);
    const kept = [];
    for (const item of found) {
      if (kept.some(existing => item.index < existing.end && item.end > existing.index)) continue;
      kept.push(item);
    }
    return kept.sort((a, b) => a.index - b.index);
  }

  function reportNumberTokens(line) {
    const source = String(line || '');
    const output = [];
    const expression = /(?:^|[\s|>])([+-]?(?:(?:\d{1,3}(?:,\d{3})+)|(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:e[+-]?\d+)?\s*(?:quadrillion|quintillion|sextillion|septillion|Qi|Qa|Sx|Sp|[KMBTQ])?)(?=$|[\s|<])/ig;
    let match;
    while ((match = expression.exec(source))) {
      const raw = match[1].trim();
      const value = parseCount(raw);
      if (Number.isFinite(value)) {
        const offset = match[0].indexOf(match[1]);
        output.push({raw, value, index:match.index + offset, end:match.index + offset + match[1].length});
      }
      if (!match[0].length) expression.lastIndex++;
    }
    return output;
  }

  function detectReportSide(line) {
    const source = String(line || '').trim();
    if (!source || source.length > 120) return null;
    if (/^(?:attacker|attacking\s+fleet|attackers)\b/i.test(source)) return 'attacker';
    if (/^(?:defender|defending\s+fleet|defenders)\b/i.test(source)) return 'defender';
    return null;
  }

  function extractTech(line, tech) {
    const source = String(line || '');
    const definitions = [
      ['weapons',/(?:weapons?|weapon\s+tech(?:nology)?)\s*[:=]?\s*(\d{1,3})/i],
      ['shield',/(?:shields?|shield\s+tech(?:nology)?)\s*[:=]?\s*(\d{1,3})/i],
      ['armor',/(?:armor|armour|armor\s+tech(?:nology)?|armour\s+tech(?:nology)?)\s*[:=]?\s*(\d{1,3})/i]
    ];
    let hit = false;
    for (const [key, expression] of definitions) {
      const match = source.match(expression);
      if (match) {
        tech[key] = Number(match[1]);
        hit = true;
      }
    }
    return hit;
  }

  function looksLikeTechHeader(line) {
    const source = String(line || '').toLowerCase();
    return /weapon/.test(source) && /shield/.test(source) && /(?:armor|armour)/.test(source);
  }

  function parseReportSection(lines) {
    const composition = {};
    const tech = {};
    const pending = [];
    let pendingTech = false;
    let stoppedAtRound = false;

    const setFirst = (key, count) => {
      if (key && Number.isFinite(count) && count >= 0 && composition[key] === undefined) composition[key] = count;
    };
    const queue = keys => {
      for (const key of keys) {
        if (composition[key] === undefined && !pending.includes(key)) pending.push(key);
      }
    };
    const consumePending = numbers => {
      let used = 0;
      while (pending.length && used < numbers.length) setFirst(pending.shift(), numbers[used++].value);
      return used;
    };

    for (let index = 0; index < lines.length; index++) {
      const line = String(lines[index] || '').replace(/\u00a0/g, ' ').trim();
      if (!line) continue;
      if (/^round\s+\d+\b/i.test(line) && Object.keys(composition).length) {
        stoppedAtRound = true;
        break;
      }

      const numbers = reportNumberTokens(line);
      const hadTech = extractTech(line, tech);
      if (pendingTech && numbers.length >= 3 && !reportUnitMatches(line).length) {
        tech.weapons = numbers[0].value;
        tech.shield = numbers[1].value;
        tech.armor = numbers[2].value;
        pendingTech = false;
        continue;
      }
      if (looksLikeTechHeader(line) && !hadTech && numbers.length < 3) {
        pendingTech = true;
        continue;
      }

      const matchedUnits = reportUnitMatches(line);
      if (!matchedUnits.length) {
        if (pending.length && numbers.length) consumePending(numbers);
        continue;
      }

      if (matchedUnits.length === 1) {
        const unit = matchedUnits[0];
        if (numbers.length) {
          const before = numbers.filter(number => number.end <= unit.index);
          const after = numbers.filter(number => number.index >= unit.end);
          const prefix = line.slice(0, unit.index).trim();
          const prefixCount = /^[\d.,eE+\-]+\s*(?:quadrillion|quintillion|sextillion|septillion|Qi|Qa|Sx|Sp|[KMBTQ])?\s*(?:x|×)?$/i.test(prefix);
          const chosen = prefixCount && before.length ? before[before.length - 1] : (after[0] || before[before.length - 1]);
          if (chosen) setFirst(unit.key, chosen.value);
          else queue([unit.key]);
        } else {
          queue([unit.key]);
        }
        continue;
      }

      // Multiple class names on one copied table row. If counts are on the same
      // line, associate each name with the first number before the next class;
      // otherwise queue the names for the following count row(s).
      let assigned = 0;
      for (let unitIndex = 0; unitIndex < matchedUnits.length; unitIndex++) {
        const start = matchedUnits[unitIndex].end;
        const end = unitIndex + 1 < matchedUnits.length ? matchedUnits[unitIndex + 1].index : Infinity;
        const number = numbers.find(item => item.index >= start && item.index < end);
        if (number) {
          setFirst(matchedUnits[unitIndex].key, number.value);
          assigned++;
        }
      }
      if (assigned < matchedUnits.length) {
        queue(matchedUnits.filter(unit => composition[unit.key] === undefined).map(unit => unit.key));
      }
    }
    return {composition, tech, stoppedAtRound};
  }

  function parseBattleReport(text) {
    const lines = String(text || '').replace(/\r/g, '').split('\n');
    const segments = [];
    let current = null;
    const prelude = [];
    for (const raw of lines) {
      const side = detectReportSide(raw);
      if (side) {
        if (current) segments.push(current);
        current = {side, lines:[raw]};
      } else if (current) {
        current.lines.push(raw);
      } else {
        prelude.push(raw);
      }
    }
    if (current) segments.push(current);

    const result = {attacker:null, defender:null, unassigned:null, hasSideMarkers:segments.length > 0};
    if (segments.length) {
      for (const side of ['attacker', 'defender']) {
        const segment = segments.find(item => item.side === side);
        if (segment) result[side] = parseReportSection(segment.lines);
      }
    } else {
      const parsed = parseReportSection(prelude);
      if (Object.keys(parsed.composition).length) result.unassigned = parsed;
    }
    return result;
  }

  return {parseCount, parseRoster, parseBattleReport};
});

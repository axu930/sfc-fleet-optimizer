(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SFCSvgCharts = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const pointBindings = new WeakMap();

  function escapeXml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;'
    })[character]);
  }

  function createScale(domain, range, mode='linear') {
    const transforms = {
      linear:{forward:value => value, inverse:value => value},
      log:{forward:value => Math.log10(Math.max(Number.MIN_VALUE, value)), inverse:value => 10 ** value},
      log1p:{forward:value => Math.log10(Math.max(0, value) + 1), inverse:value => 10 ** value - 1}
    };
    const transform = transforms[mode];
    if (!transform) throw new Error(`Unsupported chart scale: ${mode}`);
    let [domainStart, domainEnd] = domain.map(Number);
    if (!Number.isFinite(domainStart) || !Number.isFinite(domainEnd)) throw new Error('Chart scale domain must be finite.');
    if (mode === 'log' && (domainStart <= 0 || domainEnd <= 0)) throw new Error('Log chart scales require positive values.');
    if (domainEnd < domainStart) [domainStart, domainEnd] = [domainEnd, domainStart];
    let transformedStart = transform.forward(domainStart);
    let transformedEnd = transform.forward(domainEnd);
    if (transformedStart === transformedEnd) {
      transformedEnd += 1;
    }
    const [rangeStart, rangeEnd] = range.map(Number);
    const scale = value => {
      const transformed = transform.forward(Number(value));
      return rangeStart + (rangeEnd - rangeStart) * (transformed - transformedStart) / (transformedEnd - transformedStart);
    };
    scale.invert = position => transform.inverse(transformedStart + (transformedEnd - transformedStart)
      * (Number(position) - rangeStart) / (rangeEnd - rangeStart || 1));
    scale.ticks = (count=5) => Array.from({length:Math.max(2, Math.floor(count) + 1)}, (_, index) =>
      scale.invert(rangeStart + (rangeEnd - rangeStart) * index / Math.max(1, Math.floor(count))));
    return scale;
  }

  function linePath(points, x, y, xScale, yScale) {
    return points.map((point, index) => `${index ? 'L' : 'M'}${xScale(x(point)).toFixed(2)},${yScale(y(point)).toFixed(2)}`).join(' ');
  }

  function line({x1, y1, x2, y2, className='gridline', attributes={}}) {
    const extras = Object.entries(attributes).map(([key, value]) => ` ${escapeXml(key)}="${escapeXml(value)}"`).join('');
    return `<line x1="${Number(x1)}" y1="${Number(y1)}" x2="${Number(x2)}" y2="${Number(y2)}" class="${escapeXml(className)}"${extras}/>`;
  }

  function text({x, y, value, anchor='middle', className='axis', transform='', attributes={}}) {
    const extras = Object.entries(attributes).map(([key, item]) => ` ${escapeXml(key)}="${escapeXml(item)}"`).join('');
    const rotate = transform ? ` transform="${escapeXml(transform)}"` : '';
    return `<text x="${Number(x)}" y="${Number(y)}" text-anchor="${escapeXml(anchor)}" class="${escapeXml(className)}"${rotate}${extras}>${escapeXml(value)}</text>`;
  }

  function path(d, className='curve', attributes={}) {
    const extras = Object.entries(attributes).map(([key, value]) => ` ${escapeXml(key)}="${escapeXml(value)}"`).join('');
    return `<path d="${escapeXml(d)}" class="${escapeXml(className)}"${extras}/>`;
  }

  function circle({cx, cy, r=4.5, className='chart-dot', attributes={}, title=''}) {
    const extras = Object.entries(attributes).map(([key, value]) => ` ${escapeXml(key)}="${escapeXml(value)}"`).join('');
    const titleMarkup = title ? `<title>${escapeXml(title)}</title>` : '';
    return `<circle cx="${Number(cx)}" cy="${Number(cy)}" r="${Number(r)}" class="${escapeXml(className)}"${extras}>${titleMarkup}</circle>`;
  }

  function bindPointInteractions(container, {selector='.chart-dot', onPoint=()=>{}, onLeave=()=>{}}={}) {
    const existing = pointBindings.get(container);
    if (existing) {
      existing.selector = selector;
      existing.onPoint = onPoint;
      existing.onLeave = onLeave;
      return;
    }
    pointBindings.set(container, {selector, onPoint, onLeave});
    const pointFor = event => {
      const current = pointBindings.get(container);
      const point = event.target && event.target.closest ? event.target.closest(current.selector) : null;
      return point && container.contains(point) ? point : null;
    };
    container.addEventListener('pointerover', event => {
      const point = pointFor(event);
      const current = pointBindings.get(container);
      if (point && (!event.relatedTarget || !point.contains(event.relatedTarget))) current.onPoint(point, event, 'hover');
    });
    container.addEventListener('pointermove', event => {
      const point = pointFor(event);
      if (point) pointBindings.get(container).onPoint(point, event, 'hover');
    });
    container.addEventListener('pointerout', event => {
      const point = pointFor(event);
      const current = pointBindings.get(container);
      if (point && (!event.relatedTarget || !point.contains(event.relatedTarget))) current.onLeave(point, event);
    });
    container.addEventListener('focusin', event => {
      const point = pointFor(event);
      if (point) pointBindings.get(container).onPoint(point, event, 'focus');
    });
    container.addEventListener('focusout', event => {
      const point = pointFor(event);
      if (point) pointBindings.get(container).onLeave(point, event);
    });
    container.addEventListener('click', event => {
      const point = pointFor(event);
      if (point) pointBindings.get(container).onPoint(point, event, 'click');
    });
    container.addEventListener('keydown', event => {
      const point = pointFor(event);
      if (!point || (event.key !== 'Enter' && event.key !== ' ')) return;
      event.preventDefault();
      pointBindings.get(container).onPoint(point, event, 'keyboard');
    });
  }

  return {escapeXml, createScale, linePath, line, text, path, circle, bindPointInteractions};
});

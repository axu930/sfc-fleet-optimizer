'use strict';

const assert = require('assert');
const charts = require('../js/svg-charts.js');

const linear = charts.createScale([0, 10], [0, 100]);
assert.strictEqual(linear(5), 50);
assert.strictEqual(linear.invert(25), 2.5);
assert.deepStrictEqual(linear.ticks(2), [0, 5, 10]);

const log1p = charts.createScale([0, 99], [100, 0], 'log1p');
assert.strictEqual(log1p(0), 100);
assert.strictEqual(log1p(99), 0);
assert(Math.abs(log1p.invert(log1p(20)) - 20) < 1e-9);
assert(charts.createScale([0, 0], [0, 100], 'log1p').ticks(4).every(Number.isFinite));
assert.throws(() => charts.createScale([0, 10], [0, 100], 'unknown'), /Unsupported chart scale/);
assert.throws(() => charts.createScale([0, 10], [0, 100], 'log'), /positive values/);

const points = [{x:1, y:2}, {x:3, y:4}];
assert.strictEqual(charts.linePath(points, point => point.x, point => point.y, linear, linear), 'M10.00,20.00 L30.00,40.00');
assert.match(charts.line({x1:0, y1:0, x2:10, y2:10}), /class="gridline"/);
assert.match(charts.text({x:1, y:2, value:'X < Y'}), /X &lt; Y/);
assert.match(charts.path('M0,0', 'curve safe', {'data-test':'a&b'}), /data-test="a&amp;b"/);
assert.match(charts.circle({cx:1, cy:2, title:'point <one>', attributes:{'aria-label':'x"y'}}), /aria-label="x&quot;y"/);

const listeners = {};
let listenerCount = 0;
const container = {addEventListener(name, listener) { listenerCount++; listeners[name] = listener; }, contains:() => true};
const point = {contains:() => false, closest:() => point};
const interactions = [];
charts.bindPointInteractions(container, {
  onPoint:(_point, _event, type) => interactions.push(type),
  onLeave:() => interactions.push('leave')
});
const pointEvent = (fields={}) => ({target:point, relatedTarget:null, ...fields});
listeners.pointerover(pointEvent());
listeners.pointermove(pointEvent());
listeners.pointerout(pointEvent());
listeners.focusin(pointEvent());
listeners.focusout(pointEvent());
listeners.click(pointEvent());
let prevented = false;
listeners.keydown(pointEvent({key:'Enter', preventDefault() { prevented = true; }}));
assert(prevented);
assert.deepStrictEqual(interactions, ['hover', 'hover', 'leave', 'focus', 'leave', 'click', 'keyboard']);
const refreshedInteractions = [];
charts.bindPointInteractions(container, {
  onPoint:(_point, _event, type) => refreshedInteractions.push(type),
  onLeave:() => refreshedInteractions.push('leave')
});
assert.strictEqual(listenerCount, 7, 're-rendering a chart should not accumulate container listeners');
listeners.click(pointEvent());
assert.deepStrictEqual(refreshedInteractions, ['click'], 're-rendering should refresh the active chart callbacks');

console.log('SVG chart primitive tests passed');

// Loaded by the layout as an inline script before React (see layout.tsx), so it must stay a plain string.
// View transitions (page changes, and the theme switch) are skipped by the browser when the tab is hidden, when another one
// interrupts them, or when it times out. Each of those rejects the transition's promises, which nobody else listens to, so
// they surfaced as console errors. VT_SCRIPT wraps document.startViewTransition so every transition gets quiet handlers
// (whoever started it still sees the rejection). It runs from the layout before React loads, so it also covers the
// transitions React starts while the first page is still loading. A transition started in a hidden tab is skipped by the
// browser itself, with no animation; the page update still runs.
// While a transition's update runs, the screen shows a frozen picture of the old page. React's update waits for the
// navigation to finish, so a slow render held that picture until the browser gave up (about 4 s) with a TimeoutError.
// The update is capped at 700 ms: after that the transition goes ahead with whatever is on the page, and the rest of the
// render lands normally a moment later.
export const VT_SCRIPT = `(function(){var d=document;if(!d.startViewTransition||d.__quietVT)return;d.__quietVT=1;var s=d.startViewTransition.bind(d);` +
  `function q(p){p&&p.catch&&p.catch(function(){})}` +
  `function cap(u){return function(){return Promise.race([Promise.resolve(u()),new Promise(function(r){setTimeout(r,700)})])}}` +
  `d.startViewTransition=function(a){var o=typeof a==="function"?{update:a}:a;` +
  `var t=s(o&&o.update?Object.assign({},o,{update:cap(o.update)}):a);q(t.ready);q(t.finished);q(t.updateCallbackDone);return t}})()`;

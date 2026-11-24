// Loaded by the layout as an inline script before React (see layout.tsx), so it must stay a plain string.
//
// VT_SCRIPT wraps document.startViewTransition, which React calls for page changes (and ThemeToggle for its wipe). It runs
// before React loads, so it also covers the transitions React starts while the first page is still loading.
// - Hidden tab: the browser would refuse the transition (InvalidStateError, "Document hidden"), and React reports that
//   message as an uncaught error. So when the page is not visible no transition is started at all: the update runs at once
//   and a transition that has already settled is returned.
// - Hidden, interrupted, or timed out mid-way: the browser rejects the transition's promises. Each gets a quiet handler,
//   and a rejection for invalid state is passed on to the caller with the exact message React already ignores.
// - Slow renders: while the update runs the screen shows a frozen picture of the old page, and React's update waits for
//   the navigation to finish. The update is capped at 700 ms; after that the transition goes ahead with the page as it is,
//   and the rest of the render lands normally a moment later.
const lines = [
  "(function(){",
  "var d=document;if(!d.startViewTransition||d.__quietVT)return;d.__quietVT=1;",
  "var s=d.startViewTransition.bind(d);",
  "function q(p){if(p&&p.catch)p.catch(function(){});return p}",
  "function none(){}",
  "function cap(u){return function(){return Promise.race([Promise.resolve(u()),new Promise(function(r){setTimeout(r,700)})])}}",
  // Rejections React should treat as a plain skip (see customizeViewTransitionError in react-dom).
  "function calm(p){return q(p.catch(function(e){if(e&&e.name==='InvalidStateError')throw new DOMException('Transition was aborted because of invalid state','InvalidStateError');throw e}))}",
  "d.startViewTransition=function(a){",
  "var o=typeof a==='function'?{update:a}:a,u=o&&o.update;",
  // Not visible: run the update now and hand back a transition that is already over.
  "if(d.hidden||d.visibilityState!=='visible'){",
  "var done=q(Promise.resolve().then(function(){if(u)return u()}));",
  "var ok=q(done.then(none));",
  "return{ready:ok,finished:ok,updateCallbackDone:ok,skipTransition:none,types:new Set(o&&o.types||[])}}",
  "var t;try{t=s(u?Object.assign({},o,{update:cap(u)}):a)}",
  "catch(e){var r=q(Promise.resolve().then(function(){if(u)return u()}).then(none));return{ready:r,finished:r,updateCallbackDone:r,skipTransition:none,types:new Set()}}",
  "q(t.ready);q(t.finished);q(t.updateCallbackDone);",
  "return{ready:calm(t.ready),finished:t.finished,updateCallbackDone:t.updateCallbackDone,",
  "skipTransition:function(){t.skipTransition()},get types(){return t.types}}};",
  "})()",
];
export const VT_SCRIPT = lines.join("");

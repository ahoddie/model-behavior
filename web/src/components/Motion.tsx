"use client";
// Reveal on first view. Targets (TARGETS) that start below the fold are held back with the attribute data-pre, and let go
// the first time they scroll into sight; the CSS in globals.css ("Motion") eases them into place: sections rise, chart bars
// grow. Anything already on screen, and anything React has not hydrated yet, is never touched, so nothing visible blinks
// out and the server's HTML always matches. It never runs for a reader who asked for reduced motion.
import { useEffect } from "react";

const TARGETS = "[data-reveal], .home-sec, .rc, .tc, .pbal-bar, .pmeter, .race-track";
// React marks each element it owns with a "__reactFiber$…" key once it has hydrated it.
const hydrated = (el: Element) => Object.keys(el).some((k) => k.startsWith("__reactFiber$"));

// View transitions (page changes, and the theme switch) are skipped by the browser when the tab is hidden or another one
// interrupts them. That rejects the transition's "ready" promise, which nobody else listens to, so it surfaced as a console
// error. Every transition gets a quiet handler here; whoever started it still sees the rejection on its own.
// While a transition's update runs, the screen shows a frozen picture of the old page. React's update waits for the
// navigation to finish, so a slow render held that picture until the browser gave up (about 4 s) with a TimeoutError.
// The update is capped at HOLD: after that the transition goes ahead with whatever is on the page, and the rest of the
// render lands normally a moment later.
const HOLD = 700;
function quietTransitions() {
  const doc = document as Document & { __quietVT?: boolean };
  if (!doc.startViewTransition || doc.__quietVT) return;
  doc.__quietVT = true;
  const start = doc.startViewTransition.bind(doc);
  type Arg = Parameters<typeof start>[0];
  const capped = (update: () => unknown) => () =>
    Promise.race([Promise.resolve(update()), new Promise((done) => setTimeout(done, HOLD))]);
  doc.startViewTransition = ((arg?: Arg) => {
    const opts = typeof arg === "function" ? { update: arg } : arg;
    const t = start(opts?.update ? { ...opts, update: capped(opts.update) } as Arg : arg);
    t.ready.catch(() => {});
    t.finished.catch(() => {});
    t.updateCallbackDone.catch(() => {});
    return t;
  }) as typeof doc.startViewTransition;
}

export default function Motion() {
  useEffect(quietTransitions, []);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
    const root = document.documentElement;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.removeAttribute("data-pre"); io.unobserve(e.target); }
    }, { rootMargin: "0px 0px -8% 0px" });
    const seen = new WeakSet<Element>();
    let pending = false;
    const scan = () => {
      pending = false;
      for (const el of document.querySelectorAll(TARGETS)) {
        if (seen.has(el)) continue;
        if (!hydrated(el)) { pending = true; continue; }
        seen.add(el);
        const r = el.getBoundingClientRect();
        if (r.top < innerHeight && r.bottom > 0) continue;
        el.setAttribute("data-pre", "");
        io.observe(el);
      }
    };
    root.classList.add("mo");
    scan();
    // Parts of the page hydrate late, and navigation, tabs and filters bring new targets: look again once per frame
    // when the page changes, and a few times while some targets are still waiting to hydrate.
    let raf = 0, tries = 0;
    const mo = new MutationObserver((muts) => {
      // The map redraws its SVG often; those changes never add targets, so they are skipped.
      if (raf || !muts.some((m) => m.addedNodes.length && !(m.target instanceof SVGElement))) return;
      raf = requestAnimationFrame(() => { raf = 0; scan(); });
    });
    mo.observe(document.body, { childList: true, subtree: true });
    const retry = window.setInterval(() => { if (pending && tries++ < 20) scan(); else clearInterval(retry); }, 400);
    return () => { io.disconnect(); mo.disconnect(); cancelAnimationFrame(raf); clearInterval(retry); root.classList.remove("mo"); };
  }, []);
  return null;
}

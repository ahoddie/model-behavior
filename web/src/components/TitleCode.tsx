"use client";
import { useEffect, useRef } from "react";

// Hovering the home title shows blue code being typed inside the letters and the skyline's buildings,
// in a ragged patch around the pointer. Decorative only; it draws nothing until the pointer arrives.
// Two canvases cover the heading. The first blends with the page so its code shows only where there is ink (the letters).
// The second is clipped to the buildings' outlines, where the code sits on the paper.

const SNIPPETS = [
  "import torch.nn as nn", "class Net(nn.Module):", "def forward(self, x):", "x = self.fc1(x)", "h = torch.relu(x)",
  "return self.out(h)", "F.cross_entropy(z, y)", "loss.backward()", "optim.step()", "optim.zero_grad()",
  "nn.Linear(784, 256)", "nn.Conv2d(3, 64, 3)", "nn.Dropout(p=0.1)", "x = x.view(-1, 784)", "for x, y in loader:",
  "logits = model(x)", "a = q @ k.T / d**.5", "w -= lr * w.grad", "y = softmax(z, -1)", "nn.LayerNorm(d_model)",
  "h = h + self.attn(h)", "epochs, lr = 90, 3e-4", "with torch.no_grad():", "z = W @ x + b", "nn.Embedding(V, 512)",
  "mask = tril(ones(T,T))", "h = self.mlp(h) + h", "grad = dL / dW", "model.train()", "nn.GELU()",
];
const SLOT = 22; // columns per snippet slot

// The buildings' outlines as closed shapes, in the skyline's own 640 by 90 drawing space.
const BUILDINGS =
  "M18 88V24H34V88Z M124 88V60H138V88Z M140 88V50H152V88Z M156 88L170 14L184 88Z M194 88V30Q204 14 214 30V88Z " +
  "M218 88V44H232V88Z M234 88V58H248V88Z M250 88V66H262V88Z M266 88V72H280V88Z M286 88V76H300V88Z M306 88V70H318V88Z " +
  "M324 88V78H340V88Z M346 88V74H358V88Z M384 88V20L390 10L396 20V88Z M404 88V74H418V88Z " +
  "M426 88V66L432 60H456V48H458Q480 12 502 48H504V60H528L534 66V88Z M474 25V18H486V25Z M554 88V68H550L554 62H616L620 68H616V88Z";

const hash = (a: number, b: number) => {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const smooth = (t: number) => t * t * (3 - 2 * t);
// Smooth noise in two dimensions, 0 to 1.
const noise = (x: number, y: number) => {
  const xi = Math.floor(x), yi = Math.floor(y), u = smooth(x - xi), v = smooth(y - yi);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};
// The skyline fades in its middle; the code inside it fades the same way.
const skyFade = (x: number) => (x < 0.36 || x > 0.64 ? 1 : x < 0.5 ? 1 - ((x - 0.36) / 0.14) * 0.82 : 0.18 + ((x - 0.5) / 0.14) * 0.82);

export default function TitleCode() {
  const inkRef = useRef<HTMLCanvasElement>(null);
  const skyRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ink = inkRef.current!, sky = skyRef.current!, host = ink.parentElement!;
    const a = ink.getContext("2d")!, b = sky.getContext("2d")!;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let W = 0, H = 0, fs = 10, cw = 6, rh = 12, font = "";
    let skyBox: { x: number; y: number; w: number; h: number; s: number } | null = null;
    let inkColor = "", skyColor = "";
    let raf = 0, last = 0, inside = false, strength = 0;
    let tx = 0, ty = 0, px = 0, py = 0;
    // Where the ink is: one box per line of letters, plus the skyline. The effect starts only with the pointer in one of them.
    let hits: { x: number; y: number; w: number; h: number }[] | null = null;

    const measure = () => {
      const r = host.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = r.width; H = r.height;
      for (const c of [ink, sky]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); c.getContext("2d")!.setTransform(dpr, 0, 0, dpr, 0, 0); }
      const cs = getComputedStyle(ink);
      fs = Math.max(7, Math.round(parseFloat(getComputedStyle(host).fontSize) * 0.125));
      rh = fs + 1;
      font = `600 ${fs}px ${cs.fontFamily}`;
      a.font = font; cw = a.measureText("M").width;
      inkColor = cs.getPropertyValue("--code-ink").trim(); skyColor = cs.getPropertyValue("--carbon").trim();
      const svg = host.querySelector("svg.skyline");
      const sr = svg?.getBoundingClientRect();
      if (sr && sr.width > 0) {
        const s = Math.min(sr.width / 640, sr.height / 90);
        skyBox = { x: sr.left - r.left, y: sr.bottom - r.top - 90 * s, w: 640 * s, h: 90 * s, s };
      } else skyBox = null;
      hits = skyBox ? [{ x: skyBox.x, y: skyBox.y, w: skyBox.w, h: skyBox.h }] : [];
      const walk = document.createTreeWalker(host, NodeFilter.SHOW_TEXT), range = document.createRange();
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        range.selectNodeContents(n);
        // A line's box is taller than its capitals; trim it to them.
        for (const q of range.getClientRects()) if (q.width > 1) hits.push({ x: q.left - r.left, y: q.top - r.top + q.height * 0.16, w: q.width, h: q.height * 0.7 });
      }
    };

    const draw = (now: number) => {
      raf = 0;
      if (now - last < 30 && strength > 0) { raf = requestAnimationFrame(draw); return; }
      const dt = Math.min(0.1, (now - last) / 1000 || 0.016); last = now;
      strength += ((inside ? 1 : 0) - strength) * Math.min(1, dt * (inside ? 5 : 7));
      px += (tx - px) * Math.min(1, dt * 12); py += (ty - py) * Math.min(1, dt * 12);
      a.clearRect(0, 0, W, H); b.clearRect(0, 0, W, H);
      if (!inside && strength < 0.02) { strength = 0; return; }

      const t = still ? 0 : now / 1000;
      const RX = fs * 9, RY = fs * 4;
      for (const c of [a, b]) { c.font = font; c.textBaseline = "top"; }
      a.fillStyle = inkColor; b.fillStyle = skyColor;
      b.save();
      if (skyBox) { b.translate(skyBox.x, skyBox.y); b.scale(skyBox.s, skyBox.s); b.clip(new Path2D(BUILDINGS)); b.setTransform(a.getTransform()); }

      const r0 = Math.max(0, Math.floor((py - RY * 2) / rh)), r1 = Math.min(Math.ceil(H / rh), Math.ceil((py + RY * 2) / rh));
      for (let r = r0; r <= r1; r++) {
        const y = r * rh, dy = (y + rh / 2 - py) / RY;
        if (Math.abs(dy) > 1.9) continue;
        // Some rows run much further sideways than others, and which ones drifts over time.
        const reach = 0.7 + 1.1 * Math.pow(noise(r * 0.9, t * 0.35), 2);
        const off = Math.floor(hash(r, 7) * SLOT);
        const c0 = Math.max(0, Math.floor((px - RX * reach * 1.6) / cw)), c1 = Math.min(Math.ceil(W / cw), Math.ceil((px + RX * reach * 1.6) / cw));
        for (let c = c0; c <= c1; c++) {
          const x = c * cw, dx = (x + cw / 2 - px) / (RX * reach);
          const edge = strength * (0.45 + 0.6 * noise(c * 0.16 + t * 0.3, r * 0.55 - t * 0.2)) - Math.hypot(dx, dy);
          if (edge <= 0) continue;
          // Each slot holds a line of code and types the next one over it, so the patch is never empty.
          const slot = Math.floor((c + off) / SLOT), i = (c + off) % SLOT;
          const period = 2.6 + hash(slot, r) * 2.4, at = t + hash(r, slot) * period, cycle = Math.floor(at / period);
          const pick = (n: number) => SNIPPETS[Math.floor(hash(slot * 31 + r, n) * SNIPPETS.length)];
          const head = still ? SLOT : Math.floor((at % period) * 30);
          const ch = i === head && (now >> 8) % 2 ? "▍" : (i < head ? pick(cycle) : pick(cycle - 1))[i] ?? "";
          if (!ch || ch === " ") continue;
          const inSky = !!skyBox && x >= skyBox.x - 2 && x <= skyBox.x + skyBox.w && y >= skyBox.y - rh;
          const ctx = inSky ? b : a;
          ctx.globalAlpha = Math.min(1, edge * 5) * (inSky ? skyFade((x - skyBox!.x) / skyBox!.w) : 1);
          ctx.fillText(ch, x, y + 1);
        }
      }
      b.restore();
      raf = requestAnimationFrame(draw);
    };
    const kick = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(draw); } };

    const leave = () => { inside = false; kick(); };
    const move = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const r = host.getBoundingClientRect();
      tx = e.clientX - r.left; ty = e.clientY - r.top;
      if (!hits) measure();
      if (!hits!.some((q) => tx >= q.x && tx <= q.x + q.w && ty >= q.y && ty <= q.y + q.h)) { if (inside) leave(); return; }
      if (!inside) { inside = true; measure(); if (strength < 0.05) { px = tx; py = ty; } }
      kick();
    };
    const ro = new ResizeObserver(() => { if (inside || strength > 0) measure(); else hits = null; });
    ro.observe(host);
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerleave", leave);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); host.removeEventListener("pointermove", move); host.removeEventListener("pointerleave", leave); };
  }, []);

  return (
    <>
      <canvas ref={inkRef} className="title-code title-code-ink" aria-hidden />
      <canvas ref={skyRef} className="title-code" aria-hidden />
    </>
  );
}

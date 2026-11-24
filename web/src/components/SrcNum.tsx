"use client";
// A small grey citation number. It scrolls to its entry in the page's source list and highlights it for a moment.
export default function SrcNum({ n }: { n: number }) {
  return (
    <button type="button" className="c" aria-label={`Source ${n}`} onClick={() => {
      const li = document.getElementById(`src-${n}`);
      if (!li) return;
      li.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
      li.classList.remove("hl"); void li.offsetWidth; li.classList.add("hl");
      setTimeout(() => li.classList.remove("hl"), 1600);
    }}>{n}</button>
  );
}

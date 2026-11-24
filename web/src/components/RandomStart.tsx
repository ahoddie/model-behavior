"use client";
// "Random" button beside the /money "Start from" picker: opens the trace from a starting point other than the current one.
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function RandomStart({ ids, current }: { ids: string[]; current?: string }) {
  const router = useRouter();
  const [roll, setRoll] = useState(0);
  const pick = () => {
    setRoll((r) => r + 1);
    const pool = ids.filter((i) => i !== current);
    if (pool.length) router.push(`/money?from=${encodeURIComponent(pool[Math.floor(Math.random() * pool.length)])}`);
  };
  return (
    <button type="button" className="rand-btn" onClick={pick} aria-label="Start from a random giver">
      {/* The key changes on each click so the die replays its roll. */}
      <svg key={roll} className={`die${roll ? " rolled" : ""}`} width="16" height="16" viewBox="0 0 16 16" aria-hidden>
        <rect x="1.8" y="1.8" width="12.4" height="12.4" rx="2.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <g fill="currentColor"><circle cx="5.4" cy="5.4" r="1.1" /><circle cx="10.6" cy="5.4" r="1.1" /><circle cx="8" cy="8" r="1.1" /><circle cx="5.4" cy="10.6" r="1.1" /><circle cx="10.6" cy="10.6" r="1.1" /></g>
      </svg>
      Random
    </button>
  );
}

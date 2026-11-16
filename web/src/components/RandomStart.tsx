"use client";
// "Random" button beside the /money "Start from" picker: opens the trace from a starting point other than the current one.
import { useRouter } from "next/navigation";

export default function RandomStart({ ids, current }: { ids: string[]; current?: string }) {
  const router = useRouter();
  const pick = () => {
    const pool = ids.filter((i) => i !== current);
    if (pool.length) router.push(`/money?from=${encodeURIComponent(pool[Math.floor(Math.random() * pool.length)])}`);
  };
  return (
    <button type="button" className="rand-btn" onClick={pick} aria-label="Start from a random giver">
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
        <rect x="1.5" y="1.5" width="13" height="13" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <circle cx="5" cy="5" r="1.2" fill="currentColor" /><circle cx="11" cy="5" r="1.2" fill="currentColor" />
        <circle cx="8" cy="8" r="1.2" fill="currentColor" />
        <circle cx="5" cy="11" r="1.2" fill="currentColor" /><circle cx="11" cy="11" r="1.2" fill="currentColor" />
      </svg>
      Random
    </button>
  );
}

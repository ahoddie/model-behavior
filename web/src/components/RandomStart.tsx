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
      Random
    </button>
  );
}

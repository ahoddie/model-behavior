"use client";
import { useState } from "react";

// Uses its own check and message instead of the browser's validation bubble, so it matches the site.
const valid = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

export default function FollowForm({ nodeId }: { nodeId: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "ok" | "err">("idle");
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <form className="follow filters" noValidate onSubmit={async (e) => {
      e.preventDefault();
      if (!email.trim()) return setProblem("Enter an email address to follow this profile.");
      if (!valid(email)) return setProblem("That doesn't look like an email address. Check for a missing @ or dot.");
      setProblem(null);
      const r = await fetch("/api/follow", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim(), node: nodeId }) });
      setState(r.ok ? "ok" : "err");
    }}>
      <label className="field">Follow by email
        <span className="field-wrap">
          <input type="email" value={email} placeholder="you@example.org" aria-invalid={problem ? true : undefined} aria-describedby={problem ? "follow-problem" : undefined}
            onChange={(e) => { setEmail(e.target.value); if (problem) setProblem(null); }} />
          {problem && <span id="follow-problem" className="field-msg" role="alert">{problem}</span>}
        </span>
      </label>
      <button type="submit">Follow</button>
      {state === "ok" && <span role="status">Following. Digests go out daily when something changes.</span>}
      {state === "err" && <span role="status">That didn&apos;t save. Check the address.</span>}
    </form>
  );
}

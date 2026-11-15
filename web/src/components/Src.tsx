"use client";
// Source pill: the source's own icon and short name, linked to the original. Sits at the end of a claim
// so the claim itself reads as plain text.
import { useState } from "react";
import { sourceName, sourceKind } from "@/lib/format";

export default function Src({ url, archive }: { url: string; archive?: string | null }) {
  const [icon, setIcon] = useState(true);
  let host = "";
  try { host = new URL(url).hostname; } catch { return null; }
  const name = sourceName(url);
  return (
    <span className="src-wrap">
      <a className="src" href={url} target="_blank" rel="noreferrer" title={`${sourceKind(url)}: ${url}`}>
        {icon && (
          // eslint-disable-next-line @next/next/no-img-element -- the source site's own favicon, hot-linked
          <img src={`https://${host}/favicon.ico`} alt="" width={12} height={12} loading="lazy" referrerPolicy="no-referrer" onError={() => setIcon(false)} />
        )}
        {name}
      </a>
      {archive && <a className="src src-arch" href={archive} target="_blank" rel="noreferrer" title="Archived copy">archive</a>}
    </span>
  );
}

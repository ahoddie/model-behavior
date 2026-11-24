// Headline, description and sources for a person's or organization's profile (table profile_text, filled from
// data/profiles/*.json by scripts/load-profile-text.ts). Links in a description are written [shown text](node-id);
// parseDescription turns them into the parts components/Linked.tsx renders.
import { q } from "./db";
import type { Part } from "./linkify";

export type ProfileSource = { label: string; name: string; url: string };
export type ProfileText = { headline: string; description: string; parts: Part[]; sources: ProfileSource[]; thin: boolean };

const LINK = /\[([^\]]+)\]\(([a-z0-9][a-z0-9_-]*)\)/g;

export function parseDescription(text: string): Part[] {
  const out: Part[] = [];
  let last = 0;
  for (const m of text.matchAll(LINK)) {
    if (m.index! > last) out.push({ t: text.slice(last, m.index) });
    out.push({ t: m[1], id: m[2] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ t: text.slice(last) });
  return out;
}

// Plain text, links removed, for meta descriptions and search.
export const plainDescription = (text: string) => text.replace(LINK, "$1");

export async function getProfileText(id: string): Promise<ProfileText | null> {
  const [r] = await q<{ headline: string; description: string; sources: ProfileSource[]; thin: boolean }>(
    `SELECT headline, description, sources, thin FROM profile_text WHERE node_id=$1`, [id]);
  return r ? { ...r, parts: parseDescription(r.description) } : null;
}

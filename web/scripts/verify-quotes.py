#!/usr/bin/env python3
# Checks every quote in research slice files against its source page before loading.
# A quote is kept only if its words appear in the page text in order (case, curly quotes, dashes, and spacing ignored).
# A quote that fails becomes a summary-only item when the item has a summary, and is dropped otherwise.
# Usage: python3 scripts/verify-quotes.py data/research/overnight/out-*.json   (rewrites each file in place; prints a report)
import html, json, re, subprocess, sys, unicodedata

def norm(s: str) -> str:
    s = unicodedata.normalize("NFKC", html.unescape(s)).lower()
    s = s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"').replace("—", "-").replace("–", "-")
    return re.sub(r"[^a-z0-9']+", " ", s).strip()

cache: dict[str, str] = {}
def page(url: str) -> str:
    if url not in cache:
        r = subprocess.run(["curl", "-sL", "--compressed", "--max-time", "30", "-A", "Mozilla/5.0 (research; local)", url], capture_output=True)
        text = r.stdout.decode("utf-8", "ignore")
        text = re.sub(r"<(script|style)[\s\S]*?</\1>", " ", text, flags=re.I)
        cache[url] = norm(re.sub(r"<[^>]+>", " ", text))
    return cache[url]

total = kept = summarized = dropped = 0
for path in sys.argv[1:]:
    d = json.load(open(path))
    out = []
    for f in d.get("feed_items", []):
        ex = f.get("excerpt")
        if not ex:
            out.append(f); continue
        total += 1
        if len(ex.split()) <= 25 and norm(ex) and norm(ex) in page(f.get("url", "")):
            kept += 1; out.append(f)
        elif f.get("summary"):
            summarized += 1; f["excerpt"] = None; out.append(f)
            d.setdefault("gaps", []).append(f"overnight: quote for {f.get('node')} not found word for word at {f.get('url')}; kept the summary only.")
        else:
            dropped += 1
            d.setdefault("gaps", []).append(f"overnight: quote for {f.get('node')} not found word for word at {f.get('url')}; dropped.")
    d["feed_items"] = out
    json.dump(d, open(path, "w"), indent=1, ensure_ascii=False)
print(f"quotes checked {total}: kept {kept}, summary only {summarized}, dropped {dropped}")

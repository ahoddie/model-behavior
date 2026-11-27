import { Lockup, Mark } from "@/components/Logo";
import { SITE_DESCRIPTOR, SITE_NAME } from "@/lib/brand";

// Kept out of search engines and other crawlers: not linked from the site, noindex here, and disallowed in robots.ts.
export const metadata = { title: `Brand · ${SITE_NAME}`, robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false, noimageindex: true } } };

const COLORS: { name: string; hex: string; use: string }[] = [
  { name: "Paper", hex: "#F2EEE3", use: "Page background" },
  { name: "Panel", hex: "#FAF8F2", use: "Cards and raised surfaces" },
  { name: "Ink", hex: "#17171C", use: "Text, rules, and the mark" },
  { name: "Carbon", hex: "#2A2FB5", use: "The dot, links, and positions" },
  { name: "Carbon on ink", hex: "#8E93F5", use: "The dot on dark backgrounds only" },
  { name: "Ochre", hex: "#7A5A12", use: "Money: amounts and funding lines" },
  { name: "Muted", hex: "#55534B", use: "Secondary text" },
  { name: "Rule", hex: "#D8D2C2", use: "Hairlines and dividers" },
];

const FILES: [string, string][] = [
  ["mark.svg", "Mark, for light backgrounds"],
  ["mark-reversed.svg", "Mark, for dark backgrounds"],
  ["mark-ink.svg", "Mark, one color, ink"],
  ["mark-paper.svg", "Mark, one color, paper"],
  ["icon.svg", "App icon and favicon"],
  ["logo.png", "Mark and name, for light backgrounds"],
  ["logo-reversed.png", "Mark and name, for dark backgrounds"],
  ["social-card.png", "Link preview image, 1200 × 630"],
];

export default function Brand() {
  return (
    <div className="page">
      <h1>Brand</h1>
      <p className="bk-lede">
        Three lines of text part around one dot. The lines are the policy: a bill, a rule, a public statement. The dot is
        whoever is pushing on it.
      </p>

      <div className="bk-stage">
        <div><Mark size={150} title={SITE_NAME} /></div>
        <div className="on-ink"><Mark size={150} title={SITE_NAME} /></div>
      </div>
      <p className="bk-cap">Point at the mark in the page header to see the dot press.</p>

      <h2>Logo</h2>
      <p>The mark sits to the left of the name, set in Archivo at its narrowest and heaviest. Use the mark alone where space is tight or the name is already nearby.</p>
      <div className="bk-row">
        <div className="bk-tile"><Lockup size={27} still /><p className="bk-cap">Main logo, on paper or panel</p></div>
        <div className="bk-tile on-ink"><Lockup size={27} still /><p className="bk-cap">Reversed, on ink</p></div>
        <div className="bk-tile on-carbon"><Lockup size={27} still /><p className="bk-cap">One color, on carbon</p></div>
      </div>
      <div className="bk-row">
        <div className="bk-tile">
          <div>
            <Lockup size={27} still />
            <p style={{ margin: "6px 0 0", fontSize: 15 }}>{SITE_DESCRIPTOR}</p>
          </div>
          <p className="bk-cap">With the descriptor, in Literata</p>
        </div>
        <div className="bk-tile">
          <div className="bk-clear"><Mark size={48} still /></div>
          <p className="bk-cap">Clear space: half the mark&rsquo;s width on every side</p>
        </div>
        <div className="bk-tile">
          <div className="bk-sizes"><Mark size={64} still /><Mark size={32} still /><Mark size={16} still /></div>
          <p className="bk-cap">Smallest size: 16 pixels. Below that, use the dot alone.</p>
        </div>
      </div>

      <h2>Rules</h2>
      <ul>
        <li>The rules are ink or paper. The dot is carbon blue, or matches the rules in one-color use.</li>
        <li>Keep the mark flat: no outlines, shadows, gradients, or rotation.</li>
        <li>Do not redraw the curves or move the dot.</li>
        <li>Ochre belongs to money on the site. Do not use it in the logo.</li>
      </ul>

      <h2>Color</h2>
      <p>Newsprint, ink, and one blue. Color marks meaning, so use it sparingly: blue for links and positions, ochre for money.</p>
      <div className="bk-swatches">
        {COLORS.map((c) => (
          <div className="bk-sw" key={c.name}>
            <i style={{ background: c.hex }} />
            <div><b>{c.name}</b>{c.hex}<br /><span className="muted">{c.use}</span></div>
          </div>
        ))}
      </div>

      <h2>Type</h2>
      <div className="bk-type">
        <p className="bk-cap">Archivo, width 66 to 70, weight 900, capitals. Page titles and the name.</p>
        <div className="bk-display">Who funds whom</div>
      </div>
      <div className="bk-type">
        <p className="bk-cap">Literata. Everything else: body text, labels, tables, and navigation.</p>
        <p className="bk-body">Numbers are set in tabular figures so columns line up: $1,250,000.</p>
      </div>

      <h2>Voice</h2>
      <ul>
        <li>Plain and specific. Name the person, the amount, and the date.</li>
        <li>Report what the record shows. Leave judgment to the reader.</li>
        <li>Short sentences, common words, and the serial comma.</li>
      </ul>

      <h2>Files</h2>
      <ul className="bk-files">
        {FILES.map(([f, label]) => (
          <li key={f}><a href={`/brand/${f}`} download>{f}</a> <span className="muted">· {label}</span></li>
        ))}
      </ul>
    </div>
  );
}

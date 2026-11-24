// The frame around an item page (a bill now; people, organizations, rules, and agencies can share it): a sticky rail on wide
// screens with Back, one-word section links, Map it, and Cite, and on phones a sticky bar with the Back icon, the section
// links in a scroller, and the Map it icon.
import BackButton from "./BackButton";
import SectionNav from "./SectionNav";
import MapIt, { type LinkCounts } from "./MapIt";
import CiteButton from "./CiteButton";

export type RailProps = {
  sections: { id: string; label: string }[];
  back: { fallback: string; label: string };
  map: { id: string; name: string; counts: LinkCounts; caption: string };
  cite: { title: string; path: string };
};

export function ItemRail({ sections, back, map, cite }: RailProps) {
  return (
    <aside className="item-rail">
      <BackButton fallback={back.fallback} fallbackLabel={back.label} />
      <SectionNav items={sections} className="item-toc" label="Sections" />
      <MapIt id={map.id} name={map.name} counts={map.counts} caption={map.caption} />
      <CiteButton kind="page" title={cite.title} path={cite.path} plain />
    </aside>
  );
}

export function ItemBar({ sections, back, map }: RailProps) {
  return (
    <div className="item-bar">
      <BackButton fallback={back.fallback} fallbackLabel={back.label} icon />
      <SectionNav items={sections} className="item-bar-links" label="Sections" />
      <MapIt id={map.id} name={map.name} counts={map.counts} size="icon" />
    </div>
  );
}

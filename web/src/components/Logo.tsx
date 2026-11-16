// The mark: three rules of text parting around one dot. Rules take the text color; the dot is carbon blue.
// The same geometry is saved as files in public/brand. Motion (globals.css, .mark) animates the path data.
import { SITE_NAME } from "@/lib/brand";

export const MARK_TOP = "M2 9.5H8C12.5 9.5 13.5 4.5 19 4.5C24.5 4.5 25.5 9.5 30 9.5";
export const MARK_MID = "M2 16H10.5";
export const MARK_BOTTOM = "M2 22.5H8C12.5 22.5 13.5 27.5 19 27.5C24.5 27.5 25.5 22.5 30 22.5";

export function Mark({ size = 24, still = false, title }: { size?: number; still?: boolean; title?: string }) {
  return (
    <svg className={still ? "bmark still" : "bmark"} width={size} height={size} viewBox="0 0 32 32"
      role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <g fill="none" stroke="currentColor" strokeWidth="3.4">
        <path className="mk-t" d={MARK_TOP} />
        <path className="mk-m" d={MARK_MID} />
        <path className="mk-b" d={MARK_BOTTOM} />
      </g>
      <circle className="mk-dot" cx="19" cy="16" r="5" />
    </svg>
  );
}

export function Lockup({ size = 22, still = false }: { size?: number; still?: boolean }) {
  return (
    <span className="lockup" style={{ fontSize: size }}>
      <Mark size={Math.round(size * 1.1)} still={still} />
      <span className="lockup-name">{SITE_NAME}</span>
    </span>
  );
}

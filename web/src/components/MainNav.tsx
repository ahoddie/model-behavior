"use client";
// The masthead's page links. The link for the section you are in is marked aria-current="page", which the stylesheet
// shows as a blue dot under the word. The layout wraps this in <Suspense>: on a page whose address is not known at build
// time usePathname waits for the request, and the fallback is the same links with no dot.
import { usePathname } from "next/navigation";
import Link from "@/components/Link";

export const NAV = [["/map", "Network"], ["/money", "Funding"], ["/targets", "Policy"], ["/statements", "Statements"], ["/about", "About"]] as const;

export function NavLinks({ path }: { path?: string | null }) {
  return <>{NAV.map(([href, label]) => (
    <Link key={href} href={href} aria-current={path && (path === href || path.startsWith(`${href}/`)) ? "page" : undefined}>{label}</Link>
  ))}</>;
}

export default function MainNav() {
  return <NavLinks path={usePathname()} />;
}

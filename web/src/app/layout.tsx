import type { Metadata } from "next";
import { Archivo, Literata, JetBrains_Mono } from "next/font/google";
import Link from "@/components/Link";
import { Suspense, ViewTransition } from "react";
import LastUpdated from "@/components/LastUpdated";
import PageNames from "@/components/PageNames";
import MainNav, { NavLinks } from "@/components/MainNav";
import HeaderSearch from "@/components/HeaderSearch";
import Motion from "@/components/Motion";
import { VT_SCRIPT } from "@/lib/motion";
import ThemeToggle from "@/components/ThemeToggle";
import { THEME_SCRIPT } from "@/lib/theme";
import { Lockup } from "@/components/Logo";
import { SITE_NAME } from "@/lib/brand";
import "./globals.css";

const display = Archivo({ variable: "--font-display", subsets: ["latin"], axes: ["wdth"] });
const body = Literata({ variable: "--font-body", subsets: ["latin"], style: ["normal"] });
const mono = JetBrains_Mono({ variable: "--font-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: SITE_NAME,
  description: "See how frontier labs, investors, tech leaders, and think tanks shape U.S. AI policy.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT + ";" + VT_SCRIPT }} />
        <a className="skip" href="#main">Skip to content</a>
        <header className="masthead">
          <span className="brand"><Link href="/" className="wordmark" aria-label={`${SITE_NAME} home`}><Lockup /></Link><span className="beta" title="Work in progress: data and features are still being checked">Beta</span></span>
          <nav aria-label="Main">
            <Suspense fallback={<NavLinks />}><MainNav /></Suspense>
          </nav>
          <div className="mast-tools">
            <Link href="/data" className="iconbtn" aria-label="Open data: downloads, methodology, corrections" title="Open data">
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><path d="M8 2v8M4.5 6.5L8 10l3.5-3.5M2.5 13.5h11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </Link>
            <ThemeToggle />
            <HeaderSearch />
          </div>
        </header>
        {/* The top bar stays on screen; its height goes to --mast-h so everything else that sticks sits just below it. */}
        <script dangerouslySetInnerHTML={{ __html: `(()=>{const m=document.querySelector(".masthead");if(!m)return;const s=()=>document.documentElement.style.setProperty("--mast-h",m.offsetHeight+"px");s();new ResizeObserver(s).observe(m)})()` }} />
        {/* Navigations, tab links and filter changes are transitions, so the page content crossfades between them (the
            "page" view transition in globals.css). Plain state changes, like the map's, never start one. */}
        <main id="main"><ViewTransition default="page">{children}</ViewTransition></main>
        <Motion />
        <Suspense fallback={null}><PageNames /></Suspense>
        <footer className="sitefoot mono">
          <Suspense fallback={null}><LastUpdated /></Suspense>
          <Link href="/data?view=methodology">Methodology</Link>
          <Link href="/data?view=corrections">Corrections</Link>
        </footer>
      </body>
    </html>
  );
}

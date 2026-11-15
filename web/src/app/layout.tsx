import type { Metadata } from "next";
import { Archivo, Literata, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
import LastUpdated from "@/components/LastUpdated";
import HeaderSearch from "@/components/HeaderSearch";
import "./globals.css";

const display = Archivo({ variable: "--font-display", subsets: ["latin"], axes: ["wdth"] });
const body = Literata({ variable: "--font-body", subsets: ["latin"], style: ["normal"] });
const mono = JetBrains_Mono({ variable: "--font-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Model Behavior",
  description: "How frontier labs, investors, tech leaders and think tanks push on U.S. AI policy.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <a className="skip" href="#main">Skip to content</a>
        <header className="masthead">
          <span className="brand"><Link href="/" className="wordmark">Model Behavior</Link><span className="beta" title="Work in progress: data and features are still being checked">Beta</span></span>
          <nav aria-label="Main">
            <Link href="/map">Map</Link>
            <Link href="/money">Money</Link>
            <Link href="/targets">Lands on</Link>
          </nav>
          <div className="mast-tools">
            <HeaderSearch />
            <Link href="/data" className="iconbtn" aria-label="Open data: downloads, methodology, corrections" title="Open data">
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><path d="M8 2v8M4.5 6.5L8 10l3.5-3.5M2.5 13.5h11" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </Link>
          </div>
        </header>
        <main id="main">{children}</main>
        <footer className="sitefoot mono">
          <Suspense fallback={null}><LastUpdated /></Suspense>
          <Link href="/data?view=methodology">Methodology</Link>
          <Link href="/data?view=corrections">Corrections</Link>
        </footer>
      </body>
    </html>
  );
}

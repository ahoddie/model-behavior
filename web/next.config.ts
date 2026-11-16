import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  devIndicators: false,
  // NEXT_DIST_DIR=.next-verify builds and serves a second copy, so a build can be checked without touching the running site.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  cacheLife: {
    // The record (see cached() in src/lib/data.ts). Readers are always served from cache: an entry older than a minute is
    // refreshed in the background, and it only stops being served after a month without a refresh. Writes clear it by tag.
    // stale stays at 5 minutes: below that, cached content is left out of the shell that links prefetch.
    record: { stale: 300, revalidate: 60, expire: 60 * 60 * 24 * 30 },
  },
  // 790-odd pages are built from the local database. Unthrottled, the build opens about 70 pages at once and the queries
  // time out; three workers with four pages each finish without starving it, and a page that still times out is retried.
  staticPageGenerationTimeout: 180,
  experimental: { cpus: 3, staticGenerationMaxConcurrency: 4, staticGenerationRetryCount: 3 },
  async redirects() {
    // Old links to the map (/?focus=…, /?view=time) still work. The query string is carried over.
    return [
      { source: "/", has: [{ type: "query", key: "focus" }], destination: "/map", permanent: false },
      { source: "/", has: [{ type: "query", key: "view", value: "time" }], destination: "/map", permanent: false },
    ];
  },
};

export default nextConfig;

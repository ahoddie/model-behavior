import type { MetadataRoute } from "next";

// Crawlers may read the public record. The brand page and its asset files are for people who are sent the link.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/", disallow: ["/brand"] } };
}

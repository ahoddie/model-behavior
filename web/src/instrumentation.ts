// Runs once when the server starts. In production, refresh every prebuilt page in the background (see lib/warm).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { warmSite } = await import("./lib/warm");
  warmSite(`http://localhost:${process.env.PORT || 3000}`, 10_000);
}

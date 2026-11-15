// Long-lived local process: Bluesky Jetstream filtered to the verified watchlist DIDs. New posts reach the review queue within minutes.
// Usage: pnpm statements:firehose   (restart-safe: resumes from the saved Jetstream cursor)
import "../../env.ts";
import { firehose } from "./sources/bluesky.ts";
await firehose();

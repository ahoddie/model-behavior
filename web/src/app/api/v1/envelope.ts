// Shared response shape for the read-only view APIs (data/CONTRACTS.md §9).
export const envelope = (view: string, rows: unknown[], notes: string[] = []) =>
  Response.json({ view, version: 1, generated_at: new Date().toISOString(), rows, notes });

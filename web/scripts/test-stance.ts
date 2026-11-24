// Checks for the Stances page's placement rules. Run: pnpm test:stance
import test from "node:test";
import assert from "node:assert/strict";
import { placeActor, countSharedQuotesOnce } from "../src/lib/stance.ts";

test("one side only", () => {
  assert.deepEqual(placeActor([{ v: 1, date: "2024-01-01" }, { v: 2, date: null }]), { side: "agree", changed: false });
  assert.deepEqual(placeActor([{ v: -2, date: null }]), { side: "disagree", changed: false });
});
test("no side taken is neutral, not mixed", () => {
  assert.equal(placeActor([{ v: 0, date: "2024-01-01" }]).side, "neutral");
  assert.equal(placeActor([]).side, "neutral");
});
test("the newest sided statement decides, and the change is flagged", () => {
  assert.deepEqual(placeActor([{ v: 1, date: "2023-05-30" }, { v: -1, date: "2026-02-01" }]), { side: "disagree", changed: true });
  assert.deepEqual(placeActor([{ v: -1, date: "2023" }, { v: 0, date: "2026-03-01" }, { v: 2, date: "2025-06" }]), { side: "agree", changed: true });
});
test("both sides that cannot be ordered are mixed", () => {
  assert.equal(placeActor([{ v: 1, date: "2024-07-05" }, { v: -1, date: "2024-07-05" }]).side, "mixed");
  assert.equal(placeActor([{ v: 1, date: "2024-07-05" }, { v: -1, date: null }]).side, "mixed");
  assert.equal(placeActor([{ v: 1, date: "2024-07" }, { v: -1, date: "2024" }]).side, "mixed");
});
test("a quote filed under a person and their organization counts once, under the organization", () => {
  const who = new Map([["amodei", { name: "Dario Amodei", type: "person" }], ["anthropic", { name: "Anthropic", type: "lab" }], ["a16z-a", { name: "A", type: "person" }], ["a16z-b", { name: "B", type: "person" }]]);
  const rows: { kind: string; text: string; node_id: string; speaker?: string }[] = [
    { kind: "quote", text: "Second, we recommend a “testing and auditing regime”.", node_id: "amodei" },
    { kind: "quote", text: "Second, we recommend a testing and auditing regime.", node_id: "anthropic" },
    { kind: "quote", text: "Only mine.", node_id: "amodei" },
    { kind: "quote", text: "Co-written.", node_id: "a16z-a" }, { kind: "quote", text: "Co-written.", node_id: "a16z-b" },
    { kind: "letter", text: "Second, we recommend a testing and auditing regime.", node_id: "amodei" },
  ];
  const out = countSharedQuotesOnce(rows, who);
  assert.equal(out.length, 5);
  assert.equal(out.find((r) => r.node_id === "anthropic")?.speaker, "Dario Amodei");
  assert.ok(!out.some((r) => r.node_id === "amodei" && r.text.startsWith("Second") && r.kind === "quote"));
});
test("a newest reading that agrees only in part makes the actor mixed", () => {
  assert.equal(placeActor([{ v: 0, date: "2025-06-01", mixed: true }, { v: 1, date: "2024-01-01" }]).side, "mixed");
  assert.equal(placeActor([{ v: 0, date: "2023-01-01", mixed: true }, { v: -1, date: "2025-01-01" }]).side, "disagree");
});

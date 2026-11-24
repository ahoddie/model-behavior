import Money from "../page";

// /money with no starting point, prebuilt whole. src/proxy.ts sends requests here; the address stays /money.
export default function MoneyDefault() {
  return <Money params={Promise.resolve({})} searchParams={Promise.resolve({})} />;
}

import Targets from "../page";

// /targets with no tab chosen, prebuilt whole. src/proxy.ts sends requests here; the address stays /targets.
export default function TargetsDefault() {
  return <Targets params={Promise.resolve({})} searchParams={Promise.resolve({})} />;
}

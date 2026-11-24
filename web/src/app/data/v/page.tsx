import OpenData from "../page";

// /data with no tab chosen, prebuilt whole. src/proxy.ts sends requests here; the address stays /data.
export default function DataDefault() {
  return <OpenData params={Promise.resolve({})} searchParams={Promise.resolve({})} />;
}

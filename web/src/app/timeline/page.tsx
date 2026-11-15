import { redirect } from "next/navigation";

// Time is now a view on the map page.
export default function Timeline() {
  redirect("/map?view=time");
}

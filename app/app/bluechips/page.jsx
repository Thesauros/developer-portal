import { redirect } from "next/navigation";

// The blue-chip window became the blue-chip index, built from the vault
// contracts rather than an outside data service.
export default function Page() {
  redirect("/app/individual/blue-chip-index");
}

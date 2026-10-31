import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { workspaceSession } from "../../../lib/auth.mjs";
import BlueChips from "./BlueChips";

export const dynamic = "force-dynamic";
export const metadata = { title: "Thesauros · Blue chips" };

export default async function Page() {
  if (!(await workspaceSession(await headers()))) redirect("/app");
  return <BlueChips />;
}

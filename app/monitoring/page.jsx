import { headers } from "next/headers";
import { workspaceSession } from "../../lib/auth.mjs";
import EntryRedirect from "../app/EntryRedirect";
import Login from "../app/Login";
export const metadata = { title: "Thesauros · Transparency" };
export default async function Page() {
  if (await workspaceSession(await headers()))
    return <EntryRedirect mode="institution" destination="transparency" />;
  return <Login mode="institution" next="/app/institution#transparency" />;
}

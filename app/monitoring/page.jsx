import { headers } from "next/headers";
import { workspaceSession } from "../../lib/auth.mjs";
import EntryRedirect from "../app/EntryRedirect";
import Login from "../app/Login";
export const metadata = { title: "Thesauros · Protocol activity" };
export default async function Page() {
  if (await workspaceSession(await headers()))
    return <EntryRedirect mode="institution" destination="events" />;
  return <Login mode="institution" next="/app/institution#events" />;
}

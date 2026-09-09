import { headers } from "next/headers";
import { userSession, accountMode } from "../lib/auth.mjs";
import EntryRedirect from "./customer/EntryRedirect";
import Login from "./customer/Login";
export const metadata = { title: "Thesauros · Institution access" };
export default async function Page() {
  const session = await userSession(await headers());
  return session ? (
    <EntryRedirect
      mode={accountMode(session.user)}
      destination="integrations"
    />
  ) : (
    <Login initialMode="institution" next="/app/institution#integrations" />
  );
}

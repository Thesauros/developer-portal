import { headers } from "next/headers";
import { userSession, accountMode } from "../../lib/auth.mjs";
import EntryRedirect from "../customer/EntryRedirect";
import Login from "../customer/Login";
export const metadata = { title: "Thesauros · Market intelligence" };
export default async function Page() {
  const session = await userSession(await headers());
  return session ? (
    <EntryRedirect mode={accountMode(session.user)} destination="protocol" />
  ) : (
    <Login next="/app/individual#protocol" />
  );
}

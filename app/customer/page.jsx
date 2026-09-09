import { headers } from "next/headers";
import { userSession, accountMode } from "../../lib/auth.mjs";
import Login from "./Login";
import EntryRedirect from "./EntryRedirect";
export const metadata = {
  title: "Thesauros · Sign in",
  description: "Your capital, markets and infrastructure in one workspace.",
};
export default async function Page({ searchParams }) {
  const query = await searchParams;
  const session = await userSession(await headers());
  if (session)
    return <EntryRedirect mode={accountMode(session.user)} destination="overview" next={typeof query.next === "string" ? query.next : ""} />;
  return (
    <Login
      initialMode={query.mode === "institution" ? "institution" : "individual"}
      initialStage={query.signup === "1" ? "signup" : "login"}
      next={typeof query.next === "string" ? query.next : ""}
    />
  );
}

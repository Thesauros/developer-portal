import { headers } from "next/headers";
import { institutionSession, userSession } from "../../lib/auth.mjs";
import InstitutionLogin from "./InstitutionLogin";
import Login from "./Login";
import EntryRedirect from "./EntryRedirect";
export const metadata = {
  title: "Thesauros · Connect your wallet",
  description: "Your wallet, your Thesauros account.",
};
export default async function Page({ searchParams }) {
  const query = await searchParams;
  const mode = query.mode === "institution" ? "institution" : "individual";
  const next = typeof query.next === "string" ? query.next : "";
  const requestHeaders = await headers();
  if (mode === "institution") {
    if (await institutionSession(requestHeaders))
      return <EntryRedirect mode={mode} destination="overview" next={next} />;
    return <InstitutionLogin />;
  }
  if (await userSession(requestHeaders))
    return <EntryRedirect mode={mode} destination="overview" next={next} />;
  return <Login next={next} mode={mode} />;
}

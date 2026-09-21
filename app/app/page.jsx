import { headers } from "next/headers";
import { userSession } from "../../lib/auth.mjs";
import Login from "./Login";
import ComingSoon from "./ComingSoon";
import EntryRedirect from "./EntryRedirect";
export const metadata = {
  title: "Thesauros · Connect your wallet",
  description: "Your wallet, your Thesauros account.",
};
export default async function Page({ searchParams }) {
  const query = await searchParams;
  if (query.mode === "institution") return <ComingSoon />;
  const next = typeof query.next === "string" ? query.next : "";
  if (await userSession(await headers()))
    return (
      <EntryRedirect mode="individual" destination="overview" next={next} />
    );
  return <Login next={next} />;
}

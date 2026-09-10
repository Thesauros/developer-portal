import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { userSession } from "../../../lib/auth.mjs";
import WalletWorkspace from "../wallet/WalletWorkspace";
import ComingSoon from "../ComingSoon";
import Login from "../Login";
export async function generateMetadata({ params }) {
  const { mode } = await params;
  return {
    title: `Thesauros · ${mode === "institution" ? "Institution — Coming soon" : "Individual account"}`,
  };
}
export default async function Page({ params }) {
  const { mode } = await params;
  if (!["individual", "institution"].includes(mode)) notFound();
  if (mode === "institution") return <ComingSoon />;
  const session = await userSession(await headers());
  if (!session) return <Login />;
  return (
    <WalletWorkspace
      user={{
        id: session.user.id,
        name: session.user.walletAddress,
        walletAddress: session.user.walletAddress,
      }}
    />
  );
}

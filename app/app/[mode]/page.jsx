import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { institutionSession, userSession } from "../../../lib/auth.mjs";
import WalletWorkspace from "../wallet/WalletWorkspace";
import Login from "../Login";
import InstitutionLogin from "../InstitutionLogin";
export async function generateMetadata({ params }) {
  const { mode } = await params;
  return {
    title: `Thesauros · ${mode === "institution" ? "Institution workspace" : "Individual account"}`,
  };
}
export default async function Page({ params }) {
  const { mode } = await params;
  if (!["individual", "institution"].includes(mode)) notFound();
  const requestHeaders = await headers();
  if (mode === "institution") {
    const session = await institutionSession(requestHeaders);
    if (!session) return <InstitutionLogin />;
    return (
      <WalletWorkspace
        mode="institution"
        user={{
          id: session.user.id,
          kind: "institution",
          name: session.user.name,
          email: session.user.email,
          company: session.user.company,
          walletAddress: session.user.walletAddress,
        }}
      />
    );
  }
  const session = await userSession(requestHeaders);
  if (!session) return <Login mode={mode} />;
  return (
    <WalletWorkspace
      mode={mode}
      user={{
        id: session.user.id,
        kind: "wallet",
        name: session.user.walletAddress,
        walletAddress: session.user.walletAddress,
      }}
    />
  );
}

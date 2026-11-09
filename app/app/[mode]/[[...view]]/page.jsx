import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { institutionSession, userSession } from "../../../../lib/auth.mjs";
import WalletWorkspace from "../../wallet/WalletWorkspace";
import InstitutionLogin from "../../InstitutionLogin";
import InstitutionEmail from "../../InstitutionEmail";
import { vaults } from "../../../../lib/vault-contracts.mjs";
import { BATCH_VAULT_ID } from "../../../../lib/vault-facts.mjs";
// Tabs carry the product, not the network: every vault address leads to its
// product's page.
const PRODUCT_TITLES = {
  "usdc-instant": "USDC Instant",
  "usdc-multichain": "USDC Multichain",
  "usdt0-instant": "USDT0 Instant",
};
const productOfVault = (id) =>
  id === BATCH_VAULT_ID
    ? "usdc-multichain"
    : vaults.find((vault) => vault.id === id)?.symbol === "USDT0"
      ? "usdt0-instant"
      : vaults.some((vault) => vault.id === id)
        ? "usdc-instant"
        : null;
const VIEW_TITLES = {
  vaults: "Earn",
  "blue-chip-index": "Market Average",
  "market-average": "Market Average",
  activity: "Activity",
  transparency: "Transparency",
  developers: "Developers",
  account: "Account",
};
export async function generateMetadata({ params }) {
  const { mode, view = [] } = await params;
  const product =
    view[0] === "vaults" && view[1]
      ? PRODUCT_TITLES[view[1]] || PRODUCT_TITLES[productOfVault(view[1])]
      : null;
  const page = product || VIEW_TITLES[view[0]];
  return {
    title: `Thesauros · ${page || (mode === "institution" ? "Treasury" : "Earn")}`,
    description:
      "Stablecoin vaults that show where every dollar is, what it earns and how to get it out.",
    robots: { index: false, follow: false },
  };
}
export default async function Page({ params }) {
  const { mode } = await params;
  if (!["individual", "institution"].includes(mode)) notFound();
  const requestHeaders = await headers();
  if (mode === "institution") {
    const session = await institutionSession(requestHeaders);
    if (!session) return <InstitutionLogin />;
    if (session.user.askForEmail)
      return <InstitutionEmail company={session.user.company || ""} />;
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
          signInWallet: session.user.signInWallet,
          treasuryWallet: session.user.treasuryWallet,
          hasPassword: session.user.hasPassword,
        }}
      />
    );
  }
  // Everything public is readable without a wallet; connecting is only needed
  // to see a balance or to act.
  const session = await userSession(requestHeaders);
  if (!session) return <WalletWorkspace mode={mode} user={null} />;
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

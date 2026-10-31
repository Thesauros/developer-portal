import { notFound } from "next/navigation";
import CrosschainLive from "../app/CrosschainLive";

export const metadata = {
  title: "Thesauros · Cross-chain USDC vault",
  description:
    "The Thesauros cross-chain USDC vault, read from Base and Arbitrum.",
  robots: { index: false, follow: false },
};

export default function Page() {
  // Only the cross-chain deployment has this page.
  if (process.env.NEXT_PUBLIC_THESAUROS_PRODUCT !== "crosschain") notFound();
  return <CrosschainLive />;
}

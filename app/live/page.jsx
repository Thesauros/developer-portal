import { notFound, redirect } from "next/navigation";

export const metadata = {
  title: "Thesauros · USDC on Base + Arbitrum",
  robots: { index: false, follow: false },
};

// The old public address of this vault. Its page now lives in the app, open to anyone.
export default function Page() {
  if (process.env.NEXT_PUBLIC_THESAUROS_PRODUCT === "standard") notFound();
  redirect("/app/individual/vaults/base-arbitrum");
}

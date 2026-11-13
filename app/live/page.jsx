import { redirect } from "next/navigation";

export const metadata = {
  title: "Thesauros · USDC Multichain",
  robots: { index: false, follow: false },
};

// The old public address of the vault. Its page is Earn in the app, open to anyone.
export default function Page() {
  redirect("/app/individual/earn");
}

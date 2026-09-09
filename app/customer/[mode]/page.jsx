import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { userSession, accountMode } from "../../../lib/auth.mjs";
import ProductApp from "../ProductApp";
export async function generateMetadata({ params }) {
  const { mode } = await params;
  return {
    title: `Thesauros · ${mode === "institution" ? "Institution" : "Individual"} account`,
  };
}
export default async function Page({ params }) {
  const { mode } = await params;
  if (!["individual", "institution"].includes(mode)) notFound();
  const session = await userSession(await headers());
  if (!session)
    redirect(
      (process.env.BETTER_AUTH_URL || "http://80.241.220.22:8878") +
        "/app/?mode=" +
        mode,
    );
  if (accountMode(session.user) !== mode)
    redirect(
      (process.env.BETTER_AUTH_URL || "http://80.241.220.22:8878") +
        "/app/" +
        accountMode(session.user),
    );
  return (
    <ProductApp
      mode={mode}
      user={{
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
        company: session.user.company,
      }}
    />
  );
}

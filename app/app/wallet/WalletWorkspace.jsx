"use client";
import dynamic from "next/dynamic";
import BrandLoading from "../../ui/BrandLoading";
const Workspace = dynamic(() => import("./Workspace"), {
  ssr: false,
  loading: () => <BrandLoading fullscreen />,
});
export default function WalletWorkspace({ user, mode = "individual" }) {
  return <Workspace user={user} mode={mode} />;
}

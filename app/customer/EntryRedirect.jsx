"use client";
import { useEffect } from "react";
import BrandLoading from "../ui/BrandLoading";
import { workspaceDestination } from "./destination.mjs";
export default function EntryRedirect({ mode, destination, next = "" }) {
  useEffect(() => {
    location.replace(
      workspaceDestination(mode, {
        next,
        hash: location.hash,
        pathname: location.pathname,
        fallback: destination,
      }),
    );
  }, [mode, destination, next]);
  return <BrandLoading fullscreen />;
}

"use client";
import { useEffect, useState } from "react";
import BrandLoading from "./BrandLoading";

export default function NavigationLoading() {
  const [pending, setPending] = useState(false);
  useEffect(() => {
    let expiry;
    const reset = () => {
      clearTimeout(expiry);
      setPending(false);
    };
    const start = () => {
      clearTimeout(expiry);
      setPending(true);
      // A cancelled navigation must never leave the old page covered.
      expiry = setTimeout(reset, 15000);
    };
    const click = (event) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link = event.target.closest?.("a[href]");
      if (
        !link ||
        link.hasAttribute("download") ||
        (link.target && link.target !== "_self")
      )
        return;
      const url = new URL(link.href, location.href);
      if (url.origin !== location.origin || !/^https?:$/.test(url.protocol))
        return;
      if (url.pathname === location.pathname && url.search === location.search)
        return;
      if (
        /\.(pdf|zip|csv|json|svg|png|jpe?g|webp|mp4|woff2?)$/i.test(
          url.pathname,
        ) ||
        /\/(downloads|api)\//.test(url.pathname)
      )
        return;
      start();
    };
    const key = (event) => {
      if (event.key === "Escape") reset();
    };
    document.addEventListener("click", click);
    addEventListener("thesauros:navigating", start);
    addEventListener("pageshow", reset);
    addEventListener("pagehide", reset);
    addEventListener("popstate", reset);
    addEventListener("keydown", key);
    return () => {
      clearTimeout(expiry);
      document.removeEventListener("click", click);
      removeEventListener("thesauros:navigating", start);
      removeEventListener("pageshow", reset);
      removeEventListener("pagehide", reset);
      removeEventListener("popstate", reset);
      removeEventListener("keydown", key);
    };
  }, []);
  return (
    <BrandLoading pending={pending} fullscreen label="Opening the next page" />
  );
}

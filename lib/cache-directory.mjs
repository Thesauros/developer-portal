import { tmpdir } from "node:os";
import { resolve } from "node:path";

// Vercel's deployment filesystem is read-only. Only disposable source caches
// belong in /tmp; account databases must use persistent external storage.
export const cacheDirectory = process.env.VERCEL
  ? resolve(tmpdir(), "thesauros-live-cache")
  : resolve(process.cwd(), "../private-state/live-cache");

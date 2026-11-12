import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  try {
    const marker = JSON.parse(
      await readFile(join(process.cwd(), ".portal-release.json"), "utf8"),
    );
    if (marker.branch !== "migration" || !/^[a-f0-9]{40}$/.test(marker.sha))
      throw new Error("Invalid release marker");
    return Response.json(
      { branch: marker.branch, sha: marker.sha },
      { headers },
    );
  } catch {
    return Response.json(
      {
        branch: process.env.NODE_ENV === "development" ? "development" : null,
        sha: null,
      },
      { status: process.env.NODE_ENV === "development" ? 200 : 503, headers },
    );
  }
}

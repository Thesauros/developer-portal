export async function POST() {
  return Response.json(
    {
      error:
        "Individual accounts now use wallet sign-in. Institution access is coming soon.",
    },
    { status: 410, headers: { "Cache-Control": "private, no-store" } },
  );
}

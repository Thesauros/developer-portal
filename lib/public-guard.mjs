// Public data routes answer anyone, so one person's loop must not reach the RPCs.
// Results are shared for a short time and identical requests wait on one read.
const cache = (globalThis.__thesaurosPublicCache ??= new Map());
const hits = (globalThis.__thesaurosPublicHits ??= new Map());

export async function shared(key, ttlMs, load) {
  const entry = cache.get(key);
  if (entry?.value !== undefined && Date.now() - entry.at < ttlMs)
    return entry.value;
  if (entry?.pending) return entry.pending;
  const pending = (async () => {
    try {
      const value = await load();
      cache.set(key, { value, at: Date.now() });
      return value;
    } catch (error) {
      if (entry?.value !== undefined) {
        // Keep the last good answer, but try again next time.
        cache.set(key, { value: entry.value, at: entry.at });
        if (Date.now() - entry.at < ttlMs * 20) return entry.value;
      } else cache.delete(key);
      throw error;
    }
  })();
  cache.set(key, { ...entry, pending });
  return pending;
}

export function overLimit(request, limit = 300, windowMs = 60000) {
  const forwarded = request.headers.get("x-forwarded-for") || "";
  const ip = forwarded.split(",")[0].trim() || "local";
  const now = Date.now();
  const bucket = hits.get(ip);
  if (!bucket || now - bucket.start > windowMs) {
    if (hits.size > 5000) hits.clear();
    hits.set(ip, { start: now, count: 1 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > limit;
}

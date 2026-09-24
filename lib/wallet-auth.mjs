import { createPublicClient, http, verifyMessage } from "viem";
import { arbitrum, base, mainnet, monad, plasma } from "viem/chains";
import { parseSiweMessage, validateSiweMessage } from "viem/siwe";

export const walletStatement =
  "Sign in to your Thesauros account. This request does not authorize transactions or token spending.";
const chains = new Map(
  [arbitrum, base, mainnet, monad, plasma].map((chain) => [chain.id, chain]),
);
export async function verifyWalletMessage(
  { message, signature, address, chainId },
  origin,
) {
  try {
    const parsed = parseSiweMessage(message);
    const now = Date.now(),
      issued = parsed.issuedAt?.getTime(),
      expires = parsed.expirationTime?.getTime();
    if (
      !chains.has(chainId) ||
      parsed.chainId !== chainId ||
      parsed.version !== "1" ||
      parsed.uri !== origin ||
      parsed.statement !== walletStatement ||
      !Number.isFinite(issued) ||
      !Number.isFinite(expires) ||
      issued > now + 60_000 ||
      now - issued > 300_000 ||
      expires <= issued ||
      expires - issued > 300_000 ||
      !validateSiweMessage({
        address,
        domain: new URL(origin).host,
        message: parsed,
      })
    )
      return false;
    if (await verifyMessage({ address, message, signature })) return true;
    // Contract wallet signatures use a fixed chain RPC (ERC-1271).
    const client = createPublicClient({
      chain: chains.get(chainId),
      transport: http(undefined, { timeout: 8000, retryCount: 0 }),
    });
    return await client.verifyMessage({ address, message, signature });
  } catch {
    return false;
  }
}

import { createPublicClient, fallback, http } from "viem";
import { vaults } from "./vault-contracts.mjs";
export const vaultClients = Object.fromEntries(
  vaults.map((vault) => [
    vault.id,
    createPublicClient({
      chain: vault.chain,
      transport: fallback(
        vault.rpcs.map((url) =>
          http(url, { timeout: 10000, retryCount: 0, batch: { wait: 20 } }),
        ),
        { retryCount: 0 },
      ),
    }),
  ]),
);

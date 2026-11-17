// Read-only readiness check. Never constructs a signer or submits a transaction.
import { vaultClients } from "../lib/vault-rpc.mjs";
import { verifyCrosschain } from "../lib/crosschain-transactions.mjs";
import { readCrosschain } from "../lib/crosschain-api.mjs";
import {
  readCrosschainVault,
  readCrosschainAllocation,
} from "../lib/crosschain-reads.mjs";
import { chainByChainId } from "../lib/chains.mjs";
import { crosschain } from "../lib/crosschain-config.mjs";

const results = await Promise.allSettled([
  (async () => {
    const client = vaultClients[chainByChainId(crosschain.chainId).id];
    await verifyCrosschain(
      client,
      await client.getBlockNumber({ cacheTime: 0 }),
    );
    const vault = await readCrosschainVault();
    const allocation = await readCrosschainAllocation();
    return `Contracts verified; current epoch ${vault.epoch.id}; ${allocation.chains.length} chain allocations read`;
  })(),
  (async () => {
    await Promise.all([
      readCrosschain("health"),
      readCrosschain("backend-base"),
      readCrosschain("backend-arbitrum"),
    ]);
    return "Backend healthy; hub identity and hub/spoke allocation match the stand";
  })(),
]);
for (const [index, result] of results.entries()) {
  const label = index === 0 ? "contracts" : "backend";
  console.log(
    `${result.status === "fulfilled" ? "PASS" : "FAIL"} ${label}: ${result.status === "fulfilled" ? result.value : result.reason.shortMessage || result.reason.message}`,
  );
}
if (results.some((result) => result.status === "rejected"))
  process.exitCode = 1;

// Read-only deployment and contract readiness. No signer or funded operations.
import { zeroAddress } from "viem";
import { vaults } from "../lib/vault-contracts.mjs";
import { vaultClients } from "../lib/vault-rpc.mjs";
import { readMigrationLegacy } from "../lib/migration-legacy.mjs";
import { readCrosschainVault } from "../lib/crosschain-reads.mjs";
import { crosschain } from "../lib/crosschain-config.mjs";

const checks = await Promise.allSettled([
  ...vaults.map(async (vault) => {
    const position = await readMigrationLegacy(
      vaultClients[vault.id],
      vault.id,
      zeroAddress,
    );
    return {
      role: "legacy",
      chainId: vault.chainId,
      address: vault.address,
      asset: vault.asset,
      decimals: vault.decimals,
      implementation: position.implementation,
      block: position.blockNumber.toString(),
      withdrawPaused: position.withdrawPaused,
    };
  }),
  readCrosschainVault().then((vault) => ({
    role: "destination",
    chainId: 8453,
    address: crosschain.vault,
    asset: crosschain.asset,
    decimals: 6,
    block: vault.blockNumber,
    epoch: vault.epoch.id,
    depositPaused: vault.depositPaused,
    tickAgeSeconds: vault.tick.ageSeconds,
    maxTickAge: vault.risk.maxTickAge,
    frozen: vault.tick.frozen,
    quarantined: vault.tick.quarantined,
  })),
]);
for (const [index, result] of checks.entries()) {
  if (result.status === "fulfilled")
    console.log(JSON.stringify({ status: "PASS", ...result.value }));
  else
    console.log(
      JSON.stringify({
        status: "FAIL",
        check: index,
        error:
          "RPC or contract verification failed; inspect private server settings.",
      }),
    );
}
if (checks.some((result) => result.status === "rejected")) process.exitCode = 1;
const destination = checks.at(-1);
if (destination.status === "fulfilled") {
  const value = destination.value;
  const ready =
    value.depositPaused === false &&
    value.frozen === false &&
    value.quarantined === false &&
    Number.isFinite(value.tickAgeSeconds) &&
    value.tickAgeSeconds >= 0 &&
    value.tickAgeSeconds <= value.maxTickAge;
  console.log(
    JSON.stringify({
      status: ready ? "PASS" : "BLOCKED",
      check: "new_deposits",
      reason: ready
        ? "Fresh accepted NAV and unpaused deposits"
        : "Fresh accepted NAV without freeze, quarantine or deposit pause is required",
    }),
  );
  if (!ready && !process.exitCode) process.exitCode = 2;
}

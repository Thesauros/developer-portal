import { getAddress, keccak256 } from "viem";
import {
  getVault,
  implementationHash,
  implementationSlot,
  vaultAbi,
  tokenAbi,
  providerAbi,
} from "./vault-contracts.mjs";

export function userError(message) {
  return Object.assign(new Error(message), { userFacing: true });
}
export async function verifyVault(client, vault, blockNumber) {
  if ((await client.getChainId()) !== vault.chainId)
    throw userError(
      "The RPC returned a different network. Actions are unavailable.",
    );
  const storage = await client.getStorageAt({
    address: vault.address,
    slot: implementationSlot,
    blockNumber,
  });
  if (!storage || !/^0x[0-9a-f]{64}$/i.test(storage))
    throw userError("The vault configuration could not be verified.");
  const implementation = getAddress("0x" + storage.slice(-40));
  const code = await client.getBytecode({
    address: implementation,
    blockNumber,
  });
  if (!code || keccak256(code) !== implementationHash)
    throw userError(
      "The vault implementation has changed. Contact Thesauros before making a transaction.",
    );
  const [asset, decimals, tokenDecimals] = await Promise.all([
    client.readContract({
      address: vault.address,
      abi: vaultAbi,
      functionName: "asset",
      blockNumber,
    }),
    client.readContract({
      address: vault.address,
      abi: vaultAbi,
      functionName: "decimals",
      blockNumber,
    }),
    client.readContract({
      address: vault.asset,
      abi: tokenAbi,
      functionName: "decimals",
      blockNumber,
    }),
  ]);
  if (
    asset.toLowerCase() !== vault.asset.toLowerCase() ||
    decimals !== 6 ||
    tokenDecimals !== 6
  )
    throw userError(
      "The vault asset configuration does not match this product. Actions are unavailable.",
    );
  return implementation;
}
export async function readPosition(client, vaultId, owner) {
  const vault = getVault(vaultId),
    blockNumber = await client.getBlockNumber({ cacheTime: 0 });
  const implementation = await verifyVault(client, vault, blockNumber);
  const read = (functionName, args = []) =>
    client.readContract({
      address: vault.address,
      abi: vaultAbi,
      functionName,
      args,
      blockNumber,
    });
  const [
    cash,
    allowance,
    shares,
    totalAssets,
    minAssets,
    depositPaused,
    withdrawPaused,
    managementFee,
    performanceFee,
  ] = await Promise.all([
    client.readContract({
      address: vault.asset,
      abi: tokenAbi,
      functionName: "balanceOf",
      args: [owner],
      blockNumber,
    }),
    client.readContract({
      address: vault.asset,
      abi: tokenAbi,
      functionName: "allowance",
      args: [owner, vault.address],
      blockNumber,
    }),
    read("balanceOf", [owner]),
    read("totalAssets"),
    read("getMinAssets"),
    read("paused", [0]),
    read("paused", [1]),
    read("getManagementFee"),
    read("getPerformanceFee"),
  ]);
  const positionAssets = await read("previewRedeem", [shares]);
  return {
    id: vault.id,
    owner,
    blockNumber,
    implementation,
    cash,
    allowance,
    shares,
    positionAssets,
    totalAssets,
    minAssets,
    depositPaused,
    withdrawPaused,
    managementFee,
    performanceFee,
    observedAt: new Date().toISOString(),
  };
}
export async function readAllocation(client, vaultId, blockNumber) {
  const vault = getVault(vaultId);
  const addresses = await client.readContract({
    address: vault.address,
    abi: vaultAbi,
    functionName: "getProviders",
    blockNumber,
  });
  const rows = await Promise.all(
    addresses.slice(0, 16).map(async (address) => {
      const results = await Promise.allSettled([
        client.readContract({
          address,
          abi: providerAbi,
          functionName: "getIdentifier",
          blockNumber,
        }),
        client.readContract({
          address,
          abi: providerAbi,
          functionName: "getDepositBalance",
          args: [vault.address, vault.address],
          blockNumber,
        }),
        client.readContract({
          address,
          abi: providerAbi,
          functionName: "getDepositRate",
          args: [vault.address],
          blockNumber,
        }),
      ]);
      return {
        address,
        name:
          results[0].status === "fulfilled"
            ? results[0].value
            : "Lending provider",
        assets: results[1].status === "fulfilled" ? results[1].value : null,
        rateRay: results[2].status === "fulfilled" ? results[2].value : null,
      };
    }),
  );
  const total = rows.reduce((sum, row) => sum + (row.assets ?? 0n), 0n);
  const complete =
    rows.every(
      (row) =>
        row.assets !== null && (row.assets === 0n || row.rateRay !== null),
    ) && addresses.length <= 16;
  const rateRay =
    total > 0n && complete
      ? rows.reduce(
          (sum, row) => sum + (row.assets ?? 0n) * (row.rateRay ?? 0n),
          0n,
        ) / total
      : null;
  return { providers: rows, rateRay, complete };
}
export function jsonSafe(value) {
  return JSON.parse(
    JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
  );
}

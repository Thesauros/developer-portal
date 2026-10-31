// Pinned stand deployment. Source: optimized-rebalancer-contracts/deployments/
// {base,arbitrum}/crosschain.json, profile=stand, phase=3 (2026-10-28).
export const CROSSCHAIN_API_ORIGIN =
  "https://api-cross-chain-production.up.railway.app";
export const crosschain = Object.freeze({
  chainId: 8453,
  profile: "stand",
  vault: "0x33c4F5Efc49DCEa72bfA8Fe62e5Cb7B3226d7cB6",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  decimals: 6,
  startBlock: 51905646,
  implementation: "0x8E5D91AF547D78Bc9A1036b41e255d129013539d",
  implementationHash:
    "0x78b92497708e20558e4e4fc958d945e3a801702c627704f840e6a44ac5bf2b07",
  proxyHash:
    "0x73f8294265e180a15740710aad6d7fb0f42f9a48c7d1c98461aaf0664bd51f42",
  logic: "0xC7927d00ae87C95eA6f4b4046B9019a7174a6c0e",
  logicHash:
    "0xcbbc0af46c7f799457d7f7afa2a3035e944c7d42b0f8fc20db700657a538b4ab",
  accountant: "0xB45819B6844708915c5d7936A847186A6a078b27",
  explorer: "https://basescan.org",
  networks: [
    {
      chainId: 8453,
      name: "Base",
      role: "hub",
      explorer: "https://basescan.org",
      agent: "0x3BAf244cAB9a35F75e5F606704Ad7A9D09C16B83",
      strategy: "0x4cBb4042F79e150F99D3Da4d666e10fdB0711F33",
      adapter: "0x26f9955157CeE02A39B61739abe7A520aB9868ea",
    },
    {
      chainId: 42161,
      name: "Arbitrum",
      role: "spoke",
      explorer: "https://arbiscan.io",
      agent: "0x10DaB1A9BB794A53849D295fF08768345888Ddd9",
      strategy: "0xD211BfFAB29e60c17a2B406B3FAf3d0E29282B71",
      adapter: "0x12a6126507012368c8a4523437f7c3422CBFea0f",
    },
  ],
});
export const sameAddress = (a, b) =>
  /^0x[0-9a-f]{40}$/i.test(a || "") &&
  /^0x[0-9a-f]{40}$/i.test(b || "") &&
  a.toLowerCase() === b.toLowerCase();

export function assertCrosschainIdentity(value) {
  if (
    value?.chainId !== crosschain.chainId ||
    !sameAddress(value?.vault, crosschain.vault) ||
    !sameAddress(value?.asset, crosschain.asset) ||
    value?.decimals !== crosschain.decimals ||
    value?.profile !== crosschain.profile
  )
    throw new Error("The API does not match the configured cross-chain stand.");
  return value;
}

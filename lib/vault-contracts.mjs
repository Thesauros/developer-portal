import { parseAbi, parseUnits, formatUnits } from "viem";
import { arbitrum, base } from "viem/chains";

// Official optimized deployments, verified against the current public app and
// implementation bytecode on 2026-09-20. See docs/research/CONTRACT-INTEGRATION-20260920.md.
export const implementationHash =
  "0xc88383885f0e303fbe2849d454ac98a0e7c89788b6f06709275ac06b3cfc5e70";
export const implementationSlot =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
export const vaults = [
  {
    id: "arbitrum",
    chain: arbitrum,
    chainId: 42161,
    name: "Arbitrum",
    address: "0x4E5c0A4C11d713002D74bA43a458efc31bc76378",
    asset: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    symbol: "USDC",
    decimals: 6,
    explorer: "https://arbiscan.io",
    icon: "/brand/tokens/arb.png",
    rpcs: [
      "https://arbitrum-one-rpc.publicnode.com",
      "https://arb1.arbitrum.io/rpc",
    ],
  },
  {
    id: "base",
    chain: base,
    chainId: 8453,
    name: "Base",
    address: "0x3C7739173cca612B6394EE57131458185A5beC44",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    symbol: "USDC",
    decimals: 6,
    explorer: "https://basescan.org",
    icon: "/brand/tokens/base.svg",
    rpcs: ["https://base-rpc.publicnode.com", "https://mainnet.base.org"],
  },
];
export function getVault(id) {
  const vault = vaults.find((v) => v.id === id);
  if (!vault) throw new Error("Choose an available Thesauros vault.");
  return vault;
}
export const tokenAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);
export const vaultAbi = parseAbi([
  "function asset() view returns (address)",
  "function decimals() view returns (uint8)",
  "function totalAssets() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function previewDeposit(uint256) view returns (uint256)",
  "function previewWithdraw(uint256) view returns (uint256)",
  "function previewRedeem(uint256) view returns (uint256)",
  "function deposit(uint256,address) returns (uint256)",
  "function withdraw(uint256,address,address) returns (uint256)",
  "function redeem(uint256,address,address) returns (uint256)",
  "function paused(uint8) view returns (bool)",
  "function getMinAssets() view returns (uint256)",
  "function getManagementFee() view returns (uint96)",
  "function getPerformanceFee() view returns (uint96)",
  "function getProviders() view returns (address[])",
  "function getEntryProvider() view returns (address)",
  "error ActionPaused()",
  "error AssetsBelowMin()",
  "error InsufficientLiquidity()",
  "error InvalidInput()",
  "error AddressZero()",
  "error InvalidProvider()",
  "error ERC20InsufficientBalance(address,uint256,uint256)",
  "error ERC20InsufficientAllowance(address,uint256,uint256)",
  "event Deposit(address indexed sender,address indexed owner,uint256 assets,uint256 shares)",
  "event Withdraw(address indexed sender,address indexed receiver,address indexed owner,uint256 assets,uint256 shares)",
]);
export const providerAbi = parseAbi([
  "function getIdentifier() view returns (string)",
  "function getDepositBalance(address,address) view returns (uint256)",
  "function getDepositRate(address) view returns (uint256)",
]);
export function amountUnits(input) {
  const value = String(input).trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value) || value.length > 60)
    throw Object.assign(
      new Error("Enter a USDC amount with up to 6 decimal places."),
      { userFacing: true },
    );
  const units = parseUnits(value, 6);
  if (units <= 0n || units >= 2n ** 256n)
    throw Object.assign(new Error("Enter an amount above zero."), {
      userFacing: true,
    });
  return units;
}
export function tokenAmount(units) {
  return units == null ? "—" : formatUnits(BigInt(units), 6);
}
export function displayAmount(units, digits = 2) {
  if (units == null) return "—";
  const raw = tokenAmount(units),
    [whole, fraction = ""] = raw.split(".");
  return (
    whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") +
    (digits ? "." + fraction.padEnd(digits, "0").slice(0, digits) : "")
  );
}
export function friendlyTransactionError(error) {
  const name = error?.walk?.((e) => e?.data?.errorName)?.data?.errorName;
  const message = [name, error?.shortMessage, error?.message]
    .filter(Boolean)
    .join(" ");
  if (
    /UserRejected|User rejected|denied|rejected the request|4001/i.test(message)
  )
    return "Request cancelled in your wallet. You can try again when ready.";
  if (/ActionPaused/.test(message))
    return "This action is paused for the vault. Your current position is still visible.";
  if (/InsufficientLiquidity/.test(message))
    return "The vault cannot fulfil this withdrawal right now. Try a smaller amount or return later.";
  if (/AssetsBelowMin/.test(message))
    return "The deposit is below the vault’s current minimum.";
  if (/ERC20InsufficientAllowance/.test(message))
    return "USDC approval is needed before this deposit.";
  if (/ERC20InsufficientBalance|exceeds balance/i.test(message))
    return "Your balance changed. Refresh and enter an available amount.";
  if (/insufficient funds|insufficient balance.*gas/i.test(message))
    return "Your wallet needs enough ETH on this network to pay the transaction fee.";
  if (error?.userFacing) return error.message;
  return "The transaction could not be prepared. Refresh your balances and try again.";
}

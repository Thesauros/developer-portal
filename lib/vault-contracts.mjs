import { parseAbi, parseUnits, formatUnits } from "viem";
import { CHAINS } from "./chains.mjs";

// Official optimized deployments. Arbitrum, Base, Monad and Plasma run one
// implementation (checked 2026-09-20 and 2026-09-24, see
// docs/research/CONTRACT-INTEGRATION-20260920.md); Ethereum went live on
// 2026-09-21 with a later build that exposes the same functions (checked
// selector by selector on 2026-11-08). Each vault pins its own hash.
const STANDARD_IMPLEMENTATION =
  "0xc88383885f0e303fbe2849d454ac98a0e7c89788b6f06709275ac06b3cfc5e70";
export const implementationSlot =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const vault = (network, fields) => {
  const chain = CHAINS[network];
  return Object.freeze({
    id: network,
    network,
    chain: chain.chain,
    chainId: chain.chainId,
    name: chain.name,
    explorer: chain.explorer,
    gasToken: chain.gasToken,
    icon: chain.icon,
    rpcs: chain.read,
    decimals: 6,
    implementationHash: STANDARD_IMPLEMENTATION,
    ...fields,
  });
};
export const vaults = [
  vault("arbitrum", {
    address: "0x4E5c0A4C11d713002D74bA43a458efc31bc76378",
    asset: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    symbol: "USDC",
  }),
  vault("base", {
    address: "0x3C7739173cca612B6394EE57131458185A5beC44",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    symbol: "USDC",
  }),
  vault("ethereum", {
    address: "0xc3156Da39EeEa9De80F1d74b497C0E4A7030Aae3",
    asset: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    symbol: "USDC",
    implementationHash:
      "0x9843250c35e327ec40e78f3ba3dd84363d08c5d8dd7cc334c09863356c141d27",
  }),
  vault("monad", {
    address: "0x40F1fBf6a92155a6D321c09936234BFEb9Ec4760",
    asset: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
    symbol: "USDC",
  }),
  vault("plasma", {
    address: "0x2Ed9B7fB6Bbe0920145B2a79c18C3f7cFCAE3C99",
    asset: "0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb",
    symbol: "USDT0",
  }),
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
  "event Approval(address indexed owner,address indexed spender,uint256 value)",
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
      new Error("Enter an amount with up to 6 decimal places."),
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
    return "A token approval is needed before this deposit.";
  if (/ERC20InsufficientBalance|exceeds balance/i.test(message))
    return "Your balance changed. Refresh and enter an available amount.";
  if (/insufficient funds|insufficient balance.*gas/i.test(message))
    return "Your wallet needs enough ETH on this network to pay the transaction fee.";
  if (error?.userFacing) return error.message;
  return "The transaction could not be prepared. Refresh your balances and try again.";
}

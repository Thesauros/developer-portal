import { parseAbi, keccak256, encodeFunctionData } from "viem";
import { crosschain as config, sameAddress } from "./crosschain-config.mjs";
import {
  implementationSlot,
  tokenAbi,
  amountUnits,
} from "./vault-contracts.mjs";

export const epochAbi = parseAbi([
  "function asset() view returns (address)",
  "function accountant() view returns (address)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function paused(uint8) view returns (bool)",
  "function requestDeposit(uint256 assets,address receiver) returns (uint256)",
  "function requestRedeem(uint256 shares,address receiver,address owner) returns (uint256)",
  "function claim(uint256 requestId) returns (uint256)",
  "function cancel(uint256 requestId)",
  "function getRequest(uint256 requestId) view returns ((address owner,address receiver,uint64 epoch,uint8 kind,uint8 status,uint128 amount))",
]);
export function requestId(value) {
  if (
    !/^(?:0|[1-9]\d{0,77})$/.test(String(value)) ||
    BigInt(value) >= 2n ** 256n
  )
    throw new Error("Invalid request ID.");
  return BigInt(value);
}
export function crosschainAmount(value) {
  const amount = amountUnits(value);
  if (amount >= 2n ** 128n) throw new Error("Amount exceeds the vault limit.");
  return amount;
}

export async function verifyCrosschain(client, blockNumber) {
  if ((await client.getChainId()) !== config.chainId)
    throw new Error("Connect to Base to use the cross-chain vault.");
  const storage = await client.getStorageAt({
    address: config.vault,
    slot: implementationSlot,
    blockNumber,
  });
  if (
    !/^0x[0-9a-f]{64}$/i.test(storage || "") ||
    !sameAddress("0x" + storage.slice(-40), config.implementation)
  )
    throw new Error(
      "The cross-chain implementation has changed. Actions are unavailable.",
    );
  const read = (functionName) =>
    client.readContract({
      address: config.vault,
      abi: epochAbi,
      functionName,
      blockNumber,
    });
  const [
    proxy,
    implementation,
    logic,
    asset,
    accountant,
    decimals,
    assetDecimals,
  ] = await Promise.all([
    client.getBytecode({ address: config.vault, blockNumber }),
    client.getBytecode({ address: config.implementation, blockNumber }),
    client.getBytecode({ address: config.logic, blockNumber }),
    read("asset"),
    read("accountant"),
    read("decimals"),
    client.readContract({
      address: config.asset,
      abi: tokenAbi,
      functionName: "decimals",
      blockNumber,
    }),
  ]);
  if (
    !proxy ||
    !implementation ||
    !logic ||
    keccak256(proxy) !== config.proxyHash ||
    keccak256(implementation) !== config.implementationHash ||
    keccak256(logic) !== config.logicHash ||
    !sameAddress(asset, config.asset) ||
    !sameAddress(accountant, config.accountant) ||
    decimals !== 6 ||
    assetDecimals !== 6
  )
    throw new Error(
      "The cross-chain contracts could not be verified. Actions are unavailable.",
    );
}

// Only these user operations can reach a wallet. Receivers are always the signed-in owner.
export async function prepareCrosschain(client, owner, action, input) {
  if (!sameAddress(owner, owner))
    throw new Error("Connect your account wallet.");
  const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
  await verifyCrosschain(client, blockNumber);
  const read = (functionName, args) =>
    client.readContract({
      address: config.vault,
      abi: epochAbi,
      functionName,
      args,
      blockNumber,
    });
  let address = config.vault,
    abi = epochAbi,
    functionName,
    args;
  if (action === "deposit" || action === "approve" || action === "redeem") {
    const amount = crosschainAmount(input);
    const deposit = action !== "redeem";
    if (await read("paused", [deposit ? 0 : 1]))
      throw new Error("This request type is paused.");
    if (deposit) {
      const [balance, allowance] = await Promise.all([
        client.readContract({
          address: config.asset,
          abi: tokenAbi,
          functionName: "balanceOf",
          args: [owner],
          blockNumber,
        }),
        client.readContract({
          address: config.asset,
          abi: tokenAbi,
          functionName: "allowance",
          args: [owner, config.vault],
          blockNumber,
        }),
      ]);
      if (balance < amount) throw new Error("Not enough USDC on Base.");
      if (action === "approve") {
        address = config.asset;
        abi = tokenAbi;
        functionName = "approve";
        args = [config.vault, amount];
      } else {
        if (allowance < amount)
          throw new Error(
            "Approve this USDC amount first, then request the deposit.",
          );
        functionName = "requestDeposit";
        args = [amount, owner];
      }
    } else {
      if ((await read("balanceOf", [owner])) < amount)
        throw new Error("Not enough available vault shares.");
      functionName = "requestRedeem";
      args = [amount, owner, owner];
    }
  } else if (action === "claim" || action === "cancel") {
    const id = requestId(input);
    const request = await read("getRequest", [id]);
    if (
      !sameAddress(request.owner, owner) ||
      !sameAddress(request.receiver, owner) ||
      request.status !== 1
    )
      throw new Error("This request is not an active request for your wallet.");
    functionName = action;
    args = [id];
  } else throw new Error("Unsupported cross-chain action.");
  // Simulation checks the current epoch, limits, funding and claim/cancel eligibility.
  const simulated = await client.simulateContract({
    address,
    abi,
    functionName,
    args,
    account: owner,
  });
  return {
    ...simulated.request,
    address,
    abi,
    functionName,
    args,
    account: owner,
    chainId: config.chainId,
  };
}

export function verifyCrosschainReceipt(receipt, hash, owner, address) {
  if (
    receipt.status !== "success" ||
    receipt.transactionHash?.toLowerCase() !== hash.toLowerCase() ||
    !sameAddress(receipt.from, owner) ||
    !sameAddress(receipt.to, address)
  )
    throw new Error(
      "The transaction did not produce a matching successful receipt.",
    );
}

export async function executeCrosschain(
  client,
  wallet,
  owner,
  action,
  input,
  onSubmitted,
  onSigning = () => {},
) {
  const checkWallet = async () => {
    if (
      !sameAddress((await wallet.getAddresses())[0], owner) ||
      (await wallet.getChainId()) !== config.chainId
    )
      throw new Error(
        "Connect your signed-in wallet on Base before continuing.",
      );
  };
  await checkWallet();
  const prepared = await prepareCrosschain(client, owner, action, input);
  await checkWallet();
  onSigning({ address: prepared.address, data: encodeFunctionData(prepared) });
  const hash = await wallet.writeContract(prepared);
  onSubmitted(hash, prepared.address);
  const receipt = await client.waitForTransactionReceipt({
    hash,
    confirmations: 1,
  });
  verifyCrosschainReceipt(receipt, hash, owner, prepared.address);
  const transaction = await client.getTransaction({ hash });
  if (
    !sameAddress(transaction.from, owner) ||
    !sameAddress(transaction.to, prepared.address) ||
    transaction.input.toLowerCase() !==
      encodeFunctionData(prepared).toLowerCase()
  )
    throw new Error(
      "The confirmed transaction does not match the requested operation.",
    );
  return receipt;
}

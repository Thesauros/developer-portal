import { workspaceSession } from "../../../lib/auth.mjs";
import { vaults, getVault } from "../../../lib/vault-contracts.mjs";
import { vaultClients } from "../../../lib/vault-rpc.mjs";
import {
  readPosition,
  readAllocation,
  jsonSafe,
} from "../../../lib/vault-reads.mjs";
import {
  confirmedAssetAmount,
  inspectEarnTransaction,
  isTransactionNotFound,
  validNonce,
} from "../../../lib/transaction-history.mjs";
export const dynamic = "force-dynamic";
const snapshots = new Map(),
  pending = new Map();
const headers = { "Cache-Control": "private, no-store" };
const same = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.toLowerCase() === b.toLowerCase();
const notFoundAsNull = (promise) =>
  promise.catch((error) => {
    if (isTransactionNotFound(error)) return null;
    throw error;
  });
async function snapshot(
  vault,
  owner,
  force = false,
  notBefore = force ? Date.now() : 0,
) {
  const key = vault.id + ":" + owner.toLowerCase();
  const cached = snapshots.get(key);
  if (
    cached &&
    ((!force && Date.now() - cached.at < 15000) ||
      (force && cached.startedAt >= notBefore))
  )
    return cached.value;
  const inFlight = pending.get(key);
  if (inFlight) {
    // A post-transaction refresh must not reuse a read started before confirmation.
    if (force && inFlight.startedAt < notBefore) {
      await inFlight.promise;
      return snapshot(vault, owner, true, notBefore);
    }
    return inFlight.promise;
  }
  const startedAt = Date.now();
  const promise = (async () => {
    const client = vaultClients[vault.id];
    try {
      const position = await readPosition(client, vault.id, owner);
      const allocation = await readAllocation(
        client,
        vault.id,
        position.blockNumber,
      ).catch(() => ({ providers: [], rateRay: null, complete: false }));
      const value = jsonSafe({ ...position, ...allocation, status: "ready" });
      if (snapshots.size > 500) snapshots.delete(snapshots.keys().next().value);
      snapshots.set(key, { value, at: Date.now(), startedAt });
      return value;
    } catch (error) {
      return {
        id: vault.id,
        status: "unavailable",
        error: error.userFacing
          ? error.message
          : "Could not read this network. Refresh to try again.",
        observedAt: null,
      };
    } finally {
      pending.delete(key);
    }
  })();
  pending.set(key, { promise, startedAt });
  return promise;
}
export async function GET(request) {
  const session = await workspaceSession(request.headers);
  if (!session?.user.walletAddress)
    return Response.json(
      { error: "Sign in with your wallet to continue." },
      { status: 401, headers },
    );
  const query = new URL(request.url).searchParams;
  if (query.get("kind") === "replacement") {
    let vault;
    try {
      vault = getVault(query.get("vault"));
    } catch {
      return Response.json(
        { error: "Unknown vault." },
        { status: 400, headers },
      );
    }
    const hash = query.get("hash"),
      originalHash = query.get("original");
    const suppliedNonce = query.get("nonce");
    if (
      !/^0x[\da-f]{64}$/i.test(hash || "") ||
      !/^0x[\da-f]{64}$/i.test(originalHash || "") ||
      same(hash, originalHash)
    )
      return Response.json(
        { error: "Enter a different, valid replacement transaction hash." },
        { status: 400, headers },
      );
    if (
      suppliedNonce != null &&
      (!/^\d+$/.test(suppliedNonce) || !validNonce(Number(suppliedNonce)))
    )
      return Response.json(
        { error: "The saved transaction nonce is invalid." },
        { status: 400, headers },
      );
    const owner = session.user.walletAddress;
    const client = vaultClients[vault.id];
    try {
      const [receipt, replacement, original, chainId] = await Promise.all([
        notFoundAsNull(client.getTransactionReceipt({ hash })),
        notFoundAsNull(client.getTransaction({ hash })),
        notFoundAsNull(client.getTransaction({ hash: originalHash })),
        client.getChainId(),
      ]);
      if (!receipt || !replacement)
        return Response.json(
          {
            error:
              "The replacement is not confirmed yet. Check it in your wallet and try again after confirmation.",
          },
          { status: 409, headers },
        );
      if (
        chainId !== vault.chainId ||
        !same(replacement.hash, hash) ||
        !same(replacement.from, owner) ||
        !same(receipt.from, owner) ||
        !same(receipt.transactionHash, hash) ||
        (replacement.to == null
          ? receipt.to != null
          : !same(receipt.to, replacement.to)) ||
        !["success", "reverted"].includes(receipt.status) ||
        !validNonce(replacement.nonce) ||
        (replacement.chainId != null &&
          Number(replacement.chainId) !== vault.chainId)
      )
        return Response.json(
          {
            error:
              "This replacement is not a confirmed transaction from your wallet on this network.",
          },
          { status: 404, headers },
        );
      let originalVerified = false;
      if (original) {
        try {
          inspectEarnTransaction(original, vault.id, owner);
          if (!same(original.hash, originalHash) || !validNonce(original.nonce))
            throw new Error();
          originalVerified = true;
        } catch {
          return Response.json(
            {
              error:
                "The original transaction does not match this account’s Earn operation.",
            },
            { status: 404, headers },
          );
        }
        if (original.blockNumber != null)
          return Response.json(
            {
              error:
                "The original transaction is already included in a block. Refresh its receipt instead of replacing it.",
            },
            { status: 409, headers },
          );
      }
      const nonce = originalVerified
        ? original.nonce
        : suppliedNonce == null
          ? null
          : Number(suppliedNonce);
      if (!validNonce(nonce))
        return Response.json(
          {
            error:
              "The original transaction is unavailable and its nonce was not saved. Check your wallet activity or contact Thesauros to resolve it.",
          },
          { status: 409, headers },
        );
      if (
        replacement.nonce !== nonce ||
        (suppliedNonce != null && Number(suppliedNonce) !== nonce)
      )
        return Response.json(
          {
            error:
              "The replacement uses a different nonce. It cannot replace this pending transaction.",
          },
          { status: 409, headers },
        );
      const consumed = await client.getTransactionCount({
        address: owner,
        blockNumber: receipt.blockNumber,
      });
      if (!validNonce(consumed) || consumed <= nonce)
        throw new Error("The confirmed account nonce could not be reconciled.");
      let kind = null;
      try {
        kind = inspectEarnTransaction(replacement, vault.id, owner).kind;
      } catch {
        /* Same-nonce cancellation or another action. */
      }
      snapshots.delete(vault.id + ":" + owner.toLowerCase());
      // When a node has dropped the original, the nonce-to-original-hash link is
      // supplied by the wallet-scoped local history, not proven by the chain.
      // Only the replacement's sender, consumed nonce and receipt are onchain
      // evidence. The client exposes this distinction and cannot unlock without
      // a saved nonce. This endpoint performs no write or nonce reservation.
      return Response.json(
        {
          status: receipt.status,
          hash: replacement.hash,
          originalHash,
          vaultId: vault.id,
          owner: owner.toLowerCase(),
          nonce,
          originalVerified,
          originalInput: originalVerified ? original.input : null,
          kind,
          to: replacement.to,
          value: replacement.value.toString(),
          input: replacement.input.length <= 4096 ? replacement.input : null,
          blockNumber: receipt.blockNumber.toString(),
          actualAmount: kind
            ? confirmedAssetAmount(receipt, vault.id, owner, kind)
            : null,
        },
        { headers },
      );
    } catch {
      return Response.json(
        {
          error:
            "The network could not verify the replacement. The original remains pending; try again when the network responds.",
        },
        { status: 503, headers },
      );
    }
  }
  if (query.get("kind") === "receipt") {
    let vault;
    try {
      vault = getVault(query.get("vault"));
    } catch {
      return Response.json(
        { error: "Unknown vault." },
        { status: 400, headers },
      );
    }
    const hash = query.get("hash");
    if (!/^0x[\da-f]{64}$/i.test(hash || ""))
      return Response.json(
        { error: "Invalid transaction." },
        { status: 400, headers },
      );
    try {
      const client = vaultClients[vault.id];
      const [receiptResult, transactionResult] = await Promise.allSettled([
        client.getTransactionReceipt({ hash }),
        client.getTransaction({ hash }),
      ]);
      const failed = [receiptResult, transactionResult].find(
        (result) =>
          result.status === "rejected" && !isTransactionNotFound(result.reason),
      );
      if (failed) throw failed.reason;
      const receipt =
        receiptResult.status === "fulfilled" ? receiptResult.value : null;
      const transaction =
        transactionResult.status === "fulfilled"
          ? transactionResult.value
          : null;
      if (!transaction) {
        if (receipt)
          throw new Error(
            "Receipt exists but transaction input is unavailable.",
          );
        return Response.json(
          { status: "pending", found: false, hash },
          { headers },
        );
      }
      let verified;
      try {
        verified = inspectEarnTransaction(
          transaction,
          vault.id,
          session.user.walletAddress,
        );
        if (transaction.hash?.toLowerCase() !== hash.toLowerCase())
          throw new Error();
        if (
          receipt &&
          (receipt.transactionHash?.toLowerCase() !== hash.toLowerCase() ||
            receipt.from?.toLowerCase() !== transaction.from.toLowerCase() ||
            receipt.to?.toLowerCase() !== transaction.to.toLowerCase() ||
            !["success", "reverted"].includes(receipt.status))
        )
          throw new Error();
      } catch {
        return Response.json(
          {
            error: "Transaction does not match this account’s Earn operation.",
          },
          { status: 404, headers },
        );
      }
      if (receipt)
        snapshots.delete(
          vault.id + ":" + session.user.walletAddress.toLowerCase(),
        );
      return Response.json(
        {
          ...verified,
          status: receipt?.status || "pending",
          found: true,
          hash: transaction.hash,
          nonce: validNonce(transaction.nonce) ? transaction.nonce : null,
          blockNumber: receipt?.blockNumber.toString() || null,
          actualAmount: receipt
            ? confirmedAssetAmount(
                receipt,
                vault.id,
                session.user.walletAddress,
                verified.kind,
              )
            : null,
        },
        { headers },
      );
    } catch {
      return Response.json(
        {
          status: "unavailable",
          error:
            "The network could not confirm this transaction’s status. It remains pending until it can be checked.",
        },
        { status: 503, headers },
      );
    }
  }
  let selectedVaults = vaults;
  if (query.has("vault")) {
    try {
      selectedVaults = [getVault(query.get("vault"))];
    } catch {
      return Response.json(
        { error: "Unknown vault." },
        { status: 400, headers },
      );
    }
  }
  return Response.json(
    {
      vaults: await Promise.all(
        selectedVaults.map((vault) =>
          snapshot(
            vault,
            session.user.walletAddress,
            query.get("refresh") === "1",
          ),
        ),
      ),
    },
    { headers },
  );
}

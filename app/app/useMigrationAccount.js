"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import {
  createWalletClient,
  custom,
  encodeFunctionData,
  formatUnits,
} from "viem";
import {
  vaults,
  friendlyTransactionError,
} from "../../lib/vault-contracts.mjs";
import { vaultClients } from "../../lib/vault-rpc.mjs";
import {
  prepareTransaction,
  executeTransaction,
} from "../../lib/vault-transactions.mjs";
import {
  readMigrationLegacy,
  confirmMigrationWithdrawal,
} from "../../lib/migration-legacy.mjs";
import { confirmMigrationOperation } from "../../lib/migration-receipts.mjs";
import { retryMigrationIntent } from "../../lib/migration-retry.mjs";
import {
  migrationKey,
  parseMigration,
  migrationRecord,
  deriveMigration,
  migrationHash,
} from "../../lib/migration-state.mjs";

const inFlight = new Set();
const same = (a, b) => a?.toLowerCase() === b?.toLowerCase();
const rejected = (failure) => {
  for (
    let error = failure, depth = 0;
    error && depth < 10;
    error = error.cause, depth++
  )
    if (
      error.code === 4001 ||
      /UserRejected|User rejected|denied.*request/i.test(
        error.name + " " + error.message,
      )
    )
      return true;
  return false;
};

// The destination adapter is explicit: this hook does not decide product mapping.
export default function useMigrationAccount(destination) {
  const connected = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const owner = connected.status === "connected" ? connected.address : null;
  const key = owner ? migrationKey(owner) : "";
  const currentKey = useRef(key);
  currentKey.current = key;
  const [snapshot, setSnapshot] = useState({
    key: "",
    products: {},
    base: null,
  });
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [messages, setMessages] = useState({});
  const [inputs, setInputs] = useState({});
  const [hashes, setHashes] = useState({});
  const refresh = () => setRevision((value) => value + 1);

  function journal() {
    return parseMigration(localStorage.getItem(key), owner);
  }
  function update(id, change) {
    if (currentKey.current !== key) throw new Error("Кошелёк изменился.");
    const value = journal();
    const record = migrationRecord(value, id);
    const next = {
      ...value,
      products: { ...value.products, [id]: change(record) },
    };
    // Read back synchronously. Signing is forbidden unless recovery is durable.
    localStorage.setItem(key, JSON.stringify(next));
    parseMigration(localStorage.getItem(key), owner);
    return next;
  }
  const message = (id, value) => {
    if (currentKey.current === key)
      setMessages((previous) => ({ ...previous, [id]: value }));
  };

  useEffect(() => {
    setMessages({});
    setInputs({});
    setHashes({});
    setStorageError("");
    setBusy(false);
  }, [key]);

  useEffect(() => {
    if (!owner || !destination) return;
    let active = true,
      running = false;
    async function load() {
      if (running) return;
      running = true;
      setLoading(true);
      try {
        const value = journal();
        localStorage.setItem(key, JSON.stringify(value));
        const rows = await Promise.all(
          vaults.map(async (vault) => {
            const record = migrationRecord(value, vault.id);
            let position = { status: "loading" },
              verificationError = "";
            try {
              position = {
                ...(await readMigrationLegacy(
                  vaultClients[vault.id],
                  vault.id,
                  owner,
                )),
                status: "ready",
              };
            } catch (error) {
              position = {
                status: "error",
                error: error.userFacing
                  ? error.message
                  : "RPC не смог проверить старую позицию.",
              };
            }
            const withdrawals = [],
              deposits = [];
            try {
              for (const hash of record.withdrawals)
                withdrawals.push(
                  await confirmMigrationWithdrawal(
                    vaultClients[vault.id],
                    vault.id,
                    owner,
                    hash,
                  ),
                );
              for (const hash of record.deposits) {
                const deposit = await confirmMigrationOperation(
                  vaultClients.base,
                  destination.config,
                  owner,
                  hash,
                );
                if (deposit.kind !== "deposit")
                  throw new Error("Сохранённая заявка не является депозитом.");
                deposits.push(deposit);
              }
            } catch {
              verificationError =
                "Не удалось проверить историю миграции. Операции приостановлены до проверки подтверждений.";
            }
            return [
              vault.id,
              { position, record, withdrawals, deposits, verificationError },
            ];
          }),
        );
        const products = Object.fromEntries(rows);
        const ids = rows.flatMap(([, row]) =>
          row.deposits.map((deposit) => deposit.requestId),
        );
        let base = null,
          baseError = "";
        try {
          base = await destination.readUser(owner, [...new Set(ids)]);
        } catch {
          baseError =
            "Не удалось проверить новый контракт и баланс USDC в Base.";
        }
        if (active && currentKey.current === key) {
          setStorageError("");
          setSnapshot({ key, products, base, baseError });
        }
      } catch {
        if (active && currentKey.current === key)
          setStorageError(
            "Хранилище миграции недоступно или повреждено. Подпись отключена. Сохраните хеши транзакций.",
          );
      } finally {
        running = false;
        if (active && currentKey.current === key) setLoading(false);
      }
    }
    load();
    const timer = setInterval(() => {
      if (!document.hidden) load();
    }, 15000);
    const changed = (event) => {
      if (!event.key || event.key === key) refresh();
    };
    const focused = () => refresh();
    window.addEventListener("storage", changed);
    window.addEventListener("focus", focused);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("storage", changed);
      window.removeEventListener("focus", focused);
    };
  }, [key, revision, destination]);

  const state = snapshot.key === key ? snapshot : { products: {}, base: null };
  function derive(vault) {
    const row = state.products[vault.id];
    const requests =
      row?.deposits.map((deposit) => {
        const request = state.base?.requests.find(
          (request) => request.id === deposit.requestId,
        );
        if (
          !request ||
          request.kind !== "deposit" ||
          !same(request.owner, owner) ||
          !same(request.receiver, owner) ||
          BigInt(request.amount) !== deposit.amount
        )
          return null;
        return request;
      }) || [];
    const missingRequest = requests.some((request) => !request);
    return deriveMigration({
      position: row?.position,
      withdrawals: row?.withdrawals,
      requests: requests.filter(Boolean),
      pending: row?.record.pending,
      cash: state.base?.cash,
      allowance: state.base?.allowance,
      amountInput: inputs[vault.id] || "",
      verificationError:
        row?.verificationError ||
        (missingRequest
          ? "Не удалось проверить состояние заявки депозита."
          : ""),
    });
  }

  async function exclusive(task) {
    if (!key || busy || inFlight.has(key)) return;
    const run = async () => {
      if (inFlight.has(key) || currentKey.current !== key) return;
      inFlight.add(key);
      setBusy(true);
      try {
        await task();
      } finally {
        inFlight.delete(key);
        if (currentKey.current === key) {
          setBusy(false);
          refresh();
        }
      }
    };
    if (navigator.locks)
      await navigator.locks.request(key, { ifAvailable: true }, (lock) =>
        lock ? run() : undefined,
      );
    else {
      setStorageError(
        "Для безопасной подписи нужен браузер с Web Locks API. Откройте приложение в актуальном Chrome, Safari или Firefox.",
      );
    }
  }

  async function settle(vault, pending, hash) {
    if (pending.kind === "withdraw") {
      // Confirm exact intent, including replacement/cancellation when the nonce
      // was obtained from the original broadcast transaction.
      const client = vaultClients[vault.id];
      const tx = await client.getTransaction({ hash });
      if (pending.nonce != null && tx.nonce !== pending.nonce)
        throw new Error(
          "Транзакция использует другой nonce и не заменяет ожидающую операцию.",
        );
      if (!same(tx.input, pending.data) || !same(tx.to, pending.address)) {
        const receipt = await client.getTransactionReceipt({ hash });
        if (
          pending.nonce == null ||
          tx.nonce !== pending.nonce ||
          !same(tx.hash, hash) ||
          !same(tx.from, owner) ||
          !same(receipt.from, owner) ||
          !same(receipt.to, tx.to) ||
          !same(receipt.transactionHash, hash) ||
          !["success", "reverted"].includes(receipt.status) ||
          receipt.blockNumber == null ||
          tx.blockNumber !== receipt.blockNumber ||
          !same(tx.blockHash, receipt.blockHash) ||
          (await client.getBlockNumber({ cacheTime: 0 })) <
            receipt.blockNumber ||
          (await client.getChainId()) !== vault.chainId
        )
          throw new Error("Хеш не соответствует сохранённой операции.");
        update(vault.id, (record) => ({ ...record, pending: null }));
        message(
          vault.id,
          "Вывод отменён или заменён другой операцией. Баланс будет проверен заново.",
        );
        return;
      }
      if (
        same(tx.hash, pending.hash) &&
        same(tx.from, owner) &&
        Number.isSafeInteger(tx.nonce)
      )
        update(vault.id, (record) => ({
          ...record,
          pending: { ...record.pending, nonce: tx.nonce },
        }));
      try {
        await confirmMigrationWithdrawal(client, vault.id, owner, hash);
      } catch (error) {
        if (error.status === "reverted") {
          update(vault.id, (record) => ({ ...record, pending: null }));
          message(
            vault.id,
            "Вывод отклонён контрактом. Можно повторить после проверки позиции.",
          );
          return;
        }
        throw error;
      }
      update(vault.id, (record) => ({
        ...record,
        withdrawals: [...new Set([...record.withdrawals, hash.toLowerCase()])],
        pending: null,
      }));
      message(
        vault.id,
        "Вывод подтверждён. Поступление USDC в ваш кошелёк проверено.",
      );
    } else {
      if (same(hash, pending.hash) && pending.nonce == null) {
        const tx = await vaultClients.base.getTransaction({ hash });
        if (
          same(tx.hash, hash) &&
          same(tx.from, owner) &&
          same(tx.to, pending.address) &&
          same(tx.input, pending.data) &&
          Number.isSafeInteger(tx.nonce)
        ) {
          pending = { ...pending, nonce: tx.nonce };
          update(vault.id, (record) => ({ ...record, pending }));
        }
      }
      const result = await confirmMigrationOperation(
        vaultClients.base,
        destination.config,
        owner,
        hash,
        pending,
      );
      if (result.kind && result.kind !== pending.kind)
        throw new Error("Неверный вид операции.");
      // A request is reserved to one legacy product; the same receipt cannot
      // account for proceeds from two independent positions.
      const saved = journal();
      if (
        result.kind === "deposit" &&
        Object.entries(saved.products).some(
          ([id, row]) =>
            id !== vault.id && row.deposits.some((value) => same(value, hash)),
        )
      )
        throw new Error("Этот депозит уже относится к другой миграции.");
      update(vault.id, (record) => ({
        ...record,
        deposits:
          result.kind === "deposit"
            ? [...new Set([...record.deposits, hash.toLowerCase()])]
            : record.deposits,
        ...(["approve", "claim"].includes(pending.kind)
          ? {
              actions: [
                ...(record.actions || []).filter(
                  (action) => !same(action.hash, hash),
                ),
                { kind: pending.kind, hash: hash.toLowerCase() },
              ],
            }
          : {}),
        pending: null,
      }));
      message(
        vault.id,
        result.cancelled
          ? "Операция заменена или отменена."
          : result.reverted
            ? "Транзакция отклонена контрактом. Проверьте данные и повторите."
            : result.kind === "approve"
              ? "Approve подтверждён. Депозит требует отдельного подтверждения."
              : result.kind === "deposit"
                ? "USDC внесены. Ожидайте расчёта эпохи, затем получите доли через claim."
                : "Claim подтверждён. Состояние долей обновляется.",
      );
    }
  }

  async function recover(vault) {
    await exclusive(async () => {
      try {
        const pending = migrationRecord(journal(), vault.id).pending;
        const hash = hashes[vault.id] || pending?.hash;
        if (!migrationHash(hash))
          throw new Error("Укажите хеш транзакции из кошелька.");
        if (pending) await settle(vault, pending, hash);
        else {
          await confirmMigrationWithdrawal(
            vaultClients[vault.id],
            vault.id,
            owner,
            hash,
          );
          update(vault.id, (record) => ({
            ...record,
            withdrawals: [
              ...new Set([...record.withdrawals, hash.toLowerCase()]),
            ],
          }));
          message(
            vault.id,
            "Вывод найден в блокчейне. Можно продолжить миграцию.",
          );
        }
      } catch (error) {
        message(
          vault.id,
          error.userFacing
            ? error.message
            : "Транзакция пока не подтверждена или не соответствует миграции. Проверьте кошелёк и повторите проверку.",
        );
      }
    });
  }

  async function act(vault) {
    await exclusive(async () => {
      let signing = false;
      try {
        const saved = journal();
        if (Object.values(saved.products).some((row) => row.pending))
          throw new Error("Сначала проверьте незавершённую транзакцию.");
        const current = derive(vault);
        if (!current.canAct || storageError) return;
        const kind = current.stage === "withdraw" ? "withdraw" : current.stage;
        if (!["withdraw", "approve", "deposit", "claim"].includes(kind)) return;
        const network = kind === "withdraw" ? vault.chain : destination.chain;
        if (connected.chainId !== network.id)
          await switchChainAsync({ chainId: network.id });
        if (currentKey.current !== key) throw new Error("Кошелёк изменился.");
        const provider = await connected.connector.getProvider({
          chainId: network.id,
        });
        const wallet = createWalletClient({
          chain: network,
          transport: custom(provider),
        });
        const saveIntent = (intent) => {
          const latest = journal();
          const crosschainKey =
            "thesauros.crosschain." +
            destination.config.address.toLowerCase() +
            "." +
            owner.toLowerCase();
          if (localStorage.getItem(crosschainKey))
            throw new Error(
              "В новом продукте уже есть неподтверждённая операция. Сначала проверьте её статус.",
            );
          if (Object.values(latest.products).some((row) => row.pending))
            throw new Error("Операция уже ожидает подтверждения.");
          const observed = state.products[vault.id]?.record;
          const now = migrationRecord(latest, vault.id);
          if (
            JSON.stringify([
              now.withdrawals,
              now.deposits,
              now.actions || [],
            ]) !==
            JSON.stringify([
              observed?.withdrawals,
              observed?.deposits,
              observed?.actions || [],
            ])
          )
            throw new Error(
              "Миграция изменилась в другой вкладке. Обновите данные.",
            );
          update(vault.id, (record) => ({
            ...record,
            pending: {
              kind,
              chainId: network.id,
              address: intent.address,
              data: intent.data,
              nonce: intent.nonce,
            },
          }));
          signing = true;
          message(vault.id, "Подтвердите отдельную транзакцию в кошельке.");
        };
        const saveHash = async (hash) => {
          update(vault.id, (record) => ({
            ...record,
            pending: { ...record.pending, hash },
          }));
          message(vault.id, "Транзакция отправлена. Ожидается подтверждение.");
          refresh();
          try {
            const tx = await vaultClients[
              vault.id === "arbitrum" && kind === "withdraw"
                ? "arbitrum"
                : "base"
            ].getTransaction({ hash });
            update(vault.id, (record) =>
              record.pending &&
              same(record.pending.hash, hash) &&
              same(tx.hash, hash) &&
              same(tx.from, owner) &&
              same(tx.to, record.pending.address) &&
              same(tx.input, record.pending.data) &&
              tx.value === 0n &&
              Number.isSafeInteger(tx.nonce) &&
              tx.nonce >= 0 &&
              (tx.chainId == null ||
                Number(tx.chainId) === record.pending.chainId)
                ? { ...record, pending: { ...record.pending, nonce: tx.nonce } }
                : record,
            );
          } catch {
            /* Retain the hash even when a node has not seen it yet. */
          }
        };
        let hash;
        if (kind === "withdraw") {
          const client = vaultClients[vault.id];
          const prepared = await prepareTransaction({
            publicClient: client,
            vaultId: vault.id,
            owner,
            kind: "withdraw",
            all: true,
          });
          const guarded = {
            ...wallet,
            writeContract: async (request) => {
              const nonce = await client.getTransactionCount({
                address: owner,
                blockTag: "pending",
              });
              if (
                !Number.isSafeInteger(nonce) ||
                nonce < 0 ||
                !same((await wallet.getAddresses())[0], owner) ||
                (await wallet.getChainId()) !== vault.chainId
              )
                throw new Error(
                  "Кошелёк или сеть изменились. Проверьте операцию заново.",
                );
              saveIntent({
                address: request.address,
                data: encodeFunctionData(request),
                nonce,
              });
              return wallet.writeContract({ ...request, nonce });
            },
          };
          const result = await executeTransaction({
            publicClient: client,
            walletClient: guarded,
            prepared,
            onHash: saveHash,
          });
          hash = result.hash;
        } else {
          await destination.check(kind);
          const receipt = await destination.execute(
            wallet,
            owner,
            kind,
            kind === "claim"
              ? current.requestId
              : formatUnits(BigInt(current.selected), 6),
            saveHash,
            saveIntent,
          );
          hash = receipt.transactionHash;
        }
        await settle(vault, migrationRecord(journal(), vault.id).pending, hash);
        setInputs((previous) => ({ ...previous, [vault.id]: "" }));
      } catch (error) {
        if (signing && rejected(error))
          update(vault.id, (record) => ({ ...record, pending: null }));
        message(
          vault.id,
          rejected(error)
            ? "Подпись отменена. Можно продолжить с текущего шага."
            : signing
              ? "Результат операции требует проверки. Используйте хеш из кошелька; повторная отправка заблокирована."
              : error.userFacing
                ? friendlyTransactionError(error)
                : error.shortMessage || error.message,
        );
      }
    });
  }

  async function retry(vault) {
    await exclusive(async () => {
      try {
        const pending = migrationRecord(journal(), vault.id).pending;
        if (!pending) return;
        const network =
          pending.chainId === vault.chainId ? vault.chain : destination.chain;
        if (connected.chainId !== network.id)
          await switchChainAsync({ chainId: network.id });
        const provider = await connected.connector.getProvider({
          chainId: network.id,
        });
        const wallet = createWalletClient({
          chain: network,
          transport: custom(provider),
        });
        const { hash } = await retryMigrationIntent({
          publicClient:
            vaultClients[pending.chainId === 42161 ? "arbitrum" : "base"],
          walletClient: wallet,
          owner,
          vaultId: vault.id,
          pending,
          beforeRetry: (kind) => destination.check(kind),
          onHash: (hash) => {
            update(vault.id, (record) => ({
              ...record,
              pending: { ...record.pending, hash },
            }));
            message(
              vault.id,
              "Запрос отправлен с тем же nonce. Ожидаем подтверждения единственной операции.",
            );
          },
        });
        await settle(vault, migrationRecord(journal(), vault.id).pending, hash);
      } catch (error) {
        message(
          vault.id,
          rejected(error)
            ? "Повторный запрос подписи отменён. Сохранённая операция остаётся доступной для проверки или повтора."
            : error.code === "NONCE_CONSUMED"
              ? "Этот nonce уже использован. Укажите хеш подтверждённой операции или её замены для восстановления."
              : error.userFacing
                ? error.message
                : "Подтверждение пока недоступно. Операция сохранена; повтор с тем же nonce не создаст второй депозит или вывод.",
        );
      }
    });
  }

  // Automatic recovery never signs or resubmits. It only checks known receipts.
  useEffect(() => {
    if (!key || !destination) return;
    const check = () => {
      try {
        const saved = journal();
        const item = vaults.find(
          (vault) => migrationRecord(saved, vault.id).pending?.hash,
        );
        if (item) recover(item);
      } catch {
        /* The regular loader reports storage failures. */
      }
    };
    const timer = setInterval(check, 15000);
    return () => clearInterval(timer);
  }, [key, destination]);

  const products = !owner
    ? []
    : vaults
        .map((vault) => {
          const row = state.products[vault.id];
          const current = derive(vault);
          const pending = row?.record.pending;
          const txs = [
            ...(row?.record.withdrawals || []).map((hash) => ({
              hash,
              label: row?.withdrawals.some((withdrawal) =>
                same(withdrawal.hash, hash),
              )
                ? "Вывод подтверждён"
                : "Вывод · требуется проверка",
              explorer: vault.explorer,
            })),
            ...(row?.record.actions || []).map((action) => ({
              hash: action.hash,
              label:
                action.kind === "approve" ? "Approve · Base" : "Claim · Base",
              explorer: destination?.config.explorer,
            })),
            ...(row?.record.deposits || []).map((hash) => ({
              hash,
              label: "Заявка депозита",
              explorer: destination?.config.explorer,
            })),
            ...(pending?.hash
              ? [
                  {
                    hash: pending.hash,
                    label: "Ожидает проверки",
                    explorer:
                      pending.chainId === 8453
                        ? destination?.config.explorer
                        : vault.explorer,
                  },
                ]
              : []),
          ];
          return {
            ...vault,
            ...current,
            positionStatus: row?.position.status || "loading",
            shares: row?.position.shares?.toString() ?? null,
            assets: row?.position.positionAssets?.toString() ?? null,
            positionError: row?.position.error,
            cash: state.base?.cash ?? null,
            error:
              current.error ||
              row?.position.error ||
              messages[vault.id] ||
              (current.stage === "check" ? state.baseError : ""),
            canAct:
              current.canAct &&
              !busy &&
              !loading &&
              !storageError &&
              !Object.values(state.products).some((row) => row.record.pending),
            amountInput: inputs[vault.id] || "",
            setAmountInput: (value) =>
              setInputs((previous) => ({ ...previous, [vault.id]: value })),
            recovery: !!pending,
            retry:
              pending && Number.isSafeInteger(pending.nonce)
                ? () => retry(vault)
                : null,
            pendingNonce: pending?.nonce,
            recoveryHash: hashes[vault.id] || pending?.hash || "",
            setRecoveryHash: (value) =>
              setHashes((previous) => ({ ...previous, [vault.id]: value })),
            act: () => act(vault),
            recover: () => recover(vault),
            txs,
          };
        })
        .filter((product) => product.visible);
  return {
    owner,
    loading,
    error: "",
    storageError,
    busy,
    refresh,
    products,
    destination: destination?.config,
    blocksNewRequests:
      !!storageError ||
      products.some((product) => product.stage !== "complete"),
  };
}

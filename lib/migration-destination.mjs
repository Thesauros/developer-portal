import { base } from "viem/chains";
import { crosschain, assertCrosschainIdentity } from "./crosschain-config.mjs";
import {
  readCrosschainUser,
  readCrosschainVault,
} from "./crosschain-reads.mjs";
import { executeCrosschain } from "./crosschain-transactions.mjs";
import { vaultClients } from "./vault-rpc.mjs";
import { amountUnits } from "./vault-contracts.mjs";

// User confirmed 2026-11-12: both configured legacy USDC products migrate into
// this hub EpochVault. Arbitrum proceeds are transferred to Base by the user.
export const migrationDestination = Object.freeze({
  chain: base,
  config: Object.freeze({
    chainId: 8453,
    address: crosschain.vault,
    asset: crosschain.asset,
    decimals: 6,
    explorer: crosschain.explorer,
  }),
  readUser: readCrosschainUser,
  async check(kind) {
    if (kind === "claim") return;
    const value = await readCrosschainVault();
    assertCrosschainIdentity(value);
    if (
      value.depositPaused ||
      value.tick?.frozen !== false ||
      value.tick?.quarantined !== false ||
      !Number.isFinite(value.tick?.ageSeconds) ||
      value.tick.ageSeconds < 0 ||
      !Number.isFinite(value.risk?.maxTickAge) ||
      value.tick.ageSeconds > value.risk.maxTickAge
    )
      throw new Error(
        "Новый депозит недоступен: требуется актуальная оценка EpochVault без паузы.",
      );
    await Promise.all(
      ["health", "backend-base", "backend-arbitrum"].map(async (resource) => {
        const response = await fetch("/api/crosschain/" + resource, {
          cache: "no-store",
        });
        if (!response.ok)
          throw new Error(
            "Backend кроссчейн-продукта недоступен или не соответствует контрактам.",
          );
      }),
    );
  },
  async execute(wallet, owner, kind, input, onHash, onSigning) {
    if (kind === "approve") {
      const state = await readCrosschainUser(owner);
      if (BigInt(state.allowance) >= amountUnits(input))
        throw new Error(
          "USDC уже разрешены. Обновите данные и продолжите депозит отдельной транзакцией.",
        );
    }
    return executeCrosschain(
      vaultClients.base,
      wallet,
      owner,
      kind,
      input,
      onHash,
      onSigning,
    );
  },
});

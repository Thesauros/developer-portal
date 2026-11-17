// How much of a vault could leave right now, market by market: for each market
// the smaller of the vault's position and the cash that market can pay out, plus
// what the vault holds uninvested. Read from the contracts; cached briefly.
import { vaultAbi } from "./vault-contracts.mjs";
import { vaultClients } from "./vault-rpc.mjs";
import { describe, marketAbi } from "./market-index.mjs";

const cache = (globalThis.__thesaurosExitCapacity ??= new Map());
const TTL = 5 * 60 * 1000;

async function measure(vault) {
  const client = vaultClients[vault.id];
  if (!client) return null;
  const read = (address, abi, functionName, args = []) =>
    client.readContract({ address, abi, functionName, args });
  const [providers, idle] = await Promise.all([
    read(vault.address, vaultAbi, "getProviders"),
    read(vault.asset, marketAbi, "balanceOf", [vault.address]),
  ]);
  const markets = [];
  for (const provider of providers) {
    const position = await read(provider, marketAbi, "getDepositBalance", [
      vault.address,
      vault.address,
    ]);
    if (position === 0n) continue;
    const source = await read(provider, marketAbi, "getSource", [
      vault.asset,
      vault.address,
      vault.address,
    ]);
    const info = await describe(client, vault.network, source, vault.asset);
    let free = null;
    if (info?.kind === "erc4626")
      // A curated vault answers for this holder: its position, capped by the
      // liquidity of the markets it lends to.
      free = await read(source, marketAbi, "maxWithdraw", [vault.address]);
    else if (info?.kind === "aave")
      free = await read(vault.asset, marketAbi, "balanceOf", [info.aToken]);
    else if (info?.kind === "comet")
      free = await read(vault.asset, marketAbi, "balanceOf", [source]);
    if (free == null) return null; // a market we cannot read: say nothing
    const canLeave = free < position ? free : position;
    markets.push({
      name: info.name,
      protocol: info.protocol,
      position: Number(position) / 10 ** vault.decimals,
      canLeave: Number(canLeave) / 10 ** vault.decimals,
      free: Number(free) / 10 ** vault.decimals,
    });
  }
  const cash = Number(idle) / 10 ** vault.decimals;
  return {
    canLeave: cash + markets.reduce((sum, row) => sum + row.canLeave, 0),
    held: cash + markets.reduce((sum, row) => sum + row.position, 0),
    cash,
    markets,
    at: new Date().toISOString(),
  };
}

const running = (globalThis.__thesaurosExitCapacityRunning ??= new Map());

// Never holds a page up for long: a fresh reading if it comes within `waitMs`,
// otherwise the last one, while the reading finishes in the background.
export async function exitCapacity(vault, { waitMs = 4000 } = {}) {
  const hit = cache.get(vault.id);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  if (!running.has(vault.id))
    running.set(
      vault.id,
      measure(vault)
        .catch(() => hit?.value ?? null)
        .then((value) => {
          cache.set(vault.id, { value, at: Date.now() });
          return value;
        })
        .finally(() => running.delete(vault.id)),
    );
  const timeout = new Promise((done) => setTimeout(() => done(undefined), waitMs));
  const value = await Promise.race([running.get(vault.id), timeout]);
  return value === undefined ? (hit?.value ?? null) : value;
}

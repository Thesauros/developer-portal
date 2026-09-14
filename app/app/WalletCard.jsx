"use client";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useEffect, useRef, useState } from "react";
import { fmt, Mark, short, stamp } from "./LivePanels";
import s from "./workspace.module.css";
const ERC20 = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
];
const VAULT = [
  ...ERC20,
  "function asset() view returns (address)",
  "function convertToAssets(uint256) view returns (uint256)",
];
export default function WalletCard({ networks = [], expectedAddress }) {
  const { address: connectedAddress, connector, chainId } = useAccount();
  const { openConnectModal } = useConnectModal();
  const [address, setAddress] = useState(""),
    [balance, setBalance] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const generation = useRef(0),
    providerRef = useRef(null),
    networksRef = useRef(networks);
  networksRef.current = networks;
  async function read(account, ethereum) {
    const version = ++generation.current;
    setBusy(true);
    setError("");
    setBalance(null);
    setAddress(account || "");
    if (!account) {
      setBusy(false);
      return;
    }
    let provider;
    try {
      const { BrowserProvider, Contract, formatUnits } = await import("ethers");
      provider = new BrowserProvider(ethereum);
      const network = await provider.getNetwork();
      const match = networksRef.current.find(
        (n) => n.chainId === Number(network.chainId),
      );
      if (!match)
        throw new Error(
          "Switch your wallet to Base, Arbitrum, Plasma or Monad to read supported assets.",
        );
      const vault = match.vaults[0];
      if (!vault?.address)
        throw new Error("The vault address is temporarily unavailable.");
      const contract = new Contract(vault.address, VAULT, provider);
      const assetAddress = await contract.asset();
      const asset = new Contract(assetAddress, ERC20, provider);
      const block = await provider.getBlockNumber();
      const [cash, decimals, shares, shareDecimals] = await Promise.all([
        asset.balanceOf(account, { blockTag: block }),
        asset.decimals({ blockTag: block }),
        contract.balanceOf(account, { blockTag: block }),
        contract.decimals({ blockTag: block }),
      ]);
      const underlying = await contract.convertToAssets(shares, {
        blockTag: block,
      });
      if (version === generation.current)
        setBalance({
          cash: formatUnits(cash, decimals),
          shares: formatUnits(shares, shareDecimals),
          earn: formatUnits(underlying, decimals),
          token: vault.token,
          network: match.name,
          explorer: match.explorer,
          block,
          at: new Date().toISOString(),
        });
    } catch (e) {
      if (version === generation.current)
        setError(
          e.code === 4001
            ? "Connection request cancelled."
            : e.shortMessage || e.message || "Your wallet could not be read.",
        );
    } finally {
      provider?.destroy();
      if (version === generation.current) setBusy(false);
    }
  }
  function connect() {
    openConnectModal?.();
  }
  useEffect(() => {
    let cancelled = false;
    if (
      !connectedAddress ||
      !connector ||
      !networks.length ||
      connectedAddress.toLowerCase() !== expectedAddress?.toLowerCase()
    )
      return;
    connector
      .getProvider()
      .then((provider) => {
        if (cancelled) return;
        providerRef.current = provider;
        read(connectedAddress, provider);
      })
      .catch(() => {
        if (!cancelled)
          setError("Please reconnect your wallet to read balances.");
      });
    return () => {
      cancelled = true;
      generation.current++;
    };
  }, [connectedAddress, connector, chainId, networks, expectedAddress]);
  return (
    <section className={s.wallet}>
      <div className={s.panelHead}>
        <div>
          <span className={s.eyebrow}>Your connected account</span>
          <h2>
            {address
              ? "A clear view of your balance."
              : "Your capital, in view."}
          </h2>
        </div>
        <span className={s.pill}>Read only</span>
      </div>
      {address ? (
        <>
          <div className={s.walletAddress}>
            <span>{short(address)}</span>
            <span className={s.caption}>Connected wallet</span>
          </div>
          {balance ? (
            <>
              <div className={s.walletValue}>
                <span>In Thesauros Earn · {balance.token}</span>
                <strong>{fmt(Number(balance.earn), 6)}</strong>
              </div>
              <div className={s.walletDetails}>
                <div>
                  <span>Available in wallet</span>
                  <strong>
                    {fmt(Number(balance.cash), 6)} {balance.token}
                  </strong>
                </div>
                <div>
                  <span>Vault shares</span>
                  <strong>{fmt(Number(balance.shares), 6)}</strong>
                </div>
                <div>
                  <span>Network</span>
                  <strong>{balance.network}</strong>
                </div>
              </div>
              <div className={s.source}>
                <span>
                  Block {fmt(balance.block, 0)} · {stamp(balance.at)}
                </span>
                <a
                  href={balance.explorer + "/address/" + address}
                  target="_blank"
                  rel="noreferrer"
                >
                  View address
                </a>
              </div>
            </>
          ) : null}
          <button
            className={s.secondaryButton}
            disabled={busy}
            onClick={() => read(address, providerRef.current)}
          >
            {busy ? "Reading balances…" : "Refresh balances"}
          </button>
        </>
      ) : (
        <>
          <div className={s.walletValue}>
            <span>In Thesauros Earn</span>
            <strong>
              —<small> USDC</small>
            </strong>
          </div>
          <p>
            Connect your wallet to read your stablecoin balance and Thesauros
            vault position.
          </p>
          <div className={s.walletNetworks}>
            {["Base", "Arbitrum", "Monad"].map((n) => (
              <span key={n}>
                <Mark chain={n} />
                {n}
              </span>
            ))}
            <span>Plasma</span>
          </div>
          <button
            className={s.primaryButton}
            onClick={connect}
            disabled={busy || !networks.length}
          >
            {busy ? "Connecting…" : "Connect wallet"}
          </button>
        </>
      )}
      {error && (
        <p role="alert" className={s.warning}>
          {error}
        </p>
      )}
    </section>
  );
}

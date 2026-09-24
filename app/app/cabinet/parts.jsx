import c from "./cabinet.module.css";

export function VaultMark({ vault, size = 28 }) {
  return vault.icon ? (
    <img
      src={vault.icon}
      width={size}
      height={size}
      alt=""
      className={c.vaultMark}
    />
  ) : (
    <span className={c.vaultMarkText} style={{ width: size, height: size }}>
      {vault.network[0]}
    </span>
  );
}

// Large amounts with quieter decimals: 24,130.49 reads as 24,130 first.
export function Amount({ value, digits = 2 }) {
  if (value == null || !Number.isFinite(value)) return "—";
  const [whole, fraction] = value
    .toLocaleString("en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })
    .split(".");
  return (
    <>
      {whole}
      {fraction && <span className={c.fraction}>.{fraction}</span>}
    </>
  );
}

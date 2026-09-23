# Live vault integration review — 20 September 2026

Read-only integration research for the local Individual workspace. No wallet was connected, no transaction or approval was signed, no funds moved, and no contracts or remote repositories were changed. This verifies the target and integration semantics; it is not a security audit or an assertion that a wallet warning has been cleared.

## Decision and authoritative deployment evidence

The current production application uses the **optimized Rebalancer proxies** on Arbitrum and Base. Do not reuse the older addresses from the downloaded September app snapshot or the original `contracts` repository.

| Network | Chain ID | User-facing vault / approval spender | Native USDC |
| --- | --- | --- | --- |
| Arbitrum One | `42161` / `0xa4b1` | `0x4E5c0A4C11d713002D74bA43a458efc31bc76378` | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` |
| Base | `8453` / `0x2105` | `0x3C7739173cca612B6394EE57131458185A5beC44` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |

Both asset and vault-share decimals are **6**, and the observed share symbol is `tUSDC`.

Independent evidence agrees:

1. [Official app configuration at `e32437264635962d282d3e7edb03ae54dcac4632`](https://github.com/Thesauros/thesauros-app/blob/e32437264635962d282d3e7edb03ae54dcac4632/src/shared/blockchain/config.ts). The GitHub default branch was `master` at inspection; this document pins the inspected revision.
2. Fresh production JavaScript from [app.thesauros.io](https://app.thesauros.io/), checked directly rather than relying on the local archive. Both `/_next/static/chunks/2b7dc0b64d5076f0.js` and `/_next/static/chunks/5e2857a3c86eebf0.js` contained these addresses. Those asset filenames are deployment-specific.
3. [Arbitrum monitor](https://bastardgreeks.thesauros.io/api/dashboard?network=arbitrumRebalancer) and [Base monitor](https://bastardgreeks.thesauros.io/api/dashboard?network=baseRebalancer) expose the same vaults and assets. Monitor observations around `2026-09-20T19:53:18Z` / `19:53:20Z` reported active vaults.
4. Direct public JSON-RPC reads verified nonempty bytecode, `asset()`, decimals and the EIP-1967 implementation slots. The implementation runtime bytes exactly matched the committed deployment artifacts on both networks.

The official app also lists Plasma and Monad. This bounded integration review did **not** verify those deployments and does not authorize treating all monitor networks or yield-market listings as deposit targets.

### Exact local ABI and source paths

Workspace root: `/home/pavel/thesauros-docs-workspace`.

- `repos/optimized-rebalancer-contracts/deployments/arbitrum/USDCRebalancerProxy.json` — Arbitrum proxy address.
- `repos/optimized-rebalancer-contracts/deployments/arbitrum/USDCRebalancerImplementation.json` — application ABI and implementation runtime bytecode.
- `repos/optimized-rebalancer-contracts/deployments/base/USDCRebalancerProxy.json` — Base proxy address.
- `repos/optimized-rebalancer-contracts/deployments/base/USDCRebalancerImplementation.json` — application ABI and implementation runtime bytecode.
- `repos/optimized-rebalancer-contracts/contracts/Rebalancer.sol` — inspected source, lines 173–305 for limit/preview/user methods, 395–501 for execution/validation, 564–640 for fees, 651–724 for privileged operations.
- `repos/optimized-rebalancer-contracts/contracts/interfaces/IPausableActions.sol` — action enum and pause ABI.
- `repos/optimized-rebalancer-contracts/contracts/interfaces/IProvider.sol` — provider rate units and balance methods.
- `repos/optimized-rebalancer-contracts/contracts/access/{AccessManager,Timelock}.sol` and `contracts/libraries/Constants.sol` — roles, timelock and fee bounds.

The inspected local contracts revision is `cf791b9ef3966ea85a2cec54e21f27bdfc095b16`. The deployment solc input `deployments/{arbitrum,base}/solcInputs/9c5ea5f3f4c3378c95d0e1dffb2e0bfb.json` contains a `contracts/Rebalancer.sol` identical to the checked-out source (SHA-256 `d8d48c0803b00e39a6c7f37168a0e46c0a9b324c9b6194846724d679c2fb1ab3`). [Pinned source](https://github.com/Thesauros/optimized-rebalancer-contracts/blob/cf791b9ef3966ea85a2cec54e21f27bdfc095b16/contracts/Rebalancer.sol), [Arbitrum deployment ABI](https://github.com/Thesauros/optimized-rebalancer-contracts/blob/cf791b9ef3966ea85a2cec54e21f27bdfc095b16/deployments/arbitrum/USDCRebalancerImplementation.json), [Base deployment ABI](https://github.com/Thesauros/optimized-rebalancer-contracts/blob/cf791b9ef3966ea85a2cec54e21f27bdfc095b16/deployments/base/USDCRebalancerImplementation.json).

**Apply the implementation ABI to the proxy address.** The proxy artifact ABI does not contain the application deposit methods. Do not approve or deposit into the implementation address.

### Direct chain observations

| Read | Arbitrum | Base |
| --- | --- | --- |
| Public RPC | `https://arb1.arbitrum.io/rpc` | `https://mainnet.base.org`, supplemental `https://base-rpc.publicnode.com` |
| Bytecode verification block | `507211485` | `51572352` |
| EIP-1967 implementation | `0xEd3296117dAAa46FE4Cf94036bb42EE86100F8c7` | `0xd4aC8Bcec0790ADDa563dB1B35c072B485fE2708` |
| Proxy byte length | `1166` | `1166` |
| Implementation byte length | `16929` | `16929` |
| Implementation byte-for-byte artifact match | Yes | Yes |
| `getMinAssets()` | `1000000` = 1 USDC | `1000000` = 1 USDC |
| `getManagementFee()` / `getPerformanceFee()` | `0` / `0` | `0` / `0` |
| `paused(0)` / `paused(1)` | `false` / `false` | `false` / `false` |
| Example `previewDeposit(1000000)` | `994665` share units | `994165` share units |
| Example `previewRedeem(1000000)` | `1005363` USDC units | `1005869` USDC units |

The runtime keccak256 for both implementations was `0xc88383885f0e303fbe2849d454ac98a0e7c89788b6f06709275ac06b3cfc5e70`. EIP-1967 implementation slot: `0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc`.

Base reads were completed across blocks `51572352`, `51572386`, and `51572419` because the official public RPC rate-limited the first parallel batch. Arbitrum governance reads were completed at blocks `507211756` and `507211999`. These are snapshots, not values to hardcode as permanent state.

Arbitrum `totalAssets()` was `50804061288` units and `totalSupply()` `50533036915` share units at block `507211485`. Base `totalAssets()` was `1207201` units at block `51572386`; `totalSupply()` was `1200157` share units at block `51572352`. **Shares are not USDC balances and assets are not cash guaranteed available for immediate withdrawal.**

[Sourcify confirms an exact creation/runtime match for the Arbitrum implementation](https://sourcify.dev/server/v2/contract/42161/0xEd3296117dAAa46FE4Cf94036bb42EE86100F8c7?fields=matchId,creationMatch,runtimeMatch,compilation,proxyResolution), compiler Solidity `0.8.33+commit.64118f21`. The queried Sourcify records for the two proxies and Base implementation returned 404; no Sourcify verification is claimed for those addresses. Their bytecode was checked directly against the deployment artifacts. Blockscout API requests returned 403 in this environment.

## Exact interface and transaction flow

### Reads

```solidity
// ERC-20 USDC, at the token address
function balanceOf(address owner) view returns (uint256);
function allowance(address owner, address spender) view returns (uint256);
function decimals() view returns (uint8);

// Vault, at the proxy address
function asset() view returns (address);
function decimals() view returns (uint8);
function balanceOf(address owner) view returns (uint256 shares);
function convertToAssets(uint256 shares) view returns (uint256 assets);
function previewDeposit(uint256 assets) view returns (uint256 shares);
function previewWithdraw(uint256 assets) view returns (uint256 shares);
function previewRedeem(uint256 shares) view returns (uint256 assets);
function totalAssets() view returns (uint256 assets);
function totalSupply() view returns (uint256 shares);
function getMinAssets() view returns (uint256);
function paused(uint8 action) view returns (bool);
function getManagementFee() view returns (uint96);
function getPerformanceFee() view returns (uint96);
function getProviders() view returns (address[]);
function getEntryProvider() view returns (address);
```

All amount entry must use decimal strings converted to integer units, e.g. `parseUnits(input, 6)`. Do not carry user transaction amounts through floating-point `Number` arithmetic. Display values may be formatted, but transaction values and comparisons remain bigint.

### Deposit

1. Explicitly select a supported vault/network. Verify the connected account and selected wallet chain immediately before every wallet request. Read native ETH for gas and native USDC balance on that network; this direct route does not bridge or swap funds.
2. Require a positive amount with at most six decimal places, sufficient USDC, `getMinAssets()` satisfied, and `paused(0) === false`. Read `previewDeposit(amount)` for estimated shares. A preview does not test allowance, liquidity, paused state, gas availability, or actual execution success.
3. If allowance is insufficient, submit token `approve(vaultProxy, exactAmount)` after a required simulation of that request. Wait for a successful approval receipt, then re-read allowance. A successful approval alone is not a deposit; show that distinction and a clear next action.
4. Simulate `deposit(amount, walletAddress)` from the connected account using the vault ABI. A pre-approval deposit simulation normally fails for insufficient allowance, so run the final deposit preflight after allowance is confirmed.
5. Ask the wallet to submit the exact simulated request. Wait for a successful transaction receipt before showing completion. On replacement/cancellation/timeout retain the transaction hash and accurate pending state; do not relabel an unknown result as success or failure.
6. Refresh USDC, shares, current position value and the account's transaction history. Use receipt events for actual assets/shares rather than treating the earlier preview as execution output.

```solidity
// To USDC
function approve(address spender, uint256 amount) returns (bool);
// To vault proxy
function deposit(uint256 assets, address receiver) returns (uint256 shares);
```

The vault transfers assets from `msg.sender`, routes them through its entry provider and mints shares to `receiver`. The normal self-service receiver is the connected wallet. The user does not approve an adapter, a treasury address, the implementation contract, or an application server.

### Withdraw an amount / withdraw all

```solidity
function withdraw(uint256 assets, address receiver, address owner)
    returns (uint256 shares);
function redeem(uint256 shares, address receiver, address owner)
    returns (uint256 assets);
```

- **Specified USDC amount:** use `previewWithdraw(assets)` (shares rounded up), require sufficient share balance, simulate `withdraw(assets, wallet, wallet)`, then submit and wait for receipt.
- **Withdraw all:** re-read the exact share balance, show `previewRedeem(shares)` (assets rounded down), simulate `redeem(shares, wallet, wallet)`, then submit and wait for receipt. This avoids converting a rounded displayed USDC balance back into shares and leaving dust or overspending shares.
- An owner withdrawing their own shares does not need a second USDC approval. Share allowance matters if caller differs from owner; the self-service interface should not expose third-party owner/receiver inputs by default.
- Check `paused(1)` independently. A deposit pause says nothing about withdrawal availability.
- The vault attempts withdrawal across its configured providers and reverts `InsufficientLiquidity()` if it cannot collect the requested assets. The request is atomic; reverted burns/transfers do not remain applied. Do not promise an instant or guaranteed exit based on `previewRedeem` alone.

### Important departure from generic ERC-4626 integrations

`maxDeposit(address)`, `maxMint(address)`, `maxWithdraw(address)` and `maxRedeem(address)` in this deployed implementation **always return zero**, intentionally described in source as conservative underestimation because limits depend on external providers. Zero was confirmed on-chain for maxDeposit/maxWithdraw.

Do not feed those zeros into a generic vault widget as the user's balance, use them to disable all actions, or interpret them as the protocol being paused. Use explicit pause flags, asset/share balances, the configured minimum, previews and required simulation. An estimated position value is distinct from verified executable liquidity. [ERC-4626 specification](https://eips.ethereum.org/EIPS/eip-4626).

The current methods have **no `minShares`, `minAssets`, deadline or slippage-protection argument**. A preview can move before inclusion. Do not display a slippage control as if this contract enforces it. This interface is a direct USDC vault integration, not a swap or bridge integration.

## Fees, rates and privileged controls

Fees are scaled by `1e18`: management fee is annualized on assets and elapsed time; performance fee is applied to positive growth since the last accounting snapshot. They are collected by minting treasury shares. Both were zero in the observed state. These getters must remain live; the source permits fee changes. Constants cap management fee at 5% and performance fee at 20%. Do not invent a `withdrawFeePercent()` read: that function is absent from this verified implementation, although the legacy app's WithdrawModal still attempts it.

Conversions/previews include estimated accrued fee shares; direct `shares * totalAssets / totalSupply` can miss that dilution. Use the contract preview/conversion rather than reproducing accounting in the UI.

`getEntryProvider()` is only the provider receiving the next deposit. It does not describe the entire invested portfolio. Both networks have five configured adapters: Compound V3, Aave V3, Steakhouse High Yield Morpho, Steakhouse Prime Morpho and Gauntlet Core Morpho. Assets can be spread across them. The observed entry provider was Compound on both chains; Base monitoring showed its invested balance in two Morpho vaults. Explain allocations using actual balances, not the entry-provider label.

`IProvider.getDepositRate(vault)` returns **APR in ray units (`1e27`)** according to the official interface. The current app's `useOnchainCurrentAPY.ts` weights those rates by invested balances and divides by `1e25` to form a percent, but calls the result APY without a compounding calculation. A new direct-read implementation should label this variable supply APR unless it explicitly implements and explains an APY calculation. A rate read missing for any invested provider must not silently become zero or produce a purported complete weighted rate.

The existing portal `lib/live-data.mjs` consumes the public monitor, normalizes invalid/error rates to null, and labels cached stale data. Preserve those distinctions. During this investigation one Arbitrum monitor read reported `apyData.source: "error"`, `apy: "0.0000"`, `error: "vaultPositions aborted"`; that is unavailable rate data, not a verified 0% rate. A separate Base read reported 4.3099 with allocations available. Do not use a failure as a financial metric or hardcode this sample rate into the product.

### Controls relevant to product language

- `ADMIN_ROLE` can grant/revoke roles, pause/unpause **deposits and withdrawals independently**, select an entry provider from the configured list, change treasury, fees and minimum deposit.
- `EXECUTOR_ROLE` can rebalance assets between approved providers. It cannot be described as an end-user action.
- Provider-list and timelock-address changes require the configured timelock. The observed timelock delay was `3600` seconds on both chains; it is not evidence that every privileged action is delayed.
- The vaults are upgradeable transparent proxies. Arbitrum proxy admin was `0xdaad7b2be3cbc4fffe954786e2cba26e5de8cde5`; Base proxy admin was `0xb9a8f0f2e578cc1001553a8ae0a168cae48a894e`. Both proxy-admin owners read as `0xafA9ed53c33bbD8DE300481ce150dB3D35738F9D`.
- Arbitrum timelock `0x694C38fb29fd14dECbBe11A15009aC7e728A686D` owner read as `0x3CDD947001afBa4C334D49125fd4bac3E4a3bfF1`; Base timelock `0xb2b1A0c173549A498859822f20Da68be1bEA593D` owner read as `0xafA9ed53c33bbD8DE300481ce150dB3D35738F9D`.

Consequently, statements such as “the guardian can only pause deposits,” “withdrawals always remain open,” “all administrative changes are timelocked,” or “the contract cannot be upgraded” are not supported for these deployments. Source/bytecode matching does not establish audit coverage or eliminate upgrade and downstream-market risks.

## MetaMask warning: historical evidence and current limits

The user's reported Arbitrum “known scammer” warning was investigated on 9 September. The full alert context and exact flagged object were never captured. No support submission or classification clearance is evidenced locally.

Historical files:

- `/home/pavel/thesauros-docs-workspace/work/security-review/metamask-20260909/REVIEW.md`
- `/home/pavel/thesauros-docs-workspace/work/security-review/metamask-20260909/REPORT-DRAFT.md`

That review identified the then-current legacy Arbitrum vault `0x57C10bd3fdB2849384dDe954f63d37DfAD9d7d70` and demonstrated missing remediation changes relative to the named October 2025 audit revision. The legacy address remains in `repos/contracts/deployments/arbitrumOne/USDCRebalancer.json` and archived production JavaScript. Archived Base configuration used `0x6C7013b3596623d146781c90b4Ee182331Af6148`.

The production app now points to the optimized proxies above. **Do not transfer a security conclusion about the old implementation to the new implementation, and do not claim the migration cleared MetaMask.** The current warning behavior has not been exercised with MetaMask Extension or Mobile, and the original classification might have involved a domain or downstream address.

If a warning occurs, preserve the unsigned alert details and direct the user to the wallet's official reporting flow. Never recommend disabling or ignoring wallet security warnings. Relevant primary resources: [MetaMask security alerts](https://support.metamask.io/configure/wallet/security-alerts), [Blockaid mistake report](https://report.blockaid.io/mistake).

## Implementation implications and bounded validation

- Use an explicit, source-pinned allowlist of chain, vault and asset triples. Monitor/market APIs are data sources, not authorities to select an arbitrary approval spender.
- Keep Sandbox simulated balances and transactions separate from real wallet assets and signatures. Switching mode must not reinterpret a sandbox number as spendable mainnet USDC.
- Live transaction execution is initiated by the user through their connected wallet. No application private keys, treasury keys or signing server are needed.
- Before each write, revalidate wallet account, chain, recipient, amount and pause state. Handle account changes, chain changes, user rejection and pending transactions without silently issuing the next transaction.
- Fail closed when current transaction-critical RPC reads or required simulation are unavailable. Read-only market pages can show timestamped cached data; a deposit must not borrow an old successful simulation.
- Source attribution, explorer links and fee/pause state are useful product details. They should be accessible without overwhelming the first screen with implementation jargon.
- Browser tests can assert the exact unsigned request, chain, spender, receiver, simulation ordering, rejection, receipts and refresh using a wallet mock. Such tests are not proof of a successful real deposit.

This review performed only `eth_chainId`, block/bytecode/storage reads, `eth_call` view calls, public HTTP retrieval and source inspection. It did not execute a funded deposit/redeem, assess exploitability, review all downstream contracts, certify the protocol, verify audit coverage for the optimized implementation, or confirm wallet security classification.

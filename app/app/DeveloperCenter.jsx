"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { documentationHref, marketingHref } from "../../lib/site-links.mjs";
import {
  PARTNER_API_CATALOG,
  PARTNER_API_GROUPS,
  PARTNER_API_REVIEWED,
  buildPartnerRequest,
  filterPartnerEndpoints,
} from "../../lib/partner-api-catalog.mjs";
import {
  PARTNER_TERMS,
  PLANNED_PERFORMANCE_FEE,
} from "../../lib/vault-facts.mjs";
import { crosschain } from "../../lib/crosschain-config.mjs";
import { Section, Segmented, short } from "./book/parts";
import b from "./book/book.module.css";

// The calls an integration makes on the vault, as a wallet sees them.
const VAULT_CALLS = `// USDC and the vault's shares both have 6 decimals. All on Base.
usdc.approve(vault, assets)                    // exactly the amount
vault.requestDeposit(assets, receiver)         // returns requestId
vault.requestRedeem(shares, receiver, owner)   // returns requestId
vault.getRequest(requestId)                    // state and amounts
vault.claim(requestId)                         // after the batch settles
vault.cancel(requestId)                        // while the request can still be cancelled
vault.limits()                                 // minDeposit, maxEpochDeposits, ...`;

const DeveloperTools = dynamic(() => import("./DeveloperTools"), {
  ssr: false,
  loading: () => (
    <p className={b.quiet} role="status">
      Opening API Sandbox…
    </p>
  ),
});
const sandboxViews = new Set([
  "quickstart",
  "reference",
  "keys",
  "webhooks",
  "usage",
  "reconciliation",
  "users",
  "lab",
]);
// Existing tools have a legacy build-time configuration. Never present an
// external or legacy-real target as the built-in sample API.
const builtInSandbox =
  (!process.env.NEXT_PUBLIC_API_BASE ||
    process.env.NEXT_PUBLIC_API_BASE === "/api/v1") &&
  process.env.NEXT_PUBLIC_DATA_SOURCE !== "real";
const areas = [
  { id: "start", label: "Integration path" },
  { id: "reference", label: "Partner API" },
  { id: "sandbox", label: "API Sandbox" },
];
const resources = [
  {
    title: "TypeScript SDK",
    label: "Typed client",
    description:
      "PartnerClient for your backend; a separate SandboxClient for rehearsal.",
    href: "/sdks/typescript/",
  },
  {
    title: "Python SDK",
    label: "Typed client",
    description:
      "Customer records, observations and reporting from your Python services.",
    href: "/sdks/python/",
  },
  {
    title: "Download the SDKs",
    label: "Review release",
    description:
      "Version 1.1.0 packages, installation instructions and checksums.",
    href: "/sdks/downloads/",
  },
];

function CopyRequest({ text }) {
  const [message, setMessage] = useState("");
  async function copy(event) {
    const button = event.currentTarget;
    let copied = false;
    if (window.isSecureContext && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        copied = true;
      } catch {}
    }
    if (!copied) {
      const field = document.createElement("textarea");
      field.value = text;
      field.readOnly = true;
      field.style.cssText = "position:fixed;left:-10000px;top:0;opacity:0";
      document.body.appendChild(field);
      try {
        field.focus();
        field.select();
        field.setSelectionRange(0, text.length);
        copied = document.execCommand("copy");
      } catch {
      } finally {
        field.remove();
        if (button.isConnected) button.focus({ preventScroll: true });
      }
    }
    setMessage(copied ? "Request copied" : "Select and copy the request below");
  }
  return (
    <div className={b.copyRow}>
      <button type="button" className={b.secondary} onClick={copy}>
        Copy request
      </button>
      <span role="status">{message}</span>
    </div>
  );
}

function Endpoint({ endpoint }) {
  const request = buildPartnerRequest(endpoint);
  const required = endpoint.inputs.filter((input) => input.required);
  return (
    <details className={b.endpoint}>
      <summary>
        <span className={b.httpMethod} data-method={endpoint.method}>
          {endpoint.method}
        </span>
        <span className={b.endpointIdentity}>
          <code>{endpoint.path}</code>
          <span>{endpoint.title}</span>
        </span>
        <span className={b.tag}>{endpoint.access}</span>
      </summary>
      <div className={b.endpointBody}>
        <p>{endpoint.description}</p>
        <dl className={b.terms}>
          <div>
            <dt>Authorization</dt>
            <dd className={b.small}>
              {endpoint.access === "Public" ? (
                "Public, no API key"
              ) : (
                <>
                  Bearer key with{" "}
                  {endpoint.scopes.map((scope, index) => (
                    <span key={scope}>
                      {index > 0 && " or "}
                      <code>{scope}</code>
                    </span>
                  ))}
                </>
              )}
            </dd>
          </div>
          {endpoint.requiresPartner && (
            <div>
              <dt>Account scope</dt>
              <dd className={b.small}>
                The API key must be bound to your partner account.
              </dd>
            </div>
          )}
          <div>
            <dt>Required inputs</dt>
            <dd className={b.small}>
              {required.length
                ? required
                    .map((input) => `${input.name} (${input.in})`)
                    .join(", ")
                : "No path, query or body inputs required."}
            </dd>
          </div>
        </dl>
        {endpoint.inputs.length > 0 && (
          <div className={b.subBlock}>
            <h3>Request inputs</h3>
            <ul className={b.inputList}>
              {endpoint.inputs.map((input) => (
                <li key={input.in + input.name}>
                  <code>{input.name}</code>
                  <span className={b.quiet}>
                    {input.in}, {input.type},{" "}
                    {input.required ? "required" : "optional"}
                  </span>
                  {input.description && <p>{input.description}</p>}
                  {input.values && <p>Values: {input.values.join(", ")}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className={b.subBlock}>
          <h3>Example request</h3>
          <p className={b.footnote}>
            {endpoint.method === "GET" ? "Reads records. " : "Changes API records. "}
            Set the API origin and credential supplied for your integration and
            replace example IDs with your own. This page does not run requests.
          </p>
          <CopyRequest text={request} />
          <pre
            className={b.codeBlock}
            tabIndex={0}
            aria-label={`Example ${endpoint.method} ${endpoint.path} request`}
          >
            <code>{request}</code>
          </pre>
          <a href={documentationHref(endpoint.docs)}>
            Full reference and response models
          </a>
        </div>
      </div>
    </details>
  );
}

const TOOLS = [
  {
    title: "Partner API",
    note: "v1",
    text: "Customer attribution, sample rate records, partner reporting and webhooks. It does not record the vault's requests and claims yet.",
    action: "reference",
  },
  {
    title: "API Sandbox",
    note: "sample data",
    text: "Try requests, sample customers and position activity. Nothing moves on chain. Its deposits and withdrawals are instant; the vault's are not.",
    action: "sandbox",
  },
];

export default function DeveloperCenter({ user, navigate }) {
  const [area, setArea] = useState("start");
  const [sandboxView, setSandboxView] = useState("quickstart");
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("All");
  const [access, setAccess] = useState("All");
  const [method, setMethod] = useState("All");
  const matches = useMemo(
    () => filterPartnerEndpoints({ query, group, access, method }),
    [query, group, access, method],
  );
  function browse(nextGroup = "All") {
    setQuery("");
    setGroup(nextGroup);
    setAccess("All");
    setMethod("All");
    setArea("reference");
  }
  function sandboxNavigate(route) {
    const next = route.replace(/^integrations\//, "");
    if (sandboxViews.has(next)) setSandboxView(next);
  }
  const contact = marketingHref("/contact?usecase=integrate");
  return (
    <div className={b.page}>
      <header className={b.pageHead}>
        <div>
          <h1 tabIndex={-1}>Developers</h1>
          <p className={b.pageLede}>
            Put the USDC Multichain vault in your own product. Your users
            request deposits on Base from their own wallets in your app;
            Thesauros runs the vault and shows the same figures you see here.
          </p>
        </div>
        <div className={b.headActions}>
          <a
            className={b.secondary}
            href={documentationHref("/start/integration-paths/")}
          >
            Integration guide
          </a>
          <a className={b.primary} href={contact}>
            Plan an integration
          </a>
        </div>
      </header>
      <dl className={b.facts}>
        <div>
          <dt>Fee on yield</dt>
          <dd>{PLANNED_PERFORMANCE_FEE}%</dd>
          <small>Planned. The contracts charge 0% today.</small>
        </div>
        <div>
          <dt>Your share of that fee</dt>
          <dd>Up to {PARTNER_TERMS.preToken}%</dd>
          <small>
            Until 60 days after the token launches. Then {PARTNER_TERMS.base}%,
            or up to {PARTNER_TERMS.bonded}% with bonded tokens.
          </small>
        </div>
        <div>
          <dt>Partner API</dt>
          <dd>{PARTNER_API_CATALOG.length}</dd>
          <small>documented operations</small>
        </div>
      </dl>
      <div className={b.tabsRow}>
        <Segmented
          label="Developer resources"
          value={area}
          onChange={setArea}
          options={areas.map((item) => ({ value: item.id, label: item.label }))}
        />
      </div>

      {area === "start" && (
        <>
          <Section
            title="How an integration works"
            lede="Choose the wallet model with your team, build the vault's request flow into your product, then connect your own records."
          >
            <ol className={b.steps}>
              <li>
                <h3>Design the transaction</h3>
                <p>
                  Your app handles consent, wallet signing and confirmations. A
                  deposit is an approval, a request and a claim after the batch
                  settles. A withdrawal is a request and a claim. Both are on
                  the vault contract on Base.
                </p>
                <button className={b.linkButton} onClick={() => navigate("earn")}>
                  See the deposit flow
                </button>
              </li>
              <li>
                <h3>Read the vault from the chain</h3>
                <p>
                  Requests, settlements and claims are on the vault contract.
                  The Partner API does not record the vault yet: its positions,
                  ledger and webhooks do not confirm vault activity.
                </p>
                <a className={b.linkButton} href={documentationHref("/build/vault/")}>
                  Integrate the vault on chain
                </a>
              </li>
              <li>
                <h3>Connect customer records</h3>
                <p>
                  Keep Partner API credentials on your backend. Link customer
                  identities and wallets to the partner account arranged with
                  Thesauros, and treat chain data and API accounting as
                  separate sources.
                </p>
                <button className={b.linkButton} onClick={() => browse("Customers")}>
                  Customer endpoints
                </button>
              </li>
            </ol>
          </Section>
          <Section
            id="vault-contract"
            title="The vault contract"
            lede="One contract on Base takes every deposit and withdrawal. Read limits and fees from it: they can change."
          >
            <dl className={b.terms}>
              <div>
                <dt>USDC Multichain vault</dt>
                <dd>
                  <a
                    href={crosschain.explorer + "/address/" + crosschain.vault}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {short(crosschain.vault)} ↗
                  </a>
                </dd>
                <small>Base, chain ID {crosschain.chainId}. Indexed from block {crosschain.startBlock}.</small>
              </div>
              <div>
                <dt>Asset</dt>
                <dd>
                  <a
                    href={crosschain.explorer + "/address/" + crosschain.asset}
                    target="_blank"
                    rel="noreferrer"
                  >
                    USDC {short(crosschain.asset)} ↗
                  </a>
                </dd>
                <small>Native USDC on Base, 6 decimals.</small>
              </div>
              <div>
                <dt>Valuations</dt>
                <dd>
                  <a
                    href={crosschain.explorer + "/address/" + crosschain.accountant}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {short(crosschain.accountant)} ↗
                  </a>
                </dd>
                <small>Each accepted valuation sets the share price a batch settles at.</small>
              </div>
            </dl>
            <pre className={b.codeBlock} tabIndex={0} aria-label="The vault's calls">
              <code>{VAULT_CALLS}</code>
            </pre>
            <p className={b.footnote}>
              These contracts have had no external audit yet. Strategy contracts
              on each network are internal and never receive user approvals.
            </p>
          </Section>
          <Section title="Tools and clients">
            <ul className={b.toolRows}>
              {TOOLS.map((tool) => (
                <li key={tool.title}>
                  <div>
                    <strong>{tool.title}</strong> <span className={b.tag}>{tool.note}</span>
                    <p>{tool.text}</p>
                  </div>
                  <button
                    className={b.secondary}
                    onClick={() =>
                      tool.action === "reference" ? browse() : setArea("sandbox")
                    }
                  >
                    Open
                  </button>
                </li>
              ))}
              {resources.map((resource) => (
                <li key={resource.href}>
                  <div>
                    <strong>{resource.title}</strong>{" "}
                    <span className={b.tag}>{resource.label}</span>
                    <p>{resource.description}</p>
                  </div>
                  <a className={b.secondary} href={documentationHref(resource.href)}>
                    Read
                  </a>
                </li>
              ))}
              <li>
                <div>
                  <strong>OpenAPI</strong> <span className={b.tag}>JSON</span>
                  <p>The Partner API schema, for code generation and review.</p>
                </div>
                <a
                  className={b.secondary}
                  href={documentationHref("/openapi/partner-openapi.json")}
                  target="_blank"
                  rel="noreferrer"
                >
                  Download
                </a>
              </li>
            </ul>
          </Section>
          <Section
            title="Connect your organization"
            lede="Work with Thesauros on your signing model, wallet flow on Base and Partner API access. A wallet connection does not issue an organization credential."
            aside={
              <a className={b.primary} href={contact}>
                Plan an integration
              </a>
            }
          />
        </>
      )}

      {area === "reference" && (
        <Section
          title="Partner API reference"
          lede="Find the request your product needs. Examples use your own API origin and server credentials. Partner endpoints read and manage attributed records; this API does not sign deposits or withdrawals for your customers, and it does not record the USDC Multichain vault yet."
          aside={
            <a
              className={b.secondary}
              href={documentationHref("/openapi/partner-openapi.json")}
              target="_blank"
              rel="noreferrer"
            >
              OpenAPI JSON
            </a>
          }
        >
          <div className={b.filterRow}>
            <label className={b.field}>
              <span>Search</span>
              <span className={b.amount}>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Customer, webhook, vault, scope"
                />
              </span>
            </label>
            {[
              ["Capability", group, setGroup, ["All", ...PARTNER_API_GROUPS]],
              ["Access", access, setAccess, ["All", "Partner", "Protocol", "Administrative", "Public"]],
              ["Method", method, setMethod, ["All", "GET", "POST", "PATCH", "DELETE"]],
            ].map(([label, value, set, options]) => (
              <label key={label} className={b.field}>
                <span>{label}</span>
                <select
                  className={b.select}
                  value={value}
                  onChange={(event) => set(event.target.value)}
                >
                  {options.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <p className={b.resultLine}>
            <span role="status">
              {matches.length} {matches.length === 1 ? "operation" : "operations"}
            </span>
            <button className={b.linkButton} onClick={() => browse()}>
              Reset filters
            </button>
          </p>
          {matches.length ? (
            PARTNER_API_GROUPS.filter((name) =>
              matches.some((item) => item.group === name),
            ).map((name) => (
              <div key={name} className={b.subBlock}>
                <h3>{name}</h3>
                {matches
                  .filter((item) => item.group === name)
                  .map((endpoint) => (
                    <Endpoint key={endpoint.id} endpoint={endpoint} />
                  ))}
              </div>
            ))
          ) : (
            <p className={b.quiet}>
              No matching endpoints. Try a capability such as “customers” or{" "}
              <button className={b.linkButton} onClick={() => browse()}>
                show all
              </button>
              .
            </p>
          )}
          <div className={b.conventions}>
            <h3>Response conventions</h3>
            <p>
              Single resources use <code>{"{ object, data }"}</code>.
              Collections use <code>{'{ object: "list", data, meta }'}</code>.
              Paginated endpoints accept <code>limit</code> and the previous
              response’s <code>meta.next_cursor</code> as <code>cursor</code>.
            </p>
            <p>
              This catalog was checked against the Partner API controllers and
              input validation on {PARTNER_API_REVIEWED}; the backend has
              changed since, so confirm scopes and limits with the OpenAPI
              file. It omits legacy reward methods and deprecated aliases.
            </p>
            <a href={documentationHref("/api/partner-models/")}>
              Read the response models
            </a>
          </div>
        </Section>
      )}

      {area === "sandbox" && (
        <Section
          title="API Sandbox"
          lede="Tools for testing request shapes and sample account operations, on a shared environment with sample data. Creating a sample position does not send a blockchain transaction, and it is instant: the live vault's deposits and withdrawals are requests that settle in batches."
          aside={
            <a
              className={b.secondary}
              href={documentationHref("/openapi/sandbox-openapi.json")}
              target="_blank"
              rel="noreferrer"
            >
              Sandbox OpenAPI
            </a>
          }
        >
          {builtInSandbox ? (
            <div className={b.sandboxFrame}>
              <DeveloperTools
                view={sandboxView}
                userId={user?.id || user?.walletAddress || "workspace"}
                navigate={sandboxNavigate}
              />
            </div>
          ) : (
            <p className={b.quiet}>
              The built-in API Sandbox is not configured for this deployment.
              The Partner API reference and SDK downloads remain available.{" "}
              <a href={documentationHref("/api/sandbox/")}>
                Read the Sandbox documentation
              </a>
            </p>
          )}
        </Section>
      )}
    </div>
  );
}

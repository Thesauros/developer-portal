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
import s from "./developer-center.module.css";

const DeveloperTools = dynamic(() => import("./DeveloperTools"), {
  ssr: false,
  loading: () => (
    <div className={s.loading} role="status">
      Opening API Sandbox…
    </div>
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
    <div className={s.copyRow}>
      <button type="button" className={s.smallButton} onClick={copy}>
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
    <details className={s.endpoint}>
      <summary>
        <span className={`${s.method} ${s[endpoint.method.toLowerCase()]}`}>
          {endpoint.method}
        </span>
        <span className={s.endpointIdentity}>
          <code>{endpoint.path}</code>
          <span>{endpoint.title}</span>
        </span>
        <span className={s.access}>{endpoint.access}</span>
        <span className={s.expand} aria-hidden="true">
          +
        </span>
      </summary>
      <div className={s.endpointBody}>
        <p className={s.description}>{endpoint.description}</p>
        <dl className={s.authDetails}>
          <div>
            <dt>Authorization</dt>
            <dd>
              {endpoint.access === "Public" ? (
                "Public · no API key"
              ) : (
                <>
                  Bearer key ·{" "}
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
              <dd>The API key must be bound to your partner account.</dd>
            </div>
          )}
          <div>
            <dt>Required inputs</dt>
            <dd>
              {required.length
                ? required
                    .map((input) => `${input.name} (${input.in})`)
                    .join(", ")
                : "No path, query or body inputs required."}
            </dd>
          </div>
        </dl>
        {endpoint.inputs.length > 0 && (
          <div className={s.inputs}>
            <h4>Request inputs</h4>
            <ul>
              {endpoint.inputs.map((input) => (
                <li key={input.in + input.name}>
                  <div>
                    <code>{input.name}</code>
                    <span>
                      {input.in} · {input.type} ·{" "}
                      {input.required ? "required" : "optional"}
                    </span>
                  </div>
                  {input.description && <p>{input.description}</p>}
                  {input.values && <p>Values: {input.values.join(", ")}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className={s.requestHeading}>
          <h4>Example request</h4>
          <span>
            {endpoint.method === "GET" ? "Read" : "Changes API records"}
          </span>
        </div>
        <p className={s.requestNote}>
          Set the API origin and credential supplied for your integration.
          Replace example IDs with your own. This page does not execute
          requests.
        </p>
        <CopyRequest text={request} />
        <pre
          className={s.code}
          tabIndex={0}
          aria-label={`Example ${endpoint.method} ${endpoint.path} request`}
        >
          <code>{request}</code>
        </pre>
        <a className={s.textLink} href={documentationHref(endpoint.docs)}>
          Full reference and response models
        </a>
      </div>
    </details>
  );
}

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
  return (
    <div className={s.center}>
      <header className={s.intro}>
        <div>
          <span className={s.eyebrow}>Developer resources</span>
          <h2>Integrate Thesauros.</h2>
          <p>API reference, SDKs and a sandbox for your integration.</p>
        </div>
        <a
          className={s.secondary}
          href={documentationHref("/start/integration-paths/")}
        >
          Integration guide
        </a>
      </header>
      <nav className={s.tabs} aria-label="Developer resources">
        {areas.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={area === item.id ? "page" : undefined}
            onClick={() => setArea(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {area === "start" && (
        <div className={s.stack}>
          <section className={s.path} aria-labelledby="developer-path-title">
            <div className={s.sectionHeading}>
              <h3 id="developer-path-title">Integration steps.</h3>
              <p>
                Choose the wallet model with your team, then connect the records
                that make Earn work inside your product.
              </p>
            </div>
            <ol className={s.steps}>
              <li>
                <span className={s.stepNumber}>01</span>
                <h4>Design the transaction</h4>
                <p>
                  Your app handles consent, wallet signing and confirmations.
                  Approval, deposit and withdrawal use the supported vault
                  contracts.
                </p>
                <button
                  type="button"
                  className={s.textButton}
                  onClick={() => navigate("earn")}
                >
                  Inspect the Earn flow
                </button>
              </li>
              <li>
                <span className={s.stepNumber}>02</span>
                <h4>Connect customer records</h4>
                <p>
                  Keep Partner API credentials on your backend. Link customer
                  identities and wallets to the partner account arranged with
                  Thesauros.
                </p>
                <button
                  type="button"
                  className={s.textButton}
                  onClick={() => browse("Customers")}
                >
                  Explore customer endpoints
                </button>
              </li>
              <li>
                <span className={s.stepNumber}>03</span>
                <h4>Operate the experience</h4>
                <p>
                  Bring recorded positions, delivery events and reconciliation
                  into your services. Treat observed chain data and API
                  accounting as separate sources.
                </p>
                <button
                  type="button"
                  className={s.textButton}
                  onClick={() => browse("Reconciliation")}
                >
                  Explore reconciliation
                </button>
              </li>
            </ol>
          </section>
          <div className={s.surfaceGrid}>
            <section className={s.surface}>
              <span className={s.eyebrow}>Partner API · v1</span>
              <h3>Customer data and reporting.</h3>
              <p>
                Customer attribution, vault observations, partner reporting and
                webhooks. Browse {PARTNER_API_CATALOG.length} documented
                operations without a credential.
              </p>
              <div className={s.actions}>
                <button
                  type="button"
                  className={s.primary}
                  onClick={() => browse()}
                >
                  Explore Partner API
                </button>
                <a
                  className={s.textLink}
                  href={documentationHref("/openapi/partner-openapi.json")}
                  target="_blank"
                  rel="noreferrer"
                >
                  OpenAPI JSON
                </a>
              </div>
            </section>
            <section className={s.surface}>
              <span className={s.eyebrow}>API Sandbox · sample data</span>
              <h3>Test your integration.</h3>
              <p>
                Try requests, inspect sample customers and model position
                activity in the built-in API. Sample positions do not move
                onchain funds.
              </p>
              <div className={s.actions}>
                <button
                  type="button"
                  className={s.secondary}
                  onClick={() => setArea("sandbox")}
                >
                  Open API Sandbox
                </button>
              </div>
            </section>
          </div>
          <section aria-labelledby="developer-sdk-title">
            <div className={s.sectionHeading}>
              <h3 id="developer-sdk-title">
                Use the client that fits your stack.
              </h3>
              <p>
                The Partner and Sandbox clients have separate contracts.
                Packages are available as review downloads.
              </p>
            </div>
            <div className={s.resourceGrid}>
              {resources.map((resource) => (
                <a
                  key={resource.href}
                  className={s.resource}
                  href={documentationHref(resource.href)}
                >
                  <span>{resource.label}</span>
                  <h4>{resource.title}</h4>
                  <p>{resource.description}</p>
                </a>
              ))}
            </div>
          </section>
          <section className={s.accessPanel}>
            <div>
              <h3>Ready to connect your organization?</h3>
              <p>
                Work with Thesauros on your signing model, supported networks
                and Partner API access. A wallet connection does not issue an
                organization credential.
              </p>
            </div>
            <a
              className={s.primary}
              href={marketingHref("/contact?usecase=integration")}
            >
              Plan an integration
            </a>
          </section>
        </div>
      )}

      {area === "reference" && (
        <section className={s.stack} aria-labelledby="partner-reference-title">
          <div className={s.sectionHeading}>
            <div>
              <span className={s.eyebrow}>Partner API · v1</span>
              <h3 id="partner-reference-title">
                Find the request your product needs.
              </h3>
              <p>
                Reference examples use your own API origin and server
                credentials. Browse by capability or the access your key
                requires.
              </p>
            </div>
            <a
              className={s.secondary}
              href={documentationHref("/openapi/partner-openapi.json")}
              target="_blank"
              rel="noreferrer"
            >
              OpenAPI JSON
            </a>
          </div>
          <div className={s.catalogNote}>
            <strong>Access is arranged with Thesauros.</strong>
            <span>
              Partner endpoints read and manage attributed records. This API
              does not sign deposits or withdrawals for your customers.
            </span>
          </div>
          <div className={s.filters}>
            <label className={s.search}>
              <span>Search endpoints</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Customer, webhook, vault, scope…"
              />
            </label>
            <label>
              <span>Capability</span>
              <select
                value={group}
                onChange={(event) => setGroup(event.target.value)}
              >
                <option>All</option>
                {PARTNER_API_GROUPS.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Access</span>
              <select
                value={access}
                onChange={(event) => setAccess(event.target.value)}
              >
                {["All", "Partner", "Protocol", "Administrative", "Public"].map(
                  (item) => (
                    <option key={item}>{item}</option>
                  ),
                )}
              </select>
            </label>
            <label>
              <span>Method</span>
              <select
                value={method}
                onChange={(event) => setMethod(event.target.value)}
              >
                {["All", "GET", "POST", "PATCH", "DELETE"].map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
          </div>
          <div className={s.results}>
            <span role="status">
              {matches.length}{" "}
              {matches.length === 1 ? "operation" : "operations"}
            </span>
            <button
              type="button"
              className={s.textButton}
              onClick={() => browse()}
            >
              Reset filters
            </button>
          </div>
          {matches.length ? (
            <div className={s.catalog}>
              {PARTNER_API_GROUPS.filter((name) =>
                matches.some((item) => item.group === name),
              ).map((name) => (
                <section key={name} className={s.endpointGroup}>
                  <h4>{name}</h4>
                  {matches
                    .filter((item) => item.group === name)
                    .map((endpoint) => (
                      <Endpoint key={endpoint.id} endpoint={endpoint} />
                    ))}
                </section>
              ))}
            </div>
          ) : (
            <div className={s.empty}>
              <h4>No matching endpoints.</h4>
              <p>
                Try a capability such as “customers” or clear the filters to see
                the full catalog.
              </p>
              <button
                type="button"
                className={s.secondary}
                onClick={() => browse()}
              >
                Show all endpoints
              </button>
            </div>
          )}
          <details className={s.contractNote}>
            <summary>Response conventions and reference coverage</summary>
            <p>
              Single resources use <code>{"{ object, data }"}</code>.
              Collections use <code>{'{ object: "list", data, meta }'}</code>.
              Paginated endpoints accept <code>limit</code> and the previous
              response’s <code>meta.next_cursor</code> as <code>cursor</code>.
            </p>
            <p>
              This integration catalog was checked against the Partner API
              controllers and input validation on {PARTNER_API_REVIEWED}. It
              omits legacy reward methods and deprecated aliases. The
              downloadable schema is the existing official export; effective
              partner binding and required inputs shown here also reflect
              handler checks.
            </p>
            <a
              className={s.textLink}
              href={documentationHref("/api/partner-models/")}
            >
              Read the response models
            </a>
          </details>
        </section>
      )}

      {area === "sandbox" && (
        <section className={s.stack} aria-labelledby="api-sandbox-title">
          <div className={s.sectionHeading}>
            <div>
              <span className={s.eyebrow}>Shared sample environment</span>
              <h3 id="api-sandbox-title">API Sandbox</h3>
              <p>
                Seven tools for testing request shapes and sample account
                operations. Use sample customer data here; the environment is
                shared.
              </p>
            </div>
            <a
              className={s.secondary}
              href={documentationHref("/openapi/sandbox-openapi.json")}
              target="_blank"
              rel="noreferrer"
            >
              Sandbox OpenAPI
            </a>
          </div>
          <div className={s.catalogNote}>
            <strong>Sample records, separate from your Earn wallet.</strong>
            <span>
              Creating a sample position does not submit a blockchain
              transaction. Requests and changes run only when you use the
              corresponding tool.
            </span>
          </div>
          {builtInSandbox ? (
            <div className={s.sandbox}>
              <DeveloperTools
                view={sandboxView}
                userId={user?.id || user?.walletAddress || "workspace"}
                navigate={sandboxNavigate}
              />
            </div>
          ) : (
            <div className={s.empty}>
              <h4>
                The built-in API Sandbox is not configured for this deployment.
              </h4>
              <p>
                The Partner API reference and SDK downloads remain available.
                Your team can arrange the appropriate API environment with
                Thesauros.
              </p>
              <a
                className={s.secondary}
                href={documentationHref("/api/sandbox/")}
              >
                Read Sandbox documentation
              </a>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

"use client";

import { documentationHref, marketingHref } from "../../lib/site-links.mjs";
import p from "./product.module.css";

const workflow = [
  {
    title: "Start in your product",
    body: "An Earn pocket beside a balance, a wallet destination, or an account feature. Your customer sees your brand and chooses an amount.",
  },
  {
    title: "Connect to the vault",
    body: "Your wallet flow handles approval and signing. The supported vault receives the deposit and issues shares to the chosen account.",
  },
  {
    title: "Make the position useful",
    body: "Show its current value, allocation and transaction status. Keep withdrawal in the same experience, with funds returned to the customer’s wallet.",
  },
];

const resources = [
  {
    label: "API reference",
    title: "Connect your operating view",
    body: "Explore customer attribution, vault observations, reporting and events. Partner access is arranged with the team.",
    action: "Explore Partner API",
    path: "/api/partner/",
  },
  {
    label: "TypeScript & Python",
    title: "Start with an SDK",
    body: "Download the packages and follow examples for the Partner API or the separate simulated Sandbox.",
    action: "Get the SDKs",
    path: "/sdks/downloads/",
  },
  {
    label: "Architecture & controls",
    title: "Review the capital flow",
    body: "Understand the vault, lending providers and controls before choosing how Earn fits your product.",
    action: "Read the architecture",
    path: "/concepts/architecture/",
  },
];

export default function IntegrationHome({ navigate }) {
  return (
    <div className={`${p.product} ${p.pageStack}`}>
      <section className={p.buildHero} aria-labelledby="build-intro-title">
        <span className={p.eyebrow}>For financial products</span>
        <h2 id="build-intro-title" className={p.heroTitle}>
          Your customer experience.
          <br />
          Connected to Earn.
        </h2>
        <p className={p.lead}>
          Add a USDC Earn experience to your app. Keep the interface and
          customer relationship, with Thesauros vaults and integration tools
          underneath.
        </p>
        <div className={p.actionRow}>
          <a
            className={p.primaryButton}
            href={marketingHref("/contact?usecase=launch")}
          >
            Talk to Thesauros
          </a>
          <a
            className={p.secondaryButton}
            href={documentationHref("/start/integration-paths/")}
          >
            Design your integration
          </a>
        </div>
      </section>

      <section aria-labelledby="build-workflow-title">
        <div className={p.sectionHeading}>
          <h2 id="build-workflow-title">From customer balance to Earn</h2>
          <p>A complete product journey, with a clear owner at every step.</p>
        </div>
        <ol className={p.buildFlow}>
          {workflow.map((step, index) => (
            <li key={step.title} className={p.flowStep}>
              <span className={p.stepNumber} aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <div className={p.twoColumn}>
        <section className={p.panel} aria-labelledby="your-product-title">
          <span className={p.eyebrow}>Your product</span>
          <h2 id="your-product-title" className={p.panelTitle}>
            The experience stays with you
          </h2>
          <ul className={p.responsibilityList}>
            <li>
              <strong>Interface and customer relationship</strong>
              <span>Entry points, consent, account language and support.</span>
            </li>
            <li>
              <strong>Wallet and transaction flow</strong>
              <span>
                Your signing model, network selection and confirmation
                experience.
              </span>
            </li>
            <li>
              <strong>Account operations</strong>
              <span>
                Map customer identities and reconcile the records your product
                relies on.
              </span>
            </li>
          </ul>
        </section>
        <section className={p.panel} aria-labelledby="thesauros-layer-title">
          <span className={p.eyebrow}>Thesauros</span>
          <h2 id="thesauros-layer-title" className={p.panelTitle}>
            The infrastructure behind Earn
          </h2>
          <ul className={p.responsibilityList}>
            <li>
              <strong>Vaults and lending providers</strong>
              <span>
                Deposit and redemption contracts, vault shares and configured
                allocations.
              </span>
            </li>
            <li>
              <strong>Data and integration tools</strong>
              <span>
                Vault observations, Partner API documentation, SDKs and
                reporting resources.
              </span>
            </li>
            <li>
              <strong>An integration path</strong>
              <span>
                Work with the team on supported assets, networks and the
                operating model for your launch.
              </span>
            </li>
          </ul>
        </section>
      </div>

      <section aria-labelledby="build-resources-title">
        <div className={p.sectionHeading}>
          <h2 id="build-resources-title">Give your team a starting point</h2>
          <p>
            API records support the product; movement of funds still requires
            the appropriate wallet and contract transactions.
          </p>
        </div>
        <div className={p.resourceGrid}>
          {resources.map((resource) => (
            <a
              className={p.resourceCard}
              key={resource.path}
              href={documentationHref(resource.path)}
            >
              <span className={p.resourceLabel}>{resource.label}</span>
              <h3>{resource.title}</h3>
              <p>{resource.body}</p>
              <span>{resource.action}</span>
            </a>
          ))}
        </div>
      </section>

      <section className={p.panel} aria-labelledby="build-demo-title">
        <h2 id="build-demo-title" className={p.panelTitle}>
          Walk through the customer experience
        </h2>
        <p className={p.sectionCopy}>
          Explore the real Earn account, or rehearse a deposit and withdrawal
          with simulated funds. The team can help plan the integration for your
          product.
        </p>
        <div className={p.actionRow}>
          <button
            className={p.primaryButton}
            onClick={() => navigate("overview")}
          >
            Open Earn
          </button>
          <button
            className={p.secondaryButton}
            onClick={() => navigate("test")}
          >
            Try Sandbox
          </button>
        </div>
      </section>
    </div>
  );
}

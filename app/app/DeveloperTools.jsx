"use client";
import { documentationHref } from "../../lib/site-links.mjs";
import { useEffect, useState } from "react";
import Quickstart from "../views/Quickstart";
import ApiReference from "../views/ApiReference";
import ApiKeys from "../views/ApiKeys";
import Webhooks from "../views/Webhooks";
import Usage from "../views/Usage";
import Reconciliation from "../views/Reconciliation";
import Users from "../views/Users";
import { DEFAULT_KEY } from "../lib/api";
import platform from "../platform.module.css";
import s from "./workspace.module.css";
const views = {
  quickstart: Quickstart,
  reference: ApiReference,
  keys: ApiKeys,
  webhooks: Webhooks,
  usage: Usage,
  reconciliation: Reconciliation,
  users: Users,
};
const labels = {
  quickstart: "Quickstart",
  reference: "API explorer",
  keys: "API keys",
  webhooks: "Webhooks",
  usage: "Usage",
  reconciliation: "Reconciliation",
  users: "Test customers",
};
export default function DeveloperTools({
  view = "quickstart",
  navigate,
  userId,
}) {
  const [apiKey, setKey] = useState(DEFAULT_KEY);
  const storage = "thesauros.integration." + userId;
  useEffect(() => {
    try {
      setKey(sessionStorage.getItem(storage) || DEFAULT_KEY);
    } catch {}
  }, [storage]);
  function setApiKey(key) {
    setKey(key);
    try {
      sessionStorage.setItem(storage, key);
    } catch {}
  }
  const View = views[view] || Quickstart;
  const go = (id) =>
    navigate("integrations/" + (views[id] ? id : "quickstart"));
  return (
    <section>
      <div className={s.integrationIntro}>
        <div>
          <span className={s.eyebrow}>Your integration</span>
          <h2>
            From your first request
            <br /> to your customer's first deposit.
          </h2>
          <p>
            Build and inspect the flow in the API sandbox. Keep your
            implementation tools beside your market and vault data.
          </p>
        </div>
        <div>
          <a href={documentationHref("/sdks/downloads/")}>Download SDKs</a>
          <a href={documentationHref("/start/integration-paths/")}>
            Integration guide
          </a>
        </div>
      </div>
      <div
        className={s.toolTabs}
        role="navigation"
        aria-label="Developer tools"
      >
        {Object.keys(views).map((key) => (
          <button
            key={key}
            aria-current={view === key ? "page" : undefined}
            onClick={() => go(key)}
          >
            {labels[key]}
          </button>
        ))}
      </div>
      <div className={s.sandboxNote}>
        <span className={s.pill}>API sandbox</span>
        <span>
          Shared sample API data. Credentials and operations here are for
          integration testing.
        </span>
      </div>
      <div className={platform.shell + " " + s.embedded}>
        <View key={view} apiKey={apiKey} setApiKey={setApiKey} go={go} />
      </div>
    </section>
  );
}

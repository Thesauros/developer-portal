import { documentationHref, marketingHref } from "../../lib/site-links.mjs";
import AccessShell from "./AccessShell";
import s from "./login.module.css";
export default function ComingSoon() {
  return (
    <AccessShell institution>
      <span className={s.availability}>
        <span />
        Institution workspace
      </span>
      <h1>Coming soon.</h1>
      <p className={s.intro}>
        A dedicated workspace for your treasury, customer Earn and reporting.
        We’re preparing it for our first partners.
      </p>
      <div className={s.previewFeatures}>
        <div>
          <span>01</span>
          <p>Treasury &amp; allocation</p>
        </div>
        <div>
          <span>02</span>
          <p>Customer-level reporting</p>
        </div>
        <div>
          <span>03</span>
          <p>Integration &amp; developer tools</p>
        </div>
      </div>
      <a
        className={s.primaryLink}
        href={marketingHref("/contact?usecase=launch")}
      >
        Discuss early access
      </a>
      <a className={s.quietLink} href={documentationHref("/")}>
        Explore the documentation
      </a>
    </AccessShell>
  );
}

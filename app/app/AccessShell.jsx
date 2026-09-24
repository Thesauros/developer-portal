import { documentationHref, marketingHref } from "../../lib/site-links.mjs";
import s from "./login.module.css";
export default function AccessShell({ institution = false, children }) {
  return (
    <main className={s.page}>
      <section className={s.visual} aria-label="Thesauros">
        <img
          className={s.photo}
          src={
            "/brand/" +
            (institution ? "login-gallery.webp" : "login-reflections.webp")
          }
          alt=""
          fetchPriority="high"
        />
        <div className={s.shade} />
        <a className={s.brand} href={marketingHref("/")}>
          <img src={"/brand/mark.svg"} width="27" height="27" alt="" />
          Thesauros
        </a>
        <div className={s.visualCopy}>
          <h2>
            {institution
              ? "Thesauros for institutions"
              : "Your USDC. Put to work."}
          </h2>
          <p>
            {institution
              ? "Your treasury in Earn, the vaults behind it and the path to integration."
              : "A clear view of your Earn balance, the vault behind it, and your next move."}
          </p>
        </div>
      </section>
      <section className={s.access}>
        <div className={s.topLinks}>
          <a href={documentationHref("/")}>Documentation</a>
          <a href={marketingHref("/contact")}>Contact</a>
        </div>
        <div className={s.formWrap}>
          <a className={s.mobileBrand} href={marketingHref("/")}>
            <img src={"/brand/mark.svg"} width="25" height="25" alt="" />
            Thesauros
          </a>
          <nav className={s.modes} aria-label="Account type">
            <a
              href="/app/individual"
              aria-current={!institution ? "page" : undefined}
            >
              Individual
            </a>
            <a
              href="/app/institution"
              aria-current={institution ? "page" : undefined}
            >
              Institution
            </a>
          </nav>
          {children}
        </div>
        <div className={s.accessFoot}>
          <a href={marketingHref("/")}>Back to Thesauros</a>
        </div>
      </section>
    </main>
  );
}

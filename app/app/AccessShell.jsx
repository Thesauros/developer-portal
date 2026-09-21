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
          <span>Capital, with clarity.</span>
          <h2>
            {institution ? (
              <>
                A wider view.
                <br /> A stronger connection.
              </>
            ) : (
              <>
                Your next move.
                <br /> With a clearer view.
              </>
            )}
          </h2>
          <p>
            {institution
              ? "Your treasury, customers and infrastructure. One considered workspace."
              : "See where capital goes. Understand what it earns. Stay in control of your next move."}
          </p>
          <div className={s.visualFoot}>
            <span>
              Thesauros / {institution ? "Institution" : "Individual"}
            </span>
            <span>Capital, connected.</span>
          </div>
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
          <span>Your capital. Your choice.</span>
        </div>
      </section>
    </main>
  );
}

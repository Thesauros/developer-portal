"use client";

import s from "./migration.module.css";

function units(value) {
  if (value == null || !/^\d+$/.test(String(value))) return "—";
  const integer = BigInt(value);
  return `${integer / 1_000_000n}.${String(integer % 1_000_000n).padStart(6, "0")}`;
}

const short = (value) =>
  value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "—";

const stageDetails = {
  check: {
    title: "Проверяем старую позицию",
    body: "Читаем доли и состояние контракта. До завершения проверки баланс неизвестен.",
    action: "Повторить проверку",
    step: 0,
  },
  withdraw: {
    title: "Вывести средства из старого продукта",
    body: "Подтвердите отдельную транзакцию вывода в кошельке. Полученная сумма будет определена по подтверждённой транзакции.",
    action: "Вывести средства",
    step: 0,
  },
  withdraw_pending: {
    title: "Ожидаем подтверждение вывода",
    body: "Проверяем транзакцию и фактическое получение USDC. Повторный вывод не требуется, пока результат этой операции неизвестен.",
    step: 0,
  },
  base: {
    title: "Подготовить USDC в сети Base",
    body: "Если вывод выполнен в Arbitrum, самостоятельно переведите native USDC на свой кошелёк в Base. Затем обновите проверку поступления средств.",
    action: "Проверить поступление в Base",
    step: 1,
  },
  approve: {
    title: "Разрешить использование USDC в Base",
    body: "Approve разрешает новому контракту использовать выбранную сумму USDC. Для депозита потребуется отдельное подтверждение.",
    action: "Подтвердить approve в Base",
    step: 2,
  },
  deposit: {
    title: "Внести средства в новый контракт",
    body: "Подтвердите заявку на депозит USDC в Base. Доли станут доступны после расчёта эпохи и отдельного получения.",
    action: "Подтвердить депозит в Base",
    step: 3,
  },
  deposit_pending: {
    title: "Ожидаем подтверждение депозита",
    body: "Проверяем отправленную заявку. После перезагрузки продолжайте с этой транзакции; повторять депозит не нужно.",
    step: 3,
  },
  settlement: {
    title: "Ожидаем расчёт эпохи",
    body: "USDC находятся в заявке нового контракта. После расчёта эпохи здесь появится возможность получить доли.",
    step: 4,
  },
  claim: {
    title: "Получить доли нового продукта",
    body: "Депозит рассчитан. Подтвердите отдельную транзакцию получения долей в Base.",
    action: "Получить доли в Base",
    step: 4,
  },
  complete: {
    title: "Миграция завершена",
    body: "Завершение подтверждено состоянием блокчейна. Новая позиция доступна в кроссчейн-продукте.",
    step: 5,
  },
  error: {
    title: "Нужно проверить текущий шаг",
    body: "Обновите состояние блокчейна перед продолжением. Ошибка проверки не означает отсутствие средств.",
    action: "Продолжить миграцию",
    step: null,
  },
  recover: {
    title: "Восстановить продолжение миграции",
    body: "Укажите транзакцию миграции для этого кошелька. Её результат будет проверен в блокчейне.",
    step: null,
  },
};

function TransactionLinks({ transactions }) {
  if (!transactions?.length) return null;
  return (
    <ul className={s.transactions} aria-label="Транзакции миграции">
      {transactions.map((transaction, index) => (
        <li key={`${transaction.hash}-${index}`}>
          <span>{transaction.label}</span>
          <a
            href={`${transaction.explorer}/tx/${transaction.hash}`}
            target="_blank"
            rel="noreferrer"
            aria-label={`${transaction.label}: ${transaction.hash}, открыть обозреватель`}
          >
            {short(transaction.hash)} ↗
          </a>
        </li>
      ))}
    </ul>
  );
}

function MigrationProduct({ product, model }) {
  const details = stageDetails[product.stage] || stageDetails.check;
  const ready = product.positionStatus === "ready";
  const oldClosed =
    ready &&
    /^\d+$/.test(String(product.shares)) &&
    BigInt(product.shares) === 0n;
  const withdrawNetwork = product.name || `Chain ${product.chainId}`;
  const needsOldNetwork = ["withdraw", "withdraw_pending"].includes(
    product.stage,
  );
  const network = needsOldNetwork ? withdrawNetwork : "Base · chainId 8453";
  const pending = ["withdraw_pending", "deposit_pending"].includes(
    product.stage,
  );
  const editableAmount = ["approve", "deposit", "base"].includes(product.stage);
  const steps = [
    `Вывод · ${withdrawNetwork}`,
    "Средства в Base",
    "Approve · Base",
    "Депозит · Base",
    "Расчёт и получение долей",
  ];
  const headingId = `migration-${product.id}`;
  const amountId = `${headingId}-amount`;
  const recoveryId = `${headingId}-recovery`;
  const error = product.error || product.positionError;
  const refreshAction = ["base", "check"].includes(product.stage);
  const selectedAmount = product.selected || product.amount;
  const knownAmounts = [product.amount, product.cash].every(
    (value) => value != null && /^\d+$/.test(String(value)),
  );
  const maximum = knownAmounts
    ? BigInt(product.amount) < BigInt(product.cash)
      ? product.amount
      : product.cash
    : null;

  if (product.stage === "complete")
    return (
      <article className={s.product} aria-labelledby={headingId}>
        <div className={s.productHeader}>
          <h3 id={headingId}>Миграция из {withdrawNetwork} завершена</h3>
          <span className={s.network}>Base · 8453</span>
        </div>
        <p className={s.meta} role="status">
          Новая позиция подтверждена в блокчейне и доступна в
          кроссчейн-продукте.
        </p>
        <TransactionLinks transactions={product.txs} />
      </article>
    );

  return (
    <article className={s.product} aria-labelledby={headingId}>
      <div className={s.productHeader}>
        <div>
          {!oldClosed && <span className={s.eyebrow}>Старый продукт</span>}
          <h3 id={headingId}>
            {oldClosed
              ? `Продолжить миграцию из ${withdrawNetwork}`
              : `USDC · ${withdrawNetwork}`}
          </h3>
        </div>
        <span className={s.network}>
          {oldClosed ? "Base · 8453" : product.chainId}
        </span>
      </div>

      <dl className={s.balances}>
        {!oldClosed && (
          <div>
            <dt>Осталось в старом продукте</dt>
            <dd>
              {ready ? units(product.assets) : "—"} <small>USDC</small>
            </dd>
          </div>
        )}
        {!oldClosed && (
          <div>
            <dt>Доли старого продукта</dt>
            <dd>{ready ? units(product.shares) : "—"}</dd>
          </div>
        )}
        {product.amount != null && (
          <div>
            <dt>Осталось внести после вывода</dt>
            <dd>
              {units(product.amount)} <small>USDC</small>
            </dd>
          </div>
        )}
      </dl>

      {!ready && (
        <p className={s.notice} role="status">
          {product.positionStatus === "error"
            ? "Состояние старой позиции неизвестно: не удалось прочитать контракт."
            : "Проверяем старую позицию в блокчейне…"}
        </p>
      )}

      <ol className={s.steps} aria-label="Шаги миграции">
        {steps.map((step, index) => (
          <li
            key={step}
            className={
              details.step === index
                ? s.current
                : details.step > index
                  ? s.done
                  : ""
            }
            aria-current={details.step === index ? "step" : undefined}
          >
            <span aria-hidden="true">
              {details.step > index ? "✓" : index + 1}
            </span>
            {step}
          </li>
        ))}
      </ol>

      <div className={s.currentStep}>
        <div className={s.stepHeading}>
          <h4>{details.title}</h4>
          {!["check", "error", "recover", "complete"].includes(
            product.stage,
          ) && <span className={s.network}>{network}</span>}
        </div>
        <p role="status">
          {product.stage === "base" && product.chainId === 8453
            ? "Проверим native USDC на вашем кошельке в Base после подтверждённого вывода."
            : details.body}
        </p>

        {product.stage === "base" && product.chainId !== 8453 && (
          <div className={s.transfer}>
            <strong>Получатель — ваш кошелёк в Base</strong>
            <code>{model.owner}</code>
            <p>
              Перевод выполняется самостоятельно. Для продолжения нужен native
              USDC в Base, а также ETH для комиссии.
            </p>
          </div>
        )}

        {product.cash != null && editableAmount && (
          <p className={s.meta}>
            Доступно в кошельке Base: {units(product.cash)} USDC
          </p>
        )}

        {editableAmount && typeof product.setAmountInput === "function" && (
          <div className={s.amountField}>
            <label htmlFor={amountId}>Сумма депозита в Base, USDC</label>
            <div className={s.amountInput}>
              <input
                id={amountId}
                inputMode="decimal"
                autoComplete="off"
                placeholder={units(selectedAmount)}
                value={product.amountInput ?? ""}
                onChange={(event) => product.setAmountInput(event.target.value)}
                disabled={Boolean(model.busy)}
                aria-describedby={`${amountId}-help`}
              />
              <button
                type="button"
                className={s.secondary}
                disabled={Boolean(model.busy) || maximum == null}
                onClick={() => product.setAmountInput(units(maximum))}
              >
                Максимум
              </button>
            </div>
            <p className={s.meta} id={`${amountId}-help`}>
              До 6 знаков после точки. Можно внести часть средств и продолжить
              позже.
            </p>
          </div>
        )}

        {["approve", "deposit"].includes(product.stage) && (
          <p>
            <strong>
              Выбрано для{" "}
              {product.stage === "approve" ? "разрешения" : "депозита"}:{" "}
              {units(selectedAmount)} USDC · Base
            </strong>
          </p>
        )}

        {model.destination &&
          ["approve", "deposit"].includes(product.stage) && (
            <dl className={s.destination}>
              <div>
                <dt>
                  {product.stage === "approve"
                    ? "Получатель разрешения"
                    : "Контракт депозита"}{" "}
                  · Base
                </dt>
                <dd>
                  <a
                    href={`${model.destination.explorer}/address/${model.destination.address}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {model.destination.address} ↗
                  </a>
                </dd>
              </div>
              {model.destination.asset && (
                <div>
                  <dt>Native USDC · Base</dt>
                  <dd>
                    <code>{model.destination.asset}</code>
                  </dd>
                </div>
              )}
            </dl>
          )}

        {product.requestId != null && (
          <p className={s.meta}>
            Заявка нового контракта: #{String(product.requestId)}
          </p>
        )}
        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}

        {details.action && (
          <div className={s.actions}>
            <button
              type="button"
              className={s.primary}
              onClick={refreshAction ? model.refresh : product.act}
              disabled={
                Boolean(model.busy || model.loading) ||
                (!refreshAction && !product.canAct)
              }
            >
              {details.action}
            </button>
          </div>
        )}
        {pending && (
          <p className={s.meta}>
            Статус обновляется по блокчейну. Хеш операции сохранён для
            продолжения.
          </p>
        )}
      </div>

      <TransactionLinks transactions={product.txs} />

      {product.recovery && typeof product.retry === "function" && (
        <div className={s.recovery}>
          <p>
            Если страница была перезагружена во время подписи или кошелёк не
            вернул хеш, повторно откройте сохранённый запрос. Он использует тот
            же nonce и сможет исполниться только один раз.
          </p>
          <button
            type="button"
            className={s.secondary}
            onClick={product.retry}
            disabled={Boolean(model.busy || model.loading)}
          >
            Повторить запрос кошельку
          </button>
          <p className={s.meta}>
            Сеть:{" "}
            {product.pendingChainId === 42161
              ? "Arbitrum · 42161"
              : "Base · 8453"}{" "}
            · nonce {product.pendingNonce}
          </p>
        </div>
      )}

      {(product.recovery || product.allowImport) &&
        typeof product.recover === "function" && (
          <details className={s.recovery} open={product.recovery || undefined}>
            <summary>Продолжить по хешу транзакции</summary>
            <p>
              Укажите хеш операции миграции. Проверим кошелёк, контракт и
              результат операции перед продолжением.
            </p>
            <label htmlFor={recoveryId}>Хеш транзакции миграции</label>
            <input
              id={recoveryId}
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="0x…"
              value={product.recoveryHash ?? ""}
              onChange={(event) =>
                product.setRecoveryHash?.(event.target.value)
              }
              disabled={Boolean(model.busy)}
            />
            <button
              type="button"
              className={s.secondary}
              onClick={product.recover}
              disabled={Boolean(model.busy) || !product.recoveryHash?.trim()}
            >
              Проверить транзакцию
            </button>
          </details>
        )}

      {!oldClosed && (
        <a
          className={s.contractLink}
          href={`${product.explorer}/address/${product.address}`}
          target="_blank"
          rel="noreferrer"
        >
          Старый контракт: {short(product.address)} ↗
        </a>
      )}
    </article>
  );
}

export default function MigrationPanel({ model }) {
  if (!model?.owner) return null;
  const products = model.products || [];
  const allComplete =
    products.length > 0 &&
    products.every((product) => product.stage === "complete");
  if (!products.length && !model.error && !model.storageError) return null;
  return (
    <section
      className={s.panel}
      aria-label="Миграция в кроссчейн-продукт"
      lang="ru"
      aria-busy={Boolean(model.loading)}
    >
      {!allComplete && (
        <div className={s.banner}>
          <div className={s.bannerIcon} aria-hidden="true">
            ↗
          </div>
          <div>
            <h2>Выполнить миграцию</h2>
            <p>
              Выведите средства из старого продукта и внесите их в новый
              кроссчейн-контракт через Base. Каждый перевод подтверждается
              отдельно в вашем кошельке.
            </p>
          </div>
          <button
            className={s.secondary}
            type="button"
            onClick={model.refresh}
            disabled={Boolean(model.loading || model.busy)}
          >
            {model.loading ? "Проверяем…" : "Обновить статус"}
          </button>
        </div>
      )}
      {model.error && (
        <p className={s.error} role="alert">
          {model.error}
        </p>
      )}
      {model.storageError && (
        <p className={s.error} role="alert">
          {model.storageError}
        </p>
      )}
      {model.loading && !products.length && (
        <p className={s.notice} role="status">
          Проверяем старые контракты для подключённого кошелька. Баланс пока
          неизвестен.
        </p>
      )}
      <div className={s.products}>
        {products.map((product) => (
          <MigrationProduct
            key={`${model.owner}-${product.id}`}
            product={product}
            model={model}
          />
        ))}
      </div>
    </section>
  );
}

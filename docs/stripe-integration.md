# Stripe integrácia – príprava podľa docs.stripe.com/api

Tento checklist pripravuje backend na robustné dobíjanie kreditu cez Stripe.

## 1) API objekty, ktoré použiješ

- Checkout Session (`/v1/checkout/sessions`)
- Event/Webhook (`/v1/events`, webhook endpoint)
- Payment Intent (cez `checkout.session.payment_intent`)
- Refund (`charge.refunded` event)

## 2) Vytvorenie Checkout Session

Pri `POST /api/v1/billing/checkout-session`:
- over používateľa,
- vypočítaj sumu kreditu,
- vytvor Stripe Customer (ak user nemá `stripe_customer_id`),
- zavolaj Stripe `checkout.sessions.create` s:
  - `mode=payment`,
  - `customer`,
  - `line_items` (alebo `price`),
  - `success_url`, `cancel_url`,
  - `metadata.user_id`, `metadata.credit_amount_cents`.

Do DB ulož `stripe_session_id` do `stripe_checkout_sessions` so stavom `created`.

## 3) Webhook endpoint

Endpoint: `POST /api/v1/webhooks/stripe`

### Povinné kroky
1. Over podpis (`STRIPE_WEBHOOK_SECRET`).
2. Ulož event idempotentne do `stripe_events` (`event_id` je unique).
3. Podľa `event.type` spracuj stav:
   - `checkout.session.completed` -> pripíš kredit,
   - `checkout.session.async_payment_succeeded` -> pripíš kredit (ak ešte nebol),
   - `checkout.session.async_payment_failed` -> označ session ako `failed`,
   - `charge.refunded` -> podľa pravidiel odpočítaj kredit/reverz transakciu.
4. Aktualizuj `stripe_checkout_sessions.status` a `completed_at`.

## 4) Idempotencia a bezpečnosť

- Nikdy nepripisuj kredit priamo z frontendu.
- Kredit sa pripisuje iba na základe overeného webhook eventu.
- Pred zápisom wallet transakcie over, či referencia (`reference_id`) ešte neexistuje.
- Nastav webhook tolerance (`STRIPE_WEBHOOK_TOLERANCE_SECONDS`).

## 5) Minimálne test scenáre

- úspešná platba (`checkout.session.completed`),
- opakované doručenie rovnakého eventu (idempotencia),
- async payment success/fail,
- refund po úspešnej platbe.

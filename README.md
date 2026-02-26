# SMS brána (web) – štartovací návrh

Tento repozitár je **MVP blueprint** pre webovú SMS bránu s:
- vlastným serverom,
- databázou **MariaDB**,
- platbami cez **Stripe**,
- odosielaním SMS cez **EuroSMS API**.

## 1) Cieľ

Postaviť službu, kde sa používateľ registruje, dobije kredit cez Stripe a následne odosiela SMS správy cez API alebo webové rozhranie.

## 2) Navrhnutá architektúra

- **Backend API**: Node.js (Express/Nest) alebo PHP/Laravel (podľa preferencie)
- **Databáza**: MariaDB
- **Queue/Worker (odporúčané)**: Redis + worker pre spoľahlivé odosielanie SMS
- **Platby**: Stripe Checkout + webhook na potvrdenie platby
- **SMS provider**: EuroSMS API (**odporúčané verzie 2.x alebo 3.x**)
- **Auth**: JWT pre web, API key pre programové odosielanie
- **Hosting**: Nginx + Docker Compose (alebo systemd služby)

## 3) Databáza

SQL schéma je v súbore [`schema.sql`](./schema.sql).

Kľúčové entity:
- `users` – účty používateľov
- `api_keys` – API prístupy
- `wallet_transactions` – kredity/debety
- `stripe_events` – uložené webhook eventy (idempotencia)
- `sms_messages` – správy, stav odoslania, cena, provider response
- `sms_delivery_events` – história potvrdení doručenia (DLR)

## 4) Odporúčaný flow

### A) Registrácia a API kľúč
1. Používateľ sa zaregistruje.
2. Vygeneruje sa API key (`ak_live_...`) a hash sa uloží do DB.

### B) Dobitie kreditu (Stripe)
1. Backend vytvorí Stripe Checkout Session.
2. Používateľ zaplatí.
3. Stripe webhook (`checkout.session.completed`) príde na backend.
4. Backend uloží event do `stripe_events` (ochrana pred duplicitou).
5. Zapíše kredit do `wallet_transactions`.

### C) Odoslanie SMS
1. Klient zavolá `POST /api/v1/sms/send`.
2. Backend overí API key/JWT a dostupný kredit.
3. Správa sa uloží do `sms_messages` so stavom `queued`.
4. Worker zavolá EuroSMS API.
5. Po úspechu sa stav zmení na `sent`, pri chybe `failed`.
6. Pri sent sa odpíše kredit cez `wallet_transactions`.

### D) Potvrdenie doručenia SMS (DLR)
1. EuroSMS zavolá `POST /api/v1/webhooks/eurosms/dlr`.
2. Backend overí podpis/token callbacku.
3. Uloží raw payload do `sms_delivery_events` (audit + debugging).
4. Podľa `provider_message_id` nájde správu v `sms_messages`.
5. Namapuje provider status na interný stav (`delivered` / `undelivered`) a uloží `delivered_at`.
6. Web/API klient následne vidí finálny stav doručenia.

## 5) API endpointy (MVP)

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/api-keys` – vytvorenie API key
- `GET /api/v1/wallet/balance`
- `POST /api/v1/billing/checkout-session`
- `POST /api/v1/webhooks/stripe`
- `POST /api/v1/sms/send`
- `GET /api/v1/sms/:id`
- `GET /api/v1/sms?status=&from=&to=`
- `POST /api/v1/webhooks/eurosms/dlr`

## 6) Bezpečnosť (dôležité)

- Ukladať iba **hash API kľúčov** (nie plaintext).
- Stripe webhook validovať podpisom (`STRIPE_WEBHOOK_SECRET`).
- EuroSMS DLR webhook validovať tokenom/HMAC (`EUROSMS_DLR_SECRET`).
- Rate limit pre SMS endpoint.
- Whitelist/validácia telefónnych čísel (E.164 formát).
- Logovať provider chyby a retry mechanizmus (max pokusy).

## 7) Stripe API priprava (podľa docs.stripe.com/api)

- Použi **Stripe Checkout Session API** na dobitie kreditu (`mode=payment`).
- V metadátach session ukladaj `user_id` a interný `credit_amount_cents`.
- Spracuj minimálne webhook eventy:
  - `checkout.session.completed` (pridanie kreditu),
  - `checkout.session.async_payment_succeeded` (asynchrónne potvrdenie),
  - `checkout.session.async_payment_failed` (zlyhanie),
  - `charge.refunded` (reverz kreditov, ak je to business požiadavka).
- Každý Stripe event ukladaj idempotentne cez `stripe_events.event_id`.
- Pozri detailný checklist v [`docs/stripe-integration.md`](./docs/stripe-integration.md).

## 8) .env premenné

Pozri [`.env.example`](./.env.example).

### Poznámka k EuroSMS verzii API

- Odporúčané je implementovať **EuroSMS API 2.x** (https/xml/WebService) alebo **3.x** (RESTful).
- Pre nové projekty preferuj 3.x RESTful variant, ak je dostupný pre tvoje konto.
- Pri PHP klientoch môžeš využiť knižnicu od Pexxi (GitHub) namiesto vlastnej implementácie HTTP klienta.


## 9) Dizajn aplikácie a dashboardy

- Návrh počíta s 2 typmi dashboardov: **admin** a **user**.
- UI štýl: jednoduchý SaaS dashboard (KPI karty + grafy + tabuľky + filtre podľa obdobia).
- Prehľad metrík a endpointov je v [`docs/dashboards.md`](./docs/dashboards.md).
- Každý user vidí iba svoje dáta, admin vidí agregované globálne dáta celej platformy.

## 10) Nasledujúce kroky

1. Vybrať stack (napr. Node.js + Express + Prisma).
2. Implementovať endpointy, worker a DLR webhook handler.
3. Napojiť Stripe webhook a EuroSMS request podľa ich presnej API dokumentácie.
4. Implementovať oba dashboardy (admin + user) so štatistikami a RBAC.

---

Ak chceš, v ďalšom kroku ti viem rovno pripraviť aj **kompletný backend skeleton** (Node.js + MariaDB + Stripe + EuroSMS client + Docker Compose).


## 11) Backend kód (už pripravený)

Prvý funkčný backend skeleton je už pridaný v `src/`:
- `src/server.js` – štart servera
- `src/app.js` – endpointy (`/health`, dashboard summary, `POST /api/v1/sms/send`)
- `src/db.js` – MariaDB pool cez `mysql2/promise`
- `src/config.js` – načítanie `.env` konfigurácie

### Spustenie

1. `npm install`
2. `cp .env.example .env` a doplniť hodnoty
3. `npm run check`
4. `npm start`


## 12) Čo je už nakódované (API + Web)

Hotové časti v tomto repozitári:
- Stripe endpoint: `POST /api/v1/billing/checkout-session`
- Stripe webhook: `POST /api/v1/webhooks/stripe`
- EuroSMS worker endpoint (admin): `POST /api/v1/workers/sms/send-queued`
- Web dashboard MVP v `public/` (formular pre summary, SMS send, checkout)

### Rýchly štart
1. `npm install`
2. `cp .env.example .env`
3. `npm run check`
4. `npm start`
5. Otvor `http://localhost:3000`


## 13) Implementované hardening features

Aktuálne už implementované v kóde:
- JWT auth + RBAC cez DB role check (`/api/v1/auth/register`, `/api/v1/auth/login`).
- Password hashing cez `scrypt`.
- DLR webhook endpoint `POST /api/v1/webhooks/eurosms/dlr` s mapovaním do `sms_messages` a `sms_delivery_events`.
- Kreditná logika:
  - pre-check kreditu pri `POST /api/v1/sms/send`,
  - debit transakcia po úspešnom odoslaní vo workeri.
- Queue hardening:
  - retry do `WORKER_MAX_ATTEMPTS`,
  - backoff,
  - scheduler loop v server procese.
- Stripe rozšírenie:
  - `charge.refunded` coverage,
  - transakčné spracovanie webhookov + idempotencia.
- Frontend upgrade:
  - autentifikácia,
  - user/admin KPI sekcie,
  - operácie pre SMS queue + worker + checkout.

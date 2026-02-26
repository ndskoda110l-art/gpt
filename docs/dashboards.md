# Dashboardy (Admin + User) – návrh dizajnu a štatistík

Tento dokument definuje, ako má vyzerať web aplikácia pre dve roly:
- **admin**
- **user (klient)**

## 1) Dizajn systému (UI)

## Navigácia
- Ľavé menu (desktop): Dashboard, SMS, Kontakty, Billing, API kľúče, Nastavenia.
- Top bar: prepínač obdobia (dnes/7 dní/30 dní/custom), notifikácie, profil.
- Mobile: spodná navigácia + hamburger menu.

## Design system
- Farby:
  - Primary: `#2563EB` (blue)
  - Success: `#16A34A`
  - Warning: `#D97706`
  - Error: `#DC2626`
  - Neutral bg: `#F8FAFC`
- Font: Inter / Roboto.
- Komponenty: KPI cards, line chart, bar chart, donut chart, data table, filter drawer.
- Dark mode: podporiť od začiatku (token-based farby).

## 2) User dashboard (klient)

## KPI karty (hore)
- Aktuálny kredit (EUR)
- Počet SMS dnes
- Delivery rate (7 dní)
- Priemerná cena za SMS (30 dní)

## Grafy
- **Line chart**: SMS volume po dňoch (posledných 30 dní)
- **Donut chart**: stavy SMS (`sent`, `delivered`, `failed`, `undelivered`)
- **Bar chart**: náklady podľa dňa (EUR)

## Tabuľky
- Posledné SMS (recipient, status, sent_at, cena)
- Posledné platby (Stripe session, amount, status, time)

## Akcie
- Rýchle odoslanie SMS
- Dobitie kreditu
- Generovanie API key

## 3) Admin dashboard

## KPI karty (globálne)
- Aktívni používatelia (30 dní)
- Celkový počet SMS dnes
- Delivery rate platformy (7 dní)
- Tržby dnes / tento mesiac (EUR)

## Grafy
- **Line chart**: odoslané SMS po dňoch (global)
- **Stacked bar**: status breakdown po dňoch
- **Top users chart**: top 10 userov podľa objemu SMS
- **Revenue chart**: credited vs refunded

## Tabuľky
- Najnovšie chyby providera
- Používatelia s nízkym kreditom
- Posledné refundy a chargeback eventy

## Admin akcie
- Aktivovať/deaktivovať používateľa
- Manuálna kreditná/debetná transakcia
- Force retry failed SMS

## 4) API endpointy pre dashboard štatistiky

## User endpointy
- `GET /api/v1/dashboard/user/summary?from=&to=`
- `GET /api/v1/dashboard/user/sms-volume?from=&to=&groupBy=day`
- `GET /api/v1/dashboard/user/costs?from=&to=&groupBy=day`
- `GET /api/v1/dashboard/user/status-distribution?from=&to=`

## Admin endpointy
- `GET /api/v1/dashboard/admin/summary?from=&to=`
- `GET /api/v1/dashboard/admin/sms-volume?from=&to=&groupBy=day`
- `GET /api/v1/dashboard/admin/revenue?from=&to=&groupBy=day`
- `GET /api/v1/dashboard/admin/top-users?from=&to=&limit=10`

## 5) Výkon a caching

- Pre dashboardy odporúčané cache 30–120 sekúnd.
- Ťažké agregácie robiť nad predagregovanou tabuľkou `daily_sms_stats`.
- Aktualizácia agregátov cron jobom každých 5 minút.

## 6) RBAC pravidlá

- `admin` vidí globálne metriky všetkých userov.
- `user` vidí iba vlastné dáta (`WHERE user_id = auth.user.id`).
- Všetky admin endpointy chrániť middleware `role=admin`.

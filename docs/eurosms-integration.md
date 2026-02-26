# EuroSMS integrácia – implementačné poznámky

> Presné parametre endpointu, autentifikácie a callbackov si potvrď podľa aktuálnej dokumentácie EuroSMS.

> Stripe časť je pripravená v samostatnom dokumente: [`docs/stripe-integration.md`](./stripe-integration.md).

## Odporúčaná verzia API

- EuroSMS odporúča implementovať novšiu verziu API: **2.x** (https/xml/WebService) alebo **3.x** (RESTful).
- Ak začínaš nový projekt, preferuj **3.x RESTful** (jednoduchšia integrácia, JSON flow).
- Ak musíš zostať na staršom rozhraní alebo máš legacy systém, použi **2.x**.
- Pre PHP klientov je dostupná knižnica vytvorená spoločnosťou **Pexxi** (GitHub), ktorú je vhodné použiť namiesto písania klienta od nuly.

## Odoslanie správy (typický backend flow)

1. Backend vyberie `queued` správu.
2. Zostaví payload (recipient, sender, text, callback URL pre DLR).
3. Pridá autentifikáciu (API key / token).
4. Zavolá HTTP request na EuroSMS endpoint.
5. Uloží `provider_message_id`, `provider_response`, nastaví `status=sent`.

## Pseudokód – send

```ts
async function sendViaEuroSMS(msg) {
  const response = await http.post(process.env.EUROSMS_API_URL, {
    to: msg.recipient,
    from: msg.sender,
    text: msg.body,
    callback_url: `${process.env.APP_URL}/api/v1/webhooks/eurosms/dlr`,
  }, {
    headers: {
      Authorization: `Bearer ${process.env.EUROSMS_API_KEY}`,
      'Content-Type': 'application/json',
    },
    timeout: 10000,
  });

  return {
    success: response.status >= 200 && response.status < 300,
    providerMessageId: response.data?.id,
    raw: response.data,
  };
}
```

## Poznámka pre PHP implementáciu

Príklad orientačného postupu:
1. Nainštalovať Pexxi knižnicu z GitHub repozitára (podľa ich README).
2. Nastaviť credentials a endpoint podľa verzie API (2.x alebo 3.x).
3. Wrapper vo vlastnej aplikácii nechať vracať jednotný interný formát (`providerMessageId`, `raw`, `success`).

## Retry stratégia

- Retry iba pre technické chyby (timeout, 5xx).
- Max 3 pokusy (exponenciálny backoff: 10s, 30s, 90s).
- Pri business chybe (neplatné číslo, blacklist) označiť ako `failed` bez retry.

## Delivery reporty (DLR)

### Endpoint
- `POST /api/v1/webhooks/eurosms/dlr`

### Bezpečnosť callbacku
- Preferuj HMAC podpis hlavičky, napr. `X-EuroSMS-Signature`.
- Ak provider nepodporuje podpis, používaj aspoň statický tajný token (`EUROSMS_DLR_SECRET`) + IP allowlist.

### Persistencia
Pri každom callbacku:
1. Ulož payload do `sms_delivery_events`.
2. Nájdí správu podľa `provider_message_id`.
3. Namapuj provider status na interný status:
   - `DELIVERED` -> `delivered`
   - `UNDELIVERED` / `EXPIRED` / `REJECTED` -> `undelivered`
   - neznámy status -> ponechaj `sent` + `delivery_status=unknown`
4. Aktualizuj `sms_messages.delivery_status`, `status` a `delivered_at`.

### Pseudokód – DLR handler

```ts
async function handleEuroSmsDlr(req) {
  verifyDlrSignatureOrToken(req, process.env.EUROSMS_DLR_SECRET);

  const providerMessageId = req.body.message_id;
  const providerStatus = String(req.body.status || '').toUpperCase();

  await db.sms_delivery_events.insert({
    provider_message_id: providerMessageId,
    provider_status: providerStatus,
    normalized_status: normalize(providerStatus),
    payload: req.body,
  });

  const sms = await db.sms_messages.findOne({ provider_message_id: providerMessageId });
  if (!sms) return; // callback môže prísť skôr/neskôr, nerob 500

  const normalized = normalize(providerStatus);

  await db.sms_messages.update(sms.id, {
    delivery_status: normalized,
    status: normalized === 'delivered' ? 'delivered' : normalized === 'undelivered' ? 'undelivered' : sms.status,
    delivered_at: normalized === 'delivered' ? new Date() : sms.delivered_at,
  });
}
```

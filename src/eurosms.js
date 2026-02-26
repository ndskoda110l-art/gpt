import { config } from './config.js';

export const sendViaEuroSms = async ({ recipient, sender, body }) => {
  if (!config.eurosms.apiUrl || !config.eurosms.apiKey) {
    throw new Error('EuroSMS is not configured. Missing EUROSMS_API_URL/EUROSMS_API_KEY.');
  }

  const response = await fetch(config.eurosms.apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.eurosms.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      to: recipient,
      from: sender || config.eurosms.sender,
      text: body
    })
  });

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { raw: text };
  }

  return {
    ok: response.ok,
    status: response.status,
    payload,
    providerMessageId: payload?.id || payload?.message_id || null
  };
};

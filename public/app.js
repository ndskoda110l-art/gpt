const getHeaders = () => ({
  'Content-Type': 'application/json',
  'x-user-id': document.querySelector('#userId').value,
  'x-user-role': document.querySelector('#userRole').value
});

const pretty = (el, data) => {
  document.querySelector(el).textContent = JSON.stringify(data, null, 2);
};

const call = async (url, options = {}) => {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  return { status: response.status, ok: response.ok, data };
};

document.querySelector('#btnUserSummary').addEventListener('click', async () => {
  const result = await call('/api/v1/dashboard/user/summary', { headers: getHeaders() });
  pretty('#summaryOutput', result);
});

document.querySelector('#btnAdminSummary').addEventListener('click', async () => {
  const result = await call('/api/v1/dashboard/admin/summary', { headers: getHeaders() });
  pretty('#summaryOutput', result);
});

document.querySelector('#btnSendSms').addEventListener('click', async () => {
  const payload = {
    recipient: document.querySelector('#recipient').value,
    sender: document.querySelector('#sender').value,
    body: document.querySelector('#smsBody').value
  };

  const result = await call('/api/v1/sms/send', {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(payload)
  });

  pretty('#smsOutput', result);
});

document.querySelector('#btnCheckout').addEventListener('click', async () => {
  const amountCents = Number(document.querySelector('#amountCents').value || 0);
  const result = await call('/api/v1/billing/checkout-session', {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ amountCents })
  });

  pretty('#checkoutOutput', result);
});

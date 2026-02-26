let token = '';

const authHeaders = () => ({
  'Content-Type': 'application/json',
  ...(token ? { Authorization: `Bearer ${token}` } : {})
});

const pretty = (selector, value) => {
  document.querySelector(selector).textContent = JSON.stringify(value, null, 2);
};

const call = async (url, options = {}) => {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
};

const renderKpis = (selector, items) => {
  const root = document.querySelector(selector);
  root.innerHTML = items.map((item) => `<div class="kpi"><div class="label">${item.label}</div><div class="value">${item.value}</div></div>`).join('');
};

document.querySelector('#btnRegister').addEventListener('click', async () => {
  const payload = {
    email: document.querySelector('#email').value,
    password: document.querySelector('#password').value,
    fullName: document.querySelector('#fullName').value
  };
  const result = await call('/api/v1/auth/register', { method: 'POST', headers: authHeaders(), body: JSON.stringify(payload) });
  if (result.data?.token) token = result.data.token;
  pretty('#authOutput', result);
});

document.querySelector('#btnLogin').addEventListener('click', async () => {
  const payload = {
    email: document.querySelector('#email').value,
    password: document.querySelector('#password').value
  };
  const result = await call('/api/v1/auth/login', { method: 'POST', headers: authHeaders(), body: JSON.stringify(payload) });
  if (result.data?.token) token = result.data.token;
  pretty('#authOutput', result);
});

document.querySelector('#btnUserSummary').addEventListener('click', async () => {
  const result = await call('/api/v1/dashboard/user/summary', { headers: authHeaders() });
  if (result.ok) {
    renderKpis('#userKpis', [
      { label: 'Balance', value: `${((result.data.balanceCents || 0)/100).toFixed(2)} €` },
      { label: 'Total SMS', value: result.data.totalSms || 0 },
      { label: 'Delivery rate', value: `${Math.round((result.data.deliveryRate || 0) * 100)}%` },
      { label: 'Failed', value: result.data.failedSms || 0 }
    ]);
  }
  pretty('#userSummaryOutput', result);
});

document.querySelector('#btnAdminSummary').addEventListener('click', async () => {
  const result = await call('/api/v1/dashboard/admin/summary', { headers: authHeaders() });
  if (result.ok) {
    renderKpis('#adminKpis', [
      { label: 'Active users', value: result.data.activeUsers || 0 },
      { label: 'Platform SMS', value: result.data.totalSms || 0 },
      { label: 'Revenue', value: `${((result.data.revenueCents || 0)/100).toFixed(2)} €` },
      { label: 'Costs', value: `${((result.data.costsCents || 0)/100).toFixed(2)} €` }
    ]);
  }
  pretty('#adminSummaryOutput', result);
});

document.querySelector('#btnSendSms').addEventListener('click', async () => {
  const payload = {
    recipient: document.querySelector('#recipient').value,
    sender: document.querySelector('#sender').value,
    body: document.querySelector('#smsBody').value
  };
  const result = await call('/api/v1/sms/send', { method: 'POST', headers: authHeaders(), body: JSON.stringify(payload) });
  pretty('#smsOutput', result);
});

document.querySelector('#btnRunWorker').addEventListener('click', async () => {
  const result = await call('/api/v1/workers/sms/send-queued', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ limit: 20 }) });
  pretty('#smsOutput', result);
});

document.querySelector('#btnCheckout').addEventListener('click', async () => {
  const amountCents = Number(document.querySelector('#amountCents').value || 0);
  const result = await call('/api/v1/billing/checkout-session', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ amountCents }) });
  pretty('#checkoutOutput', result);
});

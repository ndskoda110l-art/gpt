import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { query } from './db.js';
import { createStripeCheckoutSession, handleStripeWebhook } from './stripe.js';
import { processQueuedSms } from './worker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const requireUser = (req, res, next) => {
  const userId = Number(req.header('x-user-id'));
  if (!Number.isInteger(userId) || userId <= 0) {
    res.status(401).json({ error: 'Missing or invalid x-user-id header.' });
    return;
  }

  req.auth = {
    userId,
    role: req.header('x-user-role') || 'user'
  };
  next();
};

const requireAdmin = (req, res, next) => {
  if (req.auth.role !== 'admin') {
    res.status(403).json({ error: 'Admin role required.' });
    return;
  }
  next();
};

app.post('/api/v1/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res, next) => {
  try {
    const signature = req.header('stripe-signature') || '';
    const result = await handleStripeWebhook(req.body, signature);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/health', async (_req, res, next) => {
  try {
    const now = await query('SELECT NOW() AS now');
    res.json({ status: 'ok', dbTime: now[0]?.now || null });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/billing/checkout-session', requireUser, async (req, res, next) => {
  try {
    const amountCents = Number(req.body.amountCents || 0);
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      res.status(400).json({ error: 'amountCents must be a positive integer.' });
      return;
    }

    const session = await createStripeCheckoutSession({ userId: req.auth.userId, amountCents });
    res.status(201).json({ id: session.id, url: session.url, amountCents });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/dashboard/user/summary', requireUser, async (req, res, next) => {
  try {
    const { userId } = req.auth;
    const walletRows = await query(
      `SELECT
        COALESCE(SUM(CASE WHEN type='credit' THEN amount_cents END), 0) AS total_credit,
        COALESCE(SUM(CASE WHEN type='debit' THEN amount_cents END), 0) AS total_debit
      FROM wallet_transactions
      WHERE user_id = ?`,
      [userId]
    );

    const smsRows = await query(
      `SELECT
        COUNT(*) AS total_sms,
        COALESCE(SUM(status='delivered'), 0) AS delivered_sms,
        COALESCE(SUM(status='failed'), 0) AS failed_sms,
        COALESCE(SUM(status='undelivered'), 0) AS undelivered_sms
      FROM sms_messages
      WHERE user_id = ?`,
      [userId]
    );

    const credits = Number(walletRows[0]?.total_credit || 0);
    const debits = Number(walletRows[0]?.total_debit || 0);
    const totalSms = Number(smsRows[0]?.total_sms || 0);
    const deliveredSms = Number(smsRows[0]?.delivered_sms || 0);

    res.json({
      balanceCents: credits - debits,
      totalSms,
      deliveryRate: totalSms > 0 ? Number((deliveredSms / totalSms).toFixed(4)) : 0,
      failedSms: Number(smsRows[0]?.failed_sms || 0),
      undeliveredSms: Number(smsRows[0]?.undelivered_sms || 0)
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/dashboard/admin/summary', requireUser, requireAdmin, async (_req, res, next) => {
  try {
    const platformRows = await query(
      `SELECT
        COUNT(*) AS total_sms,
        COALESCE(SUM(status='delivered'), 0) AS delivered_sms,
        COALESCE(SUM(status='failed'), 0) AS failed_sms
      FROM sms_messages`
    );

    const usersRows = await query('SELECT COUNT(*) AS active_users FROM users WHERE is_active = 1');

    const revenueRows = await query(
      `SELECT
        COALESCE(SUM(CASE WHEN type='credit' THEN amount_cents END), 0) AS revenue_cents,
        COALESCE(SUM(CASE WHEN type='debit' THEN amount_cents END), 0) AS costs_cents
      FROM wallet_transactions`
    );

    const totalSms = Number(platformRows[0]?.total_sms || 0);
    const deliveredSms = Number(platformRows[0]?.delivered_sms || 0);

    res.json({
      activeUsers: Number(usersRows[0]?.active_users || 0),
      totalSms,
      deliveryRate: totalSms > 0 ? Number((deliveredSms / totalSms).toFixed(4)) : 0,
      failedSms: Number(platformRows[0]?.failed_sms || 0),
      revenueCents: Number(revenueRows[0]?.revenue_cents || 0),
      costsCents: Number(revenueRows[0]?.costs_cents || 0)
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/sms/send', requireUser, async (req, res, next) => {
  try {
    const { recipient, sender, body } = req.body;
    if (typeof recipient !== 'string' || recipient.length < 8) {
      res.status(400).json({ error: 'Invalid recipient.' });
      return;
    }

    if (typeof body !== 'string' || body.trim().length === 0) {
      res.status(400).json({ error: 'SMS body is required.' });
      return;
    }

    const result = await query(
      `INSERT INTO sms_messages (user_id, recipient, sender, body, status)
      VALUES (?, ?, ?, ?, 'queued')`,
      [req.auth.userId, recipient, sender || null, body]
    );

    res.status(201).json({ id: result.insertId, status: 'queued' });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/workers/sms/send-queued', requireUser, requireAdmin, async (req, res, next) => {
  try {
    const limit = Number(req.body.limit || 10);
    const processed = await processQueuedSms(limit);
    res.json({ processedCount: processed.length, processed });
  } catch (error) {
    next(error);
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use((error, _req, res, _next) => {
  const message = error?.message || 'Unknown error';
  res.status(500).json({ error: message });
});

export default app;

import express from 'express';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { query } from './db.js';
import { createStripeCheckoutSession, handleStripeWebhook } from './stripe.js';
import { processQueuedSms, getUserBalanceCents } from './worker.js';
import { hashPassword, signJwt, verifyJwt, verifyPassword } from './auth.js';
import { config } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const authFromToken = async (req, _res, next) => {
  const authorization = req.header('authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : null;

  if (!token) {
    req.auth = null;
    next();
    return;
  }

  try {
    const payload = verifyJwt(token);
    const users = await query('SELECT id, role, is_active FROM users WHERE id = ? LIMIT 1', [payload.sub]);
    if (users.length === 0 || Number(users[0].is_active) !== 1) {
      req.auth = null;
      next();
      return;
    }

    req.auth = { userId: Number(users[0].id), role: users[0].role };
  } catch {
    req.auth = null;
  }

  next();
};

const requireUser = (req, res, next) => {
  if (!req.auth?.userId) {
    res.status(401).json({ error: 'Unauthorized. Missing/invalid Bearer token.' });
    return;
  }
  next();
};

const requireAdmin = (req, res, next) => {
  if (req.auth?.role !== 'admin') {
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
app.use(authFromToken);
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/health', async (_req, res, next) => {
  try {
    const now = await query('SELECT NOW() AS now');
    res.json({ status: 'ok', dbTime: now[0]?.now || null });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/auth/register', async (req, res, next) => {
  try {
    const { email, password, fullName } = req.body;
    if (!email || !password || String(password).length < 8) {
      res.status(400).json({ error: 'Email and password (min 8 chars) are required.' });
      return;
    }

    const exists = await query('SELECT id FROM users WHERE email = ? LIMIT 1', [String(email).toLowerCase()]);
    if (exists.length > 0) {
      res.status(409).json({ error: 'Email already exists.' });
      return;
    }

    const passwordHash = await hashPassword(password);
    const result = await query(
      `INSERT INTO users (email, password_hash, full_name, role, is_active)
       VALUES (?, ?, ?, 'user', 1)`,
      [String(email).toLowerCase(), passwordHash, fullName || null]
    );

    const token = signJwt({ sub: result.insertId, role: 'user' });
    res.status(201).json({ token });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/auth/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const rows = await query('SELECT id, password_hash, role, is_active FROM users WHERE email = ? LIMIT 1', [String(email || '').toLowerCase()]);
    if (rows.length === 0 || Number(rows[0].is_active) !== 1) {
      res.status(401).json({ error: 'Invalid credentials.' });
      return;
    }

    const valid = await verifyPassword(password || '', rows[0].password_hash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid credentials.' });
      return;
    }

    const token = signJwt({ sub: rows[0].id, role: rows[0].role });
    res.json({ token });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/api-keys', requireUser, async (req, res, next) => {
  try {
    const raw = `ak_live_${crypto.randomBytes(24).toString('hex')}`;
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    const prefix = raw.slice(0, 16);
    const label = req.body.label || null;

    await query(
      `INSERT INTO api_keys (user_id, key_prefix, key_hash, label)
       VALUES (?, ?, ?, ?)`,
      [req.auth.userId, prefix, hash, label]
    );

    res.status(201).json({ apiKey: raw, warning: 'Store this key now. It cannot be retrieved again.' });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/wallet/balance', requireUser, async (req, res, next) => {
  try {
    const balanceCents = await getUserBalanceCents(req.auth.userId);
    res.json({ balanceCents });
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

app.post('/api/v1/webhooks/eurosms/dlr', async (req, res, next) => {
  try {
    const secret = req.header('x-eurosms-secret') || req.body.secret;
    if (!config.eurosms.dlrSecret || secret !== config.eurosms.dlrSecret) {
      res.status(401).json({ error: 'Invalid DLR secret.' });
      return;
    }

    const providerMessageId = String(req.body.message_id || req.body.provider_message_id || '');
    const providerStatus = String(req.body.status || '').toUpperCase();
    const normalized = providerStatus === 'DELIVERED'
      ? 'delivered'
      : ['UNDELIVERED', 'EXPIRED', 'REJECTED', 'FAILED'].includes(providerStatus)
        ? 'undelivered'
        : 'unknown';

    const smsRows = await query('SELECT id, status FROM sms_messages WHERE provider_message_id = ? LIMIT 1', [providerMessageId]);
    const smsMessageId = smsRows[0]?.id || null;

    await query(
      `INSERT INTO sms_delivery_events (sms_message_id, provider_message_id, provider_status, normalized_status, payload)
       VALUES (?, ?, ?, ?, ?)`,
      [smsMessageId, providerMessageId, providerStatus || 'UNKNOWN', normalized, JSON.stringify(req.body)]
    );

    if (smsMessageId) {
      await query(
        `UPDATE sms_messages
         SET delivery_status = ?, status = CASE WHEN ? = 'delivered' THEN 'delivered' WHEN ? = 'undelivered' THEN 'undelivered' ELSE status END,
             delivered_at = CASE WHEN ? = 'delivered' THEN NOW() ELSE delivered_at END
         WHERE id = ?`,
        [normalized, normalized, normalized, normalized, smsMessageId]
      );
    }

    res.json({ ok: true, normalized, smsMessageId });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/dashboard/user/summary', requireUser, async (req, res, next) => {
  try {
    const { userId } = req.auth;
    const [walletRows, smsRows, series, statusDist] = await Promise.all([
      query(`SELECT COALESCE(SUM(CASE WHEN type='credit' THEN amount_cents END),0) AS total_credit, COALESCE(SUM(CASE WHEN type='debit' THEN amount_cents END),0) AS total_debit FROM wallet_transactions WHERE user_id = ?`, [userId]),
      query(`SELECT COUNT(*) AS total_sms, COALESCE(SUM(status='delivered'),0) AS delivered_sms, COALESCE(SUM(status='failed'),0) AS failed_sms, COALESCE(SUM(status='undelivered'),0) AS undelivered_sms FROM sms_messages WHERE user_id = ?`, [userId]),
      query(`SELECT DATE(queued_at) AS day, COUNT(*) AS count FROM sms_messages WHERE user_id = ? GROUP BY DATE(queued_at) ORDER BY day DESC LIMIT 30`, [userId]),
      query(`SELECT status, COUNT(*) AS count FROM sms_messages WHERE user_id = ? GROUP BY status`, [userId])
    ]);

    const credits = Number(walletRows[0]?.total_credit || 0);
    const debits = Number(walletRows[0]?.total_debit || 0);
    const totalSms = Number(smsRows[0]?.total_sms || 0);
    const deliveredSms = Number(smsRows[0]?.delivered_sms || 0);

    res.json({
      balanceCents: credits - debits,
      totalSms,
      deliveryRate: totalSms > 0 ? Number((deliveredSms / totalSms).toFixed(4)) : 0,
      failedSms: Number(smsRows[0]?.failed_sms || 0),
      undeliveredSms: Number(smsRows[0]?.undelivered_sms || 0),
      volumeByDay: series.reverse(),
      statusDistribution: statusDist
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/dashboard/admin/summary', requireUser, requireAdmin, async (_req, res, next) => {
  try {
    const [platformRows, usersRows, revenueRows, topUsers, statusDist] = await Promise.all([
      query(`SELECT COUNT(*) AS total_sms, COALESCE(SUM(status='delivered'),0) AS delivered_sms, COALESCE(SUM(status='failed'),0) AS failed_sms FROM sms_messages`),
      query('SELECT COUNT(*) AS active_users FROM users WHERE is_active = 1'),
      query(`SELECT COALESCE(SUM(CASE WHEN type='credit' THEN amount_cents END),0) AS revenue_cents, COALESCE(SUM(CASE WHEN type='debit' THEN amount_cents END),0) AS costs_cents FROM wallet_transactions`),
      query(`SELECT u.id, u.email, COUNT(m.id) AS sms_count FROM users u LEFT JOIN sms_messages m ON m.user_id = u.id GROUP BY u.id, u.email ORDER BY sms_count DESC LIMIT 10`),
      query(`SELECT status, COUNT(*) AS count FROM sms_messages GROUP BY status`)
    ]);

    const totalSms = Number(platformRows[0]?.total_sms || 0);
    const deliveredSms = Number(platformRows[0]?.delivered_sms || 0);

    res.json({
      activeUsers: Number(usersRows[0]?.active_users || 0),
      totalSms,
      deliveryRate: totalSms > 0 ? Number((deliveredSms / totalSms).toFixed(4)) : 0,
      failedSms: Number(platformRows[0]?.failed_sms || 0),
      revenueCents: Number(revenueRows[0]?.revenue_cents || 0),
      costsCents: Number(revenueRows[0]?.costs_cents || 0),
      topUsers,
      statusDistribution: statusDist
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/sms/send', requireUser, async (req, res, next) => {
  try {
    const { recipient, sender, body } = req.body;
    if (typeof recipient !== 'string' || !/^\+[1-9]\d{7,14}$/.test(recipient)) {
      res.status(400).json({ error: 'Invalid recipient format. Use E.164.' });
      return;
    }

    if (typeof body !== 'string' || body.trim().length === 0) {
      res.status(400).json({ error: 'SMS body is required.' });
      return;
    }

    const balanceCents = await getUserBalanceCents(req.auth.userId);
    const smsPrice = Number(process.env.SMS_PRICE_CENTS || 5);
    if (balanceCents < smsPrice) {
      res.status(402).json({ error: 'Insufficient credit.', balanceCents, requiredCents: smsPrice });
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

import Stripe from 'stripe';
import { config } from './config.js';
import { query } from './db.js';

const stripe = config.stripe.secretKey ? new Stripe(config.stripe.secretKey) : null;

export const createStripeCheckoutSession = async ({ userId, amountCents }) => {
  if (!stripe) {
    throw new Error('Stripe is not configured. Missing STRIPE_SECRET_KEY.');
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: config.stripe.priceId
      ? [{ price: config.stripe.priceId, quantity: 1 }]
      : [
          {
            price_data: {
              currency: 'eur',
              product_data: { name: 'SMS kredit' },
              unit_amount: amountCents
            },
            quantity: 1
          }
        ],
    success_url: config.stripe.successUrl,
    cancel_url: config.stripe.cancelUrl,
    metadata: {
      user_id: String(userId),
      credit_amount_cents: String(amountCents)
    }
  });

  await query(
    `INSERT INTO stripe_checkout_sessions (user_id, stripe_session_id, status, amount_cents, currency, metadata)
     VALUES (?, ?, 'created', ?, 'EUR', JSON_OBJECT('user_id', ?, 'credit_amount_cents', ?))`,
    [userId, session.id, amountCents, String(userId), String(amountCents)]
  );

  return session;
};

const markWalletCredit = async ({ userId, amountCents, referenceId }) => {
  const existing = await query(
    'SELECT id FROM wallet_transactions WHERE reference_id = ? LIMIT 1',
    [referenceId]
  );

  if (existing.length > 0) {
    return;
  }

  await query(
    `INSERT INTO wallet_transactions (user_id, type, amount_cents, currency, source, reference_id, note)
     VALUES (?, 'credit', ?, 'EUR', 'stripe', ?, 'Stripe checkout credit')`,
    [userId, amountCents, referenceId]
  );
};

export const handleStripeWebhook = async (rawBody, signature) => {
  if (!stripe) {
    throw new Error('Stripe is not configured. Missing STRIPE_SECRET_KEY.');
  }

  let event;
  if (config.stripe.webhookSecret) {
    event = stripe.webhooks.constructEvent(rawBody, signature, config.stripe.webhookSecret);
  } else {
    event = JSON.parse(rawBody.toString('utf8'));
  }

  const duplicate = await query('SELECT id FROM stripe_events WHERE event_id = ? LIMIT 1', [event.id]);
  if (duplicate.length > 0) {
    return { processed: false, reason: 'duplicate', eventId: event.id, type: event.type };
  }

  await query(
    'INSERT INTO stripe_events (event_id, event_type, payload) VALUES (?, ?, ?)',
    [event.id, event.type, JSON.stringify(event)]
  );

  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data.object;
    const userId = Number(session.metadata?.user_id || 0);
    const amountCents = Number(session.metadata?.credit_amount_cents || 0);

    if (userId > 0 && amountCents > 0) {
      await markWalletCredit({
        userId,
        amountCents,
        referenceId: `stripe:${session.id}`
      });

      await query(
        `UPDATE stripe_checkout_sessions
         SET status = 'completed', stripe_payment_intent_id = ?, completed_at = NOW()
         WHERE stripe_session_id = ?`,
        [session.payment_intent || null, session.id]
      );
    }
  }

  if (event.type === 'checkout.session.async_payment_failed') {
    const session = event.data.object;
    await query(
      `UPDATE stripe_checkout_sessions
       SET status = 'failed'
       WHERE stripe_session_id = ?`,
      [session.id]
    );
  }

  await query('UPDATE stripe_events SET processed_at = NOW() WHERE event_id = ?', [event.id]);
  return { processed: true, eventId: event.id, type: event.type };
};

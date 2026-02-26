import { config } from './config.js';
import { query, withTransaction } from './db.js';
import { sendViaEuroSms } from './eurosms.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const priceCents = Number(process.env.SMS_PRICE_CENTS || 5);

export const getUserBalanceCents = async (userId) => {
  const rows = await query(
    `SELECT
      COALESCE(SUM(CASE WHEN type='credit' THEN amount_cents ELSE 0 END), 0)
      - COALESCE(SUM(CASE WHEN type='debit' THEN amount_cents ELSE 0 END), 0) AS balance
     FROM wallet_transactions
     WHERE user_id = ?`,
    [userId]
  );
  return Number(rows[0]?.balance || 0);
};

export const processQueuedSms = async (limit = 10) => {
  const queued = await query(
    `SELECT id, user_id, recipient, sender, body, attempts
     FROM sms_messages
     WHERE status IN ('queued', 'failed') AND attempts < ?
     ORDER BY queued_at ASC
     LIMIT ?`,
    [config.worker.maxAttempts, limit]
  );

  const results = [];

  for (const row of queued) {
    const balance = await getUserBalanceCents(row.user_id);
    if (balance < priceCents) {
      await query(
        `UPDATE sms_messages SET status='failed', failed_at=NOW(), error_message='Insufficient credit' WHERE id=?`,
        [row.id]
      );
      results.push({ id: row.id, status: 'failed', reason: 'insufficient_credit' });
      continue;
    }

    await query("UPDATE sms_messages SET status = 'sending', attempts = attempts + 1 WHERE id = ?", [row.id]);

    try {
      const provider = await sendViaEuroSms({ recipient: row.recipient, sender: row.sender, body: row.body });

      if (provider.ok) {
        await withTransaction(async (conn) => {
          await conn.execute(
            `UPDATE sms_messages
             SET status='sent', sent_at=NOW(), provider_message_id=?, provider_response=?, price_cents=?
             WHERE id=?`,
            [provider.providerMessageId, JSON.stringify(provider.payload), priceCents, row.id]
          );

          await conn.execute(
            `INSERT INTO wallet_transactions (user_id, type, amount_cents, currency, source, reference_id, note)
             VALUES (?, 'debit', ?, 'EUR', 'sms_send', ?, 'SMS send cost')`,
            [row.user_id, priceCents, `sms:${row.id}`]
          );
        });
        results.push({ id: row.id, status: 'sent' });
      } else {
        const attempts = Number(row.attempts || 0) + 1;
        if (attempts < config.worker.maxAttempts) {
          const backoffMs = attempts * 5000;
          await sleep(backoffMs);
          await query("UPDATE sms_messages SET status='queued', error_message=? WHERE id=?", [`EuroSMS HTTP ${provider.status}`, row.id]);
          results.push({ id: row.id, status: 'requeued' });
        } else {
          await query(
            `UPDATE sms_messages SET status='failed', failed_at=NOW(), error_message=?, provider_response=? WHERE id=?`,
            [`EuroSMS HTTP ${provider.status}`, JSON.stringify(provider.payload), row.id]
          );
          results.push({ id: row.id, status: 'failed' });
        }
      }
    } catch (error) {
      await query(
        `UPDATE sms_messages SET status='failed', failed_at=NOW(), error_message=? WHERE id=?`,
        [String(error.message || error), row.id]
      );
      results.push({ id: row.id, status: 'failed' });
    }
  }

  return results;
};

export const startWorkerLoop = () => {
  const timer = setInterval(async () => {
    try {
      await processQueuedSms(20);
    } catch (error) {
      console.error('Worker loop error:', error.message);
    }
  }, config.worker.intervalMs);

  return () => clearInterval(timer);
};

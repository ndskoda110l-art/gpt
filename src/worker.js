import { query } from './db.js';
import { sendViaEuroSms } from './eurosms.js';

export const processQueuedSms = async (limit = 10) => {
  const queued = await query(
    `SELECT id, user_id, recipient, sender, body
     FROM sms_messages
     WHERE status = 'queued'
     ORDER BY queued_at ASC
     LIMIT ?`,
    [limit]
  );

  const results = [];

  for (const row of queued) {
    await query("UPDATE sms_messages SET status = 'sending', attempts = attempts + 1 WHERE id = ?", [row.id]);

    try {
      const provider = await sendViaEuroSms({
        recipient: row.recipient,
        sender: row.sender,
        body: row.body
      });

      if (provider.ok) {
        await query(
          `UPDATE sms_messages
           SET status = 'sent', sent_at = NOW(), provider_message_id = ?, provider_response = ?
           WHERE id = ?`,
          [provider.providerMessageId, JSON.stringify(provider.payload), row.id]
        );
        results.push({ id: row.id, status: 'sent' });
      } else {
        await query(
          `UPDATE sms_messages
           SET status = 'failed', failed_at = NOW(), error_message = ?, provider_response = ?
           WHERE id = ?`,
          [`EuroSMS HTTP ${provider.status}`, JSON.stringify(provider.payload), row.id]
        );
        results.push({ id: row.id, status: 'failed' });
      }
    } catch (error) {
      await query(
        `UPDATE sms_messages
         SET status = 'failed', failed_at = NOW(), error_message = ?
         WHERE id = ?`,
        [String(error.message || error), row.id]
      );
      results.push({ id: row.id, status: 'failed' });
    }
  }

  return results;
};

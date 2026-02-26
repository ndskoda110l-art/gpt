CREATE TABLE users (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NULL,
  stripe_customer_id VARCHAR(191) NULL UNIQUE,
  role ENUM('user', 'admin') NOT NULL DEFAULT 'user',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE api_keys (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  key_prefix VARCHAR(16) NOT NULL,
  key_hash VARCHAR(255) NOT NULL,
  label VARCHAR(100) NULL,
  last_used_at TIMESTAMP NULL,
  revoked_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_api_keys_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_api_keys_user_id (user_id),
  INDEX idx_api_keys_prefix (key_prefix)
);

CREATE TABLE wallet_transactions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  type ENUM('credit', 'debit') NOT NULL,
  amount_cents INT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'EUR',
  source ENUM('stripe', 'sms_send', 'manual') NOT NULL,
  reference_id VARCHAR(191) NULL,
  note VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_wallet_tx_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_wallet_user_created (user_id, created_at),
  INDEX idx_wallet_reference (reference_id)
);

CREATE TABLE stripe_events (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  event_id VARCHAR(191) NOT NULL UNIQUE,
  event_type VARCHAR(100) NOT NULL,
  payload JSON NOT NULL,
  processed_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_stripe_event_type (event_type)
);

CREATE TABLE sms_messages (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  api_key_id BIGINT UNSIGNED NULL,
  recipient VARCHAR(20) NOT NULL,
  sender VARCHAR(20) NULL,
  body TEXT NOT NULL,
  status ENUM('queued', 'sending', 'sent', 'failed', 'delivered', 'undelivered') NOT NULL DEFAULT 'queued',
  provider_name VARCHAR(50) NOT NULL DEFAULT 'eurosms',
  provider_message_id VARCHAR(191) NULL,
  provider_response JSON NULL,
  delivery_status VARCHAR(50) NULL,
  delivered_at TIMESTAMP NULL,
  price_cents INT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'EUR',
  error_code VARCHAR(50) NULL,
  error_message VARCHAR(255) NULL,
  attempts INT NOT NULL DEFAULT 0,
  queued_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TIMESTAMP NULL,
  failed_at TIMESTAMP NULL,
  CONSTRAINT fk_sms_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_sms_api_key FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE SET NULL,
  INDEX idx_sms_user_status (user_id, status),
  INDEX idx_sms_provider_id (provider_message_id),
  INDEX idx_sms_queued_status (status, queued_at),
  INDEX idx_sms_delivery_status (delivery_status)
);

CREATE TABLE sms_delivery_events (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  sms_message_id BIGINT UNSIGNED NULL,
  provider_message_id VARCHAR(191) NOT NULL,
  provider_status VARCHAR(50) NOT NULL,
  normalized_status ENUM('delivered', 'undelivered', 'unknown') NOT NULL DEFAULT 'unknown',
  payload JSON NOT NULL,
  received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_dlr_sms_message FOREIGN KEY (sms_message_id) REFERENCES sms_messages(id) ON DELETE SET NULL,
  INDEX idx_dlr_provider_message_id (provider_message_id),
  INDEX idx_dlr_received_at (received_at)
);


CREATE TABLE stripe_checkout_sessions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  stripe_session_id VARCHAR(191) NOT NULL UNIQUE,
  stripe_payment_intent_id VARCHAR(191) NULL,
  status ENUM('created', 'completed', 'expired', 'failed', 'refunded') NOT NULL DEFAULT 'created',
  amount_cents INT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'EUR',
  metadata JSON NULL,
  completed_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_stripe_checkout_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_stripe_checkout_user_created (user_id, created_at),
  INDEX idx_stripe_checkout_payment_intent (stripe_payment_intent_id)
);


CREATE TABLE daily_sms_stats (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  stat_date DATE NOT NULL,
  user_id BIGINT UNSIGNED NULL,
  total_sms INT NOT NULL DEFAULT 0,
  sent_sms INT NOT NULL DEFAULT 0,
  delivered_sms INT NOT NULL DEFAULT 0,
  failed_sms INT NOT NULL DEFAULT 0,
  undelivered_sms INT NOT NULL DEFAULT 0,
  total_cost_cents BIGINT NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL DEFAULT 'EUR',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_daily_stats_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_daily_stats_user_date (stat_date, user_id),
  INDEX idx_daily_stats_date (stat_date),
  INDEX idx_daily_stats_user_date (user_id, stat_date)
);

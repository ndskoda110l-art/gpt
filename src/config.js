import dotenv from 'dotenv';

dotenv.config();

const parseNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  appPort: parseNumber(process.env.APP_PORT, 3000),
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseNumber(process.env.DB_PORT, 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'sms_gateway'
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    priceId: process.env.STRIPE_PRICE_ID || '',
    successUrl: process.env.STRIPE_SUCCESS_URL || 'http://localhost:3000/billing/success',
    cancelUrl: process.env.STRIPE_CANCEL_URL || 'http://localhost:3000/billing/cancel'
  },
  eurosms: {
    apiUrl: process.env.EUROSMS_API_URL || '',
    apiKey: process.env.EUROSMS_API_KEY || '',
    sender: process.env.EUROSMS_SENDER || 'MyBrand'
  }
};

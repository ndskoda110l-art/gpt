import dotenv from 'dotenv';

dotenv.config();

const parsePort = (value, fallback) => {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 ? port : fallback;
};

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  appPort: parsePort(process.env.APP_PORT, 3000),
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: parsePort(process.env.DB_PORT, 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'sms_gateway'
  }
};

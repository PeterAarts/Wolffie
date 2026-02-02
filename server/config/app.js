// src/config/app.js
import dotenv from 'dotenv';
dotenv.config();

export const appConfig = {
  port: parseInt(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
};

export default appConfig;
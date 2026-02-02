// src/config/modbus.js
import dotenv from 'dotenv';
dotenv.config();

export const modbusConfig = {
  ip: process.env.ALPHA_ESS_IP || '192.168.1.158',
  port: parseInt(process.env.ALPHA_ESS_PORT) || 502,
  slaveId: parseInt(process.env.ALPHA_ESS_SLAVE_ID) || 85,
  timeout: 5000,
  retryAttempts: 5,
  retryDelay: 5000,
};

export const collectionConfig = {
  snapshotInterval: parseInt(process.env.SNAPSHOT_INTERVAL) || 10000,
  aggregationInterval: 60000, // 1 minute
  cleanupDays: parseInt(process.env.CLEANUP_DAYS) || 7,
};

export default {
  modbus: modbusConfig,
  collection: collectionConfig,
};
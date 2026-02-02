// Core database wrapper for auth services
// Provides promise-based access to the database pool

import mysql from 'mysql2';
import dotenv from 'dotenv';

dotenv.config();

// Create connection pool with promise wrapper
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'alpha_ess',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
}).promise(); // ← This is the key! .promise() wrapper

// Test connection on startup
pool.query('SELECT 1')
  .then(() => {
    console.log('✅ Database connected successfully');
  })
  .catch(err => {
    console.error('❌ Database connection failed:', err.message);
  });

export default {
  pool
};
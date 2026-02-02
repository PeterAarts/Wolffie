// src/utils/encryption.js
// Simple encryption utilities for sensitive settings

import crypto from 'crypto';

// Encryption configuration
const ALGORITHM = 'aes-256-cbc';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default-key-change-in-production-32chars!!'; // Must be 32 characters
const IV_LENGTH = 16;

/**
 * Encrypt a value
 * @param {string} text - Plain text to encrypt
 * @returns {string} - Encrypted text in format: iv:encryptedData
 */
export function encryptValue(text) {
  if (!text) return '';
  
  try {
    // Generate a random IV for each encryption
    const iv = crypto.randomBytes(IV_LENGTH);
    
    // Create cipher
    const cipher = crypto.createCipheriv(
      ALGORITHM,
      Buffer.from(ENCRYPTION_KEY.slice(0, 32)), // Ensure 32 bytes
      iv
    );
    
    // Encrypt the text
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    // Return IV + encrypted data (both in hex)
    return iv.toString('hex') + ':' + encrypted;
    
  } catch (error) {
    console.error('Encryption error:', error);
    throw new Error('Failed to encrypt value');
  }
}

/**
 * Decrypt a value
 * @param {string} encryptedText - Encrypted text in format: iv:encryptedData
 * @returns {string} - Decrypted plain text
 */
export function decryptValue(encryptedText) {
  if (!encryptedText) return '';
  
  try {
    // Split IV and encrypted data
    const parts = encryptedText.split(':');
    if (parts.length !== 2) {
      throw new Error('Invalid encrypted format');
    }
    
    const iv = Buffer.from(parts[0], 'hex');
    const encryptedData = parts[1];
    
    // Create decipher
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      Buffer.from(ENCRYPTION_KEY.slice(0, 32)), // Ensure 32 bytes
      iv
    );
    
    // Decrypt the data
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
    
  } catch (error) {
    console.error('Decryption error:', error);
    // Return empty string if decryption fails (corrupted data)
    return '';
  }
}

/**
 * Hash a value (one-way, for passwords)
 * @param {string} text - Text to hash
 * @returns {string} - SHA256 hash
 */
export function hashValue(text) {
  if (!text) return '';
  
  return crypto
    .createHash('sha256')
    .update(text)
    .digest('hex');
}

/**
 * Compare a plain text value with a hash
 * @param {string} plainText - Plain text to compare
 * @param {string} hash - Hash to compare against
 * @returns {boolean} - True if match
 */
export function compareHash(plainText, hash) {
  if (!plainText || !hash) return false;
  
  const plainHash = hashValue(plainText);
  return plainHash === hash;
}

// Default export for convenience
export default {
  encryptValue,
  decryptValue,
  hashValue,
  compareHash
};
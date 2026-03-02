// src/config/websocket-config.js
/**
 * Centralized WebSocket Configuration
 * Single source of truth for all WebSocket settings
 */

/**
 * Get WebSocket base URL from environment variable
 */
const getBaseUrl = () => {
  const wsPath = import.meta.env.VITE_WS_URL || '/ws';
  
  // If it's already an absolute ws:// or wss:// URL, use it directly
  if (wsPath.startsWith('ws://') || wsPath.startsWith('wss://')) {
    return wsPath.replace(/\/$/, '');
  }
  
  // Build from current browser location (works correctly behind Apache proxy)
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}${wsPath}`;
};
/**
 * WebSocket configuration object
 */
export const websocketConfig = {
  // Connection settings
  baseUrl: getBaseUrl(),
  path: '/ws/power-data',
  
  // Get full WebSocket URL
  get url() {
    return `${this.baseUrl}${this.path}`;
  },
  
  // Reconnection settings
  reconnectDelay: 3000,
  maxReconnectAttempts: 10,
  reconnectBackoffMultiplier: 1.5,
  
  // Heartbeat/ping settings
  heartbeatInterval: 30000,
  
  // Timeout settings
  connectionTimeout: 10000,
  
  // Logging
  enableDebugLogging: import.meta.env.DEV || false
};

// Log configuration in development
if (websocketConfig.enableDebugLogging) {
  console.log('🔧 WebSocket Configuration:');
  console.log('  URL:', websocketConfig.url);
  console.log('  Reconnect Delay:', websocketConfig.reconnectDelay);
  console.log('  Max Attempts:', websocketConfig.maxReconnectAttempts);
}

/**
 * Helper function to get config (useful for dynamic imports)
 */
export const getWebSocketConfig = () => websocketConfig;

export default websocketConfig;
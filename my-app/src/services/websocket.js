// src/services/websocket.js - FIXED TO EMIT ALL MESSAGES
import { useSystemStore } from '@/stores/system';
import websocketConfig from '@/config/websocket-config';

class WebSocketService {
  constructor() {
    this.ws = null;
    this.reconnectAttempts = 0;
    this.reconnectTimeout = null;
    this.isIntentionalClose = false;
    this.listeners = new Map();
    this.heartbeatInterval = null;
    
    // Use centralized config
    this.config = websocketConfig;
  }

  /**
   * Connect to WebSocket server
   * @param {string} url - Optional custom URL (defaults to config.url)
   */
  connect(url) {
    // Use centralized config URL if not provided
    const targetUrl = url || this.config.url;
    
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log('⚠️ WebSocket already connected');
      return;
    }

    if (this.config.enableDebugLogging) {
      console.log('🔌 Connecting to WebSocket:', targetUrl);
    }
    
    this.isIntentionalClose = false;

    try {
      this.ws = new WebSocket(targetUrl);
      this.setupEventHandlers();
    } catch (error) {
      console.error('❌ WebSocket connection error:', error);
      this.scheduleReconnect();
    }
  }

  setupEventHandlers() {
    this.ws.onopen = (event) => {
      console.log('✅ WebSocket connected');
      this.reconnectAttempts = 0;
      
      // Start heartbeat if configured
      if (this.config.heartbeatInterval > 0) {
        this.startHeartbeat();
      }
      
      this.emit('connected', event);
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleMessage(data);
      } catch (error) {
        console.error('❌ Error parsing WebSocket message:', error, event.data);
      }
    };

    this.ws.onerror = (error) => {
      console.error('❌ WebSocket error:', error);
      this.emit('error', error);
    };

    this.ws.onclose = (event) => {
      if (this.config.enableDebugLogging) {
        console.log('🔌 WebSocket closed:', event.code, event.reason);
      }
      
      // Stop heartbeat
      this.stopHeartbeat();
      
      this.emit('disconnected', event);

      if (!this.isIntentionalClose) {
        this.scheduleReconnect();
      }
    };
  }

  handleMessage(data) {
    if (this.config.enableDebugLogging) {
      console.log('📨 WebSocket message:', data.type);
    }

    // ✅ FIX: ALWAYS emit as 'message' first for realtime store
    this.emit('message', data);

    // Then handle specific types for backward compatibility
    switch (data.type) {
      case 'connection_status':
        this.handleConnectionStatus(data);
        break;
      
      case 'power_update':
        // Also emit as 'powerUpdate' for backward compatibility with old system store
        this.emit('powerUpdate', data.data);
        break;
      
      case 'summary_update':
        // Already emitted as 'message' above, no additional handling needed
        break;
      
      case 'modbus_connected':
        this.handleModbusConnected(data);
        break;
      
      case 'modbus_disconnected':
        this.handleModbusDisconnected(data);
        break;
      
      case 'pong':
        // Heartbeat response
        if (this.config.enableDebugLogging) {
          console.log('💓 Heartbeat received');
        }
        break;
      
      default:
        // Already emitted as 'message' above
        break;
    }
  }

  handleConnectionStatus(data) {
    if (this.config.enableDebugLogging) {
      console.log('📊 Connection status update:', data.connected);
    }
    this.emit('connectionStatus', data);
  }

  handleModbusConnected(data) {
    console.log('🔄 ModBus reconnected!');
    
    // Get system store and restart auto-refresh
    try {
      const systemStore = useSystemStore();
      if (systemStore.handleConnectionRestored) {
        systemStore.handleConnectionRestored();
      }
    } catch (error) {
      console.warn('System store not available:', error);
    }
    
    this.emit('modbusConnected', data);
  }

  handleModbusDisconnected(data) {
    console.log('⚠️ ModBus disconnected!');
    
    // Get system store and stop auto-refresh
    try {
      const systemStore = useSystemStore();
      if (systemStore.handleConnectionLost) {
        systemStore.handleConnectionLost();
      }
    } catch (error) {
      console.warn('System store not available:', error);
    }
    
    this.emit('modbusDisconnected', data);
  }

  scheduleReconnect() {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.error('❌ Max reconnection attempts reached');
      this.emit('maxReconnectAttemptsReached');
      return;
    }

    this.reconnectAttempts++;
    
    // Use exponential backoff from config
    const baseDelay = this.config.reconnectDelay;
    const multiplier = Math.pow(this.config.reconnectBackoffMultiplier, this.reconnectAttempts - 1);
    const delay = Math.min(baseDelay * multiplier, 30000); // Cap at 30 seconds
    
    console.log(`🔄 Scheduling reconnect attempt ${this.reconnectAttempts}/${this.config.maxReconnectAttempts} in ${Math.round(delay)}ms`);

    this.reconnectTimeout = setTimeout(() => {
      console.log('🔄 Attempting to reconnect...');
      this.connect(); // Will use config.url
    }, delay);
  }

  startHeartbeat() {
    this.stopHeartbeat(); // Clear any existing heartbeat
    
    this.heartbeatInterval = setInterval(() => {
      if (this.isConnected) {
        if (this.config.enableDebugLogging) {
          console.log('💓 Sending heartbeat...');
        }
        this.send({ type: 'ping' });
      }
    }, this.config.heartbeatInterval);
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else {
      console.warn('⚠️ Cannot send message - WebSocket not connected');
    }
  }

  disconnect() {
    console.log('🛑 Intentionally closing WebSocket');
    this.isIntentionalClose = true;

    // Clear reconnect timeout
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    // Stop heartbeat
    this.stopHeartbeat();

    // Close connection
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.reconnectAttempts = 0;
  }

  // Event listener management
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  off(event, callback) {
    if (!this.listeners.has(event)) return;
    
    const callbacks = this.listeners.get(event);
    const index = callbacks.indexOf(callback);
    if (index > -1) {
      callbacks.splice(index, 1);
    }
  }

  emit(event, data) {
    if (!this.listeners.has(event)) return;
    
    this.listeners.get(event).forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error(`Error in ${event} listener:`, error);
      }
    });
  }

  // Getters
  get isConnected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  get readyState() {
    return this.ws ? this.ws.readyState : WebSocket.CLOSED;
  }

  get connectionUrl() {
    return this.config.url;
  }
}

// Export singleton instance
export default new WebSocketService();
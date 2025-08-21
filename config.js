// config.js - Smart environment detection and configuration
class EnvironmentConfig {
  constructor() {
    this.environment = this.detectEnvironment()
    this.config = this.getConfig()
    console.log(`🌍 Environment detected: ${this.environment}`)
  }

  detectEnvironment() {
    // Check if we're in a Chrome extension context
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      // Extension environment - detect based on build or runtime
      if (chrome.runtime.getManifest().version.includes('dev') || 
          localStorage.getItem('bloomix_env') === 'development') {
        return 'development'
      }
      if (localStorage.getItem('bloomix_env') === 'production') {
        return 'production'
      }
      // Default to development for extension
      return 'development'
    }
    
    // Web environment - detect based on hostname
    const hostname = window.location.hostname
    
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'local'
    }
    
    if (hostname.includes('test') || hostname.includes('dev') || 
        hostname === 'bloomix3.netlify.app' ||
        hostname === 'bloomix-frontend-test.onrender.com') {
      return 'development'
    }
    
    if (hostname === 'bloomix.netlify.app' || 
        hostname === 'bloomix-api.onrender.com') {
      return 'production'
    }
    
    // Default fallback
    return 'development'
  }

  getConfig() {
    const configs = {
      local: {
        MAIN_URL: 'http://localhost:5000/v1',
        frontend_URL: 'http://localhost:5173',
        socket_URL: 'http://localhost:5000',
        websocket_URL: 'ws://localhost:5000'
      },
      development: {
        MAIN_URL: 'https://bloomix-frontend-test.onrender.com/v1',
        frontend_URL: 'https://bloomix3.netlify.app',
        socket_URL: 'https://bloomix-frontend-test.onrender.com',
        websocket_URL: 'wss://bloomix-frontend-test.onrender.com'
      },
      production: {
        MAIN_URL: 'https://bloomix-api.onrender.com/v1',
        frontend_URL: 'https://bloomix.netlify.app',
        socket_URL: 'https://bloomix-api.onrender.com',
        websocket_URL: 'wss://bloomix-api.onrender.com'
      }
    }

    return configs[this.environment]
  }

  // Get current environment name
  getEnvironment() {
    return this.environment
  }

  // Get specific config value
  get(key) {
    return this.config[key]
  }

  // Get all config
  getAll() {
    return { ...this.config, environment: this.environment }
  }

  // Method to manually override environment (useful for testing)
  setEnvironment(env) {
    if (['local', 'development', 'production'].includes(env)) {
      this.environment = env
      this.config = this.getConfig()
      
      // Store in localStorage for persistence
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('bloomix_env', env)
      }
      
      console.log(`🔄 Environment changed to: ${env}`)
      return true
    }
    return false
  }

  // Method to get socket.io instance with correct URL
  getSocketIO() {
    if (typeof io !== 'undefined') {
      return io(this.config.socket_URL)
    }
    console.warn('⚠️ Socket.io not loaded')
    return null
  }

  // Method to validate current configuration
  validate() {
    const required = ['MAIN_URL', 'frontend_URL', 'socket_URL']
    const missing = required.filter(key => !this.config[key])
    
    if (missing.length > 0) {
      console.error(`❌ Missing config values: ${missing.join(', ')}`)
      return false
    }
    
    console.log(`✅ Configuration valid for ${this.environment}`)
    return true
  }

  // Method to test connectivity
  async testConnectivity() {
    const results = {
      environment: this.environment,
      main_api: false,
      frontend: false,
      socket: false
    }

    try {
      // Test main API
      const apiResponse = await fetch(`${this.config.MAIN_URL}/health`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      })
      results.main_api = apiResponse.ok
    } catch (error) {
      console.warn(`⚠️ Main API test failed: ${error.message}`)
    }

    try {
      // Test frontend (HEAD request to avoid CORS issues)
      const frontendResponse = await fetch(this.config.frontend_URL, {
        method: 'HEAD',
        mode: 'no-cors'
      })
      results.frontend = true // no-cors mode doesn't give us status
    } catch (error) {
      console.warn(`⚠️ Frontend test failed: ${error.message}`)
    }

    try {
      // Test socket connection
      if (typeof io !== 'undefined') {
        const testSocket = io(this.config.socket_URL, { timeout: 5000 })
        results.socket = await new Promise((resolve) => {
          testSocket.on('connect', () => {
            testSocket.disconnect()
            resolve(true)
          })
          testSocket.on('connect_error', () => {
            resolve(false)
          })
          setTimeout(() => resolve(false), 5000)
        })
      }
    } catch (error) {
      console.warn(`⚠️ Socket test failed: ${error.message}`)
    }

    console.log(`🧪 Connectivity test results:`, results)
    return results
  }
}

// Create global instance
const envConfig = new EnvironmentConfig()

// Export for different module systems
if (typeof module !== 'undefined' && module.exports) {
  // Node.js/CommonJS
  module.exports = envConfig
} else if (typeof window !== 'undefined') {
  // Browser global
  window.envConfig = envConfig
}

// Named exports for ES6 modules
export const MAIN_URL = envConfig.get('MAIN_URL')
export const frontend_URL = envConfig.get('frontend_URL') 
export const socket_URL = envConfig.get('socket_URL')
export const websocket_URL = envConfig.get('websocket_URL')
export const environment = envConfig.getEnvironment()

// Socket.io instance
export const socket = envConfig.getSocketIO()

// Export the config instance itself
export default envConfig

// Auto-validate configuration on load
envConfig.validate()

console.log(`🚀 Bloomix Environment Config loaded:`, envConfig.getAll())
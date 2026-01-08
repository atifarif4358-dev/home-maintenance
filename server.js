/**
 * Server Entry Point
 * Home Maintenance Voice Agent
 */

import { createApp } from './src/app.js';
import { config, validateConfig } from './src/config/env.js';
import { testConnection } from './src/services/database.service.js';
import { testEmailConfiguration } from './src/services/email.service.js';
import { logger } from './src/utils/logger.js';

const PREFIX = 'Server';

/**
 * Start the server
 */
async function startServer() {
  // Validate configuration
  if (!validateConfig()) {
    logger.error(PREFIX, 'Invalid configuration. Please check your .env file.');
    process.exit(1);
  }

  // Create Express app
  const app = createApp();

  // Start server
  const server = app.listen(config.port, async () => {
    console.log('═══════════════════════════════════════════════════════');
    console.log('  Home Maintenance Voice Agent Server');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`  🚀 Server running on port ${config.port}`);
    console.log(`  🔌 WebSocket: ws://localhost:${config.port}/llm-websocket/:call_id`);
    console.log(`  📞 Callback API: http://localhost:${config.port}/request-callback`);
    console.log('═══════════════════════════════════════════════════════');
    
    // Test database connection
    await testConnection();
    
    // Test email configuration
    await testEmailConfiguration();
    
    console.log('═══════════════════════════════════════════════════════\n');
    logger.success(PREFIX, 'Server is ready to handle requests');
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    logger.log(PREFIX, 'SIGTERM signal received: closing HTTP server');
    server.close(() => {
      logger.log(PREFIX, 'HTTP server closed');
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    logger.log(PREFIX, 'SIGINT signal received: closing HTTP server');
    server.close(() => {
      logger.log(PREFIX, 'HTTP server closed');
      process.exit(0);
    });
  });
}

// Start the server
startServer().catch(error => {
  logger.error(PREFIX, 'Failed to start server:', error);
  process.exit(1);
});

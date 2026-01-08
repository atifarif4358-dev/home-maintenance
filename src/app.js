/**
 * Express App Configuration
 * Sets up Express server with middleware and routes
 */

import express from 'express';
import expressWs from 'express-ws';
import apiRoutes, { setupWebSocketRoutes } from './routes/api.routes.js';
import ragRoutes from './routes/rag.routes.js';

/**
 * Create and configure Express app
 * @returns {Express} - Configured Express app
 */
export function createApp() {
  const app = express();
  
  // Enable WebSocket support
  expressWs(app);
  
  // Middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  
  // Setup routes
  app.use('/', apiRoutes);
  app.use('/rag', ragRoutes);
  setupWebSocketRoutes(app);
  
  return app;
}


/**
 * Express App Configuration
 * Sets up Express server with middleware and routes
 */

import express from 'express';
import expressWs from 'express-ws';
import path from 'path';
import { fileURLToPath } from 'url';
import apiRoutes, { setupWebSocketRoutes } from './routes/api.routes.js';
import ragRoutes from './routes/rag.routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

  // Serve static files from the root directory (for rag-upload.html, etc.)
  app.use(express.static(path.join(__dirname, '..')));

  // Setup routes
  app.use('/', apiRoutes);
  app.use('/rag', ragRoutes);
  setupWebSocketRoutes(app);

  return app;
}


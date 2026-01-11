/**
 * API Routes
 * Defines all HTTP and WebSocket routes
 */

import express from 'express';
import { createPhoneCall } from '../services/retell.service.js';
import { handleWebSocketConnection } from '../controllers/call.controller.js';
import { logger } from '../utils/logger.js';

const router = express.Router();
const PREFIX = 'API';

/**
 * POST /request-callback
 * Initiates an outbound callback to the user
 */
router.post('/request-callback', async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    
    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'Phone number is required'
      });
    }
    
    logger.log(PREFIX, `Callback requested for: ${phoneNumber}`);
    
    // Create phone call via Retell
    const call = await createPhoneCall(phoneNumber);
    
    res.json({
      success: true,
      callId: call.call_id,
      message: 'Callback initiated successfully'
    });
    
  } catch (error) {
    logger.error(PREFIX, 'Error initiating callback:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /health
 * Health check endpoint
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'Home Maintenance Voice Agent',
    timestamp: new Date().toISOString()
  });
});

/**
 * GET /
 * Root endpoint with service information
 */
router.get('/', (req, res) => {
  res.json({
    service: 'Home Maintenance Voice Agent',
    version: '1.0.0',
    endpoints: {
      websocket: '/llm-websocket/:call_id',
      callback: 'POST /request-callback',
      health: '/health'
    }
  });
});

/**
 * Setup WebSocket route
 * @param {Express} app - Express app with WebSocket support
 */
export function setupWebSocketRoutes(app) {
  app.ws('/llm-websocket/:call_id', (ws, req) => {
    const callId = req.params.call_id;
    handleWebSocketConnection(ws, callId);
  });
}

export default router;







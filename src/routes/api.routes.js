/**
 * API Routes
 * Defines all HTTP and WebSocket routes
 */

import express from 'express';
import { createPhoneCall } from '../services/retell.service.js';
import { saveCallHistory } from '../services/database.service.js';
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
 * POST /webhook/call-analyzed
 * Webhook endpoint for Retell's call_analyzed event
 * Saves call transcript to Supabase for callback continuity
 * Sends call summary email with AI summary and recording
 */
router.post('/webhook/call-analyzed', async (req, res) => {
  try {
    const { event, call } = req.body;
    
    logger.log(PREFIX, `📥 Webhook received: ${event}`);
    logger.log(PREFIX, `Payload: ${JSON.stringify(req.body)}`);
    // Only process call_analyzed events
    if (event !== 'call_analyzed') {
      logger.log(PREFIX, `Ignoring event: ${event}`);
      return res.status(200).json({ received: true });
    }
    
    if (!call || !call.call_id) {
      logger.warn(PREFIX, 'Webhook missing call data');
      return res.status(400).json({ error: 'Missing call data' });
    }
    
    logger.log(PREFIX, `Processing call_analyzed for call: ${call.call_id}`);
    logger.log(PREFIX, `  From: ${call.from_number}`);
    logger.log(PREFIX, `  Duration: ${call.call_duration_ms ? Math.round(call.call_duration_ms / 1000) + 's' : 'N/A'}`);
    logger.log(PREFIX, `  Recording: ${call.recording_url ? '✓ Available' : '✗ Not available'}`);
    logger.log(PREFIX, `  AI Summary: ${call.call_analysis?.call_summary ? '✓ Available' : '✗ Not available'}`);
    
    // Save call history to Supabase
    const saved = await saveCallHistory({
      call_id: call.call_id,
      from_number: call.from_number,
      to_number: call.to_number,
      transcript: call.transcript,
      call_duration_ms: call.call_duration_ms,
      call_status: call.call_status,
      recording_url: call.recording_url,
      call_summary: call.call_analysis?.call_summary || null
    });
    
    if (saved) {
      logger.success(PREFIX, `✅ Call history saved for callback continuity`);
    } else {
      logger.warn(PREFIX, `⚠️ Failed to save call history`);
    }
    
    // Send call summary email with AI summary and recording
    try {
      const { sendCallSummaryFromWebhook } = await import('../services/email.service.js');
      
      // Calculate duration from timestamps if call_duration_ms is not available
      let durationSec = 0;
      if (call.call_duration_ms) {
        durationSec = Math.round(call.call_duration_ms / 1000);
      } else if (call.end_timestamp && call.start_timestamp) {
        // Calculate from timestamps (they might be in milliseconds or ISO strings)
        const endTime = typeof call.end_timestamp === 'number' ? call.end_timestamp : new Date(call.end_timestamp).getTime();
        const startTime = typeof call.start_timestamp === 'number' ? call.start_timestamp : new Date(call.start_timestamp).getTime();
        durationSec = Math.round((endTime - startTime) / 1000);
      }
      
      // Log duration for debugging
      logger.log(PREFIX, `  Duration calculated: ${durationSec}s (from call_duration_ms: ${call.call_duration_ms}, timestamps: ${call.start_timestamp} - ${call.end_timestamp})`);
      
      const durationStr = durationSec > 0 ? `${Math.floor(durationSec / 60)}m ${durationSec % 60}s` : 'N/A';
      
      await sendCallSummaryFromWebhook({
        callId: call.call_id,
        phoneNumber: call.from_number,
        transcript: call.transcript,
        duration: durationStr,
        recordingUrl: call.recording_url,
        aiSummary: call.call_analysis?.call_summary || null,
        userSentiment: call.call_analysis?.user_sentiment || null,
      });
      
      logger.success(PREFIX, `📧 Call summary email sent with AI summary and recording`);
    } catch (emailError) {
      logger.error(PREFIX, 'Failed to send call summary email:', emailError);
    }
    
    res.status(200).json({ received: true, saved });
    
  } catch (error) {
    logger.error(PREFIX, 'Webhook error:', error);
    res.status(500).json({ error: error.message });
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







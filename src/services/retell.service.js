/**
 * Retell Service
 * Handles Retell AI API operations
 */

import { Retell } from 'retell-sdk';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

const PREFIX = 'Retell';

// Initialize Retell client
export const retellClient = new Retell({
  apiKey: config.retell.apiKey
});

// console.log(
//   "[Retell Debug] call methods:",
//   Object.keys(retellClient.call || {})
// );
/**
 * Get call details from Retell API
 * @param {string} callId - Call ID from Retell
 * @returns {Promise<Object>} - Call details including from_number, to_number, etc.
 */
export async function getCallDetails(callId) {
  try {
    logger.log(PREFIX, `Fetching call details for: ${callId}`);
    
    const callDetails = await retellClient.call.retrieve(callId);
    
    if (callDetails.from_number) {
      logger.success(PREFIX, `✓ Call details retrieved - Caller: ${callDetails.from_number}`);
    } else {
      logger.warn(PREFIX, 'Call details retrieved but no from_number found');
    }
    
    return callDetails;
    
  } catch (error) {
    logger.error(PREFIX, 'Error fetching call details:', error);
    throw error;
  }
}

/**
 * Create an outbound phone call
 * @param {string} toNumber - Phone number to call
 * @returns {Promise<Object>} - Call details
 */
export async function createPhoneCall(toNumber) {
  try {
    logger.log(PREFIX, `Initiating call to: ${toNumber}`);
    
    const call = await retellClient.call.createPhoneCall({
      from_number: config.retell.phoneNumber,
      to_number: toNumber,
      override_agent_id: config.retell.agentId,
    });
    
    logger.success(PREFIX, `Call initiated. Call ID: ${call.call_id}`);
    return call;
    
  } catch (error) {
    logger.error(PREFIX, 'Error creating phone call:', error);
    throw error;
  }
}

/**
 * Send response to Retell via WebSocket
 * @param {WebSocket} ws - WebSocket connection
 * @param {string} content - Response content
 * @param {number} responseId - Response ID from Retell
 * @param {boolean} endCall - Whether to end the call
 */
export function sendResponse(ws, content, responseId = 0, endCall = false) {
  const response = {
    response_type: 'response',
    response_id: responseId,
    content: content,
    content_complete: true,
    end_call: endCall
  };
  
  ws.send(JSON.stringify(response));
  logger.debug(PREFIX, `Sent response: "${content.substring(0, 50)}..."`);
}

/**
 * Send error response to Retell
 * @param {WebSocket} ws - WebSocket connection
 * @param {number} responseId - Response ID from Retell
 */
export function sendErrorResponse(ws, responseId = 0) {
  try {
    const errorResponse = {
      response_type: 'response',
      response_id: responseId,
      content: "I'm sorry, I encountered a technical issue. Could you please repeat that?",
      content_complete: true,
      end_call: false
    };
    
    ws.send(JSON.stringify(errorResponse));
    logger.warn(PREFIX, 'Sent error response to caller');
  } catch (error) {
    logger.error(PREFIX, 'Failed to send error response:', error);
  }
}

/**
 * Direct call transfer (works without Retell LLM tools)
 * Sends a response with transfer_number field to initiate transfer
 * @param {WebSocket} ws - WebSocket connection
 * @param {number} responseId - Response ID from Retell
 * @param {string} phoneNumber - Phone number to transfer to (E.164 format)
 * @param {string} message - Optional message to say before transfer
 * @returns {void}
 */
export function sendDirectTransfer(ws, responseId, phoneNumber, message = null) {
  try {
    // Check if WebSocket is open
    if (!ws || ws.readyState !== 1) {
      logger.error(PREFIX, `❌ WebSocket not open! ReadyState: ${ws?.readyState || 'undefined'}`);
      throw new Error('WebSocket not open');
    }
    
    logger.log(PREFIX, `✓ WebSocket is OPEN (readyState: ${ws.readyState})`);
    
    // 1. Validate E.164
    if (!validateE164(phoneNumber)) {
      logger.warn(PREFIX, `Phone number not in E.164 format: ${phoneNumber}, formatting...`);
      phoneNumber = formatToE164(phoneNumber);
    }
    logger.log(PREFIX, `✓ Phone number validated: ${phoneNumber}`);

    const defaultMessage = "I'm transferring you to our emergency support team now. Please stay on the line.";
    const finalMessage = message || defaultMessage;

    // 2. Send the Response with transfer_number
    // This tells Retell: "Say this text, then transfer to this number"
    const transferResponse = {
      response_type: 'response',
      response_id: responseId,
      content: finalMessage,
      content_complete: true,
      end_call: false, // Must be false so Retell can handle the transfer logic
      transfer_number: phoneNumber // <--- This is the key field for Custom LLM
    };
    
    logger.log(PREFIX, `📤 Sending transfer payload:`, JSON.stringify(transferResponse, null, 2));
    
    ws.send(JSON.stringify(transferResponse));
    
    logger.success(PREFIX, `✅ Transfer command sent successfully! Destination: ${phoneNumber}`);
    
  } catch (error) {
    logger.error(PREFIX, 'Failed to send direct transfer:', error);
    throw error;
  }
}

/**
 * Validate E.164 phone number format
 * @param {string} phoneNumber - Phone number to validate
 * @returns {boolean} - True if valid E.164 format
 */
export function validateE164(phoneNumber) {
  const e164Regex = /^\+[1-9]\d{1,14}$/;
  return e164Regex.test(phoneNumber);
}

/**
 * Format phone number to E.164
 * @param {string} phoneNumber - Phone number to format
 * @returns {string} - E.164 formatted number
 */
export function formatToE164(phoneNumber) {
  // Remove all non-digit characters
  const digits = phoneNumber.replace(/\D/g, '');
  
  // If it doesn't start with country code, assume US (+1)
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  
  // If it starts with 1 and has 11 digits, add +
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }
  
  // Already has country code
  if (phoneNumber.startsWith('+')) {
    return phoneNumber;
  }
  
  // Default: add +1
  return `+1${digits}`;
}


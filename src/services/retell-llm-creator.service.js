/**
 * Retell LLM Creator Service
 * Create and manage Retell LLM configurations via API
 * 
 * WARNING: Using Retell LLM means you LOSE:
 * - LangGraph control
 * - Custom video frame tools
 * - Custom RAG implementation
 * - Full conversation state management
 * 
 * This is NOT recommended for this project!
 */

import Retell from 'retell-sdk';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

const PREFIX = 'RetellLLM';

// Initialize Retell client
const retellClient = new Retell({
  apiKey: config.retell.apiKey,
});

/**
 * Create a Retell LLM with transfer capabilities
 * @returns {Promise<Object>} - Created LLM details
 */
export async function createRetellLLM() {
  try {
    logger.log(PREFIX, 'Creating Retell LLM with transfer tool...');
    
    const llmConfig = {
      // Model configuration
      model: 'gpt-4.1',
      model_temperature: 0.7,
      
      // Conversation start
      start_speaker: 'agent',
      begin_message: 'Hello! I am your home maintenance assistant. How can I help you today?',
      
      // General prompt
      general_prompt: `You are a helpful home maintenance support agent. 
Your role is to:
1. Listen to the user's home maintenance issues
2. Provide helpful troubleshooting advice
3. If it's a life-threatening emergency (fire, gas leak, severe injury), transfer the call immediately

EMERGENCY PROTOCOL:
If the user reports a fire, gas leak, severe injury, or any life-threatening situation:
1. Acknowledge the emergency
2. Use the transfer_to_emergency tool IMMEDIATELY
3. Do NOT provide troubleshooting advice for emergencies`,

      // General tools (including transfer)
      general_tools: [
        {
          type: 'end_call',
          name: 'end_call',
          description: 'End the call when the conversation is complete.'
        },
        {
          type: 'transfer_call',
          name: 'transfer_to_emergency',
          description: 'Transfer the call to emergency support team when there is a life-threatening emergency (fire, gas leak, severe injury, or when user cannot call 911).',
          transfer_destination: {
            type: 'predefined',
            number: config.emergency.phoneNumber || '+12125551234', // E.164 format
            ignore_e164_validation: false
          },
          transfer_option: {
            type: 'cold_transfer',
            show_transferee_as_caller: false
          }
        }
      ]
    };
    
    const llmResponse = await retellClient.llm.create(llmConfig);
    
    logger.success(PREFIX, `Retell LLM created with ID: ${llmResponse.llm_id}`);
    logger.info(PREFIX, `Transfer tool configured for: ${config.emergency.phoneNumber}`);
    
    return llmResponse;
    
  } catch (error) {
    logger.error(PREFIX, 'Failed to create Retell LLM:', error);
    throw error;
  }
}

/**
 * Update existing Retell LLM
 * @param {string} llmId - LLM ID to update
 * @returns {Promise<Object>} - Updated LLM details
 */
export async function updateRetellLLM(llmId) {
  try {
    logger.log(PREFIX, `Updating Retell LLM: ${llmId}`);
    
    const updateConfig = {
      general_tools: [
        {
          type: 'end_call',
          name: 'end_call',
          description: 'End the call when the conversation is complete.'
        },
        {
          type: 'transfer_call',
          name: 'transfer_to_emergency',
          description: 'Transfer the call to emergency support team.',
          transfer_destination: {
            type: 'predefined',
            number: config.emergency.phoneNumber,
            ignore_e164_validation: false
          },
          transfer_option: {
            type: 'cold_transfer',
            show_transferee_as_caller: false
          }
        }
      ]
    };
    
    const llmResponse = await retellClient.llm.update(llmId, updateConfig);
    
    logger.success(PREFIX, `Retell LLM updated: ${llmId}`);
    return llmResponse;
    
  } catch (error) {
    logger.error(PREFIX, 'Failed to update Retell LLM:', error);
    throw error;
  }
}

/**
 * List all Retell LLMs
 * @returns {Promise<Array>} - List of LLMs
 */
export async function listRetellLLMs() {
  try {
    const llms = await retellClient.llm.list();
    logger.log(PREFIX, `Found ${llms.length} Retell LLMs`);
    return llms;
  } catch (error) {
    logger.error(PREFIX, 'Failed to list Retell LLMs:', error);
    throw error;
  }
}

/**
 * Get Retell LLM by ID
 * @param {string} llmId - LLM ID
 * @returns {Promise<Object>} - LLM details
 */
export async function getRetellLLM(llmId) {
  try {
    const llm = await retellClient.llm.retrieve(llmId);
    logger.log(PREFIX, `Retrieved Retell LLM: ${llmId}`);
    return llm;
  } catch (error) {
    logger.error(PREFIX, 'Failed to get Retell LLM:', error);
    throw error;
  }
}

/**
 * Delete Retell LLM
 * @param {string} llmId - LLM ID to delete
 */
export async function deleteRetellLLM(llmId) {
  try {
    await retellClient.llm.delete(llmId);
    logger.success(PREFIX, `Deleted Retell LLM: ${llmId}`);
  } catch (error) {
    logger.error(PREFIX, 'Failed to delete Retell LLM:', error);
    throw error;
  }
}



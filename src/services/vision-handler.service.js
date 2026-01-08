/**
 * Vision Handler Service
 * Formats video frames for OpenAI Vision API
 */

import { HumanMessage } from '@langchain/core/messages';
import { logger } from '../utils/logger.js';

const PREFIX = 'Vision';

/**
 * Create a vision message with frames for OpenAI
 * @param {Array} frames - Array of frame objects with URLs
 * @param {string} context - Context text to accompany the frames
 * @returns {HumanMessage} - Formatted message for OpenAI Vision
 */
export function createVisionMessage(frames, context = '') {
  logger.log(PREFIX, `Creating vision message with ${frames.length} frame(s)`);
  
  // Build content array with text + images
  const content = [];
  
  // Add context text if provided
  if (context) {
    content.push({
      type: 'text',
      text: context
    });
  }
  
  // Add each frame as an image_url
  frames.forEach(frame => {

    if (!frame?.url) return;

    // Add timestamp context
    content.push({
      type: 'text',
      text: `Frame at ${frame.timestamp} seconds`
    });

    content.push({
      type: 'image_url',
      image_url: {
        url: frame.url,
        // detail: 'high' // Use 'high' for detailed analysis, 'low' for faster processing
        detail: 'auto'
      }
    });
  });
  
  logger.success(PREFIX, `Vision message created with ${frames.length} image(s)`);
  console.log(`Vision Message Content: ${JSON.stringify(content, null, 2)}`);
  return new HumanMessage({ content });
}

/**
 * Format tool result with frames into vision-compatible message
 * @param {string} toolResult - JSON string from fetch_video_frames tool
 * @returns {Object|null} - Formatted frames or null
 */
export function parseFramesFromToolResult(toolResult) {
  try {
    const result = JSON.parse(toolResult);
    
    if (result.success && result.frames && result.frames.length > 0) {
      logger.log(PREFIX, `Parsed ${result.frames.length} frame(s) from tool result`);
      return result.frames;
    }
    
    return null;
  } catch (error) {
    logger.error(PREFIX, 'Error parsing tool result:', error);
    return null;
  }
}

/**
 * Check if a message contains vision content (images)
 * @param {Object} message - LangChain message
 * @returns {boolean}
 */
export function hasVisionContent(message) {
  if (Array.isArray(message.content)) {
    return message.content.some(item => item.type === 'image_url');
  }
  return false;
}




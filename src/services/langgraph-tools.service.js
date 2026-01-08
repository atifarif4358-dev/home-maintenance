/**
 * LangGraph Tools Service
 * Defines tools for the AI agent to use
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { fetchFramesByTranscriptId, getAvailableFrameTimestamps } from './database.service.js';
import { logger } from '../utils/logger.js';

const PREFIX = 'Tools';

/**
 * Tool: Fetch Video Frames
 * Allows the agent to request specific video frames by timestamp
 */
export const fetchVideoFramesTool = tool(
  async ({ timestamps }) => {
    try {
      logger.log(PREFIX, `Agent requesting frames at timestamps: ${timestamps.join(', ')}`);
      
      // Get transcript ID from the current context (will be bound when tool is created)
      const transcriptId = fetchVideoFramesTool.transcriptId;
      
      if (!transcriptId) {
        logger.error(PREFIX, 'No transcript ID available for frame fetching');
        return JSON.stringify({ error: 'No video associated with this call' });
      }
      
      // Fetch frames from database
      const frames = await fetchFramesByTranscriptId(transcriptId, timestamps);
      
      if (!frames || frames.length === 0) {
        logger.warn(PREFIX, 'No frames found for requested timestamps');
        return JSON.stringify({ 
          error: 'No frames found for the requested timestamps',
          requestedTimestamps: timestamps
        });
      }
      
      // Format frames for OpenAI
      const formattedFrames = frames.map(frame => ({
        timestamp: frame.frame_timestamp,
        url: frame.frame_storage_url,
        description: `Frame at ${frame.frame_timestamp} seconds`
      }));
      
      logger.success(PREFIX, `Returning ${formattedFrames.length} frame(s) to agent`);
      
      return JSON.stringify({
        success: true,
        frameCount: formattedFrames.length,
        frames: formattedFrames
      });
      
    } catch (error) {
      logger.error(PREFIX, 'Error in fetchVideoFramesTool:', error);
      return JSON.stringify({ error: 'Failed to fetch video frames' });
    }
  },
  {
    name: 'fetch_video_frames',
    description: `Fetch specific video frames from the user's uploaded video. 
    Use this when you need to see what the user showed in their video at specific timestamps.
    The video was captured at 1 frame per second.
    Example: If the user mentioned an issue at "around 10 seconds", request timestamps [9, 10, 11] to see that moment.`,
    schema: z.object({
      timestamps: z.array(z.number()).describe('Array of timestamps in seconds to fetch frames for (e.g., [10, 15, 20])'),
    }),
  }
);

/**
 * Tool: Get Available Frame Timestamps
 * Allows the agent to discover what timestamps are available in the video
 */
export const getAvailableTimestampsTool = tool(
  async () => {
    try {
      logger.log(PREFIX, 'Agent requesting available frame timestamps');
      
      const transcriptId = getAvailableTimestampsTool.transcriptId;
      
      if (!transcriptId) {
        return JSON.stringify({ error: 'No video associated with this call' });
      }
      
      const timestamps = await getAvailableFrameTimestamps(transcriptId);
      
      if (!timestamps || timestamps.length === 0) {
        return JSON.stringify({ 
          error: 'No frames available',
          videoDuration: 0
        });
      }
      
      const videoDuration = Math.max(...timestamps);
      
      logger.success(PREFIX, `Video duration: ${videoDuration}s with ${timestamps.length} frames`);
      
      return JSON.stringify({
        success: true,
        videoDuration: videoDuration,
        frameCount: timestamps.length,
        availableTimestamps: timestamps,
        message: `The video is ${videoDuration} seconds long with frames available at each second.`
      });
      
    } catch (error) {
      logger.error(PREFIX, 'Error in getAvailableTimestampsTool:', error);
      return JSON.stringify({ error: 'Failed to get available timestamps' });
    }
  },
  {
    name: 'get_available_timestamps',
    description: `Get information about the uploaded video duration and available frame timestamps.
    Use this to understand how long the video is before requesting specific frames.`,
    schema: z.object({}),
  }
);

/**
 * Create tools with transcript context
 * @param {number} transcriptId - The transcript ID to bind to tools
 * @param {boolean} includeRAG - Whether to include RAG search tool
 * @param {boolean} includeEmergency - Whether to include emergency transfer tool
 * @returns {Promise<Array>} - Array of tools
 */
export async function createToolsWithContext(transcriptId, includeRAG = true, includeEmergency = true) {
  const tools = [];
  
  // Add video frame tools if transcript ID provided
  if (transcriptId) {
    // Bind transcript ID to tools
    fetchVideoFramesTool.transcriptId = transcriptId;
    getAvailableTimestampsTool.transcriptId = transcriptId;
    
    tools.push(getAvailableTimestampsTool);
    tools.push(fetchVideoFramesTool);
    
    logger.log(PREFIX, `Video tools initialized with transcript ID: ${transcriptId}`);
  }
  
  // Add RAG search tool if enabled
  if (includeRAG) {
    const { searchKnowledgeBaseTool } = await import('./rag-tool.service.js');
    tools.push(searchKnowledgeBaseTool);
    logger.log(PREFIX, 'RAG search tool added');
  }
  
  // Add emergency transfer tool if enabled
  if (includeEmergency) {
    const { transferEmergencyCallTool } = await import('./emergency-tool.service.js');
    tools.push(transferEmergencyCallTool);
    logger.log(PREFIX, 'Emergency transfer tool added');
  }
  
  logger.log(PREFIX, `Total ${tools.length} tool(s) initialized`);
  
  return tools;
}


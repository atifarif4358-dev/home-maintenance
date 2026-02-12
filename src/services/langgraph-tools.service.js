/**
 * LangGraph Tools Service
 * Defines tools for the AI agent to use
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { fetchFramesByTranscriptId, getAvailableFrameTimestamps, getLastCallByPhone } from './database.service.js';
import { logger } from '../utils/logger.js';

const PREFIX = 'Tools';

/**
 * Tool: Fetch Video Frames
 * Allows the agent to request specific video frames by timestamp from a specific video
 */
export const fetchVideoFramesTool = tool(
  async ({ video_number, timestamps }) => {
    try {
      const transcriptIds = fetchVideoFramesTool.transcriptIds;
      
      if (!transcriptIds || transcriptIds.length === 0) {
        logger.error(PREFIX, 'No transcript IDs available for frame fetching');
        return JSON.stringify({ error: 'No video associated with this call' });
      }
      
      // Validate video_number
      if (video_number < 1 || video_number > transcriptIds.length) {
        logger.warn(PREFIX, `Invalid video_number ${video_number}. Available: 1 to ${transcriptIds.length}`);
        return JSON.stringify({ 
          error: `Invalid video number. Please use a number between 1 and ${transcriptIds.length}.` 
        });
      }
      
      // Map video_number (1-indexed) to the correct transcriptId
      const transcriptId = transcriptIds[video_number - 1];
      logger.log(PREFIX, `Agent requesting frames from Video ${video_number} (transcript ID: ${transcriptId}) at timestamps: ${timestamps.join(', ')}`);
      
      // Fetch frames from database
      const frames = await fetchFramesByTranscriptId(transcriptId, timestamps);
      
      if (!frames || frames.length === 0) {
        logger.warn(PREFIX, 'No frames found for requested timestamps');
        return JSON.stringify({ 
          error: 'No frames found for the requested timestamps',
          video_number: video_number,
          requestedTimestamps: timestamps
        });
      }
      
      // Format frames for OpenAI
      const formattedFrames = frames.map(frame => ({
        timestamp: frame.frame_timestamp,
        url: frame.frame_storage_url,
        description: `Video ${video_number} at ${frame.frame_timestamp} seconds`
      }));
      
      logger.success(PREFIX, `Returning ${formattedFrames.length} frame(s) from Video ${video_number} to agent`);
      
      return JSON.stringify({
        success: true,
        video_number: video_number,
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
    description: `Fetch specific video frames from one of the user's uploaded videos.
    You must specify which video using video_number (1 for Video 1, 2 for Video 2, etc.).
    The video was captured at 1 frame per second.
    Example: To see around the 10-second mark of Video 1, use video_number=1 and timestamps=[9, 10, 11].`,
    schema: z.object({
      video_number: z.number().describe('Which video to fetch frames from (1 for Video 1, 2 for Video 2, etc.)'),
      timestamps: z.array(z.number()).describe('Array of timestamps in seconds to fetch frames for (e.g., [10, 15, 20])'),
    }),
  }
);

/**
 * Tool: Get Available Frame Timestamps
 * Allows the agent to discover what timestamps are available in a specific video
 */
export const getAvailableTimestampsTool = tool(
  async ({ video_number }) => {
    try {
      const transcriptIds = getAvailableTimestampsTool.transcriptIds;
      
      if (!transcriptIds || transcriptIds.length === 0) {
        return JSON.stringify({ error: 'No video associated with this call' });
      }
      
      // Validate video_number
      if (video_number < 1 || video_number > transcriptIds.length) {
        return JSON.stringify({ 
          error: `Invalid video number. Please use a number between 1 and ${transcriptIds.length}.` 
        });
      }
      
      // Map video_number (1-indexed) to the correct transcriptId
      const transcriptId = transcriptIds[video_number - 1];
      logger.log(PREFIX, `Agent requesting available timestamps for Video ${video_number} (transcript ID: ${transcriptId})`);
      
      const timestamps = await getAvailableFrameTimestamps(transcriptId);
      
      if (!timestamps || timestamps.length === 0) {
        return JSON.stringify({ 
          error: `No frames available for Video ${video_number}`,
          video_number: video_number,
          videoDuration: 0
        });
      }
      
      const videoDuration = Math.max(...timestamps);
      
      logger.success(PREFIX, `Video ${video_number} duration: ${videoDuration}s with ${timestamps.length} frames`);
      
      return JSON.stringify({
        success: true,
        video_number: video_number,
        videoDuration: videoDuration,
        frameCount: timestamps.length,
        availableTimestamps: timestamps,
        message: `Video ${video_number} is ${videoDuration} seconds long with frames available at each second.`
      });
      
    } catch (error) {
      logger.error(PREFIX, 'Error in getAvailableTimestampsTool:', error);
      return JSON.stringify({ error: 'Failed to get available timestamps' });
    }
  },
  {
    name: 'get_available_timestamps',
    description: `Get information about a specific uploaded video's duration and available frame timestamps.
    You must specify which video using video_number (1 for Video 1, 2 for Video 2, etc.).
    Use this to understand how long a video is before requesting specific frames.`,
    schema: z.object({
      video_number: z.number().describe('Which video to check (1 for Video 1, 2 for Video 2, etc.)'),
    }),
  }
);

/**
 * Tool: Retrieve Previous Work Order
 * Allows the agent to fetch the caller's previous call transcript when they say they're calling about a previous work order
 */
export const retrievePreviousWorkOrderTool = tool(
  async () => {
    try {
      const phoneNumber = retrievePreviousWorkOrderTool.phoneNumber;
      const currentCallId = retrievePreviousWorkOrderTool.currentCallId;
      
      logger.log(PREFIX, `Agent requesting previous work order for phone: ${phoneNumber}`);
      
      if (!phoneNumber) {
        logger.error(PREFIX, 'No phone number available for previous work order lookup');
        return JSON.stringify({ found: false, message: 'No phone number available to look up previous work orders.' });
      }
      
      const previousCall = await getLastCallByPhone(phoneNumber, currentCallId);
      
      if (!previousCall) {
        logger.log(PREFIX, 'No previous work order found for this caller');
        return JSON.stringify({ 
          found: false, 
          message: 'No previous work order found for this caller. They may be a new caller or their last call was more than 24 hours ago.' 
        });
      }
      
      const minutesAgo = Math.round((Date.now() - previousCall.endTime) / 60000);
      logger.success(PREFIX, `✓ Previous work order found from ${minutesAgo} minutes ago`);
      
      return JSON.stringify({
        found: true,
        minutesAgo: minutesAgo,
        transcript: previousCall.transcript,
        duration: previousCall.duration,
        summary: previousCall.summary
      });
      
    } catch (error) {
      logger.error(PREFIX, 'Error in retrievePreviousWorkOrderTool:', error);
      return JSON.stringify({ error: 'Failed to retrieve previous work order' });
    }
  },
  {
    name: 'retrieve_previous_work_order',
    description: `Retrieve the caller's previous work order and call transcript. 
    Use this ONLY when the caller says they are calling about a PREVIOUS work order. 
    Do NOT use this for new work orders.`,
    schema: z.object({}),
  }
);

/**
 * Create tools with transcript context
 * @param {Array|null} transcriptIds - Array of transcript IDs to bind to video tools
 * @param {boolean} includeRAG - Whether to include RAG search tool
 * @param {boolean} includeEmergency - Whether to include emergency transfer tool
 * @param {string|null} phoneNumber - Caller's phone number (for previous work order lookup)
 * @param {string|null} currentCallId - Current call ID (to exclude from previous call lookup)
 * @returns {Promise<Array>} - Array of tools
 */
export async function createToolsWithContext(transcriptIds, includeRAG = true, includeEmergency = true, phoneNumber = null, currentCallId = null) {
  const tools = [];
  
  // Add video frame tools if transcript IDs provided
  if (transcriptIds && transcriptIds.length > 0) {
    // Bind transcript IDs array to tools (ordered: index 0 = Video 1, index 1 = Video 2, etc.)
    fetchVideoFramesTool.transcriptIds = transcriptIds;
    getAvailableTimestampsTool.transcriptIds = transcriptIds;
    
    tools.push(getAvailableTimestampsTool);
    tools.push(fetchVideoFramesTool);
    
    logger.log(PREFIX, `Video tools initialized with ${transcriptIds.length} transcript ID(s): ${transcriptIds.join(', ')}`);
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
  
  // Add previous work order tool if phone number is available
  if (phoneNumber) {
    retrievePreviousWorkOrderTool.phoneNumber = phoneNumber;
    retrievePreviousWorkOrderTool.currentCallId = currentCallId;
    tools.push(retrievePreviousWorkOrderTool);
    logger.log(PREFIX, 'Previous work order tool added');
  }
  
  logger.log(PREFIX, `Total ${tools.length} tool(s) initialized`);
  
  return tools;
}


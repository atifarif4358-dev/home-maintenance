/**
 * Call Controller
 * Handles WebSocket and API call operations
 */

import { HumanMessage, AIMessage } from '@langchain/core/messages';
import { sendResponse, sendErrorResponse, sendDirectTransfer, getCallDetails } from '../services/retell.service.js';
import { getTranscriptsByLatestUpload, fetchFramesByTranscriptId } from '../services/database.service.js';
import { 
  createAgent, 
  createTechnicalSupportPrompt, 
  createReceptionistPrompt,
  generateFirstMessage 
} from '../services/langgraph.service.js';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

const PREFIX = 'CallController';

/**
 * Handle WebSocket connection for LLM integration
 * @param {WebSocket} ws - WebSocket connection
 * @param {string} callId - Call ID from Retell
 */
export function handleWebSocketConnection(ws, callId) {
  logger.log(PREFIX, `New connection established for call: ${callId}`);
  
  let agent = null;
  let conversationState = { messages: [], transcriptIds: null, hasVideo: false };
  let transcriptsData = null; // Array of transcript objects from the same upload
  let agentInitialized = false;
  let callStartTime = Date.now();
  let userPhoneNumber = null;
  let emergencyDetected = false;
  let emergencyReason = null;
  let recordingUrl = null;
  let transferInProgress = false; // Prevent multiple transfers
  let agentInitializing = false; // Prevent duplicate initialization
  let greetingSent = false; // Track if we've sent the first greeting

  /**
   * Fetch call details from Retell API and initialize agent
   */
  const fetchCallDetailsAndInitialize = async () => {
    if (agentInitialized || agentInitializing) {
      return;
    }
    
    agentInitializing = true;
    
    try {
      // Fetch call details from Retell API
      logger.log(PREFIX, '📞 Fetching call details from Retell API...');
      const callDetails = await getCallDetails(callId);
      
      if (!callDetails.from_number) {
        throw new Error('No from_number in call details');
      }
      
      // Store phone number
      userPhoneNumber = callDetails.from_number;
      logger.success(PREFIX, `✓ Caller identified: ${userPhoneNumber}`);
      
      // Initialize agent with actual phone number
      await initializeAgent(userPhoneNumber);
      
      // Send first message after agent is ready
      sendFirstGreeting();
      
    } catch (error) {
      logger.error(PREFIX, '❌ Failed to fetch call details:', error);
      logger.warn(PREFIX, 'Initializing agent without phone number (receptionist mode)');
      // Initialize as receptionist if we can't get phone number
      await initializeAgent(null);
      
      // Send first message even in receptionist mode
      sendFirstGreeting();
    } finally {
      agentInitializing = false;
    }
  };
  
  /**
   * Send the first greeting message to start the conversation
   */
  const sendFirstGreeting = () => {
    if (!agentInitialized) {
      logger.warn(PREFIX, 'Cannot send greeting: agent not initialized');
      return;
    }
    
    if (greetingSent) {
      logger.log(PREFIX, 'Greeting already sent, skipping');
      return;
    }
    
    // Generate first message based on whether we have transcripts or not
    const videoCount = transcriptsData ? transcriptsData.length : 0;
    const firstMessage = generateFirstMessage(videoCount);
    
    // Send the greeting with response_id: 0 (no prior user message)
    sendResponse(ws, firstMessage, 0);
    
    // Add to conversation state
    conversationState.messages.push(new AIMessage(firstMessage));
    
    greetingSent = true;
    logger.success(PREFIX, `🎤 Sent greeting: "${firstMessage}"`);
  };

  /**
   * Initialize agent with appropriate configuration
   * @param {string|null} phoneNumber - User's phone number
   */
  const initializeAgent = async (phoneNumber) => {
    if (agentInitialized) {
      logger.log(PREFIX, 'Agent already initialized, skipping...');
      return;
    }

    if (!phoneNumber) {
      // No phone number - configure as receptionist
      logger.info(PREFIX, 'Initializing as RECEPTIONIST (no phone number available)');
      const systemPrompt = createReceptionistPrompt();
      agent = await createAgent(systemPrompt, null, true); // Enable RAG even without video
      agentInitialized = true;
      return;
    }
    
    logger.info(PREFIX, `Initializing agent for caller: ${phoneNumber}`);
    
    // Lookup video transcripts by latest upload (retrieved in both previous & new work order cases)
    transcriptsData = await getTranscriptsByLatestUpload(phoneNumber);
    logger.log(PREFIX, `Database query: ${transcriptsData ? `${transcriptsData.length} TRANSCRIPT(S) FOUND ✓` : 'NO TRANSCRIPT ✗'}`);
    
    if (transcriptsData && transcriptsData.length > 0) {
      // SCENARIO A: Transcripts Found - Technical Support Agent with Video Tools
      const transcriptIds = transcriptsData.map(t => t.transcriptId);
      logger.success(PREFIX, `✓ TECHNICAL SUPPORT mode (${transcriptsData.length} video(s), IDs: ${transcriptIds.join(', ')})`);
      
      // Check if any video has frames
      let hasFrames = false;
      for (const t of transcriptsData) {
        const frames = await fetchFramesByTranscriptId(t.transcriptId);
        if (frames && frames.length > 0) {
          hasFrames = true;
          logger.success(PREFIX, `✓ Video ${transcriptIds.indexOf(t.transcriptId) + 1} has ${frames.length} frames`);
        }
      }
      
      if (!hasFrames) {
        logger.warn(PREFIX, 'No video frames for any transcript');
      }
      
      // Update conversation state
      conversationState.transcriptIds = transcriptIds;
      conversationState.hasVideo = hasFrames;
      
      // Build numbered transcript text for the prompt
      const numberedTranscript = transcriptsData.map((t, i) => `Video ${i + 1}: "${t.transcript}"`).join('\n');
      
      // Create system prompt with video tool instructions
      const systemPrompt = createTechnicalSupportPrompt(numberedTranscript, hasFrames, transcriptsData.length);
      
      // Create agent with tools - pass transcriptIds array for video tools
      agent = await createAgent(systemPrompt, hasFrames ? transcriptIds : null, true, true, phoneNumber, callId);
      
    } else {
      // SCENARIO B: No Transcript - Receptionist Agent
      logger.info(PREFIX, 'ℹ RECEPTIONIST mode (no transcript for this number)');
      const systemPrompt = createReceptionistPrompt();
      // Enable RAG + emergency + previous work order tool (phoneNumber & callId passed for tool binding)
      agent = await createAgent(systemPrompt, null, true, true, phoneNumber, callId);
    }
    
    agentInitialized = true;
  };
  
  // Fetch call details immediately when connection is established
  fetchCallDetailsAndInitialize().catch(error => {
    logger.error(PREFIX, 'Error during initialization:', error);
  });

  ws.on('message', async (message) => {
    let data = null;
    
    try {
      data = JSON.parse(message);
      logger.log(PREFIX, `Received interaction type: ${data.interaction_type}`);

      // ============================================================
      // STEP 1: CALL DETAILS EVENT (Optional - we fetch via API instead)
      // ============================================================
      if (data.interaction_type === 'call_details') {
        logger.log(PREFIX, 'call_details event received (already fetched via API)');
        // We already fetched call details via API, so we can ignore this event
        // Just send config response
        const response = {
          response_type: 'config',
          config: {
            auto_reconnect: true,
            call_details: true
          }
        };
        ws.send(JSON.stringify(response));
      }

      // ============================================================
      // STEP 2: PROCESS USER RESPONSES
      // ============================================================
      else if (data.interaction_type === 'response_required') {
        // Wait for agent initialization to complete
        if (!agentInitialized && agentInitializing) {
          logger.log(PREFIX, '⏳ Agent initializing, waiting...');
          // Wait for initialization to complete (with timeout)
          const maxWait = 10000; // 10 seconds
          const startWait = Date.now();
          while (!agentInitialized && (Date.now() - startWait) < maxWait) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          
          if (!agentInitialized) {
            logger.error(PREFIX, '❌ Agent initialization timeout');
            sendErrorResponse(ws, data.response_id);
            return;
          }
        }
        
        if (!agentInitialized) {
          logger.error(PREFIX, '❌ Agent not initialized');
          sendErrorResponse(ws, data.response_id);
          return;
        }
        
        // Send greeting if we haven't yet (handles race condition)
        if (!greetingSent) {
          logger.log(PREFIX, 'Sending greeting before processing user message');
          sendFirstGreeting();
        }
        
        const userMessage = data.transcript?.[data.transcript.length - 1]?.content;
        
        if (!userMessage) {
          logger.warn(PREFIX, 'No user message in transcript');
          return;
        }
        
        logger.log(PREFIX, `User said: "${userMessage}"`);
        
        // Add user message to conversation state
        conversationState.messages.push(new HumanMessage(userMessage));
        
        // Run the LangGraph agent
        logger.log(PREFIX, 'Processing with LangGraph...');
        const result = await agent.invoke(conversationState);
        
        // Check all messages for emergency transfer signal (including tool messages)
        let emergencyTransferDetected = false;
        let transferNumber = null;
        let transferReason = null;
        
        // Check messages for emergency transfer signal
        for (const msg of result.messages) {
          const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
          
          if (content.startsWith('EMERGENCY_TRANSFER:')) {
            emergencyTransferDetected = true;
            const parts = content.split(':');
            transferNumber = parts[1];
            transferReason = parts[2] || 'Emergency situation';
            logger.success(PREFIX, `🚨 EMERGENCY TRANSFER SIGNAL DETECTED!`);
            logger.info(PREFIX, `   Number: ${transferNumber}`);
            logger.info(PREFIX, `   Reason: ${transferReason}`);
            break;
          }
        }
        
        // Extract AI response
        const aiMessage = result.messages[result.messages.length - 1];
        const responseText = aiMessage.content;
        
        // Handle emergency transfer if detected
        if (emergencyTransferDetected) {
          // Determine transfer type from reason
          const isUrgentMaintenance = transferReason.startsWith('urgent_maintenance');
          const isHumanAgentRequest = transferReason === 'human_agent_requested';
          
          const displayReason = isUrgentMaintenance 
            ? transferReason.replace('urgent_maintenance_', '') 
            : transferReason;
          
          // Log based on transfer type
          if (isHumanAgentRequest) {
            logger.log(PREFIX, `👤 USER REQUESTED HUMAN AGENT`);
          } else if (isUrgentMaintenance) {
            logger.warn(PREFIX, `🚨 URGENT MAINTENANCE DETECTED: ${displayReason}`);
          } else {
            logger.warn(PREFIX, `🚨 EMERGENCY DETECTED: ${displayReason}`);
          }
          
          // Check if transfer already happened
          if (transferInProgress) {
            logger.warn(PREFIX, '⚠️ Transfer already initiated, sending acknowledgment only');
            sendResponse(ws, "The transfer is in progress. Please stay on the line.", data.response_id);
            return;
          }
          
          // Mark that transfer is in progress BEFORE sending (prevent race conditions)
          transferInProgress = true;
          logger.log(PREFIX, '🔒 Transfer flag set');
          
          // Mark emergency for email summary (only for actual emergencies, not human agent requests)
          if (!isHumanAgentRequest) {
            emergencyDetected = true;
            emergencyReason = displayReason;
          }
          
          try {
            // CRITICAL: Send transfer IMMEDIATELY - don't wait for anything else!
            logger.info(PREFIX, `🚀 SENDING TRANSFER COMMAND`);
            logger.info(PREFIX, `📞 Destination: ${transferNumber}`);
            logger.info(PREFIX, `🆔 Response ID: ${data.response_id}`);
            logger.info(PREFIX, `💬 Response Text: "${responseText}"`);
            logger.info(PREFIX, `🌐 WebSocket State: ${ws.readyState} (1=OPEN, 2=CLOSING, 3=CLOSED)`);
            
            sendDirectTransfer(ws, data.response_id, transferNumber, responseText);
            
            logger.success(PREFIX, `✅ TRANSFER COMMAND SENT TO RETELL`);
            
            // Add to conversation state for email summary
            conversationState.messages.push(new AIMessage(responseText + ' [CALL TRANSFERRED]'));
            
          } catch (error) {
            logger.error(PREFIX, 'Transfer failed:', error);
            
            // Fallback depends on transfer type
            logger.warn(PREFIX, 'Using fallback message');
            let fallbackMessage;
            
            if (isHumanAgentRequest) {
              // For human agent request, give them the number to call
              fallbackMessage = "I apologize, the transfer to our support team didn't go through. Please call our support line directly at: " +
                transferNumber.replace(/(\d)/g, '$1 ') + ". A human agent will be happy to assist you.";
            } else if (isUrgentMaintenance) {
              // For urgent maintenance, give them the number to call
              fallbackMessage = "I apologize, the transfer failed. Please write this down and call our emergency maintenance line directly: " +
                transferNumber.replace(/(\d)/g, '$1 ') + ". They will dispatch help immediately.";
            } else {
              // For life-threatening, insist on 911
              fallbackMessage = "This is a life-threatening emergency. Please listen carefully. " +
                "Hang up this call immediately and dial 9 1 1. That's 9 1 1 for emergency services. " +
                "Your safety is the absolute priority. Hang up now and make that call.";
            }
            
            sendResponse(ws, fallbackMessage, data.response_id);
            conversationState.messages.push(new AIMessage(fallbackMessage));
          }
          
          // Send email alert in background (completely async, won't block anything)
          // This runs AFTER transfer is complete, in fire-and-forget mode
          if (!isHumanAgentRequest) {
            import('../services/email.service.js')
              .then(({ sendEmergencyAlert }) => {
                return sendEmergencyAlert({
                  callId,
                  userPhone: userPhoneNumber,
                  reason: displayReason,
                  emergencyNumber: transferNumber,
                  isUrgentMaintenance,
                });
              })
              .catch(err => logger.error(PREFIX, 'Background email failed:', err));
          }
          
          return;
        }
        
        // Update conversation state
        conversationState.messages.push(new AIMessage(responseText));
        
        logger.log(PREFIX, `Agent responded: "${responseText}"`);
        
        // Send response back to Retell
        sendResponse(ws, responseText, data.response_id);
      }
      
      // ============================================================
      // STEP 3: HANDLE UPDATES
      // ============================================================
      else if (data.interaction_type === 'update_only') {
        // Capture recording URL if available (sent after call ends)
        if (data.call?.recording_url) {
          recordingUrl = data.call.recording_url;
          logger.success(PREFIX, `📼 Recording available: ${recordingUrl}`);
        }
      }
      
      // ============================================================
      // STEP 4: HANDLE CALL END (Recording URL may be available)
      // ============================================================
      else if (data.interaction_type === 'call_ended') {
        logger.log(PREFIX, '☎️ Call ended event received');
        
        // Capture recording URL from call_ended event
        if (data.call?.recording_url) {
          recordingUrl = data.call.recording_url;
          logger.success(PREFIX, `📼 Recording captured: ${recordingUrl}`);
        }
      }
      
    } catch (error) {
      logger.error(PREFIX, 'Error processing message:', error);
      sendErrorResponse(ws, data?.response_id || 0);
    }
  });

  ws.on('close', async () => {
    logger.log(PREFIX, `Connection closed for call: ${callId}`);
    
    // Calculate call duration
    const callDuration = Math.floor((Date.now() - callStartTime) / 1000);
    const durationStr = `${Math.floor(callDuration / 60)}m ${callDuration % 60}s`;
    
    // Note: Call summary email is now sent via webhook (call_analyzed event)
    // This provides AI summary and recording URL from Retell
    logger.log(PREFIX, `Call duration: ${durationStr}`);
    logger.log(PREFIX, `Email will be sent via webhook when Retell sends call_analyzed event`);
  });

  ws.on('error', (error) => {
    logger.error(PREFIX, 'WebSocket error:', error);
  });
}


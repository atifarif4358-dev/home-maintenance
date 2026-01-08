/**
 * Call Controller
 * Handles WebSocket and API call operations
 */

import { HumanMessage, AIMessage } from '@langchain/core/messages';
import { getTranscriptWithMetadata, fetchFramesByTranscriptId } from '../services/database.service.js';
import { sendResponse, sendErrorResponse, sendDirectTransfer, getCallDetails } from '../services/retell.service.js';
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
  let conversationState = { messages: [], transcriptId: null, hasVideo: false };
  let transcriptData = null;
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
    
    // Generate first message based on whether we have transcript or not
    const firstMessage = generateFirstMessage(transcriptData?.transcript || null);
    
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
    
    // Lookup transcript with metadata (includes transcript_id for frames)
    transcriptData = await getTranscriptWithMetadata(phoneNumber);
    logger.log(PREFIX, `Database query: ${transcriptData ? 'TRANSCRIPT FOUND ✓' : 'NO TRANSCRIPT ✗'}`);
    
    if (transcriptData) {
      // SCENARIO A: Transcript Found - Technical Support Agent with Video Tools
      logger.success(PREFIX, `✓ TECHNICAL SUPPORT mode (Transcript ID: ${transcriptData.transcriptId})`);
      
      // Check if frames are available
      const frames = await fetchFramesByTranscriptId(transcriptData.transcriptId);
      const hasFrames = frames && frames.length > 0;
      
      if (hasFrames) {
        logger.success(PREFIX, `✓ Video available: ${frames.length} frames`);
      } else {
        logger.warn(PREFIX, 'No video frames for this transcript');
      }
      
      // Update conversation state with transcript info
      conversationState.transcriptId = transcriptData.transcriptId;
      conversationState.hasVideo = hasFrames;
      
      // Create system prompt with video tool instructions
      const systemPrompt = createTechnicalSupportPrompt(transcriptData.transcript, hasFrames);
      
      // Create agent with tools (video tools + RAG search + emergency)
      agent = await createAgent(systemPrompt, hasFrames ? transcriptData.transcriptId : null, true, true);
      
    } else {
      // SCENARIO B: No Transcript - Receptionist Agent
      logger.info(PREFIX, 'ℹ RECEPTIONIST mode (no transcript for this number)');
      const systemPrompt = createReceptionistPrompt();
      agent = await createAgent(systemPrompt, null, true, true); // Enable RAG + emergency
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
        
        logger.log(PREFIX, `🔍 Checking ${result.messages.length} messages for emergency signal...`);
        
        for (const msg of result.messages) {
          const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
          
          // Debug: Log message type and content preview
          const msgType = msg.constructor.name;
          const preview = content.substring(0, 100);
          logger.log(PREFIX, `  - ${msgType}: "${preview}${content.length > 100 ? '...' : ''}"`);
          
          if (content.startsWith('EMERGENCY_TRANSFER:')) {
            emergencyTransferDetected = true;
            const parts = content.split(':');
            transferNumber = parts[1];
            transferReason = parts[2] || 'Emergency situation';
            logger.success(PREFIX, `✓ Emergency transfer detected! Number: ${transferNumber}, Reason: ${transferReason}`);
            break;
          }
        }
        
        if (!emergencyTransferDetected) {
          logger.log(PREFIX, '  No emergency transfer signal found in messages');
        }
        
        // Extract AI response
        const aiMessage = result.messages[result.messages.length - 1];
        const responseText = aiMessage.content;
        
        // Handle emergency transfer if detected
        if (emergencyTransferDetected) {
          if (transferInProgress) {
            logger.warn(PREFIX, '⚠️ Transfer already in progress, ignoring duplicate request');
            // Still send a response to acknowledge
            sendResponse(ws, "The transfer is in progress. Please stay on the line.", data.response_id);
            return;
          }
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
          
          // Mark emergency for email summary (only for actual emergencies, not human agent requests)
          if (!isHumanAgentRequest) {
            emergencyDetected = true;
            emergencyReason = displayReason;
          }
          
          transferInProgress = true; // Prevent multiple transfers
          
          try {
            // CRITICAL: Send transfer IMMEDIATELY - don't wait for anything else!
            logger.info(PREFIX, `Initiating call transfer to: ${transferNumber}`);
            sendDirectTransfer(ws, data.response_id, transferNumber, responseText);
            logger.success(PREFIX, `✓ Transfer command sent`);
            
            // Send alert email AFTER transfer (async, don't block)
            // Email can be sent in background - transfer is time-critical!
            if (!isHumanAgentRequest) {
              const { sendEmergencyAlert } = await import('../services/email.service.js');
              sendEmergencyAlert({
                callId,
                userPhone: userPhoneNumber,
                reason: displayReason,
                emergencyNumber: transferNumber,
                isUrgentMaintenance,
              }).catch(err => logger.error(PREFIX, 'Failed to send alert email:', err));
              // Note: No await - let it send in background
            }
            
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
    
    // Send call summary email
    try {
      const { sendCallSummary } = await import('../services/email.service.js');
      
      await sendCallSummary({
        callId,
        phoneNumber: userPhoneNumber,
        messages: conversationState.messages,
        transcriptId: conversationState.transcriptId,
        hasVideo: conversationState.hasVideo,
        duration: durationStr,
        emergencyDetected,
        emergencyReason,
        recordingUrl: recordingUrl,
        notes: emergencyDetected ? 'Emergency situation was handled during this call.' : null,
      });
      
      logger.success(PREFIX, 'Call summary email sent');
    } catch (error) {
      logger.error(PREFIX, 'Failed to send call summary email:', error);
    }
  });

  ws.on('error', (error) => {
    logger.error(PREFIX, 'WebSocket error:', error);
  });
}


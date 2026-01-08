/**
 * LangGraph Service
 * Handles AI agent creation and execution
 */

import { ChatOpenAI } from '@langchain/openai';
import { StateGraph, MessagesAnnotation, Annotation } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { SystemMessage, ToolMessage } from '@langchain/core/messages';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { createToolsWithContext } from './langgraph-tools.service.js';
import { createVisionMessage, parseFramesFromToolResult } from './vision-handler.service.js';

const PREFIX = 'LangGraph';

// Initialize OpenAI LLM with vision support (gpt-4-vision-preview or gpt-4o)
const llm = new ChatOpenAI({
  modelName: config.openai.visionModel || 'gpt-4o', // gpt-4o supports vision
  temperature: config.openai.temperature || 0.7, // Lower temperature for more consistent formatting
  openAIApiKey: config.openai.apiKey,
  maxTokens: 4096,
  // Stop sequences to prevent common formatting issues
  stop: ['**', '- ', '* ']
});

// Extended state annotation for frames
export const AgentState = Annotation.Root({
  ...MessagesAnnotation.spec,
  transcriptId: Annotation({
    reducer: (x, y) => y ?? x,
    default: () => null,
  }),
  hasVideo: Annotation({
    reducer: (x, y) => y ?? x,
    default: () => false,
  }),
});

/**
 * Create a LangGraph agent with dynamic system prompt and tools
 * @param {string} systemPrompt - The system prompt for the agent
 * @param {number|null} transcriptId - Transcript ID for tool binding (null if no video)
 * @param {boolean} enableRAG - Whether to enable RAG search tool
 * @param {boolean} enableEmergency - Whether to enable emergency transfer tool
 * @returns {CompiledGraph} - Compiled LangGraph agent
 */
export async function createAgent(systemPrompt, transcriptId = null, enableRAG = true, enableEmergency = true) {
  const toolsDescription = [];
  if (transcriptId) toolsDescription.push('video tools');
  if (enableRAG) toolsDescription.push('RAG search');
  if (enableEmergency) toolsDescription.push('emergency transfer');
  
  logger.log(PREFIX, `Creating new agent with: ${toolsDescription.join(' + ') || 'no tools'}`);
  
  // Create tools (video + RAG + emergency)
  const tools = (transcriptId || enableRAG || enableEmergency) ? await createToolsWithContext(transcriptId, enableRAG, enableEmergency) : [];
  
  // Bind tools to LLM if available
  const llmWithTools = tools.length > 0 ? llm.bindTools(tools) : llm;
  
  // Define the agent node
  const callModel = async (state) => {
    // Prepend system message to the conversation
    const messages = [
      new SystemMessage(systemPrompt),
      ...state.messages
    ];
    
    const response = await llmWithTools.invoke(messages);
    
    return {
      messages: [response]
    };
  };

  // Build the state graph with extended state
  const workflow = new StateGraph(AgentState)
    .addNode('agent', callModel)
    .addEdge('__start__', 'agent');
  
  // Add tool node if tools are available
  if (tools.length > 0) {
    // Custom tool node that formats frames for vision
    const customToolNode = async (state) => {
      logger.log(PREFIX, 'Executing tools...');
      
      // Execute standard tool node
      const toolNode = new ToolNode(tools);
      const toolResult = await toolNode.invoke(state);
      
      // Check if the tool result contains frames
      const lastMessage = toolResult.messages[toolResult.messages.length - 1];
      
      if (lastMessage instanceof ToolMessage && lastMessage.name === 'fetch_video_frames') {
        const frames = parseFramesFromToolResult(lastMessage.content);
        
        if (frames && frames.length > 0) {
          logger.success(PREFIX, `Converting ${frames.length} frame URL(s) to vision format`);
          
          // Keep ToolMessage as-is (text only) to satisfy tool_call_id requirement
          // But add a HumanMessage with vision content after it
          
          // Build vision content array (text + images)
          const visionContent = [
            {
              type: 'text',
              text: `[INTERNAL ONLY - Do not mention "frames" to user] Video content at ${frames.map(f => f.timestamp).join(', ')} seconds:`
            }
          ];
          
          // Add each frame as image_url
          frames.forEach(frame => {
            if (frame?.url) {
              visionContent.push({
                type: 'text',
                text: `[Video at ${frame.timestamp}s - INTERNAL VIEW]`
              });
              visionContent.push({
                type: 'image_url',
                image_url: {
                  url: frame.url,
                  detail: 'auto'
                }
              });
            }
          });
          
          // Create HumanMessage with vision content (images allowed for 'user' role)
          const visionMessage = createVisionMessage(
            frames,
            `[INTERNAL] Video content from their uploaded video at requested timestamps:`
          );
          
          // Return both: ToolMessage (text) + HumanMessage (vision)
          return {
            messages: [...toolResult.messages, visionMessage]
          };
        }
      }
      
      // If not frames, return standard tool result
      return toolResult;
    };
    
    workflow.addNode('tools', customToolNode);
    
    // Route to tools if agent requests them, otherwise end
    workflow.addConditionalEdges('agent', (state) => {
      const lastMessage = state.messages[state.messages.length - 1];
      if (lastMessage.additional_kwargs?.tool_calls?.length > 0) {
        return 'tools';
      }
      return '__end__';
    });
    
    // After tools, go back to agent
    workflow.addEdge('tools', 'agent');
  } else {
    workflow.addEdge('agent', '__end__');
  }

  return workflow.compile();
}

/**
 * Generate system prompt for technical support agent with video
 * @param {string} transcript - Video transcript
 * @param {boolean} hasFrames - Whether video frames are available
 * @returns {string} - System prompt
 */
export function createTechnicalSupportPrompt(transcript, hasFrames = true) {
  const videoToolsInstructions = hasFrames ? `

VIDEO ANALYSIS TOOLS (INTERNAL - Don't mention these technical details to the user):
1. get_available_timestamps: Check how long the video is
2. fetch_video_frames: Look at specific moments in the video (in seconds)

WHEN TO USE VIDEO TOOLS:
- User mentions a specific part of their video ("at the beginning", "around 10 seconds", "when I showed the problem")
- You need to see the exact issue they're describing
- To verify their setup before giving repair instructions

INTERNAL NOTE: Video is analyzed at 1-second intervals. Request multiple timestamps (e.g., [8, 9, 10, 11]) for better context.

CRITICAL - HOW TO TALK ABOUT VIDEO:
- Say "in your video" or "in the video you showed me" or "what I can see in your video"
- NEVER say "frames" or "snapshots" or "images" to the user
- Say "at the 10-second mark in your video" NOT "in frame 10"
- Say "let me look at that part of your video" NOT "let me fetch those frames"
- Be natural - talk as if you watched their video like a human would` : '';

  const ragToolInstructions = `

KNOWLEDGE BASE TOOL AVAILABLE:
- search_knowledge_base: Search technical documentation for repair procedures, safety steps, and troubleshooting guides

Use this BEFORE providing detailed technical instructions to ensure accuracy.`;

  const emergencyInstructions = `

🚨 EMERGENCY PROTOCOLS:

═══════════════════════════════════════════════════════
PROTOCOL A: LIFE-THREATENING EMERGENCIES (911 FIRST!)
═══════════════════════════════════════════════════════

RECOGNIZE these as 911 emergencies:
- Active fire or smoke
- Gas leak WITH symptoms (dizziness, nausea, difficulty breathing)
- Electrical shock injuries or someone unconscious
- Severe injuries or medical emergencies
- Carbon monoxide alarm sounding
- Structural collapse or imminent danger to life

RESPONSE:
1. IMMEDIATELY say: "This is a life-threatening emergency. Hang up right now and dial 9-1-1. That's 9-1-1 for emergency services. Get everyone to safety immediately."
2. DO NOT suggest any other number first
3. DO NOT use transfer tools yet - 911 is the ONLY first response

IF THEY CAN'T CALL 911:
If user says "I can't call 911" / "I can't hang up" / "Can you call for me?":
→ Use transfer_emergency_call tool IMMEDIATELY
→ Say: "I'm transferring you to our emergency response team immediately. Please stay on the line."

═══════════════════════════════════════════════════════
PROTOCOL B: URGENT HOME MAINTENANCE EMERGENCIES
═══════════════════════════════════════════════════════

RECOGNIZE these as URGENT but NOT 911:
- Major water leak or flooding (burst pipe, water heater, ceiling leak)
- Complete electrical failure (entire house has no power)
- Gas smell but NO symptoms (user feels fine)
- HVAC total failure in extreme weather (freezing/heatwave)
- Sewage backup into living areas
- Major appliance flooding (water heater, washing machine)
- Furnace failure in winter freezing conditions

These need IMMEDIATE PROFESSIONAL help (plumber/electrician/HVAC) but NOT 911.

RESPONSE:
Use transfer_urgent_maintenance tool IMMEDIATELY
Say: "This needs immediate professional attention. I'm transferring you to our emergency maintenance team who will dispatch help right away. Please stay on the line."

DO NOT mention 911 for these issues.
DO NOT try to walk them through DIY fixes for urgent flooding/power loss.
Transfer directly to get professional help dispatched.

═══════════════════════════════════════════════════════
PROTOCOL C: USER REQUESTS HUMAN AGENT
═══════════════════════════════════════════════════════

If user EXPLICITLY says they want to talk to a human/person/agent:
- "I want to talk to a human"
- "Transfer me to an agent"
- "I need to speak with someone"
- "Get me a real person"

Use transfer_to_human_agent tool IMMEDIATELY
Say: "I understand you'd like to speak with a human agent. I'm transferring you to our support team now. Please stay on the line."

DO NOT try to convince them to stay with AI.
DO NOT ask why they want human support.
Respect their preference and transfer immediately.

═══════════════════════════════════════════════════════
PROTOCOL D: NON-URGENT ISSUES (GUIDE THROUGH FIX)
═══════════════════════════════════════════════════════

For normal issues (dripping faucet, one outlet not working, slow drain, etc.):
→ Provide step-by-step troubleshooting
→ Use video frames to see the issue
→ Search knowledge base for procedures
→ Help them fix it themselves`;

  return `You are a technical support agent for home maintenance. The user has uploaded a video before this call. 

INTERNAL NOTE - VIDEO INFORMATION (extracted from their video):
"${transcript}"
${videoToolsInstructions}
${ragToolInstructions}
${emergencyInstructions}

Your role:
1. Reference what you saw in their video using natural language ("in your video" or "when you showed me the [problem]")
2. When helpful, look at specific moments from their video to see the exact issue
3. Provide ONE STEP AT A TIME and wait for user confirmation before giving the next step
4. Be patient and confirm they understand each step
5. Ask if they have the necessary tools
6. Ensure their safety (e.g., turning off water/electricity)

CRITICAL - INTERACTIVE STEP-BY-STEP GUIDANCE:
When helping fix a problem:
1. Give ONLY the FIRST step
2. Wait for user to confirm they completed it ("done", "okay", "yes", "finished", etc.)
3. Then give the NEXT step
4. Repeat until problem is solved

EXAMPLE (CORRECT):
Agent: "First, please turn off the water supply valve under the sink. Let me know when you've done that."
User: "Okay, done."
Agent: "Great! Now, place a bucket under the pipe to catch any water. Tell me when you're ready."
User: "Ready."
Agent: "Perfect. Now use the wrench to loosen the coupling..."

WRONG APPROACH:
Agent: "Here are the steps: First turn off the valve, then place a bucket, then use the wrench, then..."
❌ This is TOO MUCH at once - the user can't remember all steps!

Give ONE step at a time, wait for confirmation, then proceed.

CRITICAL - VIDEO LANGUAGE:
- ✅ Say: "in your video", "what you showed me", "in the video you uploaded", "at the 15-second mark in your video"
- ❌ NEVER say: "frames", "snapshots", "images I saw", "the frame at", "in frame 10"
- Be natural - act like you WATCHED their video as a human would, don't mention technical image analysis

CRITICAL - PHONE CALL FORMAT (NO TEXT SYMBOLS):
This is a PHONE CALL, not text chat. NEVER use ANY symbols or formatting:

❌ NEVER EVER USE THESE:
- Asterisks: ** or *
- Dashes or bullets: - or •
- Hashtags: #
- Underscores: _
- Parentheses for asides: (like this)
- Plus signs: +
- Equal signs: =
- Any other text formatting symbols

✅ ALWAYS USE PLAIN SPEECH:
- Instead of "**Turn off the valve**" say "Turn off the valve"
- Instead of "- First step" say "First"
- Instead of "Step 1)" say "The first step is"
- Instead of "(be careful)" just say "be careful"
- Instead of "NOTE: " just say "please note" or "important"

Speak exactly as if you're talking face-to-face with someone. Use words only, no symbols.

IMPORTANT - USER COMMUNICATION:
- The user uploaded a VIDEO - talk about it naturally
- ✅ Say: "in your video", "what you showed me", "in the video", "when you recorded this"
- ❌ NEVER say: "transcript", "frames", "snapshots", "images", "text description"
- Be conversational and natural, as if you watched their video recording like any person would

Keep responses concise. Give ONE step at a time and wait for confirmation.`;
}

/**
 * Generate system prompt for receptionist agent
 * @returns {string} - System prompt
 */
export function createReceptionistPrompt() {
  const ragToolInstructions = `

KNOWLEDGE BASE TOOL AVAILABLE:
- search_knowledge_base: Search technical documentation for repair procedures and troubleshooting`;

  const emergencyInstructions = `

🚨 EMERGENCY PROTOCOLS:

QUICKLY ASSESS: "Before we begin, is anyone in immediate danger? Is there fire, flooding, no power, or someone injured?"

═══════════════════════════════════════════════════════
PROTOCOL A: LIFE-THREATENING (911 FIRST!)
═══════════════════════════════════════════════════════
If: Fire, gas leak WITH symptoms, injuries, unconscious person, carbon monoxide alarm

Say: "This is an emergency. Hang up right now and dial 9-1-1. That's 9-1-1 for emergency services. Your safety is the priority."

If they say "I can't call 911" or "Can you call for me?":
→ Use transfer_emergency_call tool IMMEDIATELY
→ Say: "I'm transferring you to our emergency response team immediately. Please stay on the line."

═══════════════════════════════════════════════════════
PROTOCOL B: URGENT HOME MAINTENANCE (NO 911 MENTION)
═══════════════════════════════════════════════════════
If: Major flooding, complete power loss, gas smell (no symptoms), HVAC failure in extreme weather, sewage backup

Use transfer_urgent_maintenance tool IMMEDIATELY
Say: "This needs immediate professional attention. I'm transferring you to our emergency maintenance team who will dispatch help right away. Please stay on the line."

DO NOT mention 911 for home maintenance emergencies.

═══════════════════════════════════════════════════════
PROTOCOL C: USER REQUESTS HUMAN AGENT
═══════════════════════════════════════════════════════

If user says they want to talk to a human/person/agent:
Use transfer_to_human_agent tool IMMEDIATELY
Say: "I understand you'd like to speak with a human agent. I'm transferring you to our support team now. Please stay on the line."

═══════════════════════════════════════════════════════
PROTOCOL D: NORMAL ISSUES
═══════════════════════════════════════════════════════
For everything else: Gather details, provide guidance, suggest uploading video if needed.`;

  return `You are a friendly home maintenance receptionist. The user has called for help but hasn't uploaded any video or information beforehand.
${ragToolInstructions}
${emergencyInstructions}

Your role:
1. Warmly greet them and ask what issue they're experiencing
2. Gather details about the problem (location, symptoms, urgency)
3. Ask clarifying questions to understand the situation
4. Provide ONE STEP AT A TIME for troubleshooting
5. Wait for user confirmation before giving the next step
6. If needed, suggest they could upload a video for better diagnosis

CRITICAL - INTERACTIVE STEP-BY-STEP GUIDANCE:
When helping troubleshoot:
- Give ONLY ONE step at a time
- Wait for user to confirm they completed it
- Then give the NEXT step
- Example: "First, check if the outlet has power. Let me know when you've checked."

CRITICAL - PHONE CALL FORMAT (NO TEXT SYMBOLS):
This is a PHONE CALL, not text chat. NEVER use ANY symbols:

❌ NEVER USE: asterisks (**), dashes (-), hashtags (#), parentheses for asides, or ANY formatting symbols
✅ ALWAYS USE: Plain speech only - "First", "Next", "Important", etc.

Speak exactly as if you're talking face-to-face. Use words only, no symbols.

Keep responses conversational and helpful. Make them feel supported. Give ONE step at a time.`;
}

/**
 * Generate first message based on transcript availability
 * @param {string|null} transcript - Video transcript if available
 * @returns {string} - First message to user
 */
export function generateFirstMessage(transcript) {
  if (transcript) {
    // Generic greeting that works for any issue
    return `Hello! I've reviewed the video you uploaded. I can help you with what you've shown me. Are you ready to get started?`;
  }
  
  return "Hello, welcome to Home Maintenance Support. How can I assist you today?";
}


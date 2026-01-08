/**
 * Emergency Tool Service
 * Handles emergency situations and call transfers
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { logger } from '../utils/logger.js';
import { config } from '../config/env.js';

const PREFIX = 'Emergency';

/**
 * Tool: Transfer Emergency Call
 * Transfers call to emergency support number
 */
export const transferEmergencyCallTool = tool(
  async ({ reason }) => {
    try {
      logger.warn(PREFIX, `🚨 LIFE-THREATENING emergency detected: ${reason}`);
      
      // Get emergency number from config or default to a placeholder
      const emergencyNumber = config.emergency.phoneNumber || '+1234567890';
      
      if (!config.emergency.phoneNumber) {
        logger.error(PREFIX, 'Emergency phone number not configured in .env');
      }
      
      logger.success(PREFIX, `Will instruct user to call: ${emergencyNumber}`);
      
      // Return signal for controller to handle
      return `EMERGENCY_TRANSFER:${emergencyNumber}:${reason}`;
      
    } catch (error) {
      logger.error(PREFIX, 'Error processing emergency:', error);
      return 'EMERGENCY_TRANSFER:911:emergency situation';
    }
  },
  {
    name: 'transfer_emergency_call',
    description: `IMMEDIATE emergency transfer when user cannot call 911 themselves.

⚠️ CRITICAL - USE IMMEDIATELY when user says:
- "I can't call 911"
- "I can't hang up"
- "My phone is broken"
- "Can you call for me?"
- "I can't leave [person/situation]"
- ANY indication they cannot call 911 themselves

Requirements:
1. You MUST have already told them to call 911 first
2. They indicated they CANNOT call 911 (for any reason)
3. The situation is life-threatening

When these conditions are met:
→ Use this tool IMMEDIATELY
→ NO follow-up questions
→ NO delays
→ Every second counts in emergencies

AFTER using this tool, you MUST say EXACTLY:
"I'm transferring you to our emergency response team immediately. Please stay on the line."

DO NOT say:
- "They will call 911 for you"
- "They will contact emergency services"
- Any other phrases

DO NOT use this tool if:
- You haven't told them to call 911 yet
- They just mentioned an emergency (tell them 911 first!)
- It's a minor issue (slow heater, small leak)
- User just wants faster service`,
    schema: z.object({
      reason: z.string().describe('Brief description of the emergency situation requiring transfer (e.g., "gas leak with injured person")'),
    }),
  }
);

/**
 * Tool: Transfer Urgent Home Maintenance Call
 * For urgent home issues that need immediate professional response (but not 911)
 */
export const transferUrgentMaintenanceTool = tool(
  async ({ issue, urgency }) => {
    try {
      logger.warn(PREFIX, `⚠️ URGENT MAINTENANCE issue detected: ${issue}`);
      
      // Get emergency number from config
      const emergencyNumber = config.emergency.phoneNumber;
      
      if (!config.emergency.phoneNumber) {
        logger.error(PREFIX, 'Emergency phone number not configured in .env');
      }
      
      logger.success(PREFIX, `Transferring to maintenance emergency line: ${emergencyNumber}`);
      
      // Return signal for controller to handle
      return `EMERGENCY_TRANSFER:${emergencyNumber}:urgent_maintenance_${issue}`;
      
    } catch (error) {
      logger.error(PREFIX, 'Error processing urgent maintenance transfer:', error);
      return `EMERGENCY_TRANSFER:${config.emergency.phoneNumber}:urgent_maintenance`;
    }
  },
  {
    name: 'transfer_urgent_maintenance',
    description: `Transfer to emergency maintenance team for URGENT home issues requiring IMMEDIATE professional response.

⚠️ USE THIS TOOL for urgent home maintenance emergencies like:
- Major water leak or flooding (burst pipe, water heater leak, ceiling leak)
- Complete electrical failure (no power in entire house)
- Gas smell (but user has NO symptoms like dizziness/nausea)
- HVAC total failure in extreme weather (freezing temps, heatwave)
- Sewage backup into living areas
- Water heater malfunction with flooding
- Furnace failure in winter
- Major appliance leaking causing damage

When to use:
→ Issue requires IMMEDIATE professional response (plumber, electrician, HVAC tech)
→ Issue is causing or will cause significant damage if not addressed NOW
→ User cannot safely fix it themselves
→ Not life-threatening (no fire, no injuries, no gas symptoms)

After using this tool, say:
"This needs immediate professional attention. I'm transferring you to our emergency maintenance team who will dispatch help right away. Please stay on the line."

DO NOT use this tool for:
- Minor leaks (dripping faucet, small toilet leak)
- Partial power loss (one outlet, one light)
- Issues that can wait a few hours
- User wants to try fixing it themselves first
- Life-threatening emergencies (use transfer_emergency_call instead)`,
    schema: z.object({
      issue: z.string().describe('Brief description of the urgent maintenance issue (e.g., "major water leak flooding basement")'),
      urgency: z.string().describe('Why immediate professional help is needed (e.g., "water spreading rapidly, could damage electrical")'),
    }),
  }
);

/**
 * Tool: Transfer to Human Agent
 * When user explicitly requests to speak with a human/support agent
 */
export const transferToHumanAgentTool = tool(
  async ({ userRequest }) => {
    try {
      logger.log(PREFIX, `👤 User requesting human agent: ${userRequest}`);
      
      // Get emergency/support number from config
      const supportNumber = config.emergency.phoneNumber || '+1234567890';
      
      if (!config.emergency.phoneNumber) {
        logger.error(PREFIX, 'Support phone number not configured in .env');
      }
      
      logger.success(PREFIX, `Transferring to human support agent: ${supportNumber}`);
      
      // Return signal for controller to handle
      return `EMERGENCY_TRANSFER:${supportNumber}:human_agent_requested`;
      
    } catch (error) {
      logger.error(PREFIX, 'Error processing human agent transfer:', error);
      return `EMERGENCY_TRANSFER:${config.emergency.phoneNumber}:human_agent_requested`;
    }
  },
  {
    name: 'transfer_to_human_agent',
    description: `Transfer the call to a human support agent when user EXPLICITLY requests to speak with a person.

⚠️ USE THIS TOOL when user says:
- "I want to talk to a human"
- "Can I speak to a person?"
- "Transfer me to an agent"
- "I want to speak with support"
- "Get me a real person"
- "I need to talk to someone"
- "Connect me to a human"
- "I don't want to talk to AI"
- "Let me speak with your supervisor"
- "I want customer service"

When to use:
→ User explicitly requests human interaction
→ User is frustrated with AI assistance
→ User prefers human support over AI
→ User asks for supervisor/manager/agent

After using this tool, say:
"I understand you'd like to speak with a human agent. I'm transferring you to our support team now. Please stay on the line."

DO NOT use this tool if:
- User is just asking questions (answer them first)
- User hasn't explicitly asked for human transfer
- You can easily resolve their issue yourself
- It's an emergency (use emergency tools instead)`,
    schema: z.object({
      userRequest: z.string().describe('What the user said that indicates they want human support (e.g., "I want to talk to a person")'),
    }),
  }
);

/**
 * Create emergency tools array
 * @returns {Array} - Array of emergency tools
 */
export function createEmergencyTools() {
  logger.log(PREFIX, 'Emergency and support transfer tools initialized');
  return [transferEmergencyCallTool, transferUrgentMaintenanceTool, transferToHumanAgentTool];
}


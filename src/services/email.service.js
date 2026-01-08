/**
 * Email Service
 * Sends call summaries and notifications via email
 */

import nodemailer from 'nodemailer';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

const PREFIX = 'Email';

// Create reusable transporter
let transporter = null;

/**
 * Initialize email transporter
 */
function initializeTransporter() {
  if (transporter) return transporter;

  try {
    transporter = nodemailer.createTransport({
      service: config.email.service,
      host: config.email.host,
      port: config.email.port,
      secure: config.email.secure,
      auth: {
        user: config.email.user,
        pass: config.email.password,
      },
    });

    logger.log(PREFIX, `Email transporter initialized (${config.email.service})`);
    return transporter;
  } catch (error) {
    logger.error(PREFIX, 'Failed to initialize email transporter:', error);
    return null;
  }
}

/**
 * Generate AI summary of the conversation
 * @param {Array} messages - Conversation messages
 * @returns {string} - Summary text
 */
function generateCallSummary(messages) {
  // Extract conversation content
  const userMessages = [];
  const agentMessages = [];
  
  messages.forEach((msg) => {
    const isUser = msg._getType() === 'human';
    const isAI = msg._getType() === 'ai';
    
    if (isUser) {
      userMessages.push(msg.content);
    } else if (isAI) {
      agentMessages.push(msg.content);
    }
  });
  
  // Generate simple summary
  let summary = '';
  
  if (userMessages.length === 0) {
    summary = 'No conversation recorded. Call may have been disconnected immediately.';
  } else {
    // User's main issue (first message usually)
    const userIssue = userMessages[0];
    summary += `<strong>User's Issue:</strong> ${userIssue}\n\n`;
    
    // Key points from conversation
    summary += `<strong>Conversation Summary:</strong>\n`;
    summary += `• Total exchanges: ${Math.min(userMessages.length, agentMessages.length)} back-and-forth\n`;
    
    // Check for common patterns
    const hasVideo = agentMessages.some(msg => msg.toLowerCase().includes('video'));
    const hasEmergency = agentMessages.some(msg => 
      msg.toLowerCase().includes('emergency') || 
      msg.toLowerCase().includes('911') || 
      msg.toLowerCase().includes('danger')
    );
    const hasTroubleshooting = agentMessages.some(msg => 
      msg.toLowerCase().includes('step') || 
      msg.toLowerCase().includes('first') ||
      msg.toLowerCase().includes('check') ||
      msg.toLowerCase().includes('turn off')
    );
    
    if (hasVideo) {
      summary += `• Agent referenced user's uploaded video\n`;
    }
    if (hasEmergency) {
      summary += `• ⚠️ Emergency situation detected and handled\n`;
    }
    if (hasTroubleshooting) {
      summary += `• Technical troubleshooting steps provided\n`;
    }
    
    // Last agent response (resolution or next steps)
    if (agentMessages.length > 0) {
      const lastResponse = agentMessages[agentMessages.length - 1];
      summary += `\n<strong>Agent's Final Response:</strong> ${lastResponse.substring(0, 200)}${lastResponse.length > 200 ? '...' : ''}`;
    }
  }
  
  return summary.replace(/\n/g, '<br>');
}

/**
 * Generate call summary statistics
 * @param {Object} callData - Call data object
 * @returns {Object} - Statistics
 */
function generateStatistics(callData) {
  const messageCount = callData.messages?.length || 0;
  const userMessages = callData.messages?.filter(m => m._getType() === 'human').length || 0;
  const agentMessages = callData.messages?.filter(m => m._getType() === 'ai').length || 0;
  
  return {
    totalMessages: messageCount,
    userMessages,
    agentMessages,
    hadVideo: callData.hasVideo || false,
    hadTranscript: callData.transcriptId ? true : false,
    duration: callData.duration || 'Unknown',
  };
}

/**
 * Send call summary email
 * @param {Object} callData - Call summary data
 * @returns {Promise<boolean>} - Success status
 */
export async function sendCallSummary(callData) {
  try {
    const transport = initializeTransporter();
    
    if (!transport) {
      logger.error(PREFIX, 'Email transporter not initialized');
      return false;
    }

    if (!config.email.user || !config.email.password) {
      logger.warn(PREFIX, 'Email credentials not configured');
      return false;
    }

    logger.log(PREFIX, `Preparing call summary email for call: ${callData.callId}`);

    const stats = generateStatistics(callData);
    const callSummary = generateCallSummary(callData.messages || []);
    
    // Generate email subject
    const subject = callData.emergencyDetected 
      ? `🚨 EMERGENCY Call Summary - ${callData.callId}`
      : `Call Summary - ${callData.callId}`;

    // Generate email body
    const htmlBody = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 800px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px; margin-bottom: 30px; }
          .header h1 { margin: 0; font-size: 28px; }
          .header p { margin: 10px 0 0 0; opacity: 0.9; }
          .stats { display: flex; flex-wrap: wrap; gap: 15px; margin-bottom: 30px; }
          .stat-card { background: #f8f9fa; padding: 15px; border-radius: 8px; flex: 1; min-width: 150px; border-left: 4px solid #667eea; }
          .stat-card .label { font-size: 12px; color: #666; text-transform: uppercase; margin-bottom: 5px; }
          .stat-card .value { font-size: 24px; font-weight: bold; color: #333; }
          .section { margin-bottom: 30px; }
          .section h2 { color: #667eea; border-bottom: 2px solid #667eea; padding-bottom: 10px; }
          .emergency-badge { background: #ff5252; color: white; padding: 5px 15px; border-radius: 20px; font-weight: bold; display: inline-block; margin-left: 10px; }
          .footer { text-align: center; color: #999; font-size: 12px; margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Call Summary Report ${callData.emergencyDetected ? '<span class="emergency-badge">EMERGENCY</span>' : ''}</h1>
            <p>Call ID: ${callData.callId}</p>
            <p>Timestamp: ${new Date().toLocaleString()}</p>
          </div>

          <div class="stats">
            <div class="stat-card">
              <div class="label">Total Messages</div>
              <div class="value">${stats.totalMessages}</div>
            </div>
            <div class="stat-card">
              <div class="label">User Messages</div>
              <div class="value">${stats.userMessages}</div>
            </div>
            <div class="stat-card">
              <div class="label">Agent Messages</div>
              <div class="value">${stats.agentMessages}</div>
            </div>
            <div class="stat-card">
              <div class="label">Call Duration</div>
              <div class="value">${stats.duration}</div>
            </div>
          </div>

          <div class="section">
            <h2>Call Details</h2>
            <table style="width: 100%; border-collapse: collapse;">
              <tr style="background: #f8f9fa;">
                <td style="padding: 10px; border: 1px solid #dee2e6;"><strong>Phone Number</strong></td>
                <td style="padding: 10px; border: 1px solid #dee2e6;">${callData.phoneNumber || 'Unknown'}</td>
              </tr>
              <tr>
                <td style="padding: 10px; border: 1px solid #dee2e6;"><strong>Agent Type</strong></td>
                <td style="padding: 10px; border: 1px solid #dee2e6;">${stats.hadTranscript ? 'Technical Support' : 'Receptionist'}</td>
              </tr>
              <tr style="background: #f8f9fa;">
                <td style="padding: 10px; border: 1px solid #dee2e6;"><strong>Video Available</strong></td>
                <td style="padding: 10px; border: 1px solid #dee2e6;">${stats.hadVideo ? '✓ Yes' : '✗ No'}</td>
              </tr>
              <tr>
                <td style="padding: 10px; border: 1px solid #dee2e6;"><strong>Transcript ID</strong></td>
                <td style="padding: 10px; border: 1px solid #dee2e6;">${callData.transcriptId || 'N/A'}</td>
              </tr>
              ${callData.recordingUrl ? `
              <tr style="background: #e8f5e9;">
                <td style="padding: 10px; border: 1px solid #dee2e6;"><strong>🎧 Call Recording</strong></td>
                <td style="padding: 10px; border: 1px solid #dee2e6;">
                  <a href="${callData.recordingUrl}" style="color: #2e7d32; text-decoration: none; font-weight: bold;">
                    ▶ Listen to Recording
                  </a>
                </td>
              </tr>
              ` : ''}
              ${callData.emergencyDetected ? `
              <tr style="background: #ffebee;">
                <td style="padding: 10px; border: 1px solid #dee2e6;"><strong>⚠️ Emergency Status</strong></td>
                <td style="padding: 10px; border: 1px solid #dee2e6; color: #c62828;"><strong>EMERGENCY DETECTED</strong></td>
              </tr>
              <tr style="background: #ffebee;">
                <td style="padding: 10px; border: 1px solid #dee2e6;"><strong>Emergency Reason</strong></td>
                <td style="padding: 10px; border: 1px solid #dee2e6;">${callData.emergencyReason || 'N/A'}</td>
              </tr>
              ` : ''}
            </table>
          </div>

          <div class="section">
            <h2>Call Summary</h2>
            <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; border-left: 4px solid #667eea; line-height: 1.8;">
              ${callSummary}
            </div>
          </div>
          
          ${callData.recordingUrl ? `
          <div class="section">
            <h2>📞 Call Recording</h2>
            <div style="background: #e8f5e9; padding: 20px; border-radius: 8px; text-align: center;">
              <p style="margin: 0 0 15px 0; color: #2e7d32;">
                <strong>Full call audio is available for review:</strong>
              </p>
              <a href="${callData.recordingUrl}" 
                 style="display: inline-block; background: #4caf50; color: white; padding: 12px 30px; 
                        text-decoration: none; border-radius: 5px; font-weight: bold;">
                ▶ Listen to Full Call Recording
              </a>
              <p style="margin: 15px 0 0 0; color: #666; font-size: 12px;">
                Click to play or download the complete call audio
              </p>
            </div>
          </div>
          ` : ''}

          ${callData.notes ? `
          <div class="section">
            <h2>Additional Notes</h2>
            <p style="background: #fff3cd; padding: 15px; border-radius: 8px; border-left: 4px solid #ffc107;">
              ${callData.notes}
            </p>
          </div>
          ` : ''}

          <div class="footer">
            <p>This is an automated call summary from Home Maintenance Voice Agent System</p>
            <p>Generated at ${new Date().toISOString()}</p>
          </div>
        </div>
      </body>
      </html>
    `;

    // Send email
    const info = await transport.sendMail({
      from: `"Home Maintenance AI" <${config.email.from || config.email.user}>`,
      to: config.email.to,
      subject: subject,
      html: htmlBody,
    });

    logger.success(PREFIX, `Call summary email sent: ${info.messageId}`);
    logger.log(PREFIX, `Email sent to: ${config.email.to}`);
    
    return true;

  } catch (error) {
    logger.error(PREFIX, 'Failed to send call summary email:', error);
    return false;
  }
}

/**
 * Send emergency alert email
 * @param {Object} emergencyData - Emergency details
 * @returns {Promise<boolean>} - Success status
 */
export async function sendEmergencyAlert(emergencyData) {
  try {
    const transport = initializeTransporter();
    
    if (!transport) {
      logger.error(PREFIX, 'Email transporter not initialized');
      return false;
    }

    const isUrgent = emergencyData.isUrgentMaintenance;
    const alertType = isUrgent ? 'URGENT MAINTENANCE' : 'EMERGENCY';
    const alertIcon = isUrgent ? '⚠️' : '🚨';
    const alertColor = isUrgent ? '#ff9800' : '#ff5252'; // Orange for urgent, red for emergency

    logger.warn(PREFIX, `Sending ${alertType} alert email for call: ${emergencyData.callId}`);

    const actionTaken = isUrgent 
      ? `Call transferred to emergency maintenance team at ${emergencyData.emergencyNumber}. Professional help being dispatched.`
      : `User instructed to call 911. If unable, call transferred to emergency team at ${emergencyData.emergencyNumber}.`;

    const htmlBody = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .alert { background: ${alertColor}; color: white; padding: 20px; border-radius: 10px; text-align: center; margin-bottom: 20px; }
          .alert h1 { margin: 0; font-size: 32px; }
          .details { background: #f8f9fa; padding: 20px; border-radius: 8px; border-left: 4px solid ${alertColor}; }
          .details p { margin: 10px 0; }
          .details strong { color: ${alertColor}; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="alert">
            <h1>${alertIcon} ${alertType} ALERT</h1>
            <p style="margin: 10px 0 0 0; font-size: 18px;">Immediate Action Required</p>
          </div>
          
          <div class="details">
            <p><strong>Call ID:</strong> ${emergencyData.callId}</p>
            <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
            <p><strong>User Phone:</strong> ${emergencyData.userPhone || 'Unknown'}</p>
            <p><strong>${isUrgent ? 'Issue' : 'Emergency'} Type:</strong> ${emergencyData.reason}</p>
            <p><strong>Action Taken:</strong> ${actionTaken}</p>
          </div>

          <p style="margin-top: 20px; color: #666;">
            This is an automated alert. ${isUrgent ? 'Please ensure technician is dispatched promptly.' : 'Please review for follow-up as necessary.'}
          </p>
        </div>
      </body>
      </html>
    `;

    await transport.sendMail({
      from: `"Home Maintenance AI - ${alertType}" <${config.email.from || config.email.user}>`,
      to: config.email.to,
      subject: `${alertIcon} ${alertType} ALERT - ${emergencyData.reason}`,
      html: htmlBody,
      priority: 'high',
    });

    logger.success(PREFIX, `${alertType} alert email sent`);
    return true;

  } catch (error) {
    logger.error(PREFIX, `Failed to send ${emergencyData.isUrgentMaintenance ? 'urgent maintenance' : 'emergency'} alert:`, error);
    return false;
  }
}

/**
 * Test email configuration
 * @returns {Promise<boolean>} - Success status
 */
export async function testEmailConfiguration() {
  try {
    const transport = initializeTransporter();
    
    if (!transport) {
      return false;
    }

    await transport.verify();
    logger.success(PREFIX, 'Email configuration verified successfully');
    return true;

  } catch (error) {
    logger.error(PREFIX, 'Email configuration test failed:', error);
    return false;
  }
}


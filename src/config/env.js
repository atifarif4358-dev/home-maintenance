/**
 * Environment Configuration
 * Centralized configuration management
 */

import dotenv from 'dotenv';

dotenv.config();

export const config = {
  // Server Configuration
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',

  // Supabase Configuration
  supabase: {
    url: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY,
  },

  // Retell AI Configuration
  retell: {
    apiKey: process.env.RETELL_API_KEY,
    agentId: process.env.RETELL_AGENT_ID,
    phoneNumber: process.env.RETELL_PHONE_NUMBER,
    /** When set, used as caller phone when testing via Retell web (no from_number). E.g. your real number that has transcripts. */
    testPhoneNumber: process.env.RETELL_TEST_PHONE_NUMBER || null,
  },

  // OpenAI Configuration
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || 'gpt-4',
    visionModel: process.env.OPENAI_VISION_MODEL || 'gpt-4o', // gpt-4o or gpt-4-vision-preview
    temperature: parseFloat(process.env.OPENAI_TEMPERATURE || '0.7'),
  },


  // Pinecone Configuration
  pinecone: {
    apiKey: process.env.PINECONE_API_KEY,
    environment: process.env.PINECONE_ENVIRONMENT,
    indexName: process.env.PINECONE_INDEX_NAME || 'home-maintenance-docs',
  },

  // Emergency Configuration
  emergency: {
    phoneNumber: process.env.EMERGENCY_TRANSFER_NUMBER,
  },

  // Email Configuration (Resend)
  email: {
    apiKey: process.env.RESEND_API_KEY,
    from: process.env.EMAIL_FROM || 'Home Maintenance AI <onboarding@resend.dev>',
    to: process.env.EMAIL_TO,
  },
};

/**
 * Validate required environment variables
 */
export function validateConfig() {
  const required = [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'OPENAI_API_KEY',
  ];

  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:');
    missing.forEach(key => console.error(`   - ${key}`));
    return false;
  }

  return true;
}


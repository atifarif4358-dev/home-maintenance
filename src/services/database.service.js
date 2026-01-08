/**
 * Database Service
 * Handles all Supabase database operations
 */

import { createClient } from '@supabase/supabase-js';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

const PREFIX = 'Database';

// Initialize Supabase client
const supabase = createClient(config.supabase.url, config.supabase.anonKey);

/**
 * Lookup transcript by phone number from Supabase
 * @param {string} phoneNumber - The user's phone number
 * @returns {Promise<string|null>} - The transcript text if found, null otherwise
 */
export async function findTranscriptByPhone(phoneNumber) {
  try {
    logger.log(PREFIX, `Looking up transcript for phone: ${phoneNumber}`);
    
    // Query the transcript table with explicit column selection
    // Order by created_at DESC to get the latest transcript
    const { data, error } = await supabase
      .from('transcript')
      .select('name, "phoneNumber", transcript, created_at')
      .eq('phoneNumber', phoneNumber)
      .order('created_at', { ascending: false })
      .limit(1);
    
    if (error) {
      logger.error(PREFIX, 'Supabase error:', error);
      logger.debug(PREFIX, 'Error details:', JSON.stringify(error, null, 2));
      return null;
    }
    
    logger.debug(PREFIX, 'Query result:', data);
    
    // Check if we got any results
    if (!data || data.length === 0) {
      logger.log(PREFIX, `✗ No transcript found for ${phoneNumber}`);
      return null;
    }
    
    // Get the first result (latest)
    const record = data[0];
    
    if (record && record.transcript) {
      logger.success(PREFIX, `Transcript found for ${phoneNumber} (Name: ${record.name})`);
      logger.info(PREFIX, `Created at: ${record.created_at} (Latest)`);
      logger.debug(PREFIX, `Transcript preview: ${record.transcript.substring(0, 100)}...`);
      return record.transcript;
    }
    
    logger.log(PREFIX, `✗ No transcript found for ${phoneNumber}`);
    return null;
    
  } catch (error) {
    logger.error(PREFIX, 'Unexpected error:', error);
    logger.debug(PREFIX, 'Stack trace:', error.stack);
    return null;
  }
}

/**
 * Add a transcript to the database
 * @param {string} name - User's name
 * @param {string} phoneNumber - The phone number
 * @param {string} transcript - The transcript text
 * @returns {Promise<boolean>} - Success status
 */
export async function addTranscript(name, phoneNumber, transcript) {
  try {
    logger.log(PREFIX, `Adding transcript for ${phoneNumber}`);
    
    const { data, error } = await supabase
      .from('transcript')
      .insert([{ name, phoneNumber, transcript }])
      .select();
    
    if (error) {
      logger.error(PREFIX, 'Error inserting transcript:', error);
      return false;
    }
    
    logger.success(PREFIX, `Transcript added successfully for ${phoneNumber}`);
    return true;
    
  } catch (error) {
    logger.error(PREFIX, 'Unexpected error:', error);
    return false;
  }
}

/**
 * Update an existing transcript
 * @param {string} phoneNumber - The phone number
 * @param {string} transcript - The new transcript text
 * @returns {Promise<boolean>} - Success status
 */
export async function updateTranscript(phoneNumber, transcript) {
  try {
    logger.log(PREFIX, `Updating transcript for ${phoneNumber}`);
    
    const { data, error } = await supabase
      .from('transcript')
      .update({ transcript })
      .eq('phoneNumber', phoneNumber)
      .select();
    
    if (error) {
      logger.error(PREFIX, 'Error updating transcript:', error);
      return false;
    }
    
    logger.success(PREFIX, `Transcript updated successfully for ${phoneNumber}`);
    return true;
    
  } catch (error) {
    logger.error(PREFIX, 'Unexpected error:', error);
    return false;
  }
}

/**
 * Fetch video frames by transcript ID
 * @param {number} transcriptId - The transcript ID
 * @param {number[]} timestamps - Optional specific timestamps to fetch (in seconds)
 * @returns {Promise<Array|null>} - Array of frame objects or null
 */
export async function fetchFramesByTranscriptId(transcriptId, timestamps = null) {
  try {
    logger.log(PREFIX, `Fetching frames for transcript ID: ${transcriptId}`);
    
    let query = supabase
      .from('frame')
      .select('id, frame_storage_url, frame_timestamp, transcript_id, created_at')
      .eq('transcript_id', transcriptId)
      .order('frame_timestamp', { ascending: true });
    
    // If specific timestamps requested, filter by them
    if (timestamps && timestamps.length > 0) {
      logger.debug(PREFIX, `Filtering frames for timestamps: ${timestamps.join(', ')}`);
      query = query.in('frame_timestamp', timestamps);
    }
    
    const { data, error } = await query;
    
    if (error) {
      logger.error(PREFIX, 'Error fetching frames:', error);
      return null;
    }
    
    if (!data || data.length === 0) {
      logger.log(PREFIX, `No frames found for transcript ID: ${transcriptId}`);
      return [];
    }
    
    logger.success(PREFIX, `Found ${data.length} frame(s) for transcript ID: ${transcriptId}`);
    return data;
    
  } catch (error) {
    logger.error(PREFIX, 'Unexpected error fetching frames:', error);
    return null;
  }
}

/**
 * Get all available frame timestamps for a transcript
 * @param {number} transcriptId - The transcript ID
 * @returns {Promise<number[]|null>} - Array of timestamps or null
 */
export async function getAvailableFrameTimestamps(transcriptId) {
  try {
    const { data, error } = await supabase
      .from('frame')
      .select('frame_timestamp')
      .eq('transcript_id', transcriptId)
      .order('frame_timestamp', { ascending: true });
    
    if (error) {
      logger.error(PREFIX, 'Error fetching frame timestamps:', error);
      return null;
    }
    
    const timestamps = data.map(frame => frame.frame_timestamp);
    logger.debug(PREFIX, `Available timestamps: ${timestamps.join(', ')}`);
    return timestamps;
    
  } catch (error) {
    logger.error(PREFIX, 'Unexpected error:', error);
    return null;
  }
}

/**
 * Get transcript with associated metadata (including transcript_id for frames)
 * @param {string} phoneNumber - The user's phone number
 * @returns {Promise<Object|null>} - Transcript object with metadata or null
 */
export async function getTranscriptWithMetadata(phoneNumber) {
  try {
    logger.log(PREFIX, `Looking up transcript with metadata for phone: ${phoneNumber}`);
    
    const { data, error } = await supabase
      .from('transcript')
      .select('id, name, "phoneNumber", transcript, created_at')
      .eq('phoneNumber', phoneNumber)
      .order('created_at', { ascending: false })
      .limit(1);
    
    if (error) {
      logger.error(PREFIX, 'Supabase error:', error);
      return null;
    }
    
    if (!data || data.length === 0) {
      logger.log(PREFIX, `No transcript found for ${phoneNumber}`);
      return null;
    }
    
    const record = data[0];
    logger.success(PREFIX, `Transcript found (ID: ${record.id}, Name: ${record.name})`);
    
    return {
      transcriptId: record.id,
      name: record.name,
      phoneNumber: record.phoneNumber,
      transcript: record.transcript,
      createdAt: record.created_at
    };
    
  } catch (error) {
    logger.error(PREFIX, 'Unexpected error:', error);
    return null;
  }
}

/**
 * Save RAG document to database
 * @param {Object} documentData - Document data
 * @returns {Promise<Object|null>} - Saved document or null
 */
export async function saveRAGDocument(documentData) {
  try {
    logger.log(PREFIX, `Saving RAG document: ${documentData.fileName}`);
    
    const { data, error } = await supabase
      .from('rag_documents')
      .insert([{
        file_name: documentData.fileName,
        file_type: documentData.fileType,
        file_size: documentData.fileSize,
        text_content: documentData.textContent,
        chunk_count: documentData.chunkCount,
        storage_url: documentData.storageUrl,
      }])
      .select()
      .single();
    
    if (error) {
      logger.error(PREFIX, 'Error saving document:', error);
      return null;
    }
    
    logger.success(PREFIX, `Document saved with ID: ${data.id}`);
    return data;
    
  } catch (error) {
    logger.error(PREFIX, 'Unexpected error:', error);
    return null;
  }
}

/**
 * Get RAG document by ID
 * @param {string} documentId - Document ID
 * @returns {Promise<Object|null>} - Document or null
 */
export async function getRAGDocument(documentId) {
  try {
    const { data, error } = await supabase
      .from('rag_documents')
      .select('*')
      .eq('id', documentId)
      .single();
    
    if (error) {
      logger.error(PREFIX, 'Error fetching document:', error);
      return null;
    }
    
    return data;
    
  } catch (error) {
    logger.error(PREFIX, 'Unexpected error:', error);
    return null;
  }
}

/**
 * List all RAG documents
 * @returns {Promise<Array>} - Array of documents
 */
export async function listRAGDocuments() {
  try {
    const { data, error } = await supabase
      .from('rag_documents')
      .select('id, file_name, file_type, file_size, chunk_count, created_at')
      .order('created_at', { ascending: false });
    
    if (error) {
      logger.error(PREFIX, 'Error listing documents:', error);
      return [];
    }
    
    return data;
    
  } catch (error) {
    logger.error(PREFIX, 'Unexpected error:', error);
    return [];
  }
}

/**
 * Test database connection
 * @returns {Promise<boolean>} - Connection status
 */
export async function testConnection() {
  try {
    logger.log(PREFIX, 'Testing Supabase connection...');
    
    const { data, error } = await supabase
      .from('transcript')
      .select('count')
      .limit(1);
    
    if (error) {
      logger.error(PREFIX, 'Connection test failed:', error.message);
      return false;
    }
    
    logger.success(PREFIX, 'Supabase connection successful');
    return true;
    
  } catch (error) {
    logger.error(PREFIX, 'Connection test failed:', error);
    return false;
  }
}


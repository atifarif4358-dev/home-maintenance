/**
 * Embedding Service
 * Creates embeddings using OpenAI
 */

import { OpenAIEmbeddings } from '@langchain/openai';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

const PREFIX = 'Embeddings';

// Initialize OpenAI embeddings
const embeddings = new OpenAIEmbeddings({
  openAIApiKey: config.openai.apiKey,
  modelName: 'text-embedding-3-small', // or text-embedding-ada-002
});

/**
 * Create embeddings for text chunks
 * @param {Array<string>} textChunks - Array of text chunks
 * @returns {Promise<Array<number[]>>} - Array of embeddings
 */
export async function createEmbeddings(textChunks) {
  try {
    logger.log(PREFIX, `Creating embeddings for ${textChunks.length} chunks...`);
    
    const embeddingVectors = await embeddings.embedDocuments(textChunks);
    
    logger.success(PREFIX, `Created ${embeddingVectors.length} embeddings`);
    return embeddingVectors;
    
  } catch (error) {
    logger.error(PREFIX, 'Error creating embeddings:', error);
    throw error;
  }
}

/**
 * Create embedding for a single query
 * @param {string} query - Query text
 * @returns {Promise<number[]>} - Embedding vector
 */
export async function createQueryEmbedding(query) {
  try {
    logger.log(PREFIX, 'Creating query embedding...');
    
    const embeddingVector = await embeddings.embedQuery(query);
    
    logger.success(PREFIX, 'Query embedding created');
    return embeddingVector;
    
  } catch (error) {
    logger.error(PREFIX, 'Error creating query embedding:', error);
    throw error;
  }
}




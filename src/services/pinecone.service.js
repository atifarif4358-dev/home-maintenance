/**
 * Pinecone Service
 * Handles vector database operations
 */

import { Pinecone } from '@pinecone-database/pinecone';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';

const PREFIX = 'Pinecone';

// Initialize Pinecone client
let pinecone = null;
let index = null;

/**
 * Initialize Pinecone connection
 */
async function initializePinecone() {
  if (pinecone) return;

  try {
    logger.log(PREFIX, 'Initializing Pinecone...');
    
    pinecone = new Pinecone({
      apiKey: config.pinecone.apiKey,
    });

    index = pinecone.index(config.pinecone.indexName);
    
    logger.success(PREFIX, `Connected to index: ${config.pinecone.indexName}`);
  } catch (error) {
    logger.error(PREFIX, 'Failed to initialize Pinecone:', error);
    throw error;
  }
}

/**
 * Upsert document embeddings to Pinecone
 * @param {string} documentId - Document ID from Supabase
 * @param {Array<string>} textChunks - Text chunks
 * @param {Array<number[]>} embeddings - Embedding vectors
 * @param {Object} metadata - Document metadata
 * @returns {Promise<void>}
 */
export async function upsertDocumentEmbeddings(documentId, textChunks, embeddings, metadata) {
  try {
    await initializePinecone();
    
    logger.log(PREFIX, `Upserting ${embeddings.length} vectors for document ${documentId}...`);

    // Prepare vectors for upsert
    const vectors = embeddings.map((embedding, index) => ({
      id: `${documentId}_chunk_${index}`,
      values: embedding,
      metadata: {
        documentId,
        chunkIndex: index,
        text: textChunks[index],
        fileName: metadata.fileName,
        fileType: metadata.fileType,
        uploadedAt: metadata.uploadedAt,
      }
    }));

    // Upsert in batches of 100 (Pinecone limit)
    const batchSize = 100;
    for (let i = 0; i < vectors.length; i += batchSize) {
      const batch = vectors.slice(i, i + batchSize);
      await index.upsert(batch);
      logger.log(PREFIX, `Upserted batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(vectors.length / batchSize)}`);
    }

    logger.success(PREFIX, `Successfully upserted ${vectors.length} vectors`);
  } catch (error) {
    logger.error(PREFIX, 'Error upserting to Pinecone:', error);
    throw error;
  }
}

/**
 * Search for similar documents
 * @param {number[]} queryEmbedding - Query embedding vector
 * @param {number} topK - Number of results to return
 * @returns {Promise<Array>} - Search results
 */
export async function searchSimilarDocuments(queryEmbedding, topK = 5) {
  try {
    await initializePinecone();
    
    logger.log(PREFIX, `Searching for top ${topK} similar documents...`);

    const results = await index.query({
      vector: queryEmbedding,
      topK: topK,
      includeMetadata: true,
    });

    logger.success(PREFIX, `Found ${results.matches.length} matches`);
    console.log('Results:', results.matches);
    return results.matches;
    
  } catch (error) {
    logger.error(PREFIX, 'Error searching Pinecone:', error);
    throw error;
  }
}

/**
 * Delete document vectors from Pinecone
 * @param {string} documentId - Document ID
 * @returns {Promise<void>}
 */
export async function deleteDocumentVectors(documentId) {
  try {
    await initializePinecone();
    
    logger.log(PREFIX, `Deleting vectors for document ${documentId}...`);

    // Delete all vectors with this document ID prefix
    await index.deleteMany({
      filter: { documentId: { $eq: documentId } }
    });

    logger.success(PREFIX, `Deleted vectors for document ${documentId}`);
  } catch (error) {
    logger.error(PREFIX, 'Error deleting from Pinecone:', error);
    throw error;
  }
}




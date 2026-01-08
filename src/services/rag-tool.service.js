/**
 * RAG Tool Service
 * Tool for searching knowledge base during calls
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { createQueryEmbedding } from './embedding.service.js';
import { searchSimilarDocuments } from './pinecone.service.js';
import { logger } from '../utils/logger.js';

const PREFIX = 'RAG-Tool';

/**
 * Tool: Search Knowledge Base
 * Allows the agent to search documentation during calls
 */
export const searchKnowledgeBaseTool = tool(
  async ({ query }) => {
    try {
      logger.log(PREFIX, `Agent searching knowledge base: "${query}"`);
      
      // Create embedding for the query
      const queryEmbedding = await createQueryEmbedding(query);
      
      // Search Pinecone for similar documents
      const results = await searchSimilarDocuments(queryEmbedding, 3); // Top 3 results
      
      if (!results || results.length === 0) {
        logger.warn(PREFIX, 'No relevant documents found');
        return 'No relevant information found in the knowledge base for this query. You may need to provide guidance based on general best practices.';
      }
      
      // Format results into readable text
      let responseText = `Found ${results.length} relevant section(s) in the documentation:\n\n`;
      
      results.forEach((match, index) => {
        const score = match.score?.toFixed(3) || 'N/A';
        const source = match.metadata?.fileName || 'Unknown';
        const content = match.metadata?.text || '';
        
        responseText += `Result ${index + 1} (Relevance: ${score}, Source: ${source}):\n`;
        responseText += `${content}\n\n`;
      });
      
      logger.success(PREFIX, `Found ${results.length} relevant document(s)`);
      
      // Return as plain text for better agent understanding
      return responseText;
      
    } catch (error) {
      logger.error(PREFIX, 'Error searching knowledge base:', error);
      return 'Unable to access the knowledge base at the moment. Please provide guidance based on general best practices.';
    }
  },
  {
    name: 'search_knowledge_base',
    description: `Search the technical documentation and knowledge base for information about home maintenance repairs, troubleshooting steps, safety procedures, and technical specifications.
    
    Use this tool when:
    - You need specific repair instructions or procedures
    - User asks about a technical detail you're unsure about
    - You need to verify safety steps or requirements
    - You want to provide accurate technical specifications
    
    Examples:
    - "How to replace HVAC air filter"
    - "Electrical safety procedures before repair"
    - "Troubleshooting steps for water heater not heating"
    - "Required tools for pipe replacement"`,
    schema: z.object({
      query: z.string().describe('Your search query - be specific about what information you need from the documentation'),
    }),
  }
);

/**
 * Create RAG-enabled tools array
 * @param {number|null} transcriptId - Transcript ID for video tools (optional)
 * @returns {Array} - Array of tools
 */
export function createRAGTools(transcriptId = null) {
  const tools = [searchKnowledgeBaseTool];
  
  logger.log(PREFIX, 'RAG tool initialized');
  
  return tools;
}


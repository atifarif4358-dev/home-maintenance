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
    description: `CRITICAL: Search the uploaded technical documentation and knowledge base for SPECIFIC repair instructions, troubleshooting procedures, safety steps, and technical details.

    ⚠️ ALWAYS USE THIS TOOL when the user mentions:
    - HVAC systems, air conditioning, heating, furnaces, thermostats, air filters, ductwork
    - Plumbing issues, pipes, water heaters, drains, faucets, toilets
    - Electrical problems, outlets, switches, circuit breakers, wiring
    - Appliances, refrigerators, dishwashers, washing machines, dryers
    - Any specific repair procedure, troubleshooting step, or technical specification
    
    IMPORTANT: Even if you think you know the answer, ALWAYS search the knowledge base FIRST to provide accurate, document-specific guidance. The uploaded documentation may contain specific procedures, safety requirements, or troubleshooting steps that differ from general knowledge.
    
    Use this tool BEFORE providing any detailed technical instructions or troubleshooting steps.
    
    Examples of when to use:
    - User: "My HVAC system isn't working" → Search for "HVAC troubleshooting"
    - User: "How do I replace an air filter?" → Search for "HVAC air filter replacement"
    - User: "My water heater won't heat" → Search for "water heater troubleshooting"
    - User: "Electrical outlet not working" → Search for "electrical outlet repair"
    - User: "Pipe is leaking" → Search for "pipe leak repair"`,
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


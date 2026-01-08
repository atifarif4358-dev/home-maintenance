/**
 * File Processor Service
 * Extracts text content from various file types
 */

import fs from 'fs/promises';
// import pdfParse from 'pdf-parse';
// import pdfParse from 'pdf-parse';
import * as pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { logger } from '../utils/logger.js';

const PREFIX = 'FileProcessor';

/**
 * Extract text from PDF file
 * @param {string} filePath - Path to PDF file
 * @returns {Promise<string>} - Extracted text
 */
async function extractTextFromPDF(filePath) {
  try {
    const dataBuffer = await fs.readFile(filePath);
    // const data = await pdfParse(dataBuffer);
    // const data = await pdfParse(dataBuffer);
    const data = await pdfParse.default(dataBuffer);
    logger.success(PREFIX, `Extracted ${data.text.length} characters from PDF`);
    return data.text;
  } catch (error) {
    logger.error(PREFIX, 'Error extracting PDF text:', error);
    throw new Error('Failed to extract text from PDF');
  }
}

/**
 * Extract text from DOC/DOCX file
 * @param {string} filePath - Path to DOC file
 * @returns {Promise<string>} - Extracted text
 */
async function extractTextFromDOC(filePath) {
  try {
    const result = await mammoth.extractRawText({ path: filePath });
    logger.success(PREFIX, `Extracted ${result.value.length} characters from DOC`);
    return result.value;
  } catch (error) {
    logger.error(PREFIX, 'Error extracting DOC text:', error);
    throw new Error('Failed to extract text from DOC');
  }
}

/**
 * Extract text from TXT file
 * @param {string} filePath - Path to TXT file
 * @returns {Promise<string>} - Extracted text
 */
async function extractTextFromTXT(filePath) {
  try {
    const text = await fs.readFile(filePath, 'utf-8');
    logger.success(PREFIX, `Extracted ${text.length} characters from TXT`);
    return text;
  } catch (error) {
    logger.error(PREFIX, 'Error reading TXT file:', error);
    throw new Error('Failed to read TXT file');
  }
}

/**
 * Process file and extract text based on file type
 * @param {string} filePath - Path to file
 * @param {string} mimeType - File MIME type
 * @returns {Promise<string>} - Extracted text
 */
export async function processFile(filePath, mimeType) {
  logger.log(PREFIX, `Processing file: ${filePath} (${mimeType})`);

  try {
    let text = '';
    
    // Get file extension as fallback
    const ext = filePath.toLowerCase().split('.').pop();
    
    // Check by MIME type or file extension
    if (mimeType === 'application/pdf' || ext === 'pdf') {
      text = await extractTextFromPDF(filePath);
    } else if (
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      mimeType === 'application/msword' ||
      mimeType === 'application/octet-stream' && (ext === 'docx' || ext === 'doc') ||
      ext === 'docx' || 
      ext === 'doc'
    ) {
      text = await extractTextFromDOC(filePath);
    } else if (mimeType === 'text/plain' || ext === 'txt') {
      text = await extractTextFromTXT(filePath);
    } else {
      throw new Error(`Unsupported file type: ${mimeType} with extension: .${ext}`);
    }

    // Clean up the text
    text = text.trim();

    if (!text || text.length === 0) {
      throw new Error('No text content found in file');
    }

    logger.success(PREFIX, `Successfully processed file: ${text.length} characters`);
    return text;

  } catch (error) {
    logger.error(PREFIX, 'Error processing file:', error);
    throw error;
  }
}

/**
 * Split text into chunks for embedding
 * @param {string} text - Text to split
 * @param {number} chunkSize - Size of each chunk
 * @param {number} overlap - Overlap between chunks
 * @returns {Array<string>} - Array of text chunks
 */
export function splitTextIntoChunks(text, chunkSize = 1000, overlap = 200) {
  const chunks = [];
  let startIndex = 0;

  while (startIndex < text.length) {
    const endIndex = Math.min(startIndex + chunkSize, text.length);
    const chunk = text.slice(startIndex, endIndex);
    chunks.push(chunk.trim());
    startIndex += chunkSize - overlap;
  }

  logger.log(PREFIX, `Split text into ${chunks.length} chunks`);
  return chunks;
}


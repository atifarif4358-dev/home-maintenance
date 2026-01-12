/**
 * RAG Routes
 * Endpoints for document upload and RAG operations
 */

import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { processFile, splitTextIntoChunks } from '../services/file-processor.service.js';
import { createEmbeddings } from '../services/embedding.service.js';
import { upsertDocumentEmbeddings } from '../services/pinecone.service.js';
import { saveRAGDocument, listRAGDocuments, uploadFileToStorage } from '../services/database.service.js';
import { logger } from '../utils/logger.js';

const router = express.Router();
const PREFIX = 'RAG-API';

// Configure multer for file upload
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = './uploads';
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'application/octet-stream', // Sometimes DOCX is detected as this
    ];
    
    // Get file extension
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExtensions = ['.pdf', '.doc', '.docx', '.txt'];
    
    // Check both mimetype and extension
    const isValidMimeType = allowedTypes.includes(file.mimetype);
    const isValidExtension = allowedExtensions.includes(ext);
    
    if (isValidMimeType || isValidExtension) {
      cb(null, true);
    } else {
      logger.error(PREFIX, `Rejected file: ${file.originalname} (mimetype: ${file.mimetype}, ext: ${ext})`);
      cb(new Error(`Invalid file type. Only PDF, DOC, DOCX, and TXT files are allowed. Received: ${file.mimetype}`));
    }
  }
});

/**
 * POST /rag/upload
 * Upload document, extract text, create embeddings, store in Pinecone
 */
router.post('/upload', upload.single('document'), async (req, res) => {
  let filePath = null;

  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded'
      });
    }

    filePath = req.file.path;
    const fileName = req.file.originalname;
    const fileType = req.file.mimetype;
    const fileSize = req.file.size;

    logger.log(PREFIX, `Processing uploaded file: ${fileName}`);

    // Step 1: Extract text from file
    logger.log(PREFIX, 'Step 1: Extracting text from file...');
    const textContent = await processFile(filePath, fileType);

    // Step 2: Split text into chunks
    logger.log(PREFIX, 'Step 2: Splitting text into chunks...');
    const chunks = splitTextIntoChunks(textContent, 1000, 200);

    // Step 3: Upload file to Supabase storage
    logger.log(PREFIX, 'Step 3: Uploading file to Supabase storage...');
    const storageUrl = await uploadFileToStorage(filePath, fileName, 'rag_docs');
    
    if (!storageUrl) {
      throw new Error('Failed to upload file to storage');
    }

    // Step 4: Create embeddings
    logger.log(PREFIX, 'Step 4: Creating embeddings...');
    const embeddings = await createEmbeddings(chunks);

    // Step 5: Save to Supabase database
    logger.log(PREFIX, 'Step 5: Saving document to database...');
    const savedDocument = await saveRAGDocument({
      fileName,
      fileType,
      fileSize,
      chunkCount: chunks.length,
      storageUrl,
    });

    if (!savedDocument) {
      throw new Error('Failed to save document to database');
    }

    // Step 6: Upsert to Pinecone
    logger.log(PREFIX, 'Step 6: Upserting embeddings to Pinecone...');
    await upsertDocumentEmbeddings(
      savedDocument.id,
      chunks,
      embeddings,
      {
        fileName,
        fileType,
        uploadedAt: savedDocument.created_at,
      }
    );

    // Clean up uploaded file
    await fs.unlink(filePath);
    logger.success(PREFIX, 'Cleaned up temporary file');

    logger.success(PREFIX, `✓ Document processed successfully: ${fileName}`);

    res.json({
      success: true,
      message: 'Document uploaded and processed successfully',
      document: {
        id: savedDocument.id,
        fileName: savedDocument.file_name,
        fileType: savedDocument.file_type,
        fileSize: savedDocument.file_size,
        chunkCount: savedDocument.chunk_count,
        storageUrl: savedDocument.storage_url,
        createdAt: savedDocument.created_at,
      }
    });

  } catch (error) {
    logger.error(PREFIX, 'Error processing document:', error);

    // Clean up file on error
    if (filePath) {
      try {
        await fs.unlink(filePath);
      } catch (unlinkError) {
        logger.error(PREFIX, 'Error cleaning up file:', unlinkError);
      }
    }

    res.status(500).json({
      success: false,
      error: error.message || 'Failed to process document'
    });
  }
});

/**
 * GET /rag/documents
 * List all uploaded documents
 */
router.get('/documents', async (req, res) => {
  try {
    logger.log(PREFIX, 'Fetching all documents...');
    
    const documents = await listRAGDocuments();

    res.json({
      success: true,
      count: documents.length,
      documents
    });

  } catch (error) {
    logger.error(PREFIX, 'Error fetching documents:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch documents'
    });
  }
});

export default router;


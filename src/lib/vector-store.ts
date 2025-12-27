import { MemoryVectorStore } from 'langchain/vectorstores/memory';
import { Document } from '@langchain/core/documents';
import { getEmbeddings } from './embeddings';

// 文档元信息
export interface DocumentMeta {
  id: string;
  filename: string;
  uploadTime: string;
  chunkCount: number;
  fileType: string;
}

// RAG 配置参数
export interface RagConfig {
  topK: number;          // 检索返回的文档数量
  chunkSize: number;     // 文档分割块大小
  chunkOverlap: number;  // 文档分割重叠大小
  model: string;         // LLM 模型名称
  temperature: number;   // 生成温度 (0-1)
}

// 默认配置
const DEFAULT_RAG_CONFIG: RagConfig = {
  topK: 5,
  chunkSize: 500,
  chunkOverlap: 100,
  model: 'qwen-max',
  temperature: 0.3,
};

// 根据文件名检测文件类型
function detectFileType(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() || '';
  const typeMap: Record<string, string> = {
    'pdf': 'PDF',
    'txt': 'TXT',
    'md': 'Markdown',
    'markdown': 'Markdown',
    'xlsx': 'Excel',
    'xls': 'Excel',
    'docx': 'Word',
    'doc': 'Word',
  };
  return typeMap[ext] || 'Unknown';
}

// 使用全局变量避免热重载时丢失数据
declare global {
  var vectorStoreInstance: MemoryVectorStore | undefined;
  var storedDocuments: { docId: string; doc: Document }[] | undefined;
  var documentMetas: DocumentMeta[] | undefined;
  var ragConfig: RagConfig | undefined;
}

// 获取/设置 RAG 配置
export function getRagConfig(): RagConfig {
  if (!global.ragConfig) {
    global.ragConfig = { ...DEFAULT_RAG_CONFIG };
  }
  return global.ragConfig;
}

export function setRagConfig(config: Partial<RagConfig>) {
  global.ragConfig = { ...getRagConfig(), ...config };
  console.log('[RagConfig] 更新配置:', global.ragConfig);
  return global.ragConfig;
}

export async function getVectorStore() {
  if (global.vectorStoreInstance) {
    return global.vectorStoreInstance;
  }

  const embeddings = getEmbeddings();
  const vectorStore = new MemoryVectorStore(embeddings);
  
  global.vectorStoreInstance = vectorStore;
  global.storedDocuments = global.storedDocuments || [];
  global.documentMetas = global.documentMetas || [];
  
  console.log('[VectorStore] 初始化向量存储');
  return vectorStore;
}

// 获取所有文档元信息
export function getDocumentMetas(): DocumentMeta[] {
  return global.documentMetas || [];
}

// 获取知识库统计信息
export function getKnowledgeBaseStats() {
  const metas = global.documentMetas || [];
  const totalChunks = metas.reduce((sum, m) => sum + m.chunkCount, 0);
  return {
    documentCount: metas.length,
    totalChunks,
    documents: metas,
    config: getRagConfig(),
  };
}

// 手动分批添加文档
export async function addDocumentsToStore(docs: Document[], filename: string, fileType?: string) {
  const vectorStore = await getVectorStore();
  const embeddings = getEmbeddings();
  
  const docId = `doc_${Date.now()}`;
  const batchSize = 10;
  const totalBatches = Math.ceil(docs.length / batchSize);
  
  // 自动检测文件类型
  const detectedFileType = fileType || detectFileType(filename);
  
  console.log(`[VectorStore] 开始添加 ${docs.length} 个文档 (${detectedFileType})，分 ${totalBatches} 批处理`);
  
  for (let i = 0; i < docs.length; i += batchSize) {
    const batch = docs.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    
    try {
      const texts = batch.map(doc => doc.pageContent);
      const vectors = await embeddings.embedDocuments(texts);
      
      for (let j = 0; j < batch.length; j++) {
        // 添加文档ID到metadata
        const docWithMeta = new Document({
          pageContent: batch[j].pageContent,
          metadata: { ...batch[j].metadata, docId, source: filename, fileType: detectedFileType },
        });
        await vectorStore.addVectors([vectors[j]], [docWithMeta]);
        
        // 保存文档引用
        global.storedDocuments = global.storedDocuments || [];
        global.storedDocuments.push({ docId, doc: docWithMeta });
      }
      
      console.log(`[VectorStore] 批次 ${batchNum}/${totalBatches} 完成`);
    } catch (error) {
      console.error(`[VectorStore] 批次 ${batchNum} 失败:`, error);
      throw error;
    }
  }
  
  // 保存文档元信息
  global.documentMetas = global.documentMetas || [];
  const docMeta: DocumentMeta = {
    id: docId,
    filename,
    uploadTime: new Date().toISOString(),
    chunkCount: docs.length,
    fileType: detectedFileType,
  };
  global.documentMetas.push(docMeta);
  
  console.log('[VectorStore] 所有文档添加完成，当前总数:', global.storedDocuments?.length || 0);
  
  return docMeta;
}

// 删除单个文档
export async function deleteDocument(docId: string) {
  console.log(`[VectorStore] 开始删除文档: ${docId}`);
  
  // 从元信息中删除
  global.documentMetas = (global.documentMetas || []).filter(m => m.id !== docId);
  
  // 从存储的文档中删除
  const remainingDocs = (global.storedDocuments || []).filter(d => d.docId !== docId);
  global.storedDocuments = remainingDocs;
  
  // 重建向量存储（MemoryVectorStore 不支持单独删除向量）
  const embeddings = getEmbeddings();
  const newVectorStore = new MemoryVectorStore(embeddings);
  
  if (remainingDocs.length > 0) {
    const batchSize = 10;
    for (let i = 0; i < remainingDocs.length; i += batchSize) {
      const batch = remainingDocs.slice(i, i + batchSize);
      const texts = batch.map(d => d.doc.pageContent);
      const vectors = await embeddings.embedDocuments(texts);
      
      for (let j = 0; j < batch.length; j++) {
        await newVectorStore.addVectors([vectors[j]], [batch[j].doc]);
      }
    }
  }
  
  global.vectorStoreInstance = newVectorStore;
  
  console.log(`[VectorStore] 文档删除完成，剩余: ${remainingDocs.length} 个片段`);
  
  return { success: true, remainingChunks: remainingDocs.length };
}

// 清空知识库
export async function clearKnowledgeBase() {
  global.vectorStoreInstance = undefined;
  global.storedDocuments = [];
  global.documentMetas = [];
  console.log('[VectorStore] 知识库已清空');
}

// 清空所有文档（用于重新索引前）
export async function clearAllDocuments() {
  global.vectorStoreInstance = undefined;
  global.storedDocuments = [];
  global.documentMetas = [];
  console.log('[VectorStore] 所有文档已清空，准备重新索引');
}

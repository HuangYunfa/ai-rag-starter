import { NextRequest } from 'next/server';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { Document } from '@langchain/core/documents';
import { addDocumentsToStore, getRagConfig, clearAllDocuments } from '@/lib/vector-store';

// 支持的文件扩展名
const SUPPORTED_EXTENSIONS = ['txt', 'pdf', 'xlsx', 'xls', 'docx', 'doc', 'md', 'markdown'];

function getFileExtension(filename: string): string {
  return filename.toLowerCase().split('.').pop() || '';
}

function detectFileType(filename: string): string {
  const ext = getFileExtension(filename);
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

async function parseFile(filePath: string, filename: string): Promise<string> {
  const ext = getFileExtension(filename);
  const buffer = await readFile(filePath);
  
  if (ext === 'txt' || ext === 'md' || ext === 'markdown') {
    return buffer.toString('utf-8');
  }
  
  if (ext === 'pdf') {
    const pdfParse = (await import('pdf-parse')).default;
    const pdfData = await pdfParse(buffer);
    return pdfData.text;
  }
  
  if (ext === 'xlsx' || ext === 'xls') {
    const XLSX = await import('xlsx');
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheets: string[] = [];
    workbook.SheetNames.forEach((sheetName: string) => {
      const sheet = workbook.Sheets[sheetName];
      const sheetText = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
      if (sheetText.trim()) {
        sheets.push(`【工作表: ${sheetName}】\n${sheetText}`);
      }
    });
    return sheets.join('\n\n');
  }
  
  if (ext === 'docx' || ext === 'doc') {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
  
  return '';
}

export async function POST(request: NextRequest) {
  try {
    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    
    // 读取 uploads 目录
    let files: string[] = [];
    try {
      files = await readdir(uploadDir);
    } catch {
      return Response.json({ 
        success: false, 
        message: 'uploads 目录不存在或为空',
        processed: 0,
      });
    }
    
    // 过滤支持的文件类型
    const supportedFiles = files.filter(f => {
      const ext = getFileExtension(f);
      return SUPPORTED_EXTENSIONS.includes(ext);
    });
    
    if (supportedFiles.length === 0) {
      return Response.json({ 
        success: true, 
        message: 'uploads 目录中没有可处理的文档',
        processed: 0,
      });
    }
    
    // 清空现有向量数据
    await clearAllDocuments();
    
    const config = getRagConfig();
    const results: { filename: string; status: string; chunks?: number }[] = [];
    let totalChunks = 0;
    
    // 处理每个文件
    for (const filename of supportedFiles) {
      const filePath = join(uploadDir, filename);
      
      try {
        console.log(`[Reindex] 处理文件: ${filename}`);
        
        // 解析文件内容
        let content = await parseFile(filePath, filename);
        content = content.trim().replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n');
        
        if (content.length < 10) {
          results.push({ filename, status: '内容为空，跳过' });
          continue;
        }
        
        const fileType = detectFileType(filename);
        
        // 分割文档
        const splitter = new RecursiveCharacterTextSplitter({
          chunkSize: config.chunkSize,
          chunkOverlap: config.chunkOverlap,
          separators: ['\n\n', '\n', '。', '！', '？', '；', '.', '!', '?', ';', ',', '，', ' ', ''],
        });
        
        const docs = [new Document({ 
          pageContent: content, 
          metadata: { source: filename, fileType } 
        })];
        
        let splitDocs = await splitter.splitDocuments(docs);
        if (splitDocs.length === 0 && content.length > 0) {
          splitDocs = docs;
        }
        
        // 添加到向量存储
        await addDocumentsToStore(splitDocs, filename, fileType);
        
        results.push({ filename, status: '成功', chunks: splitDocs.length });
        totalChunks += splitDocs.length;
        
        console.log(`[Reindex] ${filename} 完成，${splitDocs.length} 个片段`);
      } catch (err) {
        console.error(`[Reindex] ${filename} 失败:`, err);
        results.push({ filename, status: `失败: ${err instanceof Error ? err.message : '未知错误'}` });
      }
    }
    
    return Response.json({
      success: true,
      message: `重新索引完成，共处理 ${results.filter(r => r.status === '成功').length} 个文件，${totalChunks} 个片段`,
      processed: results.filter(r => r.status === '成功').length,
      totalChunks,
      details: results,
    });
  } catch (err) {
    console.error('[Reindex] 处理失败:', err);
    return Response.json({ 
      success: false,
      message: `重新索引失败: ${err instanceof Error ? err.message : '未知错误'}`,
      processed: 0,
    }, { status: 500 });
  }
}


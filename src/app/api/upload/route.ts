import { NextRequest } from 'next/server';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { Document } from '@langchain/core/documents';
import { addDocumentsToStore, getRagConfig } from '@/lib/vector-store';

// 获取文件扩展名
function getFileExtension(filename: string): string {
  return filename.toLowerCase().split('.').pop() || '';
}

// 支持的文件类型
const SUPPORTED_EXTENSIONS = ['txt', 'pdf', 'xlsx', 'xls', 'docx', 'doc', 'md', 'markdown'];

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file || !(file instanceof File)) {
      return Response.json({ error: '未选择文件' }, { status: 400 });
    }

    if (!process.env.DASHSCOPE_API_KEY) {
      return Response.json({ error: '未配置 DASHSCOPE_API_KEY' }, { status: 500 });
    }

    const ext = getFileExtension(file.name);
    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      return Response.json({ 
        error: `不支持的文件类型: .${ext}。支持的格式: ${SUPPORTED_EXTENSIONS.join(', ')}` 
      }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    await mkdir(uploadDir, { recursive: true });

    const filePath = join(uploadDir, file.name);
    await writeFile(filePath, buffer);

    console.log(`[Upload] 文件已保存: ${filePath}`);

    let content = '';
    let fileType = '';
    
    // TXT 文件
    if (ext === 'txt') {
      content = await readFile(filePath, 'utf-8');
      fileType = 'TXT';
      console.log(`[Upload] TXT 文件内容长度: ${content.length} 字符`);
    } 
    // Markdown 文件
    else if (ext === 'md' || ext === 'markdown') {
      content = await readFile(filePath, 'utf-8');
      fileType = 'Markdown';
      console.log(`[Upload] Markdown 文件内容长度: ${content.length} 字符`);
    }
    // PDF 文件
    else if (ext === 'pdf') {
      try {
        const pdfParse = (await import('pdf-parse')).default;
        const pdfData = await pdfParse(buffer);
        content = pdfData.text;
        fileType = 'PDF';
        console.log(`[Upload] PDF 解析完成，内容长度: ${content.length} 字符`);
      } catch (err) {
        console.error('[Upload] PDF parse error:', err);
        return Response.json({ error: 'PDF 解析失败，可能是扫描版或加密 PDF' }, { status: 500 });
      }
    }
    // Excel 文件
    else if (ext === 'xlsx' || ext === 'xls') {
      try {
        const XLSX = await import('xlsx');
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const sheets: string[] = [];
        
        workbook.SheetNames.forEach((sheetName: string) => {
          const sheet = workbook.Sheets[sheetName];
          // 转换为 CSV 格式文本
          const sheetText = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
          if (sheetText.trim()) {
            sheets.push(`【工作表: ${sheetName}】\n${sheetText}`);
          }
        });
        
        content = sheets.join('\n\n');
        fileType = 'Excel';
        console.log(`[Upload] Excel 解析完成，共 ${workbook.SheetNames.length} 个工作表，内容长度: ${content.length} 字符`);
      } catch (err) {
        console.error('[Upload] Excel parse error:', err);
        return Response.json({ error: 'Excel 解析失败' }, { status: 500 });
      }
    }
    // Word 文件
    else if (ext === 'docx' || ext === 'doc') {
      try {
        const mammoth = await import('mammoth');
        const result = await mammoth.extractRawText({ buffer });
        content = result.value;
        fileType = 'Word';
        console.log(`[Upload] Word 解析完成，内容长度: ${content.length} 字符`);
        
        if (result.messages.length > 0) {
          console.log('[Upload] Word 解析警告:', result.messages);
        }
      } catch (err) {
        console.error('[Upload] Word parse error:', err);
        return Response.json({ error: 'Word 解析失败，仅支持 .docx 格式' }, { status: 500 });
      }
    }

    // 清理内容：移除多余空白（保留换行符用于分割）
    content = content.trim().replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n');
    
    if (content.length < 10) {
      return Response.json({ 
        error: `${fileType} 内容为空或无法提取文字。请检查文件是否正确。` 
      }, { status: 400 });
    }

    console.log(`[Upload] ${fileType} 文件处理完成，清理后内容长度: ${content.length} 字符`);

    // 创建文档
    const docs = [new Document({ 
      pageContent: content, 
      metadata: { source: file.name, fileType } 
    })];

    // 获取配置
    const config = getRagConfig();
    console.log(`[Upload] 使用分块配置: chunkSize=${config.chunkSize}, chunkOverlap=${config.chunkOverlap}`);

    // 分割文档
    const splitter = new RecursiveCharacterTextSplitter({ 
      chunkSize: config.chunkSize,
      chunkOverlap: config.chunkOverlap,
      separators: ['\n\n', '\n', '。', '！', '？', '；', '.', '!', '?', ';', ',', '，', ' ', ''],
    });
    
    let splitDocs = await splitter.splitDocuments(docs);
    
    // 如果分割结果为空，但内容存在，直接使用原文档
    if (splitDocs.length === 0 && content.length > 0) {
      console.log(`[Upload] 分割结果为空，使用原文档`);
      splitDocs = docs;
    }
    
    console.log(`[Upload] 文档分割完成，共 ${splitDocs.length} 个片段`);

    if (splitDocs.length === 0) {
      return Response.json({ error: '文档处理失败，无法生成文本片段' }, { status: 400 });
    }

    const docMeta = await addDocumentsToStore(splitDocs, file.name, fileType);

    return Response.json({
      success: true,
      message: `文档上传成功！已处理 ${splitDocs.length} 个文本片段。`,
      document: docMeta,
    });
  } catch (err) {
    console.error('[Upload] 处理失败:', err);
    return Response.json({ 
      error: `处理失败: ${err instanceof Error ? err.message : '未知错误'}` 
    }, { status: 500 });
  }
}

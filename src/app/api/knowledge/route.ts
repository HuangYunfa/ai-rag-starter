import { NextRequest } from 'next/server';
import { getKnowledgeBaseStats, clearKnowledgeBase, deleteDocument, setRagConfig, getRagConfig } from '@/lib/vector-store';

// 获取知识库状态
export async function GET() {
  const stats = getKnowledgeBaseStats();
  return Response.json(stats);
}

// 更新配置或删除文档
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    
    // 更新 RAG 配置
    if (body.action === 'updateConfig') {
      const config = setRagConfig(body.config);
      return Response.json({ success: true, config });
    }
    
    // 删除单个文档
    if (body.action === 'deleteDocument' && body.docId) {
      const result = await deleteDocument(body.docId);
      return Response.json(result);
    }
    
    return Response.json({ error: '未知操作' }, { status: 400 });
  } catch (error) {
    console.error('Knowledge API error:', error);
    return Response.json({ error: '操作失败' }, { status: 500 });
  }
}

// 清空知识库
export async function DELETE() {
  await clearKnowledgeBase();
  return Response.json({ success: true, message: '知识库已清空' });
}

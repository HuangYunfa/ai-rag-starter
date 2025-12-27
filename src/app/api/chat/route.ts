import { z } from 'zod';
import { NextRequest } from 'next/server';
import { queryRag } from '@/lib/rag';

const chatSchema = z.object({
  message: z.string().min(1).max(2000),
  topK: z.number().min(1).max(20).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { message, topK } = chatSchema.parse(body);

    const result = await queryRag(message, topK);
    
    // 返回包含答案、引用片段和推荐问题的 JSON
    return Response.json({
      answer: result.answer,
      chunks: result.chunks,
      suggestedQuestions: result.suggestedQuestions,
    });
  } catch (error) {
    console.error('Chat error:', error);
    
    // 解析错误信息，提供更友好的提示
    let errorMessage = '请求处理失败';
    const errorStr = error instanceof Error ? error.message : String(error);
    
    if (errorStr.includes('AllocationQuota.FreeTierOnly') || errorStr.includes('free tier')) {
      errorMessage = '⚠️ 当前模型的免费额度已用完，请切换到其他模型或在阿里云控制台开通付费模式。';
    } else if (errorStr.includes('InvalidApiKey') || errorStr.includes('Unauthorized')) {
      errorMessage = '⚠️ API Key 无效或已过期，请检查 DASHSCOPE_API_KEY 配置。';
    } else if (errorStr.includes('RateLimitExceeded')) {
      errorMessage = '⚠️ 请求过于频繁，请稍后再试。';
    } else if (errorStr.includes('ModelNotFound')) {
      errorMessage = '⚠️ 模型不存在或未开通，请在阿里云控制台确认模型权限。';
    }
    
    return Response.json({ 
      answer: errorMessage,
      chunks: [],
      suggestedQuestions: [],
    }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

export interface FeedbackRecord {
  id: string;
  messageId: string;
  question: string;
  answer: string;
  chunks: { content: string; source: string }[];
  feedbackType: 'like' | 'dislike';
  timestamp: string;
  topK?: number;
}

interface FeedbackData {
  records: FeedbackRecord[];
  stats: {
    totalLikes: number;
    totalDislikes: number;
    lastUpdated: string;
  };
}

const FEEDBACK_DIR = './data';
const FEEDBACK_FILE = 'feedback.json';

async function getFeedbackFilePath(): Promise<string> {
  await mkdir(FEEDBACK_DIR, { recursive: true });
  return join(FEEDBACK_DIR, FEEDBACK_FILE);
}

async function loadFeedbackData(): Promise<FeedbackData> {
  try {
    const filePath = await getFeedbackFilePath();
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {
      records: [],
      stats: {
        totalLikes: 0,
        totalDislikes: 0,
        lastUpdated: new Date().toISOString(),
      },
    };
  }
}

async function saveFeedbackData(data: FeedbackData): Promise<void> {
  const filePath = await getFeedbackFilePath();
  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// POST - 提交反馈
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { messageId, question, answer, chunks, feedbackType, topK } = body;

    if (!messageId || !question || !answer || !feedbackType) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    if (!['like', 'dislike'].includes(feedbackType)) {
      return NextResponse.json({ error: '无效的反馈类型' }, { status: 400 });
    }

    const data = await loadFeedbackData();

    // 检查是否已存在该消息的反馈，如果有则更新
    const existingIndex = data.records.findIndex(r => r.messageId === messageId);
    
    const newRecord: FeedbackRecord = {
      id: `fb_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      messageId,
      question,
      answer,
      chunks: chunks || [],
      feedbackType,
      timestamp: new Date().toISOString(),
      topK,
    };

    if (existingIndex >= 0) {
      // 更新统计
      const oldType = data.records[existingIndex].feedbackType;
      if (oldType === 'like') data.stats.totalLikes--;
      else data.stats.totalDislikes--;
      
      // 替换记录
      data.records[existingIndex] = newRecord;
    } else {
      // 新增记录
      data.records.push(newRecord);
    }

    // 更新统计
    if (feedbackType === 'like') {
      data.stats.totalLikes++;
    } else {
      data.stats.totalDislikes++;
    }
    data.stats.lastUpdated = new Date().toISOString();

    await saveFeedbackData(data);

    console.log(`[Feedback] 记录反馈: ${feedbackType} for message ${messageId}`);

    return NextResponse.json({
      success: true,
      message: '反馈已记录',
      stats: data.stats,
    });
  } catch (error) {
    console.error('[Feedback] 记录失败:', error);
    return NextResponse.json({ error: '记录反馈失败' }, { status: 500 });
  }
}

// DELETE - 取消反馈
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const messageId = searchParams.get('messageId');

    if (!messageId) {
      return NextResponse.json({ error: '缺少 messageId' }, { status: 400 });
    }

    const data = await loadFeedbackData();
    const existingIndex = data.records.findIndex(r => r.messageId === messageId);

    if (existingIndex >= 0) {
      const oldType = data.records[existingIndex].feedbackType;
      if (oldType === 'like') data.stats.totalLikes--;
      else data.stats.totalDislikes--;

      data.records.splice(existingIndex, 1);
      data.stats.lastUpdated = new Date().toISOString();

      await saveFeedbackData(data);
      console.log(`[Feedback] 取消反馈: message ${messageId}`);
    }

    return NextResponse.json({
      success: true,
      message: '反馈已取消',
      stats: data.stats,
    });
  } catch (error) {
    console.error('[Feedback] 取消失败:', error);
    return NextResponse.json({ error: '取消反馈失败' }, { status: 500 });
  }
}

// GET - 获取反馈统计和报告
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'stats';

    const data = await loadFeedbackData();

    if (type === 'stats') {
      // 返回统计信息
      const totalRecords = data.records.length;
      const likeRate = totalRecords > 0 
        ? ((data.stats.totalLikes / totalRecords) * 100).toFixed(1) 
        : '0';

      return NextResponse.json({
        stats: data.stats,
        summary: {
          totalRecords,
          likeRate: `${likeRate}%`,
        },
      });
    } else if (type === 'report') {
      // 返回详细报告
      const recentDislikes = data.records
        .filter(r => r.feedbackType === 'dislike')
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 10)
        .map(r => ({
          question: r.question,
          answerPreview: r.answer.substring(0, 100) + '...',
          timestamp: r.timestamp,
          sources: [...new Set(r.chunks.map(c => c.source))],
        }));

      const recentLikes = data.records
        .filter(r => r.feedbackType === 'like')
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 10)
        .map(r => ({
          question: r.question,
          answerPreview: r.answer.substring(0, 100) + '...',
          timestamp: r.timestamp,
          sources: [...new Set(r.chunks.map(c => c.source))],
        }));

      // 分析常见问题模式
      const questionPatterns: Record<string, number> = {};
      data.records.forEach(r => {
        const keywords = r.question.split(/[，。？！、\s]+/).filter(k => k.length > 1);
        keywords.forEach(k => {
          questionPatterns[k] = (questionPatterns[k] || 0) + 1;
        });
      });

      const topKeywords = Object.entries(questionPatterns)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([keyword, count]) => ({ keyword, count }));

      return NextResponse.json({
        stats: data.stats,
        report: {
          recentDislikes,
          recentLikes,
          topKeywords,
          totalRecords: data.records.length,
          likeRate: data.records.length > 0 
            ? ((data.stats.totalLikes / data.records.length) * 100).toFixed(1) + '%'
            : '0%',
        },
      });
    } else if (type === 'export') {
      // 导出所有反馈数据（用于微调）
      const exportData = data.records.map(r => ({
        instruction: r.question,
        input: r.chunks.map(c => c.content).join('\n\n'),
        output: r.answer,
        feedback: r.feedbackType,
        timestamp: r.timestamp,
      }));

      return NextResponse.json({
        format: 'instruction-tuning',
        totalRecords: exportData.length,
        data: exportData,
      });
    }

    return NextResponse.json({ error: '无效的类型参数' }, { status: 400 });
  } catch (error) {
    console.error('[Feedback] 获取失败:', error);
    return NextResponse.json({ error: '获取反馈数据失败' }, { status: 500 });
  }
}


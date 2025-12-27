import { Embeddings } from '@langchain/core/embeddings';

// 使用阿里云 DashScope 文本嵌入模型
export class DashScopeEmbeddings extends Embeddings {
  private apiKey: string;
  private model: string;

  constructor() {
    super({});
    this.apiKey = process.env.DASHSCOPE_API_KEY || '';
    this.model = 'text-embedding-v3'; // 阿里云文本嵌入模型
  }

  async embedDocuments(documents: string[]): Promise<number[][]> {
    // DashScope API 限制每批最多 10 个文本
    const batchSize = 10;
    const results: number[][] = [];
    
    console.log(`[Embeddings] 开始处理 ${documents.length} 个文档，每批 ${batchSize} 个`);
    
    for (let i = 0; i < documents.length; i += batchSize) {
      const batch = documents.slice(i, i + batchSize);
      const embeddings = await this.callDashScopeEmbedding(batch);
      results.push(...embeddings);
      
      // 显示进度
      if ((i + batchSize) % 50 === 0 || i + batchSize >= documents.length) {
        console.log(`[Embeddings] 进度: ${Math.min(i + batchSize, documents.length)}/${documents.length}`);
      }
    }
    
    console.log(`[Embeddings] 完成，共生成 ${results.length} 个向量`);
    return results;
  }

  async embedQuery(query: string): Promise<number[]> {
    console.log(`[Embeddings] 查询嵌入: "${query.substring(0, 50)}..."`);
    const embeddings = await this.callDashScopeEmbedding([query]);
    return embeddings[0];
  }

  private async callDashScopeEmbedding(texts: string[]): Promise<number[][]> {
    if (!this.apiKey) {
      console.error('[Embeddings] DASHSCOPE_API_KEY 未设置！');
      throw new Error('DASHSCOPE_API_KEY is required for embeddings');
    }

    // 处理空文本和过长文本
    const processedTexts = texts.map(text => {
      const cleaned = text.trim();
      // DashScope embedding 有长度限制，截断过长的文本
      return cleaned.length > 2048 ? cleaned.substring(0, 2048) : cleaned;
    });

    try {
      const response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          input: processedTexts,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error('[Embeddings] API 错误:', error);
        throw new Error(`DashScope Embedding API error: ${error}`);
      }

      const data = await response.json();
      
      if (!data.data || !Array.isArray(data.data)) {
        console.error('[Embeddings] 响应格式错误:', data);
        throw new Error('Invalid API response format');
      }

      return data.data.map((item: { embedding: number[] }) => item.embedding);
    } catch (error) {
      console.error('[Embeddings] 调用失败:', error);
      throw error; // 不再降级，直接抛出错误让用户知道
    }
  }
}

export function getEmbeddings() {
  return new DashScopeEmbeddings();
}

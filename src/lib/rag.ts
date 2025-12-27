import { getVectorStore, getRagConfig } from './vector-store';
import { createLLM } from './llm';

export interface RetrievedChunk {
  content: string;
  source: string;
  score?: number;
}

export interface RagResult {
  answer: string;
  chunks: RetrievedChunk[];
  suggestedQuestions: string[];
}

export async function queryRag(question: string, customTopK?: number): Promise<RagResult> {
  const config = getRagConfig();
  const topK = customTopK ?? config.topK;
  
  const vectorStore = await getVectorStore();
  const retriever = vectorStore.asRetriever({ k: topK });
  const docs = await retriever.invoke(question);

  console.log(`[RAG] 检索到 ${docs.length} 个文档片段 (topK=${topK})`);
  
  // 收集引用片段信息
  const chunks: RetrievedChunk[] = docs.map((doc, i) => {
    console.log(`[RAG] 片段 ${i + 1} (${doc.pageContent.length} 字符): ${doc.pageContent.substring(0, 80)}...`);
    return {
      content: doc.pageContent,
      source: doc.metadata?.source || '未知来源',
    };
  });

  if (docs.length === 0) {
    return {
      answer: '抱歉，知识库中没有找到相关信息。请先上传相关文档。',
      chunks: [],
      suggestedQuestions: [],
    };
  }

  const context = docs.map((d, i) => `【片段${i + 1}】\n${d.pageContent}`).join('\n\n---\n\n');
  
  const prompt = `你是一个专业的知识库问答助手。请严格根据以下提供的资料来回答用户的问题。

## 重要规则：
1. 只能使用下面提供的资料内容来回答
2. 如果资料中包含相关信息，请准确引用并回答
3. 如果资料中确实没有相关信息，请明确说"根据已上传的文档，未找到相关信息"
4. 回答要条理清晰，可以使用列表格式
5. 回答完成后，在最后另起一行，以"---SUGGESTED_QUESTIONS---"开头，然后换行列出3个用户可能想继续问的相关问题，每个问题一行，问题要基于资料内容，帮助用户深入了解

## 参考资料：
${context}

## 用户问题：
${question}

## 回答：`;

  const model = createLLM(config.model, config.temperature);
  console.log(`[RAG] 使用模型: ${config.model}, 温度: ${config.temperature}`);
  const response = await model.invoke(prompt);
  const rawAnswer = response.content as string;
  
  // 解析回答和推荐问题
  let answer = rawAnswer;
  let suggestedQuestions: string[] = [];
  
  const separator = '---SUGGESTED_QUESTIONS---';
  if (rawAnswer.includes(separator)) {
    const parts = rawAnswer.split(separator);
    answer = parts[0].trim();
    const questionsText = parts[1]?.trim() || '';
    suggestedQuestions = questionsText
      .split('\n')
      .map(q => q.replace(/^\d+\.\s*/, '').replace(/^[-•]\s*/, '').trim())
      .filter(q => q.length > 0 && q.length < 100)
      .slice(0, 3);
  }
  
  return { answer, chunks, suggestedQuestions };
}

import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, BaseMessage, HumanMessage } from '@langchain/core/messages';

// 自定义 Qwen 聊天模型（通过 DashScope API）
class ChatQwen extends BaseChatModel {
  private apiKey: string;
  private model: string;
  private temperature: number;

  constructor(config: { apiKey: string; model?: string; temperature?: number }) {
    super({});
    this.apiKey = config.apiKey;
    this.model = config.model || 'qwen-max';
    this.temperature = config.temperature ?? 0.3;
  }

  _llmType(): string {
    return 'qwen';
  }

  // 需要流式模式的模型列表
  private readonly STREAM_ONLY_MODELS = ['glm-4.5', 'glm-4.6', 'deepseek-r1'];

  async _generate(messages: BaseMessage[]): Promise<{ generations: { text: string; message: AIMessage }[] }> {
    const formattedMessages = messages.map(msg => ({
      role: msg._getType() === 'human' ? 'user' : msg._getType() === 'ai' ? 'assistant' : 'system',
      content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
    }));

    // Qwen3 系列模型需要特殊参数
    const isQwen3 = this.model.startsWith('qwen3');
    // 检查是否需要流式模式
    const needsStream = this.STREAM_ONLY_MODELS.includes(this.model);
    
    const requestBody: Record<string, unknown> = {
      model: this.model,
      messages: formattedMessages,
    };

    // Qwen3 模型：关闭思考模式时需要设置 enable_thinking=false
    // 同时 temperature 必须大于 0
    if (isQwen3) {
      requestBody.extra_body = { enable_thinking: false };
      // Qwen3 的 temperature 范围是 0-2，但关闭思考时需要 > 0
      requestBody.temperature = Math.max(0.1, this.temperature);
    } else {
      requestBody.temperature = this.temperature;
    }

    // 某些模型只支持流式模式
    if (needsStream) {
      requestBody.stream = true;
    }

    console.log(`[LLM] 调用模型: ${this.model}, temperature: ${requestBody.temperature}, stream: ${needsStream}`);

    const response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`[LLM] API 错误 (${this.model}):`, error);
      throw new Error(`DashScope API error: ${error}`);
    }

    let content = '';

    if (needsStream) {
      // 流式响应处理
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      
      if (!reader) {
        throw new Error('无法读取流式响应');
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(line => line.trim() !== '');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;
            
            try {
              const json = JSON.parse(data);
              const delta = json.choices?.[0]?.delta?.content;
              if (delta) {
                content += delta;
              }
            } catch {
              // 忽略解析错误
            }
          }
        }
      }
    } else {
      // 非流式响应处理
      const data = await response.json();
      
      // Qwen3 可能返回 reasoning_content（思考过程）和 content（最终答案）
      const choice = data.choices?.[0]?.message;
      if (choice) {
        // 优先使用 content，如果没有则使用 reasoning_content
        content = choice.content || choice.reasoning_content || '';
      }
    }
    
    console.log(`[LLM] 响应长度: ${content.length} 字符`);

    return {
      generations: [{ text: content, message: new AIMessage(content) }],
    };
  }
}

export function createQwenChatModel(model?: string, temperature?: number) {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error('DASHSCOPE_API_KEY is required');

  return new ChatQwen({
    model: model || process.env.MODEL_NAME || 'qwen-max',
    apiKey,
    temperature: temperature ?? 0.3,
  });
}

export function createLLM(model?: string, temperature?: number) {
  const provider = process.env.LLM_PROVIDER || 'qwen';
  if (provider === 'qwen') return createQwenChatModel(model, temperature);
  else return createQwenChatModel(model, temperature);
}

// 可用的模型列表
export const AVAILABLE_MODELS = [
  { value: 'deepseek-r1', label: 'DeepSeek R1' },
  { value: 'deepseek-v3', label: 'DeepSeek V3' },
  { value: 'qwen3-max', label: 'Qwen3 Max (优秀)' },
  { value: 'qwen-max', label: 'Qwen Max (推荐)' },
  { value: 'qwen-plus', label: 'Qwen Plus (便宜)' },
  { value: 'qwen-turbo', label: 'Qwen Turbo (快速)' },
  { value: 'qwen-long', label: 'Qwen Long (长文本)' },
  { value: 'glm-4.6', label:'GLM 4.6'},
  { value: 'glm-4.5', label:'GLM 4.5'},
  { value: 'kimi-k2-thinking', label:'Kimi K2 Thinking'},
  { value: 'Moonshot-Kimi-K2-Instruct', label:'Kimi K2 Instruct'},
];

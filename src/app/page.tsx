'use client';

import { useState, useRef, useEffect } from 'react';

interface DocumentMeta {
  id: string;
  filename: string;
  uploadTime: string;
  chunkCount: number;
  fileType: string;
}

interface RagConfig {
  topK: number;
  chunkSize: number;
  chunkOverlap: number;
  model: string;
  temperature: number;
}

// 可用的模型列表
const AVAILABLE_MODELS = [
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

interface KnowledgeStats {
  documentCount: number;
  totalChunks: number;
  documents: DocumentMeta[];
  config: RagConfig;
}

interface RetrievedChunk {
  content: string;
  source: string;
}

interface Message {
  id: string;
  role: string;
  content: string;
  chunks?: RetrievedChunk[];
  feedback?: 'like' | 'dislike' | null;
  showChunks?: boolean;
  suggestedQuestions?: string[];
}

// 确认弹窗组件
function ConfirmModal({ 
  isOpen, 
  title, 
  message, 
  onConfirm, 
  onCancel,
  confirmText = '确定',
  cancelText = '取消',
  danger = false,
}: {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}) {
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 背景遮罩 */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      
      {/* 弹窗内容 */}
      <div className="relative bg-slate-800 border border-slate-600 rounded-2xl shadow-2xl max-w-md w-full mx-4 overflow-hidden">
        <div className="p-6">
          <h3 className="text-lg font-semibold text-slate-100 mb-2">{title}</h3>
          <p className="text-sm text-slate-400">{message}</p>
        </div>
        
        <div className="flex border-t border-slate-700">
          <button
            onClick={onCancel}
            className="flex-1 py-3 text-sm font-medium text-slate-300 hover:bg-slate-700/50 transition-colors"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 py-3 text-sm font-medium transition-colors border-l border-slate-700 ${
              danger 
                ? 'text-red-400 hover:bg-red-500/20' 
                : 'text-blue-400 hover:bg-blue-500/20'
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ChatPage() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [knowledgeStats, setKnowledgeStats] = useState<KnowledgeStats | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [topK, setTopK] = useState(5);
  const [model, setModel] = useState('qwen-max');
  const [temperature, setTemperature] = useState(0.3);
  const [chunkSize, setChunkSize] = useState(500);
  const [chunkOverlap, setChunkOverlap] = useState(100);
  const [reindexing, setReindexing] = useState(false);
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    danger?: boolean;
  } | null>(null);
  const [showFeedbackReport, setShowFeedbackReport] = useState(false);
  const [feedbackReport, setFeedbackReport] = useState<{
    stats: { totalLikes: number; totalDislikes: number; lastUpdated: string };
    report: {
      recentDislikes: { question: string; answerPreview: string; timestamp: string; sources: string[] }[];
      recentLikes: { question: string; answerPreview: string; timestamp: string; sources: string[] }[];
      topKeywords: { keyword: string; count: number }[];
      totalRecords: number;
      likeRate: string;
    };
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const fetchKnowledgeStats = async () => {
    try {
      const res = await fetch('/api/knowledge');
      if (res.ok) {
        const data = await res.json();
        setKnowledgeStats(data);
        if (data.config) {
          setTopK(data.config.topK);
          setModel(data.config.model || 'qwen-max');
          setTemperature(data.config.temperature ?? 0.3);
          setChunkSize(data.config.chunkSize ?? 500);
          setChunkOverlap(data.config.chunkOverlap ?? 100);
        }
      }
    } catch (err) {
      console.error('获取知识库状态失败:', err);
    }
  };

  const fetchFeedbackReport = async () => {
    try {
      const res = await fetch('/api/feedback?type=report');
      if (res.ok) {
        const data = await res.json();
        setFeedbackReport(data);
      }
    } catch (err) {
      console.error('获取反馈报告失败:', err);
    }
  };

  const exportToExcel = async () => {
    try {
      const res = await fetch('/api/feedback?type=export');
      if (!res.ok) throw new Error('导出失败');
      
      const data = await res.json();
      if (!data.data || data.data.length === 0) {
        alert('暂无反馈数据可导出');
        return;
      }

      // 构建 CSV 内容（Excel 可直接打开）
      const headers = ['问题', '上下文', '回答', '反馈类型', '时间'];
      const rows = data.data.map((item: { instruction: string; input: string; output: string; feedback: string; timestamp: string }) => [
        `"${(item.instruction || '').replace(/"/g, '""')}"`,
        `"${(item.input || '').replace(/"/g, '""').substring(0, 500)}"`, // 截断上下文
        `"${(item.output || '').replace(/"/g, '""')}"`,
        item.feedback === 'like' ? '👍 好评' : '👎 差评',
        new Date(item.timestamp).toLocaleString('zh-CN'),
      ]);

      // 添加 BOM 以支持中文
      const BOM = '\uFEFF';
      const csvContent = BOM + [headers.join(','), ...rows.map((row: string[]) => row.join(','))].join('\n');
      
      // 创建下载
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `feedback_export_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('导出失败:', err);
      alert('导出失败，请重试');
    }
  };

  useEffect(() => {
    fetchKnowledgeStats();
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (showFeedbackReport) {
      fetchFeedbackReport();
    }
  }, [showFeedbackReport]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || sending) return;

    const userMessage: Message = { 
      id: `user_${Date.now()}`, 
      role: 'user', 
      content: input 
    };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setSending(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: input, topK }),
      });
      const result = await res.json();
      const aiMessage: Message = { 
        id: `ai_${Date.now()}`, 
        role: 'assistant', 
        content: result.answer,
        chunks: result.chunks || [],
        feedback: null,
        showChunks: false,
        suggestedQuestions: result.suggestedQuestions || [],
      };
      setMessages(prev => [...prev, aiMessage]);
    } catch (err) {
      console.error(err);
      const errorMessage: Message = { 
        id: `ai_${Date.now()}`, 
        role: 'assistant', 
        content: '抱歉，出错了。',
        chunks: [],
        feedback: null,
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setSending(false);
    }
  };

  const handleCopy = async (content: string, messageId: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(messageId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error('复制失败:', err);
    }
  };

  const handleFeedback = async (messageId: string, type: 'like' | 'dislike') => {
    // 找到当前消息和对应的用户问题
    const msgIndex = messages.findIndex(m => m.id === messageId);
    const currentMsg = messages[msgIndex];
    if (!currentMsg || currentMsg.role !== 'assistant') return;

    // 找到前一条用户消息作为问题
    let question = '';
    for (let i = msgIndex - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        question = messages[i].content;
        break;
      }
    }

    const isCancel = currentMsg.feedback === type;
    
    // 更新本地状态
    setMessages(prev => prev.map(msg => {
      if (msg.id === messageId) {
        const newFeedback = msg.feedback === type ? null : type;
        return { ...msg, feedback: newFeedback };
      }
      return msg;
    }));

    // 发送到后端
    try {
      if (isCancel) {
        // 取消反馈
        await fetch(`/api/feedback?messageId=${messageId}`, { method: 'DELETE' });
      } else {
        // 提交反馈
        await fetch('/api/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messageId,
            question,
            answer: currentMsg.content,
            chunks: currentMsg.chunks || [],
            feedbackType: type,
            topK,
          }),
        });
      }
    } catch (err) {
      console.error('反馈提交失败:', err);
    }
  };

  const toggleChunks = (messageId: string) => {
    setMessages(prev => prev.map(msg => {
      if (msg.id === messageId) {
        return { ...msg, showChunks: !msg.showChunks };
      }
      return msg;
    }));
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    const fileInput = fileInputRef.current;
    if (!fileInput?.files?.length) {
      setUploadStatus('请选择文件');
      return;
    }

    const file = fileInput.files[0];
    const formData = new FormData();
    formData.append('file', file);

    setUploading(true);
    setUploadStatus(null);

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });
      const result = await res.json();
      if (res.ok) {
        setUploadStatus(`✅ ${result.message}`);
        fileInput.value = '';
        fetchKnowledgeStats();
      } else {
        setUploadStatus(`❌ ${result.error}`);
      }
    } catch (err) {
      console.error(err);
      setUploadStatus('❌ 上传出错，请重试');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteDocument = (docId: string, filename: string) => {
    setConfirmModal({
      isOpen: true,
      title: '删除文档',
      message: `确定要删除文档 "${filename}" 吗？删除后将无法恢复。`,
      danger: true,
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          const res = await fetch('/api/knowledge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'deleteDocument', docId }),
          });
          if (res.ok) {
            // 立即更新本地状态，确保 UI 刷新
            setKnowledgeStats(prev => {
              if (!prev) return prev;
              const newDocs = prev.documents.filter(d => d.id !== docId);
              const deletedDoc = prev.documents.find(d => d.id === docId);
              const chunksToRemove = deletedDoc?.chunkCount || 0;
              return {
                ...prev,
                documentCount: newDocs.length,
                totalChunks: prev.totalChunks - chunksToRemove,
                documents: newDocs,
              };
            });
            setUploadStatus(`✅ 已删除: ${filename}`);
          }
        } catch (err) {
          console.error('删除文档失败:', err);
          setUploadStatus(`❌ 删除失败`);
        }
      },
    });
  };

  const handleClearKnowledge = () => {
    setConfirmModal({
      isOpen: true,
      title: '清空知识库',
      message: '确定要清空所有文档吗？此操作将删除所有已上传的文档和向量数据，且无法恢复。',
      danger: true,
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          const res = await fetch('/api/knowledge', { method: 'DELETE' });
          if (res.ok) {
            setKnowledgeStats({ documentCount: 0, totalChunks: 0, documents: [], config: knowledgeStats?.config || { topK: 5, chunkSize: 500, chunkOverlap: 100, model: 'qwen-max', temperature: 0.3 } });
            setUploadStatus('✅ 知识库已清空');
          }
        } catch (err) {
          console.error('清空知识库失败:', err);
        }
      },
    });
  };

  const handleUpdateConfig = async (updates: Partial<{ topK: number; model: string; temperature: number; chunkSize: number; chunkOverlap: number }>) => {
    // 更新本地状态
    if (updates.topK !== undefined) setTopK(updates.topK);
    if (updates.model !== undefined) setModel(updates.model);
    if (updates.temperature !== undefined) setTemperature(updates.temperature);
    if (updates.chunkSize !== undefined) setChunkSize(updates.chunkSize);
    if (updates.chunkOverlap !== undefined) setChunkOverlap(updates.chunkOverlap);
    
    try {
      await fetch('/api/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'updateConfig', config: updates }),
      });
    } catch (err) {
      console.error('更新配置失败:', err);
    }
  };

  const formatTime = (isoString: string) => {
    return new Date(isoString).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleReindex = async () => {
    setReindexing(true);
    setUploadStatus('⏳ 正在重建索引，请稍候...');
    
    try {
      const res = await fetch('/api/reindex', { method: 'POST' });
      const result = await res.json();
      
      if (result.success) {
        setUploadStatus(`✅ ${result.message}`);
        fetchKnowledgeStats();
      } else {
        setUploadStatus(`❌ ${result.message}`);
      }
    } catch (err) {
      console.error('重建索引失败:', err);
      setUploadStatus('❌ 重建索引失败');
    } finally {
      setReindexing(false);
    }
  };

  return (
    <div className="flex h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* 左侧：知识库管理 */}
      <aside className="w-80 flex-shrink-0 bg-slate-800/80 border-r border-slate-700 flex flex-col">
        {/* Logo */}
        <div className="p-4 border-b border-slate-700">
          <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent flex items-center gap-2">
            <img src="/favicon.svg" alt="logo" className="w-6 h-6" />
            AI 知识库助手
          </h1>
        </div>

        {/* 上传区域 */}
        <div className="p-4 border-b border-slate-700">
          <h2 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
            📤 上传文档
          </h2>
          <form onSubmit={handleUpload} className="space-y-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.txt,.xlsx,.xls,.docx,.doc,.md,.markdown"
              className="w-full text-xs text-slate-400 file:mr-2 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-blue-600 file:text-white file:text-xs file:font-medium file:cursor-pointer hover:file:bg-blue-500"
            />
            <button
              type="submit"
              disabled={uploading}
              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
            >
              {uploading ? (
                <>
                  <span className="animate-spin">⏳</span> 处理中...
                </>
              ) : (
                <>📥 上传并向量化</>
              )}
            </button>
          </form>
          {uploadStatus && (
            <p className={`mt-2 text-xs ${uploadStatus.startsWith('✅') ? 'text-emerald-400' : 'text-red-400'}`}>
              {uploadStatus}
            </p>
          )}
        </div>

        {/* 知识库统计 + 设置 */}
        <div className="p-4 border-b border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
              📚 知识库
            </h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowSettings(!showSettings)}
                className={`text-sm px-2 py-1 rounded transition-colors ${
                  showSettings 
                    ? 'bg-blue-600 text-white' 
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'
                }`}
                title="设置"
              >
                ⚙️ 设置
              </button>
              {knowledgeStats && knowledgeStats.documentCount > 0 && (
                <button
                  onClick={handleClearKnowledge}
                  className="text-xs text-red-400 hover:text-red-300 transition-colors"
                >
                  清空
                </button>
              )}
            </div>
          </div>
          
          {/* 设置面板 */}
          {showSettings && (
            <div className="mb-3 p-3 bg-slate-700/50 rounded-lg space-y-4">
              {/* 模型选择 */}
              <div>
                <label className="text-xs text-slate-400 block mb-1.5">🤖 模型</label>
                <select
                  value={model}
                  onChange={(e) => handleUpdateConfig({ model: e.target.value })}
                  className="w-full bg-slate-600 border border-slate-500 rounded px-2 py-1.5 text-xs text-slate-200"
                >
                  {AVAILABLE_MODELS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>

              {/* Temperature */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs text-slate-400">🌡️ Temperature</label>
                  <span className="text-xs text-blue-400 font-mono">{temperature.toFixed(1)}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={temperature}
                  onChange={(e) => handleUpdateConfig({ temperature: Number(e.target.value) })}
                  className="w-full h-1.5 bg-slate-600 rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
                <div className="flex justify-between text-xs text-slate-500 mt-1">
                  <span>精确</span>
                  <span>创意</span>
                </div>
              </div>

              {/* Top K */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs text-slate-400">📚 Top K (检索数量)</label>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={topK}
                    onChange={(e) => handleUpdateConfig({ topK: Number(e.target.value) })}
                    className="w-14 bg-slate-600 border border-slate-500 rounded px-2 py-1 text-xs text-slate-200 text-center"
                  />
                </div>
                <p className="text-xs text-slate-500">每次查询返回的相关片段数量</p>
              </div>

              {/* 分割线 */}
              <div className="border-t border-slate-600 pt-3 mt-3">
                <p className="text-xs text-slate-400 mb-3">📄 文档分割设置 (上传时生效)</p>
                
                {/* Chunk Size */}
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs text-slate-500">分块大小</label>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min="100"
                      max="2000"
                      step="100"
                      value={chunkSize}
                      onChange={(e) => handleUpdateConfig({ chunkSize: Number(e.target.value) })}
                      className="w-16 bg-slate-600 border border-slate-500 rounded px-2 py-1 text-xs text-slate-200 text-center"
                    />
                    <span className="text-xs text-slate-500">字符</span>
                  </div>
                </div>

                {/* Chunk Overlap */}
                <div className="flex items-center justify-between">
                  <label className="text-xs text-slate-500">重叠大小</label>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min="0"
                      max="500"
                      step="50"
                      value={chunkOverlap}
                      onChange={(e) => handleUpdateConfig({ chunkOverlap: Number(e.target.value) })}
                      className="w-16 bg-slate-600 border border-slate-500 rounded px-2 py-1 text-xs text-slate-200 text-center"
                    />
                    <span className="text-xs text-slate-500">字符</span>
                  </div>
                </div>
                <p className="text-xs text-slate-600 mt-2">修改后对新上传的文档生效</p>
              </div>
            </div>
          )}
          
          {knowledgeStats && knowledgeStats.documentCount > 0 ? (
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="bg-slate-700/50 rounded-lg p-2">
                <div className="text-lg font-bold text-blue-400">{knowledgeStats.documentCount}</div>
                <div className="text-xs text-slate-500">文档数</div>
              </div>
              <div className="bg-slate-700/50 rounded-lg p-2">
                <div className="text-lg font-bold text-emerald-400">{knowledgeStats.totalChunks}</div>
                <div className="text-xs text-slate-500">片段数</div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-500 text-center py-2">暂无文档</p>
          )}
        </div>

        {/* 文档列表 */}
        <div className="flex-1 overflow-y-auto p-4">
          <h2 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
            📋 文档列表
          </h2>
          {knowledgeStats && knowledgeStats.documents.length > 0 ? (
            <div className="space-y-2">
              {[...knowledgeStats.documents].sort((a, b) => 
                new Date(b.uploadTime).getTime() - new Date(a.uploadTime).getTime()
              ).map((doc) => (
                <div
                  key={doc.id}
                  className="bg-slate-700/30 hover:bg-slate-700/50 rounded-lg p-3 transition-colors group"
                >
                  <div className="flex items-start gap-2">
                    <span className="text-lg flex-shrink-0">
                      {doc.fileType === 'PDF' ? '📕' : 
                       doc.fileType === 'Word' ? '📘' : 
                       doc.fileType === 'Excel' ? '📗' : 
                       doc.fileType === 'Markdown' ? '📝' : '📄'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-200 truncate" title={doc.filename}>
                        {doc.filename}
                      </p>
                      <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
                        <span>{doc.chunkCount} 片段</span>
                        <span>•</span>
                        <span>{formatTime(doc.uploadTime)}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteDocument(doc.id, doc.filename)}
                      className="opacity-0 group-hover:opacity-100 p-1 text-red-400 hover:text-red-300 transition-all"
                      title="删除此文档"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-slate-500 text-sm">📭 暂无文档</p>
              <p className="text-slate-600 text-xs mt-1">上传 PDF、Word、Excel、Markdown、TXT 开始</p>
              <button
                onClick={handleReindex}
                disabled={reindexing}
                className="mt-4 text-xs bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 text-slate-300 px-3 py-1.5 rounded transition-colors"
              >
                {reindexing ? '⏳ 重建中...' : '🔄 重建 uploads 目录索引'}
              </button>
              <p className="text-slate-600 text-xs mt-2">如果 uploads 目录有文件，点击重建索引</p>
            </div>
          )}
        </div>

        {/* 反馈报告入口 */}
        <div className="p-4 border-t border-slate-700">
          <button
            onClick={() => setShowFeedbackReport(!showFeedbackReport)}
            className={`w-full text-sm px-3 py-2 rounded-lg transition-colors flex items-center justify-center gap-2 ${
              showFeedbackReport 
                ? 'bg-purple-600 text-white' 
                : 'bg-slate-700/50 text-slate-300 hover:bg-slate-600'
            }`}
          >
            📊 {showFeedbackReport ? '隐藏反馈报告' : '查看反馈报告'}
          </button>
        </div>

        {/* 底部信息 */}
        <div className="p-4 border-t border-slate-700 text-center">
          <p className="text-xs text-slate-600">支持 PDF、Word、Excel、Markdown、TXT</p>
        </div>
      </aside>

      {/* 右侧：聊天区域 */}
      <main className="flex-1 flex flex-col">
        {/* 聊天头部 */}
        <header className="bg-slate-800/50 backdrop-blur-sm border-b border-slate-700 px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-200 flex items-center gap-2">
                <img src="/favicon.svg" alt="logo" className="w-5 h-5" />
                智能问答
              </h2>
              <p className="text-xs text-slate-500">基于知识库的 RAG 检索增强生成 | Top K: {topK}</p>
            </div>
            {knowledgeStats && knowledgeStats.documentCount > 0 && (
              <span className="text-xs text-emerald-400 bg-emerald-400/10 px-3 py-1 rounded-full">
                ✅ 知识库就绪
              </span>
            )}
          </div>
        </header>

        {/* 聊天消息 */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center max-w-md">
                <div className="text-6xl mb-4">💡</div>
                <h3 className="text-xl font-semibold text-slate-300 mb-2">开始提问</h3>
                <p className="text-slate-500 text-sm">
                  {knowledgeStats && knowledgeStats.documentCount > 0
                    ? `知识库包含 ${knowledgeStats.documentCount} 个文档，${knowledgeStats.totalChunks} 个片段，随时为您解答！`
                    : '请先在左侧上传知识文档，然后开始提问。'}
                </p>
                {knowledgeStats && knowledgeStats.documentCount > 0 && (
                  <div className="mt-6 space-y-3">
                    <p className="text-xs text-slate-500">💡 试试这些问题：</p>
                    <div className="flex flex-wrap justify-center gap-2">
                      <button
                        onClick={() => setInput('知识库里有哪些文档？分别讲了什么内容？')}
                        className="text-xs bg-slate-700/80 hover:bg-slate-600 text-slate-300 px-4 py-2 rounded-full transition-colors border border-slate-600"
                      >
                        📚 知识库概览
                      </button>
                      <button
                        onClick={() => setInput('帮我总结一下所有文档的重点内容')}
                        className="text-xs bg-slate-700/80 hover:bg-slate-600 text-slate-300 px-4 py-2 rounded-full transition-colors border border-slate-600"
                      >
                        📝 总结重点
                      </button>
                      <button
                        onClick={() => setInput('这些文档有什么实用的建议或步骤？')}
                        className="text-xs bg-slate-700/80 hover:bg-slate-600 text-slate-300 px-4 py-2 rounded-full transition-colors border border-slate-600"
                      >
                        🎯 实用建议
                      </button>
                    </div>
                    <p className="text-xs text-slate-600 mt-2">点击问题填充到输入框，按发送即可</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`max-w-[80%] ${msg.role === 'user' ? '' : 'space-y-2'}`}>
                    <div
                      className={`px-4 py-3 rounded-2xl ${
                        msg.role === 'user'
                          ? 'bg-blue-600 text-white rounded-br-md'
                          : 'bg-slate-700/80 text-slate-100 rounded-bl-md'
                      }`}
                    >
                      <p className="text-xs opacity-60 mb-1">
                        {msg.role === 'user' ? '你' : '🤖 AI'}
                      </p>
                      <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</p>
                    </div>
                    
                    {/* AI 回答的操作按钮 */}
                    {msg.role === 'assistant' && (
                      <>
                        <div className="flex items-center gap-1 ml-2">
                          {/* 复制按钮 */}
                          <button
                            onClick={() => handleCopy(msg.content, msg.id)}
                            className="p-1.5 rounded-lg hover:bg-slate-700/50 text-slate-400 hover:text-slate-200 transition-colors"
                            title="复制"
                          >
                            {copiedId === msg.id ? (
                              <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            ) : (
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                            )}
                          </button>
                          
                          {/* 点赞按钮 */}
                          <button
                            onClick={() => handleFeedback(msg.id, 'like')}
                            className={`p-1.5 rounded-lg hover:bg-slate-700/50 transition-colors ${
                              msg.feedback === 'like' 
                                ? 'text-emerald-400' 
                                : 'text-slate-400 hover:text-slate-200'
                            }`}
                            title="有帮助"
                          >
                            <svg className="w-4 h-4" fill={msg.feedback === 'like' ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
                            </svg>
                          </button>
                          
                          {/* 点踩按钮 */}
                          <button
                            onClick={() => handleFeedback(msg.id, 'dislike')}
                            className={`p-1.5 rounded-lg hover:bg-slate-700/50 transition-colors ${
                              msg.feedback === 'dislike' 
                                ? 'text-red-400' 
                                : 'text-slate-400 hover:text-slate-200'
                            }`}
                            title="没有帮助"
                          >
                            <svg className="w-4 h-4" fill={msg.feedback === 'dislike' ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14H5.236a2 2 0 01-1.789-2.894l3.5-7A2 2 0 018.736 3h4.018a2 2 0 01.485.06l3.76.94m-7 10v5a2 2 0 002 2h.096c.5 0 .905-.405.905-.904 0-.715.211-1.413.608-2.008L17 13V4m-7 10h2m5-10h2a2 2 0 012 2v6a2 2 0 01-2 2h-2.5" />
                            </svg>
                          </button>
                          
                          {/* 查看引用按钮 */}
                          {msg.chunks && msg.chunks.length > 0 && (
                            <button
                              onClick={() => toggleChunks(msg.id)}
                              className={`p-1.5 rounded-lg hover:bg-slate-700/50 transition-colors flex items-center gap-1 ${
                                msg.showChunks ? 'text-blue-400' : 'text-slate-400 hover:text-slate-200'
                              }`}
                              title="查看引用"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                              </svg>
                              <span className="text-xs">{msg.chunks.length} 引用</span>
                            </button>
                          )}
                        </div>
                        
                        {/* 引用片段展示 */}
                        {msg.showChunks && msg.chunks && msg.chunks.length > 0 && (
                          <div className="ml-2 mt-2 p-3 bg-slate-800/50 rounded-lg border border-slate-600 space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-medium text-slate-400">📚 引用片段 ({msg.chunks.length})</span>
                            </div>
                            <div className="space-y-2 max-h-60 overflow-y-auto">
                              {msg.chunks.map((chunk, idx) => (
                                <div key={idx} className="p-2 bg-slate-700/50 rounded text-xs">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded text-xs">
                                      #{idx + 1}
                                    </span>
                                    <span className="text-slate-500 truncate">{chunk.source}</span>
                                  </div>
                                  <p className="text-slate-300 leading-relaxed line-clamp-4">
                                    {chunk.content}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        
                        {/* 推荐问题 */}
                        {msg.suggestedQuestions && msg.suggestedQuestions.length > 0 && (
                          <div className="ml-2 mt-3">
                            <p className="text-xs text-slate-500 mb-2">💡 你可能还想问：</p>
                            <div className="flex flex-wrap gap-2">
                              {msg.suggestedQuestions.map((question, idx) => (
                                <button
                                  key={idx}
                                  onClick={() => setInput(question)}
                                  className="text-xs bg-slate-700/50 hover:bg-slate-600 text-slate-300 px-3 py-1.5 rounded-full transition-colors border border-slate-600 hover:border-slate-500"
                                >
                                  {question}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
              {sending && (
                <div className="flex justify-start">
                  <div className="bg-slate-700/80 text-slate-100 px-4 py-3 rounded-2xl rounded-bl-md">
                    <p className="text-xs opacity-60 mb-1">🤖 AI</p>
                    <div className="flex items-center gap-2">
                      <div className="flex space-x-1">
                        <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                        <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                        <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                      </div>
                      <span className="text-sm text-slate-400">思考中...</span>
                    </div>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </>
          )}
        </div>

        {/* 输入区域 */}
        <div className="border-t border-slate-700 p-4 bg-slate-800/30">
          <form onSubmit={handleSubmit} className="flex gap-3 max-w-4xl mx-auto">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="输入你的问题..."
              disabled={sending}
              className="flex-1 bg-slate-800 border border-slate-600 rounded-xl px-4 py-3 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              className="bg-blue-600 hover:bg-blue-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white px-6 py-3 rounded-xl font-medium transition-colors flex items-center gap-2"
            >
              {sending ? '发送中...' : '发送 →'}
            </button>
          </form>
        </div>
      </main>
      
      {/* 确认弹窗 */}
      {confirmModal && (
        <ConfirmModal
          isOpen={confirmModal.isOpen}
          title={confirmModal.title}
          message={confirmModal.message}
          onConfirm={confirmModal.onConfirm}
          onCancel={() => setConfirmModal(null)}
          confirmText="确定删除"
          cancelText="取消"
          danger={confirmModal.danger}
        />
      )}

      {/* 反馈报告弹窗 */}
      {showFeedbackReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowFeedbackReport(false)} />
          <div className="relative bg-slate-800 border border-slate-600 rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[80vh] overflow-hidden flex flex-col">
            {/* 标题栏 */}
            <div className="p-4 border-b border-slate-700 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
                📊 反馈质量报告
              </h3>
              <button
                onClick={() => setShowFeedbackReport(false)}
                className="p-1 text-slate-400 hover:text-slate-200 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* 报告内容 */}
            <div className="p-4 overflow-y-auto flex-1 space-y-4">
              {feedbackReport ? (
                <>
                  {/* 统计概览 */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-slate-700/50 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-blue-400">{feedbackReport.report.totalRecords}</div>
                      <div className="text-xs text-slate-500">总反馈数</div>
                    </div>
                    <div className="bg-slate-700/50 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-emerald-400">{feedbackReport.stats.totalLikes}</div>
                      <div className="text-xs text-slate-500">👍 点赞</div>
                    </div>
                    <div className="bg-slate-700/50 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-red-400">{feedbackReport.stats.totalDislikes}</div>
                      <div className="text-xs text-slate-500">👎 点踩</div>
                    </div>
                  </div>

                  {/* 满意率 */}
                  <div className="bg-slate-700/30 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-slate-300">回答满意率</span>
                      <span className="text-lg font-bold text-emerald-400">{feedbackReport.report.likeRate}</span>
                    </div>
                    <div className="w-full bg-slate-600 rounded-full h-2">
                      <div 
                        className="bg-gradient-to-r from-emerald-500 to-emerald-400 h-2 rounded-full transition-all"
                        style={{ width: feedbackReport.report.likeRate }}
                      />
                    </div>
                    <p className="text-xs text-slate-500 mt-2">
                      基于用户反馈计算，可用于评估 RAG 系统效果和改进 prompt
                    </p>
                  </div>

                  {/* 热门关键词 */}
                  {feedbackReport.report.topKeywords.length > 0 && (
                    <div className="bg-slate-700/30 rounded-lg p-4">
                      <h4 className="text-sm font-medium text-slate-300 mb-3">🔥 热门问题关键词</h4>
                      <div className="flex flex-wrap gap-2">
                        {feedbackReport.report.topKeywords.map((kw, idx) => (
                          <span key={idx} className="bg-slate-600 text-slate-300 px-2 py-1 rounded-full text-xs">
                            {kw.keyword} <span className="text-slate-500">({kw.count})</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 近期差评 */}
                  {feedbackReport.report.recentDislikes.length > 0 && (
                    <div className="bg-red-900/20 border border-red-800/30 rounded-lg p-4">
                      <h4 className="text-sm font-medium text-red-400 mb-3">👎 近期差评（需改进）</h4>
                      <div className="space-y-2">
                        {feedbackReport.report.recentDislikes.slice(0, 5).map((item, idx) => (
                          <div key={idx} className="bg-slate-800/50 rounded p-2">
                            <p className="text-xs text-slate-300 font-medium">Q: {item.question}</p>
                            <p className="text-xs text-slate-500 mt-1 line-clamp-2">A: {item.answerPreview}</p>
                            <div className="flex items-center gap-2 mt-1 text-xs text-slate-600">
                              <span>{new Date(item.timestamp).toLocaleString('zh-CN')}</span>
                              {item.sources.length > 0 && <span>• 来源: {item.sources.join(', ')}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-red-400/70 mt-3">
                        💡 提示：这些回答被标记为不满意，可以用于改进 prompt 或检查文档质量
                      </p>
                    </div>
                  )}

                  {/* 近期好评 */}
                  {feedbackReport.report.recentLikes.length > 0 && (
                    <div className="bg-emerald-900/20 border border-emerald-800/30 rounded-lg p-4">
                      <h4 className="text-sm font-medium text-emerald-400 mb-3">👍 近期好评（表现优秀）</h4>
                      <div className="space-y-2">
                        {feedbackReport.report.recentLikes.slice(0, 3).map((item, idx) => (
                          <div key={idx} className="bg-slate-800/50 rounded p-2">
                            <p className="text-xs text-slate-300 font-medium">Q: {item.question}</p>
                            <p className="text-xs text-slate-500 mt-1 line-clamp-2">A: {item.answerPreview}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 导出数据 */}
                  <div className="bg-slate-700/30 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-slate-300">📥 导出反馈数据</p>
                        <p className="text-xs text-slate-500 mt-1">
                          导出为 CSV 格式，可用 Excel 打开，适用于模型微调
                        </p>
                      </div>
                      <button
                        onClick={exportToExcel}
                        className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        导出 Excel
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-center py-8">
                  <div className="animate-spin text-2xl mb-2">⏳</div>
                  <p className="text-slate-500 text-sm">加载中...</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

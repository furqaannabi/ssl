import React, { useState, useRef, useEffect } from 'react';
import { Icon } from './UI';
import { useConnection } from 'wagmi';

interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
}

interface ArbitrageOpportunity {
    id: string;
    pairSymbol: string;
    tokenSymbol: string;
    orderPrice: number;
    marketPrice: number;
    profitPercent: number;
    direction: 'BUY' | 'SELL';
    orderAmount: number;
    potentialProfit: number;
}

const QUICK_PROMPTS = [
    { label: 'Portfolio', prompt: 'Analyze my portfolio and suggest improvements' },
    { label: 'Arbitrage', prompt: 'Are there any arbitrage opportunities right now?' },
    { label: 'Market', prompt: 'Give me a quick market overview of all available tokens' },
    { label: 'Help', prompt: 'How do I deposit and trade on this platform?' },
];

export const AIChatbot: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [isStreaming, setIsStreaming] = useState(false);
    const [arbitrageCount, setArbitrageCount] = useState(0);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const { address: eoaAddress } = useConnection();

    const API_URL = import.meta.env.VITE_API_URL || 'https://arc.furqaannabi.com';

    // Auto-scroll to bottom
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // Focus input when chat opens
    useEffect(() => {
        if (isOpen) inputRef.current?.focus();
    }, [isOpen]);

    // Poll arbitrage count for badge
    useEffect(() => {
        const fetchArbitrage = async () => {
            try {
                const res = await fetch(`${API_URL}/api/chat/arbitrage`);
                if (res.ok) {
                    const data = await res.json();
                    setArbitrageCount(data.opportunities?.length || 0);
                }
            } catch { /* ignore */ }
        };
        fetchArbitrage();
        const interval = setInterval(fetchArbitrage, 15000);
        return () => clearInterval(interval);
    }, []);

    const sendMessage = async (messageText?: string) => {
        const text = messageText || input.trim();
        if (!text || isStreaming) return;

        const userMsg: ChatMessage = { role: 'user', content: text, timestamp: Date.now() };
        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setIsStreaming(true);

        // Add placeholder assistant message
        const assistantMsg: ChatMessage = { role: 'assistant', content: '', timestamp: Date.now() };
        setMessages(prev => [...prev, assistantMsg]);

        try {
            const res = await fetch(`${API_URL}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: text,
                    userAddress: eoaAddress || 'anonymous',
                    conversationHistory: messages.slice(-10),
                }),
            });

            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }

            const reader = res.body?.getReader();
            const decoder = new TextDecoder();

            if (reader) {
                let fullContent = '';
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    const chunk = decoder.decode(value, { stream: true });
                    const lines = chunk.split('\n').filter(l => l.startsWith('data: '));

                    for (const line of lines) {
                        try {
                            const data = JSON.parse(line.slice(6));
                            if (data.type === 'chunk') {
                                fullContent += data.content;
                                setMessages(prev => {
                                    const updated = [...prev];
                                    updated[updated.length - 1] = {
                                        ...updated[updated.length - 1],
                                        content: fullContent,
                                    };
                                    return updated;
                                });
                            }
                        } catch { /* skip malformed lines */ }
                    }
                }
            }
        } catch (err: any) {
            setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                    ...updated[updated.length - 1],
                    content: 'Sorry, I could not connect to the AI service. Please check that the backend is running and OPENAI_API_KEY is configured.',
                };
                return updated;
            });
        } finally {
            setIsStreaming(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    };

    return (
        <>
            {/* Floating Button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-primary text-black rounded-full flex items-center justify-center shadow-glow hover:scale-110 transition-all duration-200 group"
            >
                <Icon name={isOpen ? 'close' : 'bolt'} className="text-xl" />
                {arbitrageCount > 0 && !isOpen && (
                    <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center animate-pulse">
                        {arbitrageCount}
                    </span>
                )}
                {!isOpen && (
                    <span className="absolute right-16 bg-surface-dark border border-border-dark px-3 py-1.5 text-xs text-primary opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap font-mono shadow-xl rounded">
                        AI Financial Advisor
                    </span>
                )}
            </button>

            {/* Chat Panel */}
            {isOpen && (
                <div className="fixed bottom-24 right-6 z-50 w-[420px] h-[600px] bg-surface-dark border border-border-dark rounded-lg shadow-2xl flex flex-col overflow-hidden">
                    {/* Header */}
                    <div className="px-4 py-3 border-b border-border-dark bg-obsidian flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 bg-primary/10 border border-primary/30 rounded flex items-center justify-center">
                                <Icon name="bolt" className="text-primary text-sm" />
                            </div>
                            <div>
                                <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono">SSL Advisor</h3>
                                <p className="text-[9px] text-slate-500 font-mono">
                                    GPT-4o {arbitrageCount > 0 && (
                                        <span className="text-red-400 ml-1">{arbitrageCount} arb detected</span>
                                    )}
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={() => setIsOpen(false)}
                            className="text-slate-500 hover:text-white transition-colors"
                        >
                            <Icon name="close" className="text-lg" />
                        </button>
                    </div>

                    {/* Messages */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-black/50">
                        {messages.length === 0 && (
                            <div className="flex flex-col items-center justify-center h-full text-center space-y-4">
                                <div className="w-16 h-16 bg-primary/5 border border-primary/20 rounded-full flex items-center justify-center">
                                    <Icon name="bolt" className="text-primary text-2xl" />
                                </div>
                                <div>
                                    <h4 className="text-white text-sm font-bold mb-1">SSL Financial Advisor</h4>
                                    <p className="text-[11px] text-slate-500 max-w-[280px]">
                                        I can analyze your portfolio, detect arbitrage opportunities, and provide real-time market insights.
                                    </p>
                                </div>
                                <div className="flex flex-wrap gap-2 justify-center">
                                    {QUICK_PROMPTS.map((qp) => (
                                        <button
                                            key={qp.label}
                                            onClick={() => sendMessage(qp.prompt)}
                                            className="px-3 py-1.5 bg-surface-dark border border-border-dark rounded text-[10px] text-slate-400 font-mono hover:border-primary hover:text-primary transition-colors"
                                        >
                                            {qp.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {messages.map((msg, i) => (
                            <div
                                key={i}
                                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                            >
                                <div
                                    className={`max-w-[85%] px-3 py-2 rounded-lg text-xs font-mono leading-relaxed ${
                                        msg.role === 'user'
                                            ? 'bg-primary/10 border border-primary/20 text-white'
                                            : 'bg-surface-dark border border-border-dark text-slate-300'
                                    }`}
                                >
                                    {msg.role === 'assistant' && msg.content === '' && isStreaming && i === messages.length - 1 ? (
                                        <div className="flex items-center gap-2 text-slate-500">
                                            <div className="flex gap-1">
                                                <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                                                <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                                                <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                                            </div>
                                            Analyzing...
                                        </div>
                                    ) : (
                                        <div className="whitespace-pre-wrap">
                                            {msg.content.split(/(\$\d+[\d,.]*)/g).map((part, j) => (
                                                /^\$\d/.test(part) ? (
                                                    <span key={j} className="text-primary font-bold">{part}</span>
                                                ) : (
                                                    <span key={j}>{part}</span>
                                                )
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Quick Actions (show after first exchange) */}
                    {messages.length > 0 && !isStreaming && (
                        <div className="px-3 py-2 border-t border-border-dark bg-surface-dark/50 flex gap-2 overflow-x-auto">
                            {QUICK_PROMPTS.map((qp) => (
                                <button
                                    key={qp.label}
                                    onClick={() => sendMessage(qp.prompt)}
                                    className="shrink-0 px-2 py-1 bg-black border border-border-dark rounded text-[9px] text-slate-500 font-mono hover:border-primary hover:text-primary transition-colors"
                                >
                                    {qp.label}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Input */}
                    <div className="px-3 py-3 border-t border-border-dark bg-obsidian flex items-center gap-2">
                        <input
                            ref={inputRef}
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder={isStreaming ? 'Waiting for response...' : 'Ask about your portfolio, prices, arbitrage...'}
                            disabled={isStreaming}
                            className="flex-1 bg-black border border-border-dark text-white text-xs px-3 py-2 font-mono focus:border-primary outline-none disabled:opacity-50 rounded"
                        />
                        <button
                            onClick={() => sendMessage()}
                            disabled={isStreaming || !input.trim()}
                            className="w-8 h-8 bg-primary text-black rounded flex items-center justify-center hover:bg-primary-dark transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                            <Icon name="bolt" className="text-sm" />
                        </button>
                    </div>
                </div>
            )}
        </>
    );
};

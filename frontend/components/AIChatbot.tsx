import React, { useState, useRef, useEffect } from 'react';
import { Icon } from './UI';
import { useConnection } from 'wagmi';
import { OrderPreviewModal } from './OrderPreviewModal';
import { auth } from '../lib/auth';

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

interface ParsedOrder {
    side: 'BUY' | 'SELL';
    amount: string;
    price: string;
    symbol: string;
    chain: string;
    pairId?: string;
    chainSelector?: string;
}

interface BalanceCheck {
    hasSufficientBalance: boolean;
    required: string;
    available: string;
    error: string;
}

interface ParseResponse {
    parsed: ParsedOrder | null;
    requiresConfirmation: boolean;
    balanceCheck: BalanceCheck | null;
    totalValue?: string;
}

const QUICK_PROMPTS = [
    { label: 'Portfolio', prompt: 'Analyze my portfolio and suggest improvements' },
    { label: 'Arbitrage', prompt: 'Are there any arbitrage opportunities right now?' },
    { label: 'Market', prompt: 'Give me a quick market overview of all available tokens' },
    { label: 'Help', prompt: 'How do I deposit and trade on this platform?' },
];

/**
 * Lightweight markdown renderer — processes line by line.
 * Handles: ### headings, **bold**, *italic*, `code`, $price,
 *          bullet lists (* / -), numbered lists, blank lines as spacing.
 */
function renderMarkdown(text: string): React.ReactNode {
    const lines = text.split('\n');
    const output: React.ReactNode[] = [];
    let i = 0;

    while (i < lines.length) {
        const raw = lines[i];
        const trimmed = raw.trim();

        // Skip blank lines (they add spacing via the container's space-y)
        if (!trimmed) { i++; continue; }

        // Headings: ### ## #
        const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)/);
        if (headingMatch) {
            const level = headingMatch[1].length;
            const cls = level === 1
                ? 'text-sm font-bold text-white mt-2 mb-0.5'
                : level === 2
                ? 'text-xs font-bold text-white mt-1.5 mb-0.5'
                : 'text-[11px] font-bold text-slate-200 mt-1 mb-0.5 uppercase tracking-wide';
            output.push(<p key={i} className={cls}>{renderInline(headingMatch[2])}</p>);
            i++; continue;
        }

        // Bullet list — collect consecutive bullet lines
        if (/^[\*\-]\s+/.test(trimmed)) {
            const items: string[] = [];
            while (i < lines.length && /^[\*\-]\s+/.test(lines[i].trim())) {
                items.push(lines[i].trim().replace(/^[\*\-]\s+/, ''));
                i++;
            }
            output.push(
                <ul key={`ul-${i}`} className="list-none space-y-0.5 my-1">
                    {items.map((item, li) => (
                        <li key={li} className="flex gap-1.5 items-baseline">
                            <span className="text-primary shrink-0 leading-none">›</span>
                            <span className="leading-relaxed">{renderInline(item)}</span>
                        </li>
                    ))}
                </ul>
            );
            continue;
        }

        // Numbered list — collect consecutive numbered lines
        if (/^\d+\.\s+/.test(trimmed)) {
            const items: string[] = [];
            let num = 1;
            while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
                items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
                i++;
            }
            output.push(
                <ol key={`ol-${i}`} className="list-none space-y-0.5 my-1">
                    {items.map((item, li) => (
                        <li key={li} className="flex gap-1.5 items-baseline">
                            <span className="text-primary shrink-0 font-bold leading-none">{num++}.</span>
                            <span className="leading-relaxed">{renderInline(item)}</span>
                        </li>
                    ))}
                </ol>
            );
            continue;
        }

        // Horizontal rule
        if (/^---+$/.test(trimmed)) {
            output.push(<hr key={i} className="border-border-dark my-1.5" />);
            i++; continue;
        }

        // Regular paragraph line
        output.push(
            <p key={i} className="leading-relaxed">{renderInline(trimmed)}</p>
        );
        i++;
    }

    return <div className="space-y-1">{output}</div>;
}

/** Render inline markdown: **bold**, *italic*, `code`, $price highlights */
function renderInline(text: string): React.ReactNode {
    const tokens = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\$[\d,.]+)/);
    return tokens.map((tok, i) => {
        if (/^\*\*/.test(tok)) return <strong key={i} className="text-white font-bold">{tok.slice(2, -2)}</strong>;
        if (/^\*/.test(tok))   return <em key={i} className="text-slate-200 italic">{tok.slice(1, -1)}</em>;
        if (/^`/.test(tok))    return <code key={i} className="bg-black/60 text-primary px-1 rounded text-[9px] font-mono">{tok.slice(1, -1)}</code>;
        if (/^\$[\d,.]/.test(tok)) return <span key={i} className="text-primary font-bold">{tok}</span>;
        return tok;
    });
}

export const AIChatbot: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [isStreaming, setIsStreaming] = useState(false);
    const [arbitrageCount, setArbitrageCount] = useState(0);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const { address: eoaAddress } = useConnection();

    const API_URL = "";

    // Order Preview Modal State
    const [isOrderPreviewOpen, setIsOrderPreviewOpen] = useState(false);
    const [parsedOrder, setParsedOrder] = useState<ParsedOrder | null>(null);
    const [balanceCheck, setBalanceCheck] = useState<BalanceCheck | null>(null);
    const [orderTotalValue, setOrderTotalValue] = useState<string | undefined>();
    const [pendingMessage, setPendingMessage] = useState<string>('');

    // Auto-scroll to bottom
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // Focus input when chat opens
    useEffect(() => {
        if (isOpen) inputRef.current?.focus();
    }, [isOpen]);

    // Check for trading intent keywords
    const hasTradingIntent = (text: string): boolean => {
        const tradingKeywords = ['buy', 'sell', 'purchase', 'trade', 'order', 'long', 'short'];
        const lower = text.toLowerCase();
        return tradingKeywords.some(kw => lower.includes(kw));
    };

    // Handle order confirmation from modal — must include encrypted + signature for CRE TEE
    const handleOrderConfirm = async (order: {
        pairId: string;
        amount: string;
        price: string;
        side: 'BUY' | 'SELL';
        shieldAddress: string;
        baseChainSelector: string;
        quoteChainSelector: string;
        encrypted: string;
        signature: string;
    }, onLog?: (log: string) => void): Promise<{ success: boolean; logs?: string[]; error?: string }> => {
        const logs: string[] = [];

        const pushLog = (msg: string) => {
            logs.push(msg);
            onLog?.(msg);
        };
        
        try {
            const response = await fetch(`${API_URL}/api/order`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...order,
                    userAddress: eoaAddress,
                }),
                credentials: 'include',
            });

            console.log('[Order] Response status:', response.status);
            
            if (!response.ok) {
                const text = await response.text();
                console.log('[Order] Error response:', text);
                try {
                    const err = JSON.parse(text);
                    return { success: false, error: err.error || `HTTP ${response.status}` };
                } catch {
                    return { success: false, error: `HTTP ${response.status}: ${text || 'No response body'}` };
                }
            }

            // Stream the response to get logs
            const reader = response.body?.getReader();
            const decoder = new TextDecoder();
            
            if (reader) {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    
                    const chunk = decoder.decode(value, { stream: true });
                    const lines = chunk.split('\n').filter(l => l.trim() !== '');
                    
                    for (const line of lines) {
                        try {
                            const data = JSON.parse(line);
                            if (data.type === 'log') {
                                pushLog(data.message);
                            } else if (data.type === 'result') {
                                pushLog(`Order ${data.orderId?.slice(0, 8)}... ${data.status}`);
                                return { success: true, logs };
                            } else if (data.type === 'error') {
                                return { success: false, error: data.detail || 'Matching engine failed', logs };
                            }
                        } catch { /* skip malformed */ }
                    }
                }
            }

            return { success: true, logs };
        } catch (err: any) {
            return { success: false, error: err.message || 'Failed to place order', logs };
        }
    };

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

        // Clear input immediately
        setInput('');

        // Check for trading intent BEFORE sending to chat
        if (hasTradingIntent(text)) {
            if (!eoaAddress) {
                const errorMsg: ChatMessage = {
                    role: 'assistant',
                    content: 'To place an order, please connect your wallet first.',
                    timestamp: Date.now(),
                };
                setMessages(prev => [...prev, errorMsg]);
                return;
            }

            // Gate: World ID verification required before trading
            const user = await auth.getMe();
            if (!user?.isVerified) {
                const errorMsg: ChatMessage = {
                    role: 'assistant',
                    content: 'World ID verification is required before placing orders. Head to the **Compliance** tab to verify your identity.',
                    timestamp: Date.now(),
                };
                setMessages(prev => [...prev, errorMsg]);
                return;
            }

            setPendingMessage(text);
            setIsStreaming(true);

            try {
                const res = await fetch(`${API_URL}/api/order/parse`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        message: text,
                        userAddress: eoaAddress,
                    }),
                });

                if (!res.ok) {
                    throw new Error(`HTTP ${res.status}`);
                }

                const data = await res.json();

                if (data.requiresConfirmation && data.parsed) {
                    // Show the order preview modal
                    setParsedOrder(data.parsed);
                    setBalanceCheck(data.balanceCheck);
                    setOrderTotalValue(data.totalValue);
                    setIsOrderPreviewOpen(true);
                    setIsStreaming(false);
                    setTimeout(() => inputRef.current?.focus(), 10);
                    return;
                } else if (data.parsed?.error) {
                    // Show error message in chat
                    const errorMsg: ChatMessage = {
                        role: 'assistant',
                        content: data.parsed.error,
                        timestamp: Date.now(),
                    };
                    setMessages(prev => [...prev, errorMsg]);
                    setIsStreaming(false);
                    setTimeout(() => inputRef.current?.focus(), 10);
                    return;
                } else {
                    // Parse succeeded but not a valid order - continue to regular chat
                    console.log('[OrderParse] Not a valid order, continuing to chat');
                }
            } catch (err: any) {
                console.error('[OrderParse] Error:', err);
                // Show error message in chat
                const errorMsg: ChatMessage = {
                    role: 'assistant',
                    content: 'Sorry, I had trouble processing that order. Please try again or try a simpler format like "Buy 0.5 tMETA at $100 on Base".',
                    timestamp: Date.now(),
                };
                setMessages(prev => [...prev, errorMsg]);
            } finally {
                setIsStreaming(false);
                setTimeout(() => inputRef.current?.focus(), 10);
            }
        }

        // Regular chat message (non-trading)
        const userMsg: ChatMessage = { role: 'user', content: text, timestamp: Date.now() };
        setMessages(prev => [...prev, userMsg]);
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
            // Restore focus to input after reply
            setTimeout(() => inputRef.current?.focus(), 10);
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
                                    {renderMarkdown(`Hello there! Welcome to SSL (Stealth Settlement Layer), your private platform for trading tokenized Real World Assets.

What can I help you with today? You can:

* **Learn more about the platform**
* **See what tokens are available for trading**
* **Find out how to deposit funds**
* **Place trades in natural language** — e.g. "Buy 0.5 tNVDA at $800"

Let me know how I can assist!`)}
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
                                        <div className="space-y-1.5 text-xs leading-relaxed">
                                            {msg.role === 'assistant'
                                                ? renderMarkdown(msg.content)
                                                : msg.content
                                            }
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

            {/* Order Preview Modal */}
            <OrderPreviewModal
                isOpen={isOrderPreviewOpen}
                onClose={() => {
                    setIsOrderPreviewOpen(false);
                    setParsedOrder(null);
                    setBalanceCheck(null);
                    setOrderTotalValue(undefined);
                }}
                parsed={parsedOrder}
                balanceCheck={balanceCheck}
                totalValue={orderTotalValue}
                onConfirm={handleOrderConfirm}
            />
        </>
    );
};

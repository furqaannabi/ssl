import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Icon, Card, Button, Badge, useToast } from './UI';
import { OracleIndicator } from './OracleIndicator';
import { FundingModal } from './FundingModal';
import { useConnection, useSignMessage } from 'wagmi';
import { signTypedData } from '@wagmi/core';
import { CHAINS } from '../lib/chain-config';
import { auth } from '../lib/auth';
import { ETH_SEPOLIA_TOKENS } from '../lib/contracts';
import { config } from '../lib/wagmi';
import { encryptOrder } from '../lib/crypto';
import { fetchCREPublicKey, signEncryptedOrder } from '../lib/cre-client';
import { getAddress } from 'viem';

const CONVERGENCE_VAULT: `0x${string}` = '0xE588a6c73933BFD66Af9b4A07d48bcE59c0D2d13';
const CONVERGENCE_DOMAIN = {
    name: 'CompliantPrivateTokenDemo',
    version: '0.0.1',
    chainId: 11155111,
    verifyingContract: CONVERGENCE_VAULT,
} as const;
const RETRIEVE_BALANCES_TYPES = {
    'Retrieve Balances': [
        { name: 'account', type: 'address' },
        { name: 'timestamp', type: 'uint256' },
    ],
} as const;

export const Terminal: React.FC = () => {
    const { toast } = useToast();
    const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
    const [privacyLevel, setPrivacyLevel] = useState(3);
    const [shieldAddress, setShieldAddress] = useState<string>('');
    const [status, setStatus] = useState<'IDLE' | 'SENDING' | 'MATCHING' | 'SETTLED'>('IDLE');
    const [selectedPairId, setSelectedPairId] = useState<string>('');
    const [amount, setAmount] = useState('10');
    const [price, setPrice] = useState('100.00');
    const logEndRef = useRef<HTMLDivElement>(null);

    const { address: eoaAddress, isConnected } = useConnection();
    const { signMessageAsync } = useSignMessage();

    const API_URL = ""; // Use Vite proxy for CORS/cookie consistency
    // Order State
    const [isFundingOpen, setIsFundingOpen] = useState(false);
    const [myOrders, setMyOrders] = useState<any[]>([]);
    const [activeTab, setActiveTab] = useState<'BOOK' | 'MY_ORDERS'>('BOOK');
    const [logs, setLogs] = useState<string[]>([]);
    const [orderBook, setOrderBook] = useState<{ bids: any[], asks: any[] }>({ bids: [], asks: [] });
    const [pairs, setPairs] = useState<any[]>([]);
    const [baseChainSelector, setBaseChainSelector] = useState<string>('ethereum-testnet-sepolia');
    const [quoteChainSelector, setQuoteChainSelector] = useState<string>('ethereum-testnet-sepolia');
    const [balances, setBalances] = useState<Array<{ token: string; chainSelector: string; balance: string }>>([]); // Raw balance entries from backend
    const [tokenLookup, setTokenLookup] = useState<Record<string, any>>({}); // address -> token metadata (symbol, decimals)
    const [vaultChecked, setVaultChecked] = useState(false);
    const [vaultChecking, setVaultChecking] = useState(false);
    const [vaultCheckError, setVaultCheckError] = useState<string | null>(null);
    // Fetch Data
    const fetchBalances = async () => {
        try {
            const tokensRes = await fetch(`${API_URL}/api/tokens`);

            // Build address->metadata lookup from /api/tokens, falling back to hardcoded list
            const lookup: Record<string, any> = {};
            // Seed with hardcoded ETH Sepolia tokens so USDC + RWA always resolve
            ETH_SEPOLIA_TOKENS.forEach(t => { lookup[t.address.toLowerCase()] = t; });
            if (tokensRes.ok) {
                const data = await tokensRes.json();
                if (data.success) {
                    // DB entries override hardcoded ones (may have richer metadata)
                    data.tokens.forEach((t: any) => { lookup[t.address.toLowerCase()] = t; });
                }
            }
            setTokenLookup(lookup);
        } catch (e) { console.error("Failed to fetch token metadata", e); }
    };

    /** Sign EIP-712 and fetch live vault balances from Convergence via backend proxy. */
    const checkVaultBalances = useCallback(async () => {
        if (!isConnected || !eoaAddress) { setVaultCheckError('Connect your wallet first.'); return; }
        setVaultChecking(true);
        setVaultCheckError(null);
        try {
            const timestamp = Math.floor(Date.now() / 1000);
            const sig = await signTypedData(config, {
                account: eoaAddress as `0x${string}`,
                domain: CONVERGENCE_DOMAIN,
                types: RETRIEVE_BALANCES_TYPES,
                primaryType: 'Retrieve Balances',
                message: {
                    account: getAddress(eoaAddress),
                    timestamp: BigInt(timestamp),
                },
            });
            const res = await fetch('/api/user/vault-balances', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ timestamp, auth: sig }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error((err as any).error || 'Failed to fetch vault balances');
            }
            const data = await res.json();
            const vaultBals: Array<{ token: string; amount: string }> = data.balances ?? [];
            // Map into the balances[] format: balance = raw amount (same units Convergence returns)
            setBalances(vaultBals.map(b => ({
                token: b.token.toLowerCase(),
                chainSelector: 'ethereum-testnet-sepolia',
                balance: b.amount,
            })));
            setVaultChecked(true);
        } catch (err: any) {
            setVaultCheckError(err.shortMessage || err.message || 'Balance check failed');
        } finally {
            setVaultChecking(false);
        }
    }, [isConnected, eoaAddress]);

    /** Get available balance filtered by token address and optionally by chain. */
    const getAvailableBalance = (tokenAddress: string, decimals: number, chainSel?: string): number => {
        let total = 0;
        for (const b of balances) {
            if (b.token === tokenAddress.toLowerCase() && (!chainSel || b.chainSelector === chainSel)) {
                total += Number(b.balance) / (10 ** decimals);
            }
        }
        return total;
    };

    /** Find base token entry (address+decimals) for the currently selected base chain.
     *  Prefers ETH Sepolia chain match; falls back to first token in pair so stale
     *  DB chainSelector values (e.g. 'base-1') don't break token resolution. */
    const getBaseToken = (pairArg?: any): { address: string; decimals: number; chainSelector: string } | undefined => {
        const pair = pairArg ?? pairs.find(p => p.id === selectedPairId);
        if (!pair?.tokens?.length) return undefined;
        return pair.tokens.find((t: any) => t.chainSelector === 'ethereum-testnet-sepolia')
            ?? pair.tokens[0];
    };

    /** Find USDC token entry (ETH Sepolia only — chain-agnostic lookup). */
    const getQuoteToken = (): { address: string; decimals: number; symbol: string } | undefined => {
        return Object.values(tokenLookup).find((t: any) => t.symbol === 'USDC') as any;
    };
    const fetchPairs = async () => {
        try {
            const res = await fetch(`${API_URL}/api/pairs`);
            if (res.ok) {
                const data = await res.json();
                if (data.success && data.pairs.length > 0) {
                    setPairs(data.pairs);
                    if (!selectedPairId) {
                        const first = data.pairs[0];
                        setSelectedPairId(first.id);
                        // Always keep ETH Sepolia — don't let stale DB chainSelector values override
                        setBaseChainSelector('ethereum-testnet-sepolia');
                        setQuoteChainSelector('ethereum-testnet-sepolia');
                    }
                }
            }
        } catch (e) { console.error("Failed to fetch pairs", e); }
    };

    const fetchMyOrders = async () => {
        try {
            const res = await fetch(`${API_URL}/api/user/orders`, { credentials: "include" });
            if (res.ok) {
                const data = await res.json();
                if (data.success) setMyOrders(data.orders);
            }
        } catch (e) { console.error("Failed to fetch user orders", e); }
    };

    const fetchOrderBook = async () => {
        if (!selectedPairId) return; // Wait for pair selection
        try {
            const res = await fetch(`${API_URL}/api/order/book?pairId=${selectedPairId}`);
            if (res.ok) {
                const data = await res.json();
                if (data.success) {
                    const orders = data.orders;

                    // Process Orders into Aggregated Levels
                    // Group by Price
                    const bidsMap = new Map<string, number>();
                    const asksMap = new Map<string, number>();

                    orders.forEach((o: any) => {
                        const price = Number(o.price).toFixed(2);
                        const amount = Number(o.amount) - Number(o.filledAmount || 0);

                        if (o.side === 'BUY') {
                            bidsMap.set(price, (bidsMap.get(price) || 0) + amount);
                        } else {
                            asksMap.set(price, (asksMap.get(price) || 0) + amount);
                        }
                    });

                    // Convert Map to Array & Sort
                    const bids = Array.from(bidsMap.entries())
                        .map(([price, amount]) => ({ price, amount }))
                        .sort((a, b) => Number(b.price) - Number(a.price)); // Descending (Best Bid Top)

                    const asks = Array.from(asksMap.entries())
                        .map(([price, amount]) => ({ price, amount }))
                        .sort((a, b) => Number(a.price) - Number(b.price)); // Ascending (Best Ask Top)

                    setOrderBook({ bids, asks });
                }
            }
        } catch (e) { console.error("Failed to fetch book", e); }
    };

    useEffect(() => {
        fetchPairs();
        if (isConnected) {
            fetchMyOrders();
            fetchBalances(); // loads tokenLookup metadata only
        }
        if (selectedPairId) fetchOrderBook();

        const interval = setInterval(() => {
            if (isConnected) {
                if (activeTab === 'MY_ORDERS') fetchMyOrders();
                fetchBalances(); // periodically refresh token metadata
            }
            if (activeTab === 'BOOK' && selectedPairId) fetchOrderBook();
        }, 3000);
        return () => clearInterval(interval);
    }, [isConnected, activeTab, selectedPairId]);

    // Chain selectors are always ETH Sepolia — do not override from pair tokens

    // Auto-scroll logs to bottom whenever logs change
    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    const cancelOrder = async (orderId: string) => {
        try {
            const res = await fetch(`${API_URL}/api/order/${orderId}/cancel`, {
                method: "POST",
                credentials: "include"
            });
            const data = await res.json();
            if (data.success) {
                toast.success("Order Cancelled");
                fetchMyOrders();
            } else {
                toast.error(data.error || "Cancel failed");
            }
        } catch (e) {
            toast.error("Cancel failed");
        }
    };

    const handlePlaceOrder = async () => {
        if (!isConnected) {
            toast.error("Connect Authority Wallet (EOA) first");
            return;
        }

        // Gate: World ID verification required by vault contract
        const user = await auth.getMe();
        if (!user?.isVerified) {
            toast.error("World ID verification required. Go to the Compliance tab to verify.");
            return;
        }

        if (!shieldAddress || !/^0x[0-9a-fA-F]{40}$/.test(shieldAddress)) {
            toast.error("Invalid Shield Address. Generate in Profile.");
            return;
        }

        // Find Pair ID
        const pair = pairs.find(p => p.id === selectedPairId);
        if (!pair) {
            toast.error(`Trading pair not found`);
            return;
        }

        const totalValue = Number(amount) * Number(price);
        if (totalValue < 5) {
            toast.error(`Order value must be at least 5 USDC (Current: ${totalValue.toFixed(2)} USDC)`);
            return;
        }

        // CHECK BALANCES
        if (side === 'BUY') {
            const qt = getQuoteToken();
            if (!qt) { toast.error("USDC not found for selected chain"); return; }
            const available = getAvailableBalance(qt.address, qt.decimals || 6, quoteChainSelector);
            if (totalValue > available) {
                toast.error(`Insufficient USDC. Need: ${totalValue.toFixed(2)}, Have: ${available.toFixed(2)}`);
                return;
            }
        } else {
            const bt = getBaseToken();
            if (!bt) { toast.error(`${pair.baseSymbol} not found for selected chain`); return; }
            const available = getAvailableBalance(bt.address, bt.decimals || 18, baseChainSelector);
            if (Number(amount) > available) {
                toast.error(`Insufficient ${pair.baseSymbol}. Have: ${available.toFixed(4)}`);
                return;
            }
        }

        try {
            setLogs([]); // Clear previous logs
            setStatus('SENDING');

            // ── Encrypt order for CRE TEE (required) ──────────────────────────────
            setLogs(['Encrypting order for CRE TEE...']);
            const crePublicKey = await fetchCREPublicKey();
            const encrypted = await encryptOrder({ pairId: pair.id, side, amount: String(amount), price: String(price), shieldAddress: shieldAddress, userAddress: eoaAddress || '' }, crePublicKey);
            const signature = await signEncryptedOrder(encrypted, signMessageAsync as any);
            setLogs(prev => [...prev, 'Order encrypted. Submitting to TEE...']);

            const payload = {
                pairId: pair.id,
                side,
                amount: String(amount),
                price: String(price),
                shieldAddress: shieldAddress,
                userAddress: eoaAddress,
                baseChainSelector,
                quoteChainSelector,
                encrypted,
                signature,
            };

            const response = await fetch(`${API_URL}/api/order`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
                credentials: "include"
            });

            if (!response.ok) {
                if (response.status === 401) {
                    toast.error("Session expired. Logging out...");
                    setTimeout(() => {
                        import('../lib/auth').then(({ auth }) => auth.logout());
                    }, 1000);
                    return;
                }
                const err = await response.json();
                throw new Error(err.error || "Order placement failed");
            }

            // Stream matching engine logs directly from the response
            setStatus('MATCHING');
            const reader = response.body?.getReader();
            const decoder = new TextDecoder();

            if (reader) {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    const chunk = decoder.decode(value, { stream: true });
                    const lines = chunk.split('\n').filter(line => line.trim() !== '');

                    for (const line of lines) {
                        try {
                            const data = JSON.parse(line);
                            if (data.type === 'log') {
                                setLogs(prev => [...prev, data.message]);
                            } else if (data.type === 'result') {
                                setLogs(prev => [...prev, `SUCCESS: Order ${data.status}`]);
                                fetchMyOrders(); // Refresh status
                                if (data.status === 'SETTLED' || data.status === 'MATCHED') setStatus('SETTLED');
                                else setStatus('IDLE');
                                toast.success(`Order ${data.status}`);
                            } else if (data.type === 'error') {
                                toast.error(data.error);
                                setStatus('IDLE');
                            }
                        } catch (e) {
                            // console.error("Stream parse error", e);
                        }
                    }
                }
            }

            setTimeout(() => setStatus('IDLE'), 3000);

        } catch (err: any) {
            console.error("Order failed:", err);
            if (err.message.includes("Unlimited") || err.message.includes("Unauthorized") || err.message.includes("401")) {
                toast.error("Session expired. Logging out...");
                setTimeout(() => {
                    import('../lib/auth').then(({ auth }) => auth.logout());
                }, 1000);
            } else {
                toast.error(err.message || "Order placement failed");
            }
            setLogs(prev => [...prev, `ERROR: ${err.message}`]);
            setStatus('IDLE');
        }
    };

    return (
        <div className="h-full grid grid-cols-12 gap-4 p-4 overflow-hidden bg-background-dark relative">
            <div className="crt-overlay absolute inset-0 z-50 pointer-events-none opacity-20"></div>
            <div className="absolute inset-0 pointer-events-none opacity-5 bg-grid-pattern z-0"></div>

            {/* Order Entry */}
            <div className="col-span-12 md:col-span-3 flex flex-col z-10">
                <Card className="h-full flex flex-col shadow-heavy border-border-dark">
                    <div className="px-4 py-3 border-b border-border-dark bg-obsidian flex justify-between items-center">
                        <h2 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2 font-mono">
                            <Icon name="vpn_key" className="text-primary text-sm" />
                            Confidential Order Entry
                        </h2>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="ghost"
                                className="h-6 px-2 text-[8px] text-primary border border-primary/30 hover:bg-primary/10 font-mono uppercase tracking-wider"
                                onClick={() => setIsFundingOpen(true)}
                            >
                                + Deposit
                            </Button>
                            <div className="w-1.5 h-1.5 bg-primary"></div>
                        </div>
                    </div>

                    <div className="p-5 flex-1 overflow-y-auto space-y-6 bg-stripes bg-[length:20px_20px]">
                        {!isConnected && (
                            <div className="p-3 bg-primary/10 border border-primary/40 rounded text-[10px] text-primary font-mono mb-2 flex items-center gap-2">
                                <Icon name="link_off" className="text-xs" />
                                EOA DISCONNECTED: Link authority wallet to sign orders.
                            </div>
                        )}
                        {/* Stealth Key Input */}
                        <div className="bg-obsidian/50 p-3 rounded border border-border-dark space-y-2">
                            <div className="flex justify-between items-center">
                                <label className="text-[10px] text-primary font-mono uppercase tracking-wider">Shield Address</label>
                                <Button
                                    variant="ghost"
                                    className="text-[8px] h-5 px-2 text-primary border border-primary/20 hover:bg-primary/10"
                                    onClick={async () => {
                                        try {
                                            const text = await navigator.clipboard.readText();
                                            const cleanedText = text ? text.trim() : "";

                                            if (!cleanedText) {
                                                toast.error("Clipboard is empty");
                                                return;
                                            }

                                            if (/^0x[0-9a-fA-F]{40}$/.test(cleanedText)) {
                                                setShieldAddress(cleanedText);
                                                toast.success("Shield Address Pasted");
                                            } else {
                                                toast.error("Invalid Address Format (0x + 40 hex chars)");
                                            }
                                        } catch (e) {
                                            console.error("Clipboard error", e);
                                            toast.error("Failed to read clipboard");
                                        }
                                    }}
                                >
                                    PASTE
                                </Button>
                            </div>
                            <input
                                type="text"
                                value={shieldAddress}
                                onChange={(e) => setShieldAddress(e.target.value)}
                                placeholder="0x..."
                                className="w-full bg-black border border-border-light rounded p-2 text-[10px] font-mono text-white focus:border-primary outline-none"
                            />
                            <p className="text-[8px] text-slate-500 font-mono">
                                Destination for settled assets.
                                <span className="text-primary cursor-pointer ml-1 hover:underline" onClick={() => (window as any).toggleProfile?.()}>Generate in Profile</span>
                            </p>
                        </div>

                        <div className="space-y-2 relative bg-surface-dark/95 p-4 border border-border-dark backdrop-blur-sm">
                            <label className="text-[10px] text-primary font-mono uppercase tracking-wider block mb-1">Asset Class</label>
                            <div className="relative">
                                <select
                                    className="w-full bg-black border border-border-dark text-white text-sm px-3 py-2.5 focus:ring-1 focus:ring-primary focus:border-primary appearance-none font-mono rounded-none"
                                    value={selectedPairId}
                                    onChange={(e) => setSelectedPairId(e.target.value)}
                                >
                                    {pairs.length > 0 ? (
                                        pairs.map(pair => (
                                            <option key={pair.id} value={pair.id}>
                                                {pair.baseSymbol}/{pair.quoteSymbol}
                                            </option>
                                        ))
                                    ) : (
                                        <option disabled>Loading markets...</option>
                                    )}
                                </select>
                                <Icon name="expand_more" className="absolute right-3 top-2.5 text-primary pointer-events-none text-lg" />
                            </div>
                        </div>


                        <div className="grid grid-cols-2 gap-3 bg-surface-dark/95 p-4 border border-border-dark backdrop-blur-sm">
                            <div className="space-y-1">
                                <label className="text-[10px] text-slate-500 font-mono uppercase">Side</label>
                                <div className="flex bg-black border border-border-dark p-0.5">
                                    <button
                                        onClick={() => setSide('BUY')}
                                        className={`flex-1 text-center text-[10px] font-bold py-2 font-mono uppercase transition-colors ${side === 'BUY' ? 'bg-primary text-black' : 'text-slate-500 hover:text-white'}`}
                                    >BUY</button>
                                    <button
                                        onClick={() => setSide('SELL')}
                                        className={`flex-1 text-center text-[10px] font-bold py-2 font-mono uppercase transition-colors ${side === 'SELL' ? 'bg-red-500 text-black' : 'text-slate-500 hover:text-white'}`}
                                    >SELL</button>
                                </div>
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] text-slate-500 font-mono uppercase">Type</label>
                                <select className="w-full bg-black border border-border-dark text-white text-xs px-2 py-2 focus:ring-1 focus:ring-primary focus:border-primary appearance-none font-mono rounded-none h-[34px]">
                                    <option>Limit</option>
                                    <option>Market</option>
                                    <option>Pegged</option>
                                </select>
                            </div>
                        </div>

                        <div className="space-y-4 bg-surface-dark/95 p-4 border border-border-dark backdrop-blur-sm">
                            <div className="space-y-1">
                                <div className="flex justify-between">
                                    <label className="text-[10px] text-slate-500 font-mono uppercase">Volume</label>
                                    <span className="text-[10px] text-primary font-mono cursor-pointer underline decoration-primary/50" onClick={() => {
                                        if (side === 'BUY') {
                                            const qt = getQuoteToken();
                                            if (!qt) return;
                                            const bal = getAvailableBalance(qt.address, qt.decimals || 6, quoteChainSelector);
                                            const p = Number(price);
                                            if (p > 0) setAmount((bal / p).toFixed(4));
                                        } else {
                                            const bt = getBaseToken();
                                            if (!bt) return;
                                            const bal = getAvailableBalance(bt.address, bt.decimals || 18, baseChainSelector);
                                            setAmount(bal.toFixed(4));
                                        }
                                    }}>Max</span>
                                </div>
                                {/* Balance row */}
                                <div className="flex items-center justify-between mb-1">
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-[8px] text-slate-500 font-mono uppercase">Vault Balance</span>
                                        <button
                                            onClick={checkVaultBalances}
                                            disabled={vaultChecking || !isConnected}
                                            className="text-[8px] text-primary border border-primary/30 px-1 py-0.5 font-mono hover:bg-primary/10 disabled:opacity-40 disabled:cursor-not-allowed"
                                        >
                                            {vaultChecking ? '…' : vaultChecked ? '↻' : 'CHECK'}
                                        </button>
                                    </div>
                                    {side === 'BUY' ? (
                                        <span className="text-[9px] font-mono" style={{ color: vaultChecked ? undefined : '#475569' }}>
                                            {!vaultChecked ? (
                                                <span className="text-slate-600">-- USDC</span>
                                            ) : (
                                                (() => {
                                                    const qt = getQuoteToken();
                                                    if (!qt) return <span className="text-slate-600">-- USDC</span>;
                                                    const bal = getAvailableBalance(qt.address, qt.decimals || 6, quoteChainSelector);
                                                    return <span className={bal > 0 ? 'text-primary' : 'text-slate-500'}>{bal.toFixed(2)} USDC</span>;
                                                })()
                                            )}
                                        </span>
                                    ) : (
                                        (() => {
                                            const selectedPair = pairs.find(p => p.id === selectedPairId);
                                            if (!selectedPair) return null;
                                            if (!vaultChecked) return <span className="text-[9px] text-slate-600 font-mono">-- {selectedPair.baseSymbol}</span>;
                                            const bt = getBaseToken();
                                            const bal = bt ? getAvailableBalance(bt.address, bt.decimals || 18, baseChainSelector) : 0;
                                            return <span className={`text-[9px] font-mono ${bal > 0 ? 'text-primary' : 'text-slate-500'}`}>{bal.toFixed(4)} {selectedPair.baseSymbol}</span>;
                                        })()
                                    )}
                                </div>
                                {vaultCheckError && (
                                    <div className="text-[8px] text-red-400 font-mono mb-1">{vaultCheckError}</div>
                                )}
                                <div className="relative">
                                    <input
                                        className="w-full bg-black border border-border-dark text-white font-mono text-sm px-3 py-2.5 focus:ring-1 focus:ring-primary focus:border-primary text-right rounded-none"
                                        placeholder="0.00"
                                        value={amount}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            if (/^\d*\.?\d*$/.test(val)) setAmount(val);
                                        }}
                                        type="text"
                                    />
                                    <span className="absolute left-3 top-2.5 text-slate-600 font-mono text-xs">UNITS</span>
                                </div>
                            </div>
                            <div className="space-y-1">
                                <div className="flex justify-between">
                                    <label className="text-[10px] text-slate-500 font-mono uppercase">Limit Price</label>
                                    <span className="text-[10px] text-slate-500 font-mono">Mid: <span className="text-white">98.42</span></span>
                                </div>
                                <div className="relative">
                                    <input
                                        className="w-full bg-black border border-border-dark text-white font-mono text-sm px-3 py-2.5 focus:ring-1 focus:ring-primary focus:border-primary text-right rounded-none"
                                        placeholder="0.00"
                                        value={price}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            if (/^\d*\.?\d*$/.test(val)) setPrice(val);
                                        }}
                                        type="text"
                                    />
                                    <span className="absolute left-3 top-2.5 text-slate-600 font-mono text-xs">USDC</span>
                                </div>
                            </div>

                            {/* Total Value & Validation */}
                            <div className="pt-2 border-t border-border-dark flex justify-between items-end">
                                <div className="text-[10px] text-slate-500 font-mono uppercase">Est. Total</div>
                                <div className="text-right flex flex-col items-end">
                                    <span className={`font-mono text-sm font-bold ${(() => {
                                        const totalVal = Number(amount) * Number(price);
                                        if (side === 'BUY') {
                                            const qt = getQuoteToken();
                                            if (!qt) return "text-white";
                                            const available = getAvailableBalance(qt.address, qt.decimals || 6, quoteChainSelector);
                                            return totalVal > available ? "text-red-500" : "text-primary";
                                        } else {
                                            const bt = getBaseToken();
                                            if (!bt) return "text-white";
                                            const available = getAvailableBalance(bt.address, bt.decimals || 18, baseChainSelector);
                                            return Number(amount) > available ? "text-red-500" : "text-white";
                                        }
                                    })()
                                        }`}>
                                        {(Number(amount) * Number(price)).toFixed(2)} USDC
                                    </span>
                                    {/* Insufficient Funds Warning */}
                                    {(() => {
                                        if (!vaultChecked) return null; // Don't warn until vault balances are loaded
                                        const totalVal = Number(amount) * Number(price);
                                        const pair = pairs.find(p => p.id === selectedPairId);
                                        if (!pair) return null;
                                        let available = 0;
                                        let isInsufficient = false;
                                        if (side === 'BUY') {
                                            const qt = getQuoteToken();
                                            if (!qt) return null;
                                            available = getAvailableBalance(qt.address, qt.decimals || 6, quoteChainSelector);
                                            if (totalVal > available) isInsufficient = true;
                                        } else {
                                            const bt = getBaseToken();
                                            if (!bt) return null;
                                            available = getAvailableBalance(bt.address, bt.decimals || 18, baseChainSelector);
                                            if (Number(amount) > available) isInsufficient = true;
                                        }
                                        if (isInsufficient) {
                                            const chainLabel = side === 'BUY'
                                                ? CHAINS[quoteChainSelector]?.name || 'chain'
                                                : CHAINS[baseChainSelector]?.name || 'chain';
                                            return <span className="text-[9px] text-red-500 font-mono">
                                                INSUFFICIENT BALANCE — Max: {side === 'BUY'
                                                    ? `${available.toFixed(2)} USDC on ${chainLabel}`
                                                    : `${available.toFixed(4)} ${pair.baseSymbol} on ${chainLabel}`}
                                            </span>;
                                        }
                                        return null;
                                    })()}
                                </div>
                            </div>
                        </div>

                        <Button
                            fullWidth
                            icon={status === 'IDLE' ? (shieldAddress ? ((Number(amount) * Number(price)) >= 5 ? "lock" : "warning") : "lock_open") : "pending"}
                            className={`py-4 mt-6 uppercase tracking-wider ${(Number(amount) * Number(price)) < 5 ? 'opacity-50 cursor-not-allowed' : ''}`}
                            onClick={handlePlaceOrder}
                            disabled={status !== 'IDLE' || (Number(amount) * Number(price)) < 5}
                        >
                            {status === 'SENDING' ? "Placing Order..." :
                                status === 'MATCHING' ? "Matching Engine..." :
                                    status === 'SETTLED' ? "Order Settled!" :
                                        (Number(amount) * Number(price)) < 5 ? "Min Order Value: 5 USDC" :
                                            shieldAddress ? "Place Order" : "Enter Shield Address"}
                        </Button>
                        <div className="text-[9px] text-slate-600 text-center font-mono uppercase tracking-wide mt-2">
                            TEE Verification: <span className="text-slate-400">{shieldAddress ? "READY" : "WAITING FOR ADDRESS"}</span>
                        </div>
                    </div>
                </Card>
            </div>

            {/* Center Engine & Logs */}
            <div className="col-span-12 md:col-span-5 flex flex-col gap-4 z-10">
                {/* Execution Engine */}
                <Card className="flex-1 flex flex-col shadow-heavy relative transition-all duration-500">
                    <div className="absolute inset-0 z-0 opacity-10 bg-[radial-gradient(#1f3324_1px,transparent_1px)] bg-[length:20px_20px]"></div>
                    <div className="px-4 py-3 border-b border-border-dark bg-obsidian flex justify-between items-center z-10">
                        <h2 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2 font-mono">
                            <Icon name="memory" className="text-primary text-sm" />
                            Secure Execution Engine <span className="text-[10px] text-primary border border-primary/30 px-1 py-0.5 ml-2 font-normal">LIVE</span>
                        </h2>
                        <div className="flex items-center gap-2 text-[10px] font-mono text-slate-400 uppercase">
                            <span className="w-1.5 h-1.5 bg-primary animate-pulse"></span>
                            LATENCY: 12ms
                        </div>
                    </div>

                    {/* Oracle Integration */}
                    <div className="px-4 py-3 border-b border-border-dark bg-obsidian/40 min-h-[60px] flex flex-col justify-center">
                        <OracleIndicator pairId={selectedPairId} />
                    </div>

                    <div className="flex-1 relative z-10 p-6 flex flex-col justify-between bg-black/50 backdrop-blur-sm">
                        {/* Steps */}
                        {(() => {
                            const stepIndex = status === 'IDLE' ? -1 : status === 'SENDING' ? 0 : status === 'MATCHING' ? 1 : 3;
                            const steps = [
                                { id: '01', title: 'Order Placement',   desc: 'Submitting order to secure enclave.'        },
                                { id: '02', title: 'Dark Pool Match',   desc: 'Searching for counterparty liquidity.'      },
                                { id: '03', title: 'Settlement Report', desc: 'CRE submitting on-chain report to Vault.'   },
                                { id: '04', title: 'Confirmed',         desc: 'Assets routed to shield address.'           },
                            ];
                            return steps.map((step, i) => {
                                const isCompleted = i < stepIndex;
                                const isActive    = i === stepIndex;
                                const isPending   = i > stepIndex;
                                return (
                                    <div key={i} className={`flex items-center gap-4 transition-all duration-500 ${isActive ? 'scale-105' : isPending ? 'opacity-30' : ''}`}>
                                        {/* Node */}
                                        <div className={`w-8 h-8 border flex items-center justify-center text-xs font-mono font-bold shrink-0 transition-all duration-300
                                            ${isCompleted ? 'bg-primary/20 border-primary text-primary' :
                                              isActive    ? 'bg-primary/10 border-primary text-primary shadow-glow animate-pulse' :
                                                            'bg-black border-border-dark text-slate-600'}`}>
                                            {isCompleted
                                                ? <Icon name="check" className="text-[14px] text-primary" />
                                                : step.id}
                                        </div>
                                        {/* Connector */}
                                        {i < 3 && (
                                            <div className={`flex-1 h-px relative overflow-hidden
                                                ${isCompleted ? 'bg-primary/40' :
                                                  isActive    ? 'bg-border-dark' :
                                                                'border-b border-dashed border-border-dark bg-transparent'}`}>
                                                {isActive && (
                                                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/60 to-transparent animate-shimmer" />
                                                )}
                                            </div>
                                        )}
                                        {/* Card */}
                                        <div className={`w-56 border p-3 transition-all duration-300 shrink-0
                                            ${isCompleted ? 'bg-primary/5  border-primary/30' :
                                              isActive    ? 'bg-surface-lighter border-primary shadow-glow-strong/20' :
                                                            'bg-black border-border-dark'}`}>
                                            <div className={`text-[10px] font-bold uppercase tracking-wide mb-1 flex justify-between
                                                ${isCompleted ? 'text-primary/70' :
                                                  isActive    ? 'text-primary' :
                                                                'text-slate-500'}`}>
                                                {step.title}
                                                {isActive    && <Icon name="settings"  className="text-[12px] animate-spin" />}
                                                {isCompleted && <Icon name="check_circle" className="text-[12px] text-primary/60" />}
                                            </div>
                                            <div className="text-[10px] font-mono text-slate-500 line-clamp-2">
                                                {step.desc}
                                            </div>
                                        </div>
                                    </div>
                                );
                            });
                        })()}
                    </div>
                </Card>

                {/* Logs */}
                <Card className="min-h-0 h-1/3 flex flex-col shadow-heavy">
                    <div className="px-3 py-2 border-b border-border-dark flex items-center justify-between bg-obsidian shrink-0">
                        <div className="flex items-center gap-2">
                            <Icon name="terminal" className="text-slate-500 text-sm" />
                            <span className="text-[10px] font-mono font-bold text-slate-400 uppercase">System Logs</span>
                        </div>
                        <div className="flex items-center gap-2">
                            {status !== 'IDLE' && status !== 'SETTLED' && (
                                <span className="flex items-center gap-1 text-[9px] font-mono text-primary uppercase">
                                    <span className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
                                    LIVE
                                </span>
                            )}
                            <span className="text-[9px] font-mono text-slate-600 uppercase">{logs.length} events</span>
                        </div>
                    </div>
                    <div className="flex-1 min-h-0 p-3 overflow-y-auto font-mono text-[10px] space-y-0.5 bg-black">
                        {logs.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center gap-2 text-slate-700">
                                <Icon name="terminal" className="text-2xl opacity-30" />
                                <span className="text-[10px] italic">Awaiting execution...</span>
                            </div>
                        ) : logs.map((log, i) => {
                            const isTee   = log.startsWith('[TEE]');
                            const isErr   = /error|fail|denied/i.test(log);
                            const isOk    = /success|settled|matched|confirmed/i.test(log);
                            const isCre   = log.startsWith('[convergence]') || log.startsWith('[cre]');
                            return (
                                <div key={i} className="flex gap-2 items-start leading-relaxed">
                                    <span className="text-slate-700 shrink-0 tabular-nums">
                                        {new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                    </span>
                                    <span className={`shrink-0 font-bold uppercase text-[9px] px-1 border
                                        ${isTee  ? 'text-primary/80  border-primary/30  bg-primary/5'  :
                                          isCre  ? 'text-violet-400  border-violet-400/30 bg-violet-400/5' :
                                          isErr  ? 'text-red-400     border-red-400/30   bg-red-400/5'   :
                                          isOk   ? 'text-green-400   border-green-400/30 bg-green-400/5' :
                                                   'text-slate-500   border-border-dark  bg-black'}`}>
                                        {isTee ? 'TEE' : isCre ? 'CRE' : isErr ? 'ERR' : isOk ? ' OK' : 'SYS'}
                                    </span>
                                    <span className={`break-all
                                        ${isErr ? 'text-red-300' :
                                          isOk  ? 'text-green-300' :
                                          isTee ? 'text-primary/90' :
                                                  'text-slate-300'}`}>
                                        {log.replace(/^\[(TEE|convergence|cre)\]\s*/i, '')}
                                    </span>
                                </div>
                            );
                        })}
                        <div ref={logEndRef} />
                    </div>
                </Card>
            </div>

            {/* Order Book */}
            <div className="col-span-12 md:col-span-4 flex flex-col z-10">
                <Card className="flex-1 flex flex-col shadow-heavy">
                    <div className="px-4 py-3 border-b border-border-dark bg-obsidian flex justify-between items-center">
                        <div className="flex gap-2">
                            <button
                                onClick={() => setActiveTab('BOOK')}
                                className={`text-xs font-bold uppercase tracking-wider flex items-center gap-2 font-mono px-2 py-1 transition-colors ${activeTab === 'BOOK' ? 'text-primary bg-primary/10 border border-primary/20 rounded' : 'text-slate-500 hover:text-white'}`}
                            >
                                <Icon name="list_alt" className="text-sm" />
                                Order Book
                            </button>
                            <button
                                onClick={() => setActiveTab('MY_ORDERS')}
                                className={`text-xs font-bold uppercase tracking-wider flex items-center gap-2 font-mono px-2 py-1 transition-colors ${activeTab === 'MY_ORDERS' ? 'text-primary bg-primary/10 border border-primary/20 rounded' : 'text-slate-500 hover:text-white'}`}
                            >
                                <Icon name="person" className="text-sm" />
                                My Orders
                            </button>
                        </div>
                        {activeTab === 'BOOK' && <div className="px-2 py-0.5 bg-black border border-border-dark text-[9px] text-slate-400 font-mono uppercase tracking-wide">Obfuscated View</div>}
                    </div>

                    <div className="flex-1 flex flex-col font-mono text-xs bg-black/50 backdrop-blur-sm relative">
                        {/* MY ORDERS TAB */}
                        {activeTab === 'MY_ORDERS' && (
                            <div className="absolute inset-0 flex flex-col z-20 bg-black/80 backdrop-blur-md">
                                <div className="grid grid-cols-5 px-4 py-2 text-slate-500 border-b border-border-dark text-[9px] uppercase tracking-wider bg-surface-dark/50">
                                    <div>Asset</div>
                                    <div>Pair</div>
                                    <div className="text-right">Side</div>
                                    <div className="text-right hidden sm:block">Status</div>
                                    <div className="text-right">Action</div>
                                </div>

                                <div className="flex-1 overflow-y-auto">
                                    {myOrders.length === 0 && (
                                        <div className="flex flex-col items-center justify-center h-40 text-slate-600 gap-2">
                                            <Icon name="inbox" className="text-2xl opacity-20" />
                                            <span className="text-[10px]">NO ACTIVE ORDERS</span>
                                        </div>
                                    )}
                                    {myOrders.map((order) => {
                                        const pair = pairs.find(p => p.id === order.pairId);
                                        const chainName = order.baseChainSelector
                                            ? (CHAINS[order.baseChainSelector]?.name?.replace(' Sepolia', '') || order.baseChainSelector)
                                            : (pair ? (CHAINS[pair.tokens?.[0]?.chainSelector]?.name?.replace(' Sepolia', '') || '') : '');
                                        const pairSymbol = pair ? `${pair.baseSymbol}/USDC` : "UNK/USDC";

                                        const isCrossChainSettled = order.status === 'SETTLED' && order.bridgeTxHash;
                                        const ccipUrl = order.bridgeTxHash ? `https://ccip.chain.link/tx/${order.bridgeTxHash}` : null;
                                        return (
                                            <div key={order.id} className={`grid grid-cols-5 px-4 py-3 border-b items-center hover:bg-white/5 transition-colors ${isCrossChainSettled ? 'border-primary/10 bg-primary/3' : 'border-white/5'}`}>
                                                <div className="flex flex-col">
                                                    <span className="text-white font-bold">{pair?.baseSymbol || order.asset || "UNK"}</span>
                                                    <span className="text-[9px] text-slate-500">{(Number(order.amount)).toFixed(2)} @ {Number(order.price).toFixed(2)}</span>
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="text-[9px] text-slate-400">{pairSymbol}</span>
                                                    <span className="text-[8px] text-slate-600">{chainName}</span>
                                                </div>
                                                <div className={`text-right font-bold ${order.side === 'BUY' ? 'text-primary' : 'text-red-500'}`}>{order.side}</div>
                                                <div className="text-right hidden sm:block">
                                                    <Badge
                                                        label={order.status}
                                                        color={order.status === 'OPEN' ? 'blue' : order.status === 'SETTLED' ? 'primary' : order.status === 'MATCHED' ? 'yellow' : 'slate'}
                                                    />
                                                </div>
                                                <div className="text-right flex flex-col items-end gap-1">
                                                    {['OPEN', 'PENDING'].includes(order.status) && (
                                                        <Button
                                                            variant="ghost"
                                                            className="h-6 px-2 text-[8px] border-red-500/30 text-red-500 hover:bg-red-500/10"
                                                            onClick={() => cancelOrder(order.id)}
                                                        >
                                                            CANCEL
                                                        </Button>
                                                    )}
                                                    {ccipUrl && (
                                                        <a
                                                            href={ccipUrl}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="flex items-center gap-1 text-[8px] text-primary hover:text-primary/80 font-mono transition-colors"
                                                            title="View CCIP bridge transaction"
                                                        >
                                                            <Icon name="link" className="text-[10px]" />
                                                            CCIP
                                                        </a>
                                                    )}
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                        )}

                        {/* PUBLIC BOOK (Always rendered underneath or toggled) */}
                        <div className="opacity-100 flex-1 flex flex-col">
                            <div className="grid grid-cols-3 px-4 py-2 text-slate-500 border-b border-border-dark text-[9px] uppercase tracking-wider bg-surface-dark/50">
                                <div>Price (USDC)</div>
                                <div className="text-right">Vol (Masked)</div>
                                <div className="text-right">Total</div>
                            </div>

                            {/* Asks (Sell Orders) - Red */}
                            <div className="flex-1 overflow-y-auto flex flex-col-reverse justify-end pb-2">
                                {orderBook.asks.length === 0 && <div className="text-center text-[9px] text-slate-700 py-2">NO ASK LIQUIDITY</div>}
                                {orderBook.asks.map((order: any, i) => {
                                    const vol = Number(order.amount);
                                    const maxVol = Math.max(...orderBook.asks.map((o: any) => Number(o.amount)), 100);
                                    const width = `${(vol / maxVol) * 100}%`;

                                    return (
                                        <div key={i} className="grid grid-cols-3 px-4 py-1 hover:bg-red-900/10 cursor-pointer group relative border-b border-transparent hover:border-red-900/30">
                                            <span className="text-red-500">{Number(order.price).toFixed(2)}</span>
                                            <span className="text-right text-slate-500 blur-[3px] group-hover:blur-none transition-all">{vol.toFixed(1)}</span>
                                            <span className="text-right text-slate-500">{(Number(order.price) * vol).toFixed(0)}</span>
                                            <div className="absolute right-0 top-0 bottom-0 bg-red-500/5 pointer-events-none" style={{ width }}></div>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Spread */}
                            <div className="py-3 border-y border-border-dark bg-surface-lighter flex items-center justify-between px-4 z-10">
                                <span className="text-slate-500 text-[10px] uppercase tracking-wide">
                                    Spread: {orderBook.asks.length && orderBook.bids.length
                                        ? (Number(orderBook.asks[0].price) - Number(orderBook.bids[0].price)).toFixed(2)
                                        : '-.--'}
                                </span>
                                <div className="flex items-center gap-2">
                                    <Icon name="lock" className="text-primary text-[12px]" />
                                    <span className="text-white text-xs font-bold font-mono">
                                        {orderBook.asks.length && orderBook.bids.length
                                            ? ((Number(orderBook.asks[0].price) + Number(orderBook.bids[0].price)) / 2).toFixed(2) + " USD"
                                            : "No Market"}
                                    </span>
                                </div>
                            </div>

                            {/* Bids (Buy Orders) - Green/Primary */}
                            <div className="flex-1 overflow-y-auto pt-2">
                                {orderBook.bids.length === 0 && <div className="text-center text-[9px] text-slate-700 py-2">NO BID LIQUIDITY</div>}
                                {orderBook.bids.map((order: any, i) => {
                                    const vol = Number(order.amount);
                                    const maxVol = Math.max(...orderBook.bids.map((o: any) => Number(o.amount)), 100);
                                    const width = `${(vol / maxVol) * 100}%`;

                                    return (
                                        <div key={i} className="grid grid-cols-3 px-4 py-1 hover:bg-primary/10 cursor-pointer group relative border-b border-transparent hover:border-primary/20">
                                            <span className="text-primary">{Number(order.price).toFixed(2)}</span>
                                            <span className="text-right text-slate-500 blur-[3px] group-hover:blur-none transition-all">{vol.toFixed(1)}</span>
                                            <span className="text-right text-slate-500">{(Number(order.price) * vol).toFixed(0)}</span>
                                            <div className="absolute right-0 top-0 bottom-0 bg-primary/5 pointer-events-none" style={{ width }}></div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </Card>
            </div>

            <FundingModal isOpen={isFundingOpen} onClose={() => { setIsFundingOpen(false); if (vaultChecked) checkVaultBalances(); }} context="terminal" />
        </div>
    );
};
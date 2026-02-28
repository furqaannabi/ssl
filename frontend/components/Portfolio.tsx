import React, { useState, useEffect, useCallback } from 'react';
import { Icon, Card, Button } from './UI';
import { FundingModal } from './FundingModal';
import { WithdrawalModal } from './WithdrawalModal';
import { TOKEN_DECIMALS, RWA_TOKENS, ETH_SEPOLIA_TOKENS } from '../lib/contracts';
import { formatUnits, getAddress } from 'viem';
import { useConnection, useSignTypedData } from 'wagmi';

const CONVERGENCE_VAULT = '0xE588a6c73933BFD66Af9b4A07d48bcE59c0D2d13' as const;
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

const LIST_TRANSACTIONS_TYPES = {
    'List Transactions': [
        { name: 'account', type: 'address' },
        { name: 'timestamp', type: 'uint256' },
        { name: 'cursor', type: 'string' },
        { name: 'limit', type: 'uint256' },
    ],
} as const;

const TYPE_ICONS: Record<string, { icon: string; colorClass: string }> = {
    STOCK: { icon: 'show_chart', colorClass: 'text-blue-400' },
    ETF: { icon: 'pie_chart', colorClass: 'text-purple-400' },
    BOND: { icon: 'account_balance', colorClass: 'text-amber-400' },
    STABLE: { icon: 'account_balance_wallet', colorClass: 'text-slate-400' },
    UNKNOWN: { icon: 'token', colorClass: 'text-slate-500' },
};

interface VaultBalance { token: string; amount: string; }

interface VaultTransaction {
    id: string;
    type: 'deposit' | 'withdrawal' | 'transfer';
    account: string;
    token: string;
    amount: string;
    tx_hash: string;
    sender: string;
    recipient: string;
    is_incoming: boolean;
    is_sender_hidden: boolean;
    withdraw_status?: string;
}

export const Portfolio: React.FC = () => {
    const [isFundingOpen, setIsFundingOpen] = useState(false);
    const [isWithdrawalOpen, setIsWithdrawalOpen] = useState(false);

    const [contextBalances, setBalances] = useState<VaultBalance[]>([]);
    const [isChecking, setIsLoading] = useState(false);
    const [checkError, setError] = useState<string | null>(null);

    const { signTypedDataAsync } = useSignTypedData();
    const { address: eoaAddress, isConnected } = useConnection();

    const refreshBalances = useCallback(async () => {
        if (!isConnected || !eoaAddress) {
            setBalances([]);
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            const timestamp = Math.floor(Date.now() / 1000);

            const signature = await signTypedDataAsync({
                account: getAddress(eoaAddress),
                domain: CONVERGENCE_DOMAIN,
                types: RETRIEVE_BALANCES_TYPES,
                primaryType: 'Retrieve Balances',
                message: {
                    account: getAddress(eoaAddress),
                    timestamp: BigInt(timestamp),
                },
            });

            // Proxy to backend which calls Convergence API
            const res = await fetch('/api/user/vault-balances', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ timestamp, auth: signature }),
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || 'Failed to fetch vault balances');
            }

            const data = await res.json();
            if (data.success && data.balances) {
                const mappedAssets = data.balances.map((b: any) => {
                    const addr = b.token.toLowerCase();
                    const tokenMeta = ETH_SEPOLIA_TOKENS.find(t => t.address.toLowerCase() === addr);
                    const decimals = tokenMeta?.decimals ?? TOKEN_DECIMALS[tokenMeta?.symbol ?? ''] ?? 18;
                    const parsedBalance = parseFloat(formatUnits(BigInt(b.amount), decimals));

                    return {
                        contractAddress: b.token,
                        token: b.token,
                        balance: parsedBalance,
                    };
                });
                setBalances(mappedAssets);
            }
        } catch (err: any) {
            console.error('Failed to fetch vault balances:', err);
            if (err.message && (err.message.includes('User rejected') || err.message.includes('rejected'))) {
                setError('Signature rejected for balance retrieval.');
            } else {
                setError(err.message || 'Failed to fetch vault balances');
            }
        } finally {
            setIsLoading(false);
        }
    }, [isConnected, eoaAddress, signTypedDataAsync]);

    const [transactions, setTransactions] = useState<VaultTransaction[]>([]);
    const [isTxLoading, setIsTxLoading] = useState(false);
    const [txError, setTxError] = useState<string | null>(null);
    const [txNextCursor, setTxNextCursor] = useState<string | undefined>(undefined);
    const [txHasMore, setTxHasMore] = useState(false);

    const fetchTransactions = useCallback(async (cursor?: string) => {
        if (!isConnected || !eoaAddress) return;

        setIsTxLoading(true);
        setTxError(null);

        try {
            const timestamp = Math.floor(Date.now() / 1000);
            const cursorVal = cursor ?? '';
            const limitVal = 20;

            const signature = await signTypedDataAsync({
                account: getAddress(eoaAddress),
                domain: CONVERGENCE_DOMAIN,
                types: LIST_TRANSACTIONS_TYPES,
                primaryType: 'List Transactions',
                message: {
                    account: getAddress(eoaAddress),
                    timestamp: BigInt(timestamp),
                    cursor: cursorVal,
                    limit: BigInt(limitVal),
                },
            });

            const res = await fetch('/api/user/vault-transactions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ timestamp, auth: signature, cursor: cursorVal || undefined, limit: limitVal }),
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || 'Failed to fetch transactions');
            }

            const data = await res.json();
            if (data.success) {
                setTransactions(prev => cursor ? [...prev, ...data.transactions] : data.transactions);
                setTxHasMore(data.has_more ?? false);
                setTxNextCursor(data.next_cursor);
            }
        } catch (err: any) {
            console.error('Failed to fetch transactions:', err);
            if (err.message?.includes('User rejected') || err.message?.includes('rejected')) {
                setTxError('Signature rejected.');
            } else {
                setTxError(err.message || 'Failed to fetch transactions');
            }
        } finally {
            setIsTxLoading(false);
        }
    }, [isConnected, eoaAddress, signTypedDataAsync]);

    const [prices, setPrices] = useState<Record<string, { current: number; changePercent?: number }>>({});

    // Fetch live prices from backend every 15s
    useEffect(() => {
        const load = async () => {
            try {
                const res = await fetch('/api/tokens');
                if (!res.ok) return;
                const data = await res.json();
                if (data.success) {
                    const map: Record<string, { current: number; changePercent?: number }> = {};
                    data.tokens.forEach((t: any) => {
                        if (t.price) map[t.symbol] = { current: t.price.current, changePercent: t.price.changePercent };
                    });
                    setPrices(map);
                }
            } catch { }
        };
        load();
        const id = setInterval(load, 15000);
        return () => clearInterval(id);
    }, []);

    // address → formatted balance
    const balanceMap: Record<string, number> = {};
    contextBalances.forEach(b => {
        const addr = b.contractAddress?.toLowerCase() || '';
        balanceMap[addr] = b.balance;
    });

    // address → token symbol lookup
    const tokenSymbolMap: Record<string, { symbol: string; decimals: number }> = {};
    ETH_SEPOLIA_TOKENS.forEach(t => {
        tokenSymbolMap[t.address.toLowerCase()] = { symbol: t.symbol, decimals: t.decimals };
    });

    const totalValue = ETH_SEPOLIA_TOKENS.reduce((sum, t) => {
        const bal = balanceMap[t.address.toLowerCase()] ?? 0;
        const price = t.symbol === 'USDC' ? 1 : (prices[t.symbol]?.current ?? 0);
        return sum + bal * price;
    }, 0);

    // Rows sorted by vault balance desc
    const rows = ETH_SEPOLIA_TOKENS.map(t => {
        const meta = RWA_TOKENS[t.symbol];
        const typeKey = meta?.type ?? 'UNKNOWN';
        const typeInfo = TYPE_ICONS[typeKey] ?? TYPE_ICONS.UNKNOWN;
        const bal = balanceMap[t.address.toLowerCase()] ?? 0;
        const price = t.symbol === 'USDC' ? 1 : (prices[t.symbol]?.current ?? 0);
        const value = bal * price;
        const change = prices[t.symbol]?.changePercent;
        return { token: t, meta, typeInfo, bal, price, value, change };
    }).sort((a, b) => b.bal - a.bal);

    const withdrawalAssets = rows.filter(r => r.bal > 0).map(r => ({
        symbol: r.token.symbol,
        name: r.meta?.name ?? r.token.name,
        type: r.meta?.type ?? 'Unknown',
        allocation: 0,
        value: `$${r.value.toFixed(2)}`,
        status: 'Active' as const,
        icon: r.typeInfo.icon,
        colorClass: r.typeInfo.colorClass,
        address: r.token.address,
        rawValue: r.value,
        price: r.price,
        balance: r.bal,
    }));

    return (
        <div className="h-full flex flex-col gap-6 p-6 overflow-y-auto bg-background-light dark:bg-background-dark">

            {/* Header */}
            <div className="flex justify-between items-center shrink-0">
                <div>
                    <h2 className="text-xl font-bold text-white font-display tracking-tight uppercase">Portfolio Overview</h2>
                    <p className="text-[10px] text-slate-500 font-mono tracking-widest mt-1">CONFIDENTIAL ASSET MANAGEMENT · CONVERGENCE VAULT</p>
                </div>
                <div className="flex gap-3">
                    <Button
                        variant="ghost"
                        icon={isChecking ? 'hourglass_empty' : 'account_balance'}
                        onClick={refreshBalances}
                        disabled={isChecking || !isConnected}
                        className="border border-primary/40 text-primary hover:bg-primary/10"
                    >
                        {isChecking ? 'Checking…' : 'Refresh Balances'}
                    </Button>
                    <Button variant="ghost" icon="remove_circle_outline" onClick={() => setIsWithdrawalOpen(true)} className="border border-red-500/30 text-red-400 hover:bg-red-500/10">
                        Withdraw
                    </Button>
                    <Button variant="primary" icon="add" onClick={() => setIsFundingOpen(true)}>
                        Deposit Assets
                    </Button>
                </div>
            </div>

            {/* Error */}
            {checkError && (
                <div className="bg-red-500/10 border border-red-500/20 p-3 rounded flex items-center gap-3 text-red-400 text-xs font-mono shrink-0">
                    <Icon name="error" className="text-sm shrink-0" />
                    {checkError}
                </div>
            )}

            {/* Prompt to check */}
            {!isConnected && !isChecking && (
                <div className="bg-primary/5 border border-primary/20 p-3 rounded flex items-center gap-3 text-slate-400 text-xs shrink-0">
                    <Icon name="lock" className="text-primary text-sm shrink-0" />
                    <span>Balances are private. <strong className="text-primary">Connect your wallet</strong> to view your Convergence vault balance.</span>
                </div>
            )}

            {/* Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 shrink-0">
                <Card className="p-5 group">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                        <Icon name="account_balance" className="text-4xl text-slate-500" />
                    </div>
                    <h3 className="text-slate-500 text-xs uppercase font-semibold tracking-widest mb-2">Total Value Locked</h3>
                    <div className="text-2xl lg:text-3xl font-mono font-medium text-white tracking-tight">
                        {isConnected && !isChecking
                            ? `$${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                            : <span className="text-slate-600 blur-sm select-none">$0.00</span>
                        }
                    </div>
                    <div className="mt-2 text-xs text-slate-500">{isConnected && !isChecking ? 'Live · Convergence vault' : 'Checking…'}</div>
                </Card>

                <Card className="p-5 relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/5 to-transparent animate-scan pointer-events-none"></div>
                    <div className="absolute top-0 right-0 p-4 opacity-10">
                        <Icon name="trending_up" className="text-4xl text-primary" />
                    </div>
                    <h3 className="text-slate-500 text-xs uppercase font-semibold tracking-widest mb-2">Holdings</h3>
                    <div className="text-2xl lg:text-3xl font-mono font-medium text-primary tracking-tight">
                        {isConnected && !isChecking ? rows.filter(r => r.bal > 0).length : <span className="text-slate-600">—</span>}
                        <span className="text-slate-500 text-lg ml-2">/ {ETH_SEPOLIA_TOKENS.length}</span>
                    </div>
                    <div className="mt-2 text-xs text-slate-500">Tokens with vault balance</div>
                </Card>

                <Card className="p-5">
                    <div className="absolute top-0 right-0 p-4 opacity-10">
                        <Icon name="shield" className="text-4xl text-slate-500" />
                    </div>
                    <h3 className="text-slate-500 text-xs uppercase font-semibold tracking-widest mb-2">Vault Contract</h3>
                    <div className="text-xs font-mono text-primary mt-1 break-all">0xE588…0D2d13</div>
                    <div className="mt-2 text-xs text-slate-500 font-mono">Ethereum Sepolia · chainId 11155111</div>
                </Card>
            </div>

            {/* Token Table */}
            <div className="pb-6">
                <Card className="flex flex-col">
                    <div className="p-5 border-b border-border-dark flex justify-between items-center bg-surface-lighter">
                        <h2 className="text-lg font-medium text-white flex items-center gap-2">
                            <Icon name="table_chart" className="text-slate-500" />
                            All Vault Tokens
                        </h2>
                        {isConnected && !isChecking && (
                            <span className="text-[10px] font-mono text-primary bg-primary/10 border border-primary/20 px-2 py-1 rounded flex items-center gap-1">
                                <span className="w-1.5 h-1.5 bg-primary rounded-full inline-block animate-pulse"></span>
                                Live · Convergence API
                            </span>
                        )}
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="text-xs uppercase tracking-wider text-slate-500 border-b border-border-dark bg-black/20 font-mono">
                                    <th className="px-6 py-4 font-semibold">Asset</th>
                                    <th className="px-6 py-4 font-semibold">Type</th>
                                    <th className="px-6 py-4 font-semibold text-right">Price</th>
                                    <th className="px-6 py-4 font-semibold text-right">Vault Balance</th>
                                    <th className="px-6 py-4 font-semibold text-right">Value</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border-dark text-sm font-mono">
                                {rows.map(({ token, meta, typeInfo, bal, price, value, change }) => {
                                    const hasBalance = isConnected && !isChecking && bal > 0;
                                    return (
                                        <tr key={token.address} className="group hover:bg-white/5 transition-colors">
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-3">
                                                    <div className={`h-8 w-8 rounded bg-slate-800 flex items-center justify-center border border-slate-700 ${typeInfo.colorClass}`}>
                                                        <Icon name={typeInfo.icon} className="text-sm" />
                                                    </div>
                                                    <div>
                                                        <div className="font-medium text-white font-display uppercase">
                                                            {meta?.name ?? token.name}
                                                        </div>
                                                        <div className="text-xs text-slate-500 flex gap-2 items-center">
                                                            <span>{token.symbol}</span>
                                                            {change != null && (
                                                                <span className={change >= 0 ? 'text-primary' : 'text-red-500'}>
                                                                    {change >= 0 ? '+' : ''}{change.toFixed(2)}%
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 text-slate-400">{meta?.type ?? 'Unknown'}</td>
                                            <td className="px-6 py-4 text-right text-slate-300">
                                                {price > 0 ? `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                {!isConnected ? (
                                                    <span className="text-slate-700 select-none blur-sm">0.0000</span>
                                                ) : isChecking ? (
                                                    <span className="w-3 h-3 border border-primary border-t-transparent rounded-full animate-spin inline-block"></span>
                                                ) : (
                                                    <span className={hasBalance ? 'text-primary' : 'text-slate-600'}>
                                                        {bal.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-6 py-4 text-right">
                                                {!isConnected ? (
                                                    <span className="text-slate-700 blur-sm select-none">$0.00</span>
                                                ) : (
                                                    <span className={hasBalance ? 'text-white' : 'text-slate-600'}>
                                                        ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </Card>
            </div>

            {/* Transaction History */}
            <div className="pb-6">
                <Card className="flex flex-col">
                    <div className="p-5 border-b border-border-dark flex justify-between items-center bg-surface-lighter">
                        <h2 className="text-lg font-medium text-white flex items-center gap-2">
                            <Icon name="receipt_long" className="text-slate-500" />
                            Transaction History
                        </h2>
                        <Button
                            variant="ghost"
                            icon={isTxLoading ? 'hourglass_empty' : 'history'}
                            onClick={() => { setTransactions([]); setTxNextCursor(undefined); fetchTransactions(); }}
                            disabled={isTxLoading || !isConnected}
                            className="border border-slate-700 text-slate-400 hover:bg-white/5 text-xs"
                        >
                            {isTxLoading ? 'Loading…' : transactions.length === 0 ? 'Load History' : 'Refresh'}
                        </Button>
                    </div>

                    {txError && (
                        <div className="mx-5 mt-4 bg-red-500/10 border border-red-500/20 p-3 rounded flex items-center gap-3 text-red-400 text-xs font-mono">
                            <Icon name="error" className="text-sm shrink-0" />
                            {txError}
                        </div>
                    )}

                    {transactions.length === 0 && !isTxLoading ? (
                        <div className="p-10 text-center text-slate-500 text-sm font-mono">
                            {isConnected
                                ? 'Click "Load History" to fetch your vault transaction history.'
                                : 'Connect your wallet to view transaction history.'}
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="text-xs uppercase tracking-wider text-slate-500 border-b border-border-dark bg-black/20 font-mono">
                                        <th className="px-6 py-4 font-semibold">Type</th>
                                        <th className="px-6 py-4 font-semibold">Direction</th>
                                        <th className="px-6 py-4 font-semibold">Token</th>
                                        <th className="px-6 py-4 font-semibold text-right">Amount</th>
                                        <th className="px-6 py-4 font-semibold">Tx Hash</th>
                                        <th className="px-6 py-4 font-semibold">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border-dark text-xs font-mono">
                                    {transactions.map(tx => {
                                        const tokenInfo = tokenSymbolMap[tx.token?.toLowerCase()];
                                        const decimals = tokenInfo?.decimals ?? 18;
                                        const symbol = tokenInfo?.symbol ?? `${tx.token?.slice(0, 6)}…`;
                                        const amount = tx.amount
                                            ? parseFloat(formatUnits(BigInt(tx.amount), decimals)).toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })
                                            : '—';
                                        const isIn = tx.is_incoming || tx.type === 'deposit';
                                        const typeColors: Record<string, string> = {
                                            deposit: 'text-primary bg-primary/10 border-primary/20',
                                            withdrawal: 'text-amber-400 bg-amber-400/10 border-amber-400/20',
                                            transfer: 'text-blue-400 bg-blue-400/10 border-blue-400/20',
                                        };
                                        const typeColor = typeColors[tx.type] ?? 'text-slate-400 bg-slate-400/10 border-slate-400/20';
                                        const shortHash = tx.tx_hash ? `${tx.tx_hash.slice(0, 8)}…${tx.tx_hash.slice(-6)}` : '—';

                                        return (
                                            <tr key={tx.id} className="hover:bg-white/5 transition-colors">
                                                <td className="px-6 py-3">
                                                    <span className={`text-[10px] font-mono border px-2 py-0.5 rounded uppercase ${typeColor}`}>
                                                        {tx.type}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-3">
                                                    <span className={`font-bold ${isIn ? 'text-primary' : 'text-red-400'}`}>
                                                        {isIn ? '↓ IN' : '↑ OUT'}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-3 text-white font-display uppercase">{symbol}</td>
                                                <td className="px-6 py-3 text-right text-white">{amount}</td>
                                                <td className="px-6 py-3">
                                                    {tx.tx_hash ? (
                                                        <span className="text-slate-400 hover:text-slate-200 cursor-pointer transition-colors" title={tx.tx_hash}>
                                                            {shortHash}
                                                        </span>
                                                    ) : (
                                                        <span className="text-slate-600">—</span>
                                                    )}
                                                </td>
                                                <td className="px-6 py-3">
                                                    {tx.type === 'withdrawal' && tx.withdraw_status ? (
                                                        <span className={`text-[10px] border px-2 py-0.5 rounded uppercase ${tx.withdraw_status === 'completed' ? 'text-primary border-primary/30' : tx.withdraw_status === 'refunded' ? 'text-red-400 border-red-400/30' : 'text-amber-400 border-amber-400/30'}`}>
                                                            {tx.withdraw_status}
                                                        </span>
                                                    ) : (
                                                        <span className="text-[10px] text-primary border border-primary/30 px-2 py-0.5 rounded uppercase">confirmed</span>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {isTxLoading && (
                                        <tr>
                                            <td colSpan={6} className="px-6 py-4 text-center text-slate-500">
                                                <span className="inline-block w-3 h-3 border border-primary border-t-transparent rounded-full animate-spin mr-2"></span>
                                                Loading…
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                            {txHasMore && (
                                <div className="p-4 border-t border-border-dark text-center">
                                    <Button
                                        variant="ghost"
                                        icon="expand_more"
                                        onClick={() => fetchTransactions(txNextCursor)}
                                        disabled={isTxLoading}
                                        className="text-slate-400 border border-slate-700 hover:bg-white/5 text-xs"
                                    >
                                        Load More
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}
                </Card>
            </div>

            <FundingModal
                isOpen={isFundingOpen}
                onClose={() => { setIsFundingOpen(false); refreshBalances(); }}
                context="portfolio"
            />
            <WithdrawalModal
                isOpen={isWithdrawalOpen}
                onClose={() => { setIsWithdrawalOpen(false); refreshBalances(); }}
                assets={withdrawalAssets}
            />
        </div>
    );
};

import React, { useState, useEffect } from 'react';
import { Asset } from '../types';
import { Icon, Badge, Card, Button } from './UI';
import { StealthKeyReveal } from './StealthKeyReveal';
import { FundingModal } from './FundingModal';
import { WithdrawalModal } from './WithdrawalModal';
import { auth } from '../lib/auth';
import { TOKEN_DECIMALS, RWA_TOKENS } from '../lib/contracts';
import { formatUnits } from 'viem';

// Icon mapping for token types
const TYPE_ICONS: Record<string, { icon: string; colorClass: string }> = {
    STOCK: { icon: 'show_chart', colorClass: 'text-blue-400' },
    ETF: { icon: 'pie_chart', colorClass: 'text-purple-400' },
    BOND: { icon: 'account_balance', colorClass: 'text-amber-400' },
    STABLE: { icon: 'account_balance_wallet', colorClass: 'text-slate-400' },
    UNKNOWN: { icon: 'token', colorClass: 'text-slate-500' },
};

export const Portfolio: React.FC = () => {
  const [isFundingOpen, setIsFundingOpen] = useState(false);
  const [isWithdrawalOpen, setIsWithdrawalOpen] = useState(false);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [totalValue, setTotalValue] = useState<number>(0);

  const fetchBalances = async () => {
    try {
        // Fetch tokens (with prices) and user profile in parallel
        const [user, tokensRes] = await Promise.all([
            auth.getMe(),
            fetch(`/api/tokens`)
        ]);

        // Build symbol->token map from backend /api/tokens
        const tokenMap: Record<string, any> = {}; // address -> token data
        const symbolMap: Record<string, any> = {}; // symbol -> token data
        if (tokensRes.ok) {
            const data = await tokensRes.json();
            if (data.success) {
                data.tokens.forEach((t: any) => {
                    tokenMap[t.address.toLowerCase()] = t;
                    symbolMap[t.symbol] = t;
                });
            }
        }

        if (user && user.balances) {
            // Aggregate balances by symbol (across chains)
            const balancesBySymbol: Record<string, { total: number, breakdown: Record<string, number> }> = {};

            user.balances.forEach((b: any) => {
                const tokenData = tokenMap[b.token.toLowerCase()];
                const symbol = tokenData?.symbol || 'UNKNOWN';

                if (!balancesBySymbol[symbol]) balancesBySymbol[symbol] = { total: 0, breakdown: {} };

                const decimals = tokenData?.decimals || TOKEN_DECIMALS[symbol] || 18;
                const amount = parseFloat(formatUnits(BigInt(b.balance), decimals));

                balancesBySymbol[symbol].total += amount;

                const chainSelector = b.chainSelector || 'unknown';
                balancesBySymbol[symbol].breakdown[chainSelector] = (balancesBySymbol[symbol].breakdown[chainSelector] || 0) + amount;
            });

            // Build asset list from user's actual holdings
            const updatedAssets: Asset[] = Object.entries(balancesBySymbol)
                .filter(([_, agg]) => agg.total > 0) // Only show tokens with balance
                .map(([symbol, agg]) => {
                    const tokenData = symbolMap[symbol];
                    const meta = RWA_TOKENS[symbol];
                    const typeInfo = TYPE_ICONS[tokenData?.tokenType || meta?.type || 'UNKNOWN'] || TYPE_ICONS.UNKNOWN;

                    // Price from backend token data
                    const price = tokenData?.price?.current || (symbol === 'USDC' || symbol === 'mUSDC' ? 1 : 0);
                    const changePercent = tokenData?.price?.changePercent;
                    const value = agg.total * price;

                    return {
                        symbol,
                        name: meta?.name || tokenData?.name || symbol,
                        type: tokenData?.tokenType || meta?.type || 'Unknown',
                        allocation: 0, // Calculated below
                        value: `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                        status: 'Active' as const,
                        icon: typeInfo.icon,
                        colorClass: typeInfo.colorClass,
                        address: tokenData?.address,
                        rawValue: value,
                        price,
                        change24h: changePercent != null ? `${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%` : undefined,
                        balance: agg.total,
                        breakdown: agg.breakdown,
                    };
                });

            const total = updatedAssets.reduce((acc, curr) => acc + (curr.rawValue || 0), 0);
            setTotalValue(total);

            // Calculate allocations
            const finalAssets = updatedAssets.map(asset => ({
                ...asset,
                allocation: total > 0 ? Math.round(((asset.rawValue || 0) / total) * 100) : 0
            }));

            setAssets(finalAssets);
        } else {
            setAssets([]);
            setTotalValue(0);
        }
    } catch (e) {
        console.error('Failed to fetch balances', e);
    }
  };

  useEffect(() => {
    fetchBalances();
    // Poll for updates every 10s
    const interval = setInterval(fetchBalances, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="h-full flex flex-col gap-6 p-6 overflow-y-auto bg-background-light dark:bg-background-dark">

      <div className="flex justify-between items-center shrink-0">
        <div>
          <h2 className="text-xl font-bold text-white font-display tracking-tight uppercase">Portfolio Overview</h2>
          <p className="text-[10px] text-slate-500 font-mono tracking-widest mt-1">CONFIDENTIAL ASSET MANAGEMENT SYSTEM</p>
        </div>
        <div className="flex gap-3">
            <Button variant="ghost" icon="remove_circle_outline" onClick={() => setIsWithdrawalOpen(true)} className="border border-red-500/30 text-red-400 hover:bg-red-500/10">
              Withdraw
            </Button>
            <Button variant="primary" icon="add" onClick={() => setIsFundingOpen(true)}>
              Deposit Assets
            </Button>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 shrink-0">
        <Card className="p-5 group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <Icon name="account_balance" className="text-4xl text-slate-500" />
          </div>
          <h3 className="text-slate-500 text-xs uppercase font-semibold tracking-widest mb-2">Total Value Locked</h3>
          <div className="flex items-end space-x-3">
            <span className="text-2xl lg:text-3xl font-mono font-medium text-white tracking-tight">
                ${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            <span className="text-primary font-mono">+0.0%</span> vs last month
          </div>
        </Card>

        <Card className="p-5 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/5 to-transparent animate-scan pointer-events-none"></div>
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <Icon name="trending_up" className="text-4xl text-primary" />
          </div>
          <h3 className="text-slate-500 text-xs uppercase font-semibold tracking-widest mb-2">24h PnL</h3>
          <div className="flex items-end space-x-3">
            <span className="text-2xl lg:text-3xl font-mono font-medium text-primary tracking-tight">+$0.00</span>
            <span className="text-sm font-mono text-primary bg-primary/10 px-1.5 py-0.5 rounded mb-1">0.0%</span>
          </div>
          <div className="mt-2 text-xs text-slate-500">Realized & Unrealized</div>
        </Card>

        <Card className="p-5">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <Icon name="visibility_off" className="text-4xl text-slate-500" />
          </div>
          <h3 className="text-slate-500 text-xs uppercase font-semibold tracking-widest mb-2">Stealth Yield</h3>
          <div className="flex items-end space-x-3">
            <span className="text-2xl lg:text-3xl font-mono font-medium text-white tracking-tight">4.5%</span>
            <span className="text-sm text-slate-500 mb-1">APY</span>
          </div>
          <div className="mt-2 w-full bg-slate-700 h-1 rounded-full overflow-hidden">
            <div className="bg-primary h-full w-3/4 rounded-full"></div>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-12 gap-6 pb-6">
        {/* Asset Table */}
        <div className="col-span-12 lg:col-span-9 flex flex-col gap-6">
          <Card className="flex flex-col">
            <div className="p-5 border-b border-border-dark flex justify-between items-center bg-surface-lighter">
              <h2 className="text-lg font-medium text-white flex items-center gap-2">
                <Icon name="table_chart" className="text-slate-500" />
                Confidential Asset Breakdown
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="text-xs uppercase tracking-wider text-slate-500 border-b border-border-dark bg-black/20 font-mono">
                    <th className="px-6 py-4 font-semibold text-center">Privacy Shield</th>
                    <th className="px-6 py-4 font-semibold">Asset</th>
                    <th className="px-6 py-4 font-semibold">Type</th>
                    <th className="px-6 py-4 font-semibold">Chain</th>
                    <th className="px-6 py-4 font-semibold text-right">Quantity</th>
                    <th className="px-6 py-4 font-semibold text-right">Allocation</th>
                    <th className="px-6 py-4 font-semibold text-right">Position Size</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-dark text-sm font-mono">
                  {assets.map((asset, idx) => (
                    <tr key={idx} className="group hover:bg-white/5 transition-colors">
                      <td className="px-6 py-4 text-center">
                        <Badge 
                          label={asset.status} 
                          color={asset.status === 'Active' ? 'primary' : 'slate'} 
                          pulse={asset.status === 'Active'} 
                          icon={asset.status === 'Encrypted' ? 'lock' : undefined}
                        />
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center">
                          <div className={`h-8 w-8 rounded bg-slate-800 flex items-center justify-center mr-3 border border-slate-700 ${asset.colorClass}`}>
                            <Icon name={asset.icon} className="text-sm" />
                          </div>
                          <div>
                            <div className="font-medium text-white font-display uppercase">{asset.name}</div>
                            <div className="text-xs text-slate-500 flex gap-2">
                                <span>{asset.symbol}</span>
                                {(asset as any).change24h && (
                                    <span className={`${(asset as any).change24h.startsWith('-') ? 'text-red-500' : 'text-primary'}`}>
                                        {(asset as any).change24h}
                                    </span>
                                )}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-slate-400">{asset.type}</td>
                      <td className="px-6 py-4">
                        <div className="flex gap-2">
                            {asset.breakdown && Object.keys(asset.breakdown).map(chain => (
                                <span key={chain} className="px-2 py-1 bg-slate-800 text-slate-300 rounded text-xs border border-slate-700 font-mono">
                                    {chain.toLowerCase().includes('base') ? 'Base' : chain.toLowerCase().includes('arbitrum') ? 'Arbitrum' : 'Unknown'}
                                </span>
                            ))}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right text-slate-300 font-mono">
                        {asset.balance?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 }) || "0.00"}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end space-x-2">
                          <span className="text-white">{asset.allocation}%</span>
                          <div className="w-16 h-1 bg-slate-700 rounded-full overflow-hidden">
                            <div className={`h-full ${asset.symbol === 'US-Gov-042' ? 'bg-blue-500' : 'bg-primary'} w-[${asset.allocation}%]`} style={{ width: `${asset.allocation}%` }}></div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right text-slate-200">
                        <span className="blur-[2px] group-hover:blur-none transition-all cursor-crosshair block">{asset.value}</span>
                         <div className="text-[9px] text-slate-500 group-hover:text-primary transition-colors">@ ${(asset as any).price?.toFixed(2)}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* ... (rest of component) ... */}

        </div>

        {/* Sidebar Widgets */}
        <div className="col-span-12 lg:col-span-3 flex flex-col gap-6">
          <Card className="p-5">
            <h3 className="text-slate-500 text-xs uppercase font-semibold tracking-widest mb-4">Yield Projections</h3>
            <div className="h-32 mb-4 w-full rounded bg-black/40 border border-border-dark overflow-hidden relative flex items-center justify-center">
              <div className="text-center">
                <Icon name="trending_up" className="text-2xl text-slate-700 mb-1" />
                <p className="text-[10px] text-slate-600 font-mono">Yield data will appear once settlements accrue interest.</p>
              </div>
            </div>
          </Card>

          <Card className="p-5 flex-1 flex flex-col justify-center border-primary/30">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-slate-500 text-xs uppercase font-semibold tracking-widest">Accrued Interest</h3>
              <Icon name="bolt" className="text-primary animate-pulse text-sm" />
            </div>
            <div className="text-3xl font-mono text-primary font-medium tracking-tight mb-1">
              $0.00<span className="text-slate-600 text-lg">00</span>
            </div>
            <p className="text-xs text-slate-500">
              No private yield accrued yet.
            </p>
            <div className="mt-6 pt-6 border-t border-border-dark">
              <Button fullWidth icon="download" disabled>Claim Yield</Button>
            </div>
          </Card>
        </div>
      </div>

      <FundingModal 
        isOpen={isFundingOpen} 
        onClose={() => {
            setIsFundingOpen(false);
            fetchBalances(); // Refresh balances on close
        }} 
        context="portfolio"
      />
      <WithdrawalModal 
        isOpen={isWithdrawalOpen} 
        onClose={() => {
            setIsWithdrawalOpen(false);
            fetchBalances(); // Refresh balances on close
        }} 
        assets={assets}
      />
    </div>
  );
};
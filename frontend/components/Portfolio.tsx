import React, { useState, useEffect } from 'react';
import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts';
import { Asset } from '../types';
import { Icon, Badge, Card, Button } from './UI';
import { loadStealthKeys, SpendingKeypair } from '../lib/stealth';
import { StealthKeyReveal } from './StealthKeyReveal';
import { FundingModal } from './FundingModal';

const assets: Asset[] = [
  { symbol: 'US-Gov-042', name: 'Tokenized T-Bills', type: 'Fixed Income', allocation: 45, value: '$5,602,590.00', status: 'Active', icon: 'account_balance', colorClass: 'text-blue-400' },
  { symbol: 'BlackRock-MM', name: 'Private Credit Structure A', type: 'Yield Farming', allocation: 30, value: '$3,735,060.00', status: 'Active', icon: 'apartment', colorClass: 'text-purple-400' },
  { symbol: 'PAXG-ETH', name: 'PAX Gold', type: 'Commodity', allocation: 15, value: '$1,867,530.00', status: 'Encrypted', icon: 'token', colorClass: 'text-yellow-400' },
  { symbol: 'Circle-Reserve', name: 'USDC Liquidity', type: 'Stablecoin', allocation: 10, value: '$1,245,020.00', status: 'Active', icon: 'account_balance_wallet', colorClass: 'text-slate-400' },
];

const yieldData = [
  { name: 'Jan', value: 4000 },
  { name: 'Feb', value: 3000 },
  { name: 'Mar', value: 5000 },
  { name: 'Apr', value: 8000 },
  { name: 'May', value: 6000 },
  { name: 'Jun', value: 9000 },
  { name: 'Jul', value: 11000 },
  { name: 'Aug', value: 13000 },
];

export const Portfolio: React.FC = () => {
  const [stealthKeys, setStealthKeys] = useState<any[]>([]);
  const [revealTarget, setRevealTarget] = useState<any | null>(null);
  const [isFundingOpen, setIsFundingOpen] = useState(false);

  useEffect(() => {
    setStealthKeys(loadStealthKeys());
  }, []);

  return (
    <div className="h-full flex flex-col gap-6 p-6 overflow-y-auto bg-background-light dark:bg-background-dark">
      {revealTarget && (
        <StealthKeyReveal
          isOpen={!!revealTarget}
          onClose={() => setRevealTarget(null)}
          address={revealTarget.stealthAddress}
          privateKey={revealTarget.stealthPrivateKey}
          title={`Stealth Key: ${revealTarget.orderId.slice(0, 8)}...`}
        />
      )}

      <div className="flex justify-between items-center shrink-0">
        <div>
          <h2 className="text-xl font-bold text-white font-display tracking-tight uppercase">Portfolio Overview</h2>
          <p className="text-[10px] text-slate-500 font-mono tracking-widest mt-1">CONFIDENTIAL ASSET MANAGEMENT SYSTEM</p>
        </div>
        <Button variant="primary" icon="add" onClick={() => setIsFundingOpen(true)}>
          Deposit Assets
        </Button>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 shrink-0">
        <Card className="p-5 group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <Icon name="account_balance" className="text-4xl text-slate-500" />
          </div>
          <h3 className="text-slate-500 text-xs uppercase font-semibold tracking-widest mb-2">Total Value Locked</h3>
          <div className="flex items-end space-x-3">
            <span className="text-2xl lg:text-3xl font-mono font-medium text-white tracking-tight">$12,450,200.00</span>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            <span className="text-primary font-mono">+12.5%</span> vs last month
          </div>
        </Card>

        <Card className="p-5 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/5 to-transparent animate-scan pointer-events-none"></div>
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <Icon name="trending_up" className="text-4xl text-primary" />
          </div>
          <h3 className="text-slate-500 text-xs uppercase font-semibold tracking-widest mb-2">24h PnL</h3>
          <div className="flex items-end space-x-3">
            <span className="text-2xl lg:text-3xl font-mono font-medium text-primary tracking-tight">+$45,200</span>
            <span className="text-sm font-mono text-primary bg-primary/10 px-1.5 py-0.5 rounded mb-1">3.2%</span>
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
                            <div className="text-xs text-slate-500">{asset.symbol}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-slate-400">{asset.type}</td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end space-x-2">
                          <span className="text-white">{asset.allocation}%</span>
                          <div className="w-16 h-1 bg-slate-700 rounded-full overflow-hidden">
                            <div className={`h-full ${asset.symbol === 'US-Gov-042' ? 'bg-blue-500' : 'bg-primary'} w-[${asset.allocation}%]`} style={{ width: `${asset.allocation}%` }}></div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right text-slate-200">
                        <span className="blur-[2px] group-hover:blur-none transition-all cursor-crosshair">{asset.value}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Stealth Settlements Table */}
          <Card className="flex flex-col border-primary/20">
            <div className="p-5 border-b border-border-dark flex justify-between items-center bg-black/40">
              <h2 className="text-sm font-bold text-primary flex items-center gap-2 uppercase tracking-widest">
                <Icon name="fingerprint" className="text-lg" /> 
                Recent Stealth Settlements
              </h2>
              <Badge label={`${stealthKeys.length} RECORDED`} color="slate" />
            </div>
            <div className="overflow-x-auto min-h-[200px]">
              {stealthKeys.length > 0 ? (
                <table className="w-full text-left border-collapse font-mono">
                  <thead>
                     <tr className="text-[10px] uppercase tracking-widest text-slate-500 border-b border-border-dark bg-black/20">
                        <th className="px-6 py-4 font-semibold">Settlement Hash</th>
                        <th className="px-6 py-4 font-semibold">Derived Stealth Address</th>
                        <th className="px-6 py-4 font-semibold text-center">Action</th>
                     </tr>
                  </thead>
                  <tbody className="divide-y divide-border-dark text-xs">
                    {stealthKeys.map((key, i) => (
                      <tr key={i} className="hover:bg-primary/5 transition-colors group">
                        <td className="px-6 py-4 text-slate-500 truncate max-w-[150px]">
                          {key.orderId}
                        </td>
                        <td className="px-6 py-4">
                           <div className="flex items-center gap-2 text-white">
                              <span className="w-1.5 h-1.5 rounded-full bg-primary shadow-glow"></span>
                              {key.stealthAddress}
                           </div>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <Button 
                            variant="secondary" 
                            className="text-[10px] py-1 px-3 border-primary/30 hover:bg-primary/10 text-primary"
                            onClick={() => setRevealTarget(key)}
                          >
                            Access Funds
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="flex flex-col items-center justify-center p-12 text-center">
                   <Icon name="shield" className="text-4xl text-slate-800 mb-4" />
                   <p className="text-xs text-slate-500 max-w-xs">No stealth settlements detected yet. Matched trades will appear here automatically.</p>
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* Sidebar Widgets */}
        <div className="col-span-12 lg:col-span-3 flex flex-col gap-6">
          <Card className="p-5">
            <h3 className="text-slate-500 text-xs uppercase font-semibold tracking-widest mb-4">Yield Projections</h3>
            <div className="h-32 mb-4 w-full rounded bg-black/40 border border-border-dark overflow-hidden relative">
              <ResponsiveContainer width="100%" height="100%">
                 <AreaChart data={yieldData}>
                    <defs>
                      <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#0df259" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#0df259" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <Area type="monotone" dataKey="value" stroke="#0df259" fillOpacity={1} fill="url(#colorValue)" strokeWidth={2} />
                 </AreaChart>
              </ResponsiveContainer>
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
        onClose={() => setIsFundingOpen(false)} 
      />
    </div>
  );
};
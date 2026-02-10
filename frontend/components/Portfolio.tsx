import React from 'react';
import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts';
import { Asset } from '../types';
import { Icon, Badge, Card, Button } from './UI';

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
  return (
    <div className="h-full flex flex-col gap-6 p-6 overflow-y-auto bg-background-light dark:bg-background-dark">
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

      <div className="grid grid-cols-12 gap-6 flex-1 min-h-[400px]">
        {/* Asset Table */}
        <div className="col-span-12 lg:col-span-9 flex flex-col">
          <Card className="flex-1 flex flex-col h-full">
            <div className="p-5 border-b border-border-dark flex justify-between items-center bg-surface-lighter">
              <h2 className="text-lg font-medium text-white flex items-center">
                <Icon name="table_chart" className="mr-2 text-slate-500" />
                Confidential Asset Breakdown
              </h2>
              <div className="flex space-x-2">
                <button className="p-1.5 hover:bg-white/5 rounded text-slate-500 transition-colors">
                  <Icon name="filter_list" className="text-sm" />
                </button>
                <button className="p-1.5 hover:bg-white/5 rounded text-slate-500 transition-colors">
                  <Icon name="download" className="text-sm" />
                </button>
              </div>
            </div>
            <div className="overflow-x-auto flex-1">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="text-xs uppercase tracking-wider text-slate-500 border-b border-border-dark bg-black/20">
                    <th className="px-6 py-4 font-semibold">Asset</th>
                    <th className="px-6 py-4 font-semibold">Type</th>
                    <th className="px-6 py-4 font-semibold text-right">Allocation</th>
                    <th className="px-6 py-4 font-semibold text-right">Position Size</th>
                    <th className="px-6 py-4 font-semibold text-center">Privacy Shield</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-dark text-sm">
                  {assets.map((asset, idx) => (
                    <tr key={idx} className="group hover:bg-white/5 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center">
                          <div className={`h-8 w-8 rounded bg-slate-800 flex items-center justify-center mr-3 border border-slate-700 ${asset.colorClass}`}>
                            <Icon name={asset.icon} className="text-sm" />
                          </div>
                          <div>
                            <div className="font-medium text-white">{asset.name}</div>
                            <div className="text-xs text-slate-500 font-mono">{asset.symbol}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-slate-400">{asset.type}</td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end space-x-2">
                          <span className="font-mono text-white">{asset.allocation}%</span>
                          <div className="w-16 h-1 bg-slate-700 rounded-full overflow-hidden">
                            <div className={`h-full ${asset.symbol === 'US-Gov-042' ? 'bg-blue-500' : 'bg-primary'} w-[${asset.allocation}%]`} style={{ width: `${asset.allocation}%` }}></div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right font-mono text-slate-200">
                        <span className="blur-[2px] group-hover:blur-none transition-all cursor-crosshair">{asset.value}</span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <Badge 
                          label={asset.status} 
                          color={asset.status === 'Active' ? 'primary' : 'slate'} 
                          pulse={asset.status === 'Active'} 
                          icon={asset.status === 'Encrypted' ? 'lock' : undefined}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-500">Projected (30d)</span>
                  <span className="text-white font-mono">$15,420</span>
                </div>
                <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                  <div className="bg-primary h-full w-[65%] rounded-full"></div>
                </div>
              </div>
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-500">Projected (1y)</span>
                  <span className="text-white font-mono">$188,400</span>
                </div>
                <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                  <div className="bg-primary/50 h-full w-[40%] rounded-full"></div>
                </div>
              </div>
            </div>
          </Card>

          <Card className="p-5 flex-1 flex flex-col justify-center">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-slate-500 text-xs uppercase font-semibold tracking-widest">Accrued Interest</h3>
              <Icon name="bolt" className="text-primary animate-pulse text-sm" />
            </div>
            <div className="text-3xl font-mono text-primary font-medium tracking-tight mb-1">
              $3,402.15<span className="text-slate-600 text-lg">92</span>
            </div>
            <p className="text-xs text-slate-500">
              Last updated: Block 18293402
            </p>
            <div className="mt-6 pt-6 border-t border-border-dark">
              <Button fullWidth icon="download">Claim Yield</Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};
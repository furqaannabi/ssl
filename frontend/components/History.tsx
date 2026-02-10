import React from 'react';
import { Icon, Button } from './UI';

const historyData = [
  { time: '2023-10-27 14:30:05', asset: 'USTB (T-Bills)', type: 'T', side: 'BUY', filled: '500 / 500', price: '$98.24', status: 'SETTLED', hash: '0x7a...b9f2', color: 'blue' },
  { time: '2023-10-27 13:15:22', asset: 'PAXG (Gold)', type: 'G', side: 'SELL', filled: '12.5 / 12.5', price: '$1,980.50', status: 'SETTLED', hash: '0x3c...d1e8', color: 'yellow' },
  { time: '2023-10-26 09:42:10', asset: 'USTB (T-Bills)', type: 'T', side: 'BUY', filled: '1000 / 1000', price: '$98.21', status: 'SETTLED', hash: '0x9f...a2b4', color: 'blue' },
  { time: '2023-10-25 16:10:00', asset: 'SPY (S&P 500)', type: 'S', side: 'BUY', filled: '0 / 200', price: '-', status: 'CANCELED', hash: '0xe1...c3d4', color: 'purple', opacity: true },
];

export const History: React.FC = () => {
  return (
    <div className="flex h-full bg-background-dark bg-grid-pattern">
       {/* Main Content */}
       <div className="flex-1 flex flex-col min-w-0">
          {/* Toolbar */}
          <div className="h-16 border-b border-border-dark flex items-center px-6 justify-between bg-surface-dark/80 backdrop-blur-sm sticky top-0 z-10 shrink-0">
             <div className="flex items-center gap-4">
                <h1 className="text-lg font-bold tracking-tight text-white mr-4">ORDER HISTORY</h1>
                
                {['ASSET: ALL', 'SIDE: ALL'].map((label, i) => (
                   <div key={i} className="relative group">
                      <select className="appearance-none bg-surface-dark border border-border-dark text-xs text-slate-300 rounded pl-3 pr-8 py-1.5 focus:border-primary focus:ring-0 cursor-pointer font-mono hover:bg-white/5 transition-colors">
                         <option>{label}</option>
                         <option>Option 1</option>
                      </select>
                      <Icon name="expand_more" className="absolute right-2 top-1.5 text-slate-500 text-sm pointer-events-none" />
                   </div>
                ))}
                
                <button className="flex items-center gap-2 bg-surface-dark border border-border-dark text-xs text-slate-300 rounded px-3 py-1.5 hover:bg-white/5 transition-colors font-mono">
                   <Icon name="calendar_today" className="text-sm" />
                   <span>LAST 30 DAYS</span>
                </button>
             </div>
             
             <div className="flex items-center gap-3">
                <div className="relative">
                   <input className="bg-surface-dark border border-border-dark text-xs text-white rounded pl-8 pr-3 py-1.5 w-64 focus:border-primary focus:ring-0 font-mono placeholder-slate-600" placeholder="Search Hash..." type="text" />
                   <Icon name="search" className="absolute left-2 top-1.5 text-slate-500 text-sm" />
                </div>
                <button className="bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 rounded px-3 py-1.5 text-xs font-medium flex items-center gap-1 transition-colors">
                   <Icon name="download" className="text-sm" />
                   EXPORT CSV
                </button>
             </div>
          </div>

          {/* Table */}
          <div className="flex-1 overflow-auto p-6">
             <div className="border border-border-dark rounded bg-surface-dark overflow-hidden shadow-2xl">
                <table className="w-full text-left border-collapse">
                   <thead>
                      <tr className="bg-black/40 text-slate-500 text-[10px] uppercase tracking-wider font-semibold border-b border-border-dark">
                         <th className="px-4 py-3 font-medium w-48">Timestamp (UTC)</th>
                         <th className="px-4 py-3 font-medium">Asset</th>
                         <th className="px-4 py-3 font-medium">Side</th>
                         <th className="px-4 py-3 font-medium text-right">Filled / Total</th>
                         <th className="px-4 py-3 font-medium text-right">Avg. Price</th>
                         <th className="px-4 py-3 font-medium text-center">Status</th>
                         <th className="px-4 py-3 font-medium w-64">Privacy Hash</th>
                      </tr>
                   </thead>
                   <tbody className="divide-y divide-border-dark text-xs font-mono">
                      {historyData.map((row, i) => (
                         <tr key={i} className={`cursor-pointer hover:bg-white/5 transition-colors group ${i === 0 ? 'bg-primary/5 border-l-2 border-l-primary' : 'border-l-2 border-l-transparent'} ${row.opacity ? 'opacity-60' : ''}`}>
                            <td className="px-4 py-3 text-slate-400">{row.time}</td>
                            <td className="px-4 py-3">
                               <div className="flex items-center gap-2">
                                  <div className={`w-4 h-4 rounded-full bg-${row.color}-500/20 border border-${row.color}-500/50 flex items-center justify-center text-[8px] text-${row.color}-300`}>{row.type}</div>
                                  <span className="text-white font-display font-medium">{row.asset}</span>
                               </div>
                            </td>
                            <td className="px-4 py-3">
                               <span className={`${row.side === 'BUY' ? 'text-primary bg-primary/10' : 'text-red-400 bg-red-400/10'} px-1.5 py-0.5 rounded text-[10px] font-bold`}>{row.side}</span>
                            </td>
                            <td className="px-4 py-3 text-right text-white">{row.filled}</td>
                            <td className="px-4 py-3 text-right text-slate-300">{row.price}</td>
                            <td className="px-4 py-3 text-center">
                               <span className={`inline-flex items-center gap-1 ${row.status === 'SETTLED' ? 'text-primary border-primary/20 bg-primary/5' : 'text-slate-400 border-slate-600/30 bg-slate-600/10'} border px-2 py-0.5 rounded-full text-[10px] font-bold`}>
                                  <span className={`w-1 h-1 rounded-full ${row.status === 'SETTLED' ? 'bg-primary' : 'bg-slate-400'}`}></span> {row.status}
                               </span>
                            </td>
                            <td className="px-4 py-3 text-slate-500 group-hover:text-slate-300 transition-colors">
                               <div className="flex items-center justify-between gap-2 bg-black/30 rounded px-2 py-1 border border-transparent group-hover:border-border-dark">
                                  <span className="truncate">{row.hash}</span>
                                  <Icon name="content_copy" className="text-[12px] opacity-0 group-hover:opacity-100 cursor-pointer hover:text-primary" />
                               </div>
                            </td>
                         </tr>
                      ))}
                   </tbody>
                </table>
             </div>
             
             {/* Pagination */}
             <div className="flex items-center justify-between mt-4 text-xs text-slate-500">
                <div>Showing 1-4 of 128 orders</div>
                <div className="flex gap-2">
                   <button className="px-3 py-1 rounded bg-surface-dark border border-border-dark hover:text-white disabled:opacity-50">Previous</button>
                   <button className="px-3 py-1 rounded bg-surface-dark border border-border-dark hover:text-white text-primary border-primary/30">1</button>
                   <button className="px-3 py-1 rounded bg-surface-dark border border-border-dark hover:text-white">2</button>
                   <button className="px-3 py-1 rounded bg-surface-dark border border-border-dark hover:text-white">3</button>
                   <span className="px-2 py-1">...</span>
                   <button className="px-3 py-1 rounded bg-surface-dark border border-border-dark hover:text-white">Next</button>
                </div>
             </div>
          </div>
          
          {/* Ticker */}
          <div className="h-8 bg-black border-t border-border-dark flex items-center overflow-hidden whitespace-nowrap px-4 text-[10px] font-mono shrink-0">
             <span className="text-primary font-bold mr-4 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span> LIVE FEEDS</span>
             <div className="flex gap-8 animate-marquee">
                <span className="text-slate-400">XAU/USD <span className="text-white">$1,980.50</span> <span className="text-primary">(+0.40%)</span></span>
                <span className="text-slate-400">USTB/USD <span className="text-white">$98.24</span> <span className="text-primary">(+0.01%)</span></span>
                <span className="text-slate-400">BTC/USD <span className="text-white">$34,201.00</span> <span className="text-red-400">(-0.15%)</span></span>
                <span className="text-slate-400">ETH/USD <span className="text-white">$1,789.45</span> <span className="text-primary">(+1.20%)</span></span>
                <span className="text-slate-400">SPY/USD <span className="text-white">$415.20</span> <span className="text-primary">(+0.05%)</span></span>
             </div>
          </div>
       </div>

       {/* Right Sidebar (Details) */}
       <aside className="w-80 bg-surface-dark border-l border-border-dark flex flex-col shrink-0 z-10 shadow-xl">
          <div className="h-16 border-b border-border-dark flex items-center px-5 justify-between bg-black/20 shrink-0">
             <h2 className="text-sm font-bold uppercase tracking-wide text-white">Settlement Details</h2>
             <button className="text-slate-500 hover:text-white transition-colors">
                <Icon name="close" className="text-lg" />
             </button>
          </div>
          <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-6">
             <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 flex flex-col items-center text-center gap-2">
                <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center mb-1">
                   <Icon name="verified" className="text-primary text-2xl" />
                </div>
                <div className="text-primary font-bold text-lg tracking-tight">TRANSACTION SETTLED</div>
                <div className="text-[10px] text-slate-400">Verified via Chainlink CCIP & Intel SGX</div>
             </div>
             
             <div className="space-y-4">
                <div>
                   <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Order ID</div>
                   <div className="text-xs font-mono text-white bg-black/40 p-2 rounded border border-border-dark flex items-center justify-between group">
                      <span className="truncate">8934-2938-AC92</span>
                      <Icon name="content_copy" className="text-[12px] text-slate-600 group-hover:text-primary cursor-pointer" />
                   </div>
                </div>
                <div>
                   <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Asset Allocation</div>
                   <div className="flex justify-between items-center text-sm border-b border-border-dark pb-2 mb-2">
                      <span className="text-slate-300">USTB (T-Bills)</span>
                      <span className="font-mono text-white">500.00</span>
                   </div>
                   <div className="flex justify-between items-center text-sm">
                      <span className="text-slate-300">Total Value</span>
                      <span className="font-mono text-primary">$49,120.00</span>
                   </div>
                </div>
             </div>
             
             <div className="space-y-3 pt-4 border-t border-border-dark">
                <h3 className="text-xs font-bold text-white uppercase flex items-center gap-2">
                   <Icon name="fingerprint" className="text-sm text-primary" />
                   Cryptographic Proofs
                </h3>
                <div className="space-y-3">
                   {[{label: 'CCIP Message ID', val: '0x8a72...92b1c4e', status: 'Valid'}, {label: 'TEE Attestation Hash', val: '0x9f23...1a7d82b', status: 'Secured'}].map((item, i) => (
                      <div key={i}>
                         <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] text-slate-500">{item.label}</span>
                            <span className="text-[10px] text-primary flex items-center gap-0.5"><Icon name="check_circle" className="text-[10px]" /> {item.status}</span>
                         </div>
                         <div className="text-[10px] font-mono text-slate-400 bg-black/40 p-2 rounded break-all border border-border-dark leading-tight">
                            {item.val}
                         </div>
                      </div>
                   ))}
                </div>
             </div>
             
             <div className="mt-auto pt-4">
                <Button variant="secondary" fullWidth icon="open_in_new" className="text-xs justify-center">View On-Chain Explorer</Button>
             </div>
          </div>
       </aside>
    </div>
  );
};
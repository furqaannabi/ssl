import React, { useState, useEffect } from 'react';
import { Icon, Card, Button, Badge } from './UI';
import { SpendingKeypair } from '../lib/stealth';
import { useConnection, useSignMessage } from 'wagmi';

export const Terminal: React.FC = () => {
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [privacyLevel, setPrivacyLevel] = useState(3);
  const [spendingKeypair, setSpendingKeypair] = useState<SpendingKeypair | null>(null);
  const [status, setStatus] = useState<'IDLE' | 'SIGNING' | 'ENCRYPTING' | 'MATCHING' | 'SETTLED'>('IDLE');
  
  const { address: eoaAddress, isConnected } = useConnection();
  const { signMessageAsync } = useSignMessage();

  useEffect(() => {
    const stored = localStorage.getItem("ssl_spending_keypair");
    if (stored) setSpendingKeypair(JSON.parse(stored));
    
    // Listen for storage changes (e.g. from ProfileModal)
    const handleStorage = () => {
        const updated = localStorage.getItem("ssl_spending_keypair");
        if (updated) setSpendingKeypair(JSON.parse(updated));
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const handlePlaceOrder = async () => {
    if (!isConnected) {
        alert("Please connect your Authority Wallet (EOA) first.");
        return;
    }
    if (!spendingKeypair) {
        alert("Stealth Layer not initialized. Please go to Profile and initialize your security layer first.");
        return;
    }

    try {
        setStatus('SIGNING');
        
        // 1. Sign Authorization Message with EOA
        const message = `Authorize SSL Order: ${side} 50,000 UNITS @ 98.40 USDC\nRecipient: ${spendingKeypair.publicKey}\nNonce: ${Date.now()}`;
        console.log("Requesting EOA signature...");
        
        // In wagmi v3, signMessageAsync typically takes { message }
        // If it requires account, we pass the connected eoaAddress
        await signMessageAsync({ message, account: eoaAddress });

        // 2. Encrypt & Place (Simulated)
        setStatus('ENCRYPTING');
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        setStatus('MATCHING');
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        setStatus('SETTLED');
        setTimeout(() => setStatus('IDLE'), 5000);

    } catch (err) {
        console.error("Order failed:", err);
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
               <div className="w-1.5 h-1.5 bg-primary"></div>
            </div>
            
            <div className="p-5 flex-1 overflow-y-auto space-y-6 bg-stripes bg-[length:20px_20px]">
               {!isConnected && (
                   <div className="p-3 bg-primary/10 border border-primary/40 rounded text-[10px] text-primary font-mono mb-2 flex items-center gap-2">
                       <Icon name="link_off" className="text-xs" />
                       EOA DISCONNECTED: Link authority wallet to sign orders.
                   </div>
               )}
               {isConnected && !spendingKeypair && (
                   <div className="p-3 bg-red-900/10 border border-red-900/40 rounded text-[10px] text-red-400 font-mono mb-2">
                       <Icon name="error_outline" className="text-xs mr-1 align-middle" />
                       STEALTH LAYER INACTIVE: Initialize spending keys to trade.
                   </div>
               )}

               <div className="space-y-2 relative bg-surface-dark/95 p-4 border border-border-dark backdrop-blur-sm">
                  <label className="text-[10px] text-primary font-mono uppercase tracking-wider block mb-1">Asset Class</label>
                  <div className="relative">
                     <select className="w-full bg-black border border-border-dark text-white text-sm px-3 py-2.5 focus:ring-1 focus:ring-primary focus:border-primary appearance-none font-mono rounded-none">
                        <option>US T-Bill (Short-Term)</option>
                        <option>Paxos Gold (PAXG)</option>
                        <option>Corporate Bonds (INV-G)</option>
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
                        <span className="text-[10px] text-primary font-mono cursor-pointer underline decoration-primary/50">Max</span>
                     </div>
                     <div className="relative">
                        <input className="w-full bg-black border border-border-dark text-white font-mono text-sm px-3 py-2.5 focus:ring-1 focus:ring-primary focus:border-primary text-right rounded-none" placeholder="0.00" defaultValue="50,000" type="text" />
                        <span className="absolute left-3 top-2.5 text-slate-600 font-mono text-xs">UNITS</span>
                     </div>
                  </div>
                  <div className="space-y-1">
                     <div className="flex justify-between">
                        <label className="text-[10px] text-slate-500 font-mono uppercase">Limit Price</label>
                        <span className="text-[10px] text-slate-500 font-mono">Mid: <span className="text-white">98.42</span></span>
                     </div>
                     <div className="relative">
                        <input className="w-full bg-black border border-border-dark text-white font-mono text-sm px-3 py-2.5 focus:ring-1 focus:ring-primary focus:border-primary text-right rounded-none" placeholder="0.00" defaultValue="98.40" type="text" />
                        <span className="absolute left-3 top-2.5 text-slate-600 font-mono text-xs">USDC</span>
                     </div>
                  </div>
               </div>

               <div className="space-y-2 pt-4 bg-surface-dark/95 p-4 border border-border-dark backdrop-blur-sm">
                  <label className="text-[10px] text-primary font-mono uppercase flex items-center gap-2">
                     <Icon name="visibility_off" className="text-[12px]" /> Privacy Level
                  </label>
                  <div className="w-full bg-black p-3 border border-border-dark">
                     <input 
                        className="w-full accent-primary h-1 bg-slate-800 appearance-none cursor-pointer" 
                        type="range" min="1" max="3" step="1"
                        value={privacyLevel}
                        onChange={(e) => setPrivacyLevel(Number(e.target.value))}
                     />
                     <div className="flex justify-between text-[9px] font-mono mt-2 text-slate-600 uppercase tracking-wider">
                        <span className={privacyLevel === 1 ? 'text-primary' : ''}>Standard</span>
                        <span className={privacyLevel === 2 ? 'text-primary' : ''}>Hidden</span>
                        <span className={`font-bold ${privacyLevel === 3 ? 'text-primary' : ''}`}>Zero-Knowledge</span>
                     </div>
                  </div>
               </div>

               <Button 
                fullWidth 
                icon={status === 'IDLE' ? (spendingKeypair ? "lock" : "lock_open") : "pending"} 
                className="py-4 mt-2 uppercase tracking-wider"
                onClick={handlePlaceOrder}
                disabled={status !== 'IDLE'}
               >
                {status === 'SIGNING' ? "Requesting Signature..." :
                 status === 'ENCRYPTING' ? "Encrypting Order..." :
                 status === 'MATCHING' ? "Matching Engine..." :
                 status === 'SETTLED' ? "Order Settled!" :
                 spendingKeypair ? "Encrypt & Place Order" : "Initialize Stealth Layer"}
               </Button>
               <div className="text-[9px] text-slate-600 text-center font-mono uppercase tracking-wide">
                  TEE Verification: <span className="text-slate-400">{spendingKeypair ? "READY (0x..." + spendingKeypair.publicKey.slice(-6) + ")" : "OFFLINE"}</span>
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
              
              <div className="flex-1 relative z-10 p-6 flex flex-col justify-between bg-black/50 backdrop-blur-sm">
                 {/* Steps */}
                 {[
                   { id: '01', title: 'Authority Sign', desc: 'EOA signing order authorization.', active: status === 'SIGNING' },
                   { id: '02', title: 'Enclave Encryption', desc: 'Symmetric encryption via TEE.', active: status === 'ENCRYPTING' },
                   { id: '03', title: 'Matching', desc: 'Dark pool liquidity search.', active: status === 'MATCHING' },
                   { id: '04', title: 'Settlement', desc: 'Report submitted to Vault.', active: status === 'SETTLED' }
                 ].map((step, i) => (
                    <div key={i} className={`flex items-center gap-4 group transition-all duration-500 ${step.active ? 'scale-105' : 'opacity-40'}`}>
                       <div className={`w-8 h-8 border flex items-center justify-center text-xs font-mono font-bold transition-all ${step.active ? 'bg-primary/10 border-primary text-primary shadow-glow' : 'bg-black border-border-dark text-slate-500'}`}>
                        {step.id}
                      </div>
                      {i < 3 && <div className={`flex-1 border-b ${step.active ? 'border-primary/50 overflow-hidden relative' : 'border-dashed border-border-dark'} top-3 relative`}>
                          {step.active && <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/50 to-transparent w-1/2 h-full animate-shimmer"></div>}
                      </div>}
                      <div className={`w-64 border p-3 transition-all ${step.active ? 'bg-surface-lighter border-primary shadow-glow-strong/20' : 'bg-black border-border-dark'}`}>
                         <div className={`text-[10px] font-bold uppercase tracking-wide mb-1 flex justify-between ${step.active ? 'text-primary' : 'text-white'}`}>
                            {step.title}
                            {step.active && <Icon name="settings" className="text-[12px] animate-spin" />}
                         </div>
                         <div className="text-[10px] font-mono text-slate-500 line-clamp-2">
                           {step.desc}
                         </div>
                      </div>
                    </div>
                 ))}
              </div>
           </Card>

           {/* Logs */}
           <Card className="h-1/3 flex flex-col shadow-heavy">
              <div className="px-3 py-2 border-b border-border-dark flex items-center gap-2 bg-obsidian">
                 <Icon name="terminal" className="text-slate-500 text-sm" />
                 <span className="text-[10px] font-mono font-bold text-slate-400 uppercase">SYSTEM LOGS</span>
              </div>
              <div className="flex-1 p-3 overflow-y-auto font-mono text-[10px] space-y-1 bg-black">
                 <div className="flex gap-2"><span className="text-slate-600">[14:20:01]</span><span className="text-primary"> Connected to Node SGX-Alpha-9</span></div>
                 <div className="flex gap-2"><span className="text-slate-600">[14:20:05]</span><span className="text-slate-300"> Fetching latest Merkle Root...</span></div>
                 <div className="flex gap-2"><span className="text-slate-600">[14:20:06]</span><span className="text-slate-300"> Privacy pool depth updated (Block 18492011)</span></div>
                 <div className="flex gap-2"><span className="text-slate-600">[14:20:12]</span><span className="text-yellow-600 font-bold"> Warning: High gas fees detected on Settlement Layer</span></div>
                 <div className="flex gap-2"><span className="text-slate-600">[14:20:15]</span><span className="text-slate-300"> Order #9921 encrypted. <span className="text-slate-600">hash: 0x7f...a9b</span></span></div>
                 <div className="flex gap-2"><span className="text-slate-600 animate-pulse">_</span></div>
              </div>
           </Card>
        </div>

        {/* Order Book */}
        <div className="col-span-12 md:col-span-4 flex flex-col z-10">
           <Card className="flex-1 flex flex-col shadow-heavy">
               <div className="px-4 py-3 border-b border-border-dark bg-obsidian flex justify-between items-center">
                  <h2 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2 font-mono">
                     <Icon name="list_alt" className="text-primary text-sm" />
                     Private Order Book
                  </h2>
                  <div className="px-2 py-0.5 bg-black border border-border-dark text-[9px] text-slate-400 font-mono uppercase tracking-wide">Obfuscated View</div>
               </div>
               
               <div className="flex-1 flex flex-col font-mono text-xs bg-black/50 backdrop-blur-sm">
                  <div className="grid grid-cols-3 px-4 py-2 text-slate-500 border-b border-border-dark text-[9px] uppercase tracking-wider bg-surface-dark/50">
                     <div>Price (USDC)</div>
                     <div className="text-right">Vol (Masked)</div>
                     <div className="text-right">Total</div>
                  </div>
                  
                  {/* Asks */}
                  <div className="flex-1 overflow-y-auto flex flex-col-reverse justify-end pb-2">
                     {[
                        { price: '98.55', vol: '12.5k', total: '240.2k', w: '20%' },
                        { price: '98.52', vol: '50.0k', total: '227.7k', w: '40%' },
                        { price: '98.50', vol: 'XX.Xk', total: '177.7k', w: '30%' },
                        { price: '98.48', vol: '85.2k', total: '1XX.Xk', w: '50%' },
                        { price: '98.45', vol: '20.0k', total: '45.0k', w: '10%' },
                     ].map((row, i) => (
                        <div key={i} className="grid grid-cols-3 px-4 py-1 hover:bg-red-900/10 cursor-pointer group relative border-b border-transparent hover:border-red-900/30">
                           <span className="text-red-500">{row.price}</span>
                           <span className="text-right text-slate-500 blur-[3px] group-hover:blur-none transition-all">{row.vol}</span>
                           <span className="text-right text-slate-500">{row.total}</span>
                           <div className="absolute right-0 top-0 bottom-0 bg-red-500/5 pointer-events-none" style={{width: row.w}}></div>
                        </div>
                     ))}
                  </div>

                  {/* Spread */}
                  <div className="py-3 border-y border-border-dark bg-surface-lighter flex items-center justify-between px-4 z-10">
                     <span className="text-slate-500 text-[10px] uppercase tracking-wide">Spread: 0.03 (0.03%)</span>
                     <div className="flex items-center gap-2">
                        <Icon name="lock" className="text-primary text-[12px]" />
                        <span className="text-white text-xs font-bold font-mono">98.42 USD</span>
                     </div>
                  </div>

                  {/* Bids */}
                  <div className="flex-1 overflow-y-auto pt-2">
                     {[
                        { price: '98.42', vol: '45.2k', total: '45.2k', w: '35%' },
                        { price: '98.40', vol: '100.0k', total: '145.2k', w: '65%' },
                        { price: '98.38', vol: 'XX.Xk', total: '167.2k', w: '15%' },
                        { price: '98.35', vol: '12.1k', total: '179.3k', w: '10%' },
                        { price: '98.30', vol: '50.0k', total: '2XX.3k', w: '40%' },
                     ].map((row, i) => (
                        <div key={i} className="grid grid-cols-3 px-4 py-1 hover:bg-primary/10 cursor-pointer group relative border-b border-transparent hover:border-primary/20">
                           <span className="text-primary">{row.price}</span>
                           <span className="text-right text-slate-500 blur-[3px] group-hover:blur-none transition-all">{row.vol}</span>
                           <span className="text-right text-slate-500">{row.total}</span>
                           <div className="absolute right-0 top-0 bottom-0 bg-primary/5 pointer-events-none" style={{width: row.w}}></div>
                        </div>
                     ))}
                  </div>
               </div>
           </Card>
        </div>
    </div>
  );
};
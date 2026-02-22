import React, { useState, useEffect, useRef } from 'react';
import { Icon, Card, Button, Badge, useToast } from './UI';
import { OracleIndicator } from './OracleIndicator';
import { useConnection } from 'wagmi';
import { CHAINS } from '../lib/chain-config';
import { auth } from '../lib/auth';

export const Terminal: React.FC = () => {
  const { toast } = useToast();
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [privacyLevel, setPrivacyLevel] = useState(3);
  const [stealthAddress, setStealthAddress] = useState<string>('');
  const [status, setStatus] = useState<'IDLE' | 'SENDING' | 'MATCHING' | 'SETTLED'>('IDLE');
  const [selectedPairId, setSelectedPairId] = useState<string>('');
  const [amount, setAmount] = useState('10');
  const [price, setPrice] = useState('100.00');
  const logEndRef = useRef<HTMLDivElement>(null);
  
  const { address: eoaAddress, isConnected } = useConnection();

  const API_URL = ""; // Use Vite proxy for CORS/cookie consistency
  // Order State
  const [myOrders, setMyOrders] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'BOOK' | 'MY_ORDERS'>('BOOK');
  const [logs, setLogs] = useState<string[]>([]);
  const [orderBook, setOrderBook] = useState<{bids: any[], asks: any[]}>({ bids: [], asks: [] });
  const [pairs, setPairs] = useState<any[]>([]);
  const [baseChainSelector, setBaseChainSelector] = useState<string>('');
  const [quoteChainSelector, setQuoteChainSelector] = useState<string>('');
  const [balances, setBalances] = useState<Array<{ token: string; chainSelector: string; balance: string }>>([]); // Raw balance entries from backend
  const [tokenLookup, setTokenLookup] = useState<Record<string, any>>({}); // address -> token metadata (symbol, decimals)
  // Fetch Data
  const fetchBalances = async () => {
      try {
        const [user, tokensRes] = await Promise.all([
            import('../lib/auth').then(({ auth }) => auth.getMe()),
            fetch(`${API_URL}/api/tokens`),
        ]);

        // Build address->metadata lookup from /api/tokens
        if (tokensRes.ok) {
            const data = await tokensRes.json();
            if (data.success) {
                const lookup: Record<string, any> = {};
                data.tokens.forEach((t: any) => { lookup[t.address.toLowerCase()] = t; });
                setTokenLookup(lookup);
            }
        }

        if (user && user.balances) {
            setBalances(user.balances.map((b: any) => ({
                token: b.token.toLowerCase(),
                chainSelector: b.chainSelector,
                balance: b.balance,
            })));
        }
      } catch (e) { console.error("Failed to fetch balances", e); }
  };

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

  /** Find base token entry (address+decimals) for the currently selected base chain. */
  const getBaseToken = (pairArg?: any): { address: string; decimals: number; chainSelector: string } | undefined => {
      const pair = pairArg ?? pairs.find(p => p.id === selectedPairId);
      return pair?.tokens?.find((t: any) => t.chainSelector === baseChainSelector);
  };

  /** Find USDC token entry for the currently selected quote chain. */
  const getQuoteToken = (): { address: string; decimals: number; symbol: string } | undefined => {
      return Object.values(tokenLookup).find(
          (t: any) => t.symbol === 'USDC' && t.chainSelector === quoteChainSelector
      ) as any;
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
                    const firstChain = first.tokens?.[0]?.chainSelector || '';
                    setBaseChainSelector(firstChain);
                    setQuoteChainSelector(firstChain);
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
          fetchBalances();
      }
      if (selectedPairId) fetchOrderBook();

      const interval = setInterval(() => {
          if (isConnected) {
              if (activeTab === 'MY_ORDERS') fetchMyOrders();
              fetchBalances();
          }
          if (activeTab === 'BOOK' && selectedPairId) fetchOrderBook();
      }, 3000);
      return () => clearInterval(interval);
  }, [isConnected, activeTab, selectedPairId]);

  // Reset chain selectors when selected pair changes
  useEffect(() => {
    const pair = pairs.find(p => p.id === selectedPairId);
    if (pair?.tokens?.length > 0) {
      const firstChain = pair.tokens[0].chainSelector;
      setBaseChainSelector(firstChain);
      setQuoteChainSelector(firstChain);
    }
  }, [selectedPairId]);

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
    
    if (!stealthAddress || !/^0x[0-9a-fA-F]{40}$/.test(stealthAddress)) {
        toast.error("Invalid Stealth Address. Generate in Profile.");
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

        const payload = {
            pairId: pair.id,
            amount: String(amount),
            price: String(price),
            side,
            stealthAddress,
            userAddress: eoaAddress,
            baseChainSelector,
            quoteChainSelector,
        };

        console.log("Placing order:", payload);

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
               <div className="w-1.5 h-1.5 bg-primary"></div>
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
                        <label className="text-[10px] text-primary font-mono uppercase tracking-wider">Stealth Address</label>
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

                                    if(/^0x[0-9a-fA-F]{40}$/.test(cleanedText)) {
                                        setStealthAddress(cleanedText);
                                        toast.success("Stealth Address Pasted");
                                    } else {
                                        toast.error("Invalid Address Format (0x + 40 hex chars)");
                                    }
                                } catch(e) { 
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
                        value={stealthAddress}
                        onChange={(e) => setStealthAddress(e.target.value)}
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
                     {/* Chain + balance rows */}
                     {side === 'BUY' ? (
                         <div className="space-y-1 mb-1">
                             {/* RWA receive chain — all supported chains */}
                             {(() => {
                                 const selectedPair = pairs.find(p => p.id === selectedPairId);
                                 if (!selectedPair) return null;
                                 const toShort = (name: string) => name.replace(' Sepolia','').replace('Arbitrum','Arb');
                                 return (
                                     <div className="flex items-center justify-between">
                                         <div className="flex items-center gap-1 text-[8px] text-slate-500 font-mono uppercase">
                                             <span>Receive {selectedPair.baseSymbol} on</span>
                                             <select
                                                 className="bg-black border border-border-dark text-primary text-[8px] px-1 py-0.5 font-mono rounded-none appearance-none"
                                                 value={baseChainSelector}
                                                 onChange={e => setBaseChainSelector(e.target.value)}
                                             >
                                                 {Object.values(CHAINS).map(c => (
                                                     <option key={c.chainSelector} value={c.chainSelector}>
                                                         {toShort(c.name)}
                                                     </option>
                                                 ))}
                                             </select>
                                         </div>
                                     </div>
                                 );
                             })()}
                             {/* USDC pay chain */}
                             <div className="flex items-center justify-between">
                                 <div className="flex items-center gap-1 text-[8px] text-slate-500 font-mono uppercase">
                                     <span>Pay USDC on</span>
                                     <select
                                         className="bg-black border border-border-dark text-primary text-[8px] px-1 py-0.5 font-mono rounded-none appearance-none"
                                         value={quoteChainSelector}
                                         onChange={e => setQuoteChainSelector(e.target.value)}
                                     >
                                         {Object.values(CHAINS).map(c => (
                                             <option key={c.chainSelector} value={c.chainSelector}>
                                                 {c.name.replace(' Sepolia','')}
                                             </option>
                                         ))}
                                     </select>
                                     {quoteChainSelector !== baseChainSelector && <span className="text-yellow-400">⚡</span>}
                                 </div>
                                 <span className="text-[9px] text-slate-500 font-mono">
                                     {(() => {
                                         const qt = getQuoteToken();
                                         if (!qt) return "-- USDC";
                                         const bal = getAvailableBalance(qt.address, qt.decimals || 6, quoteChainSelector);
                                         return `${bal.toFixed(2)} USDC`;
                                     })()}
                                 </span>
                             </div>
                         </div>
                     ) : (
                         /* SELL: chain selector + balance */
                         <div className="flex items-center justify-between mb-1">
                             {(() => {
                                 const selectedPair = pairs.find(p => p.id === selectedPairId);
                                 if (!selectedPair?.tokens?.length) return null;
                                 const toShort = (name: string) => name.replace(' Sepolia','').replace('Arbitrum','Arb');
                                 const bt = getBaseToken();
                                 const bal = bt ? getAvailableBalance(bt.address, bt.decimals || 18, baseChainSelector) : 0;
                                 return (
                                     <>
                                         <div className="flex items-center gap-1 text-[8px] text-slate-500 font-mono uppercase">
                                             <span>{selectedPair.baseSymbol} on</span>
                                             <select
                                                 className="bg-black border border-border-dark text-primary text-[8px] px-1 py-0.5 font-mono rounded-none appearance-none"
                                                 value={baseChainSelector}
                                                 onChange={e => { setBaseChainSelector(e.target.value); setQuoteChainSelector(e.target.value); }}
                                             >
                                                 {selectedPair.tokens.map((t: any) => (
                                                     <option key={t.chainSelector} value={t.chainSelector}>
                                                         {toShort(CHAINS[t.chainSelector]?.name || t.chainSelector)}
                                                     </option>
                                                 ))}
                                             </select>
                                         </div>
                                         <span className="text-[9px] text-slate-500 font-mono">{bal.toFixed(4)} {selectedPair.baseSymbol}</span>
                                     </>
                                 );
                             })()}
                         </div>
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

                  {/* Total Value & Validation */ }
                  <div className="pt-2 border-t border-border-dark flex justify-between items-end">
                      <div className="text-[10px] text-slate-500 font-mono uppercase">Est. Total</div>
                      <div className="text-right flex flex-col items-end">
                          <span className={`font-mono text-sm font-bold ${
                              (() => {
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
                                      ? CHAINS[quoteChainSelector]?.name?.replace(' Sepolia','') || 'chain'
                                      : CHAINS[baseChainSelector]?.name?.replace(' Sepolia','') || 'chain';
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
                 icon={status === 'IDLE' ? (stealthAddress ? ((Number(amount) * Number(price)) >= 5 ? "lock" : "warning") : "lock_open") : "pending"} 
                 className={`py-4 mt-6 uppercase tracking-wider ${(Number(amount) * Number(price)) < 5 ? 'opacity-50 cursor-not-allowed' : ''}`}
                 onClick={handlePlaceOrder}
                 disabled={status !== 'IDLE' || (Number(amount) * Number(price)) < 5}
                >
                 {status === 'SENDING' ? "Placing Order..." :
                  status === 'MATCHING' ? "Matching Engine..." :
                  status === 'SETTLED' ? "Order Settled!" :
                  (Number(amount) * Number(price)) < 5 ? "Min Order Value: 5 USDC" :
                  stealthAddress ? "Place Order" : "Enter Stealth Address"}
                </Button>
               <div className="text-[9px] text-slate-600 text-center font-mono uppercase tracking-wide mt-2">
                  TEE Verification: <span className="text-slate-400">{stealthAddress ? "READY" : "WAITING FOR ADDRESS"}</span>
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
                 {[
                   { id: '01', title: 'Order Placement', desc: 'Submitting order to secure enclave.', active: status === 'SENDING' },
                   { id: '02', title: 'Dark Pool Match', desc: 'Searching for counterparty liquidity.', active: status === 'MATCHING' },
                   { id: '03', title: 'Settlement Report', desc: 'CRE submitting on-chain report to Vault.', active: status === 'SETTLED' },
                   { id: '04', title: 'Confirmed', desc: 'Assets routed to stealth address.', active: status === 'SETTLED' }
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
           <Card className="min-h-0 h-1/3 flex flex-col shadow-heavy">
              <div className="px-3 py-2 border-b border-border-dark flex items-center gap-2 bg-obsidian shrink-0">
                 <Icon name="terminal" className="text-slate-500 text-sm" />
                 <span className="text-[10px] font-mono font-bold text-slate-400 uppercase">SYSTEM LOGS</span>
              </div>
              <div className="flex-1 min-h-0 p-3 overflow-y-auto font-mono text-[10px] space-y-1 bg-black">
                 {logs.length === 0 && <div className="text-slate-600 italic">Ready for logs...</div>}
                 {logs.map((log, i) => (
                     <div key={i} className="flex gap-2">
                         <span className="text-slate-600">[{new Date().toLocaleTimeString().split(' ')[0]}]</span>
                         <span className="text-slate-300">{log}</span>
                     </div>
                 ))}
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
                                      ? (CHAINS[order.baseChainSelector]?.name?.replace(' Sepolia','') || order.baseChainSelector)
                                      : (pair ? (CHAINS[pair.tokens?.[0]?.chainSelector]?.name?.replace(' Sepolia','') || '') : '');
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
                              )})}
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
                        const maxVol = Math.max(...orderBook.asks.map((o:any) => Number(o.amount)), 100);
                        const width = `${(vol / maxVol) * 100}%`;
                        
                        return (
                            <div key={i} className="grid grid-cols-3 px-4 py-1 hover:bg-red-900/10 cursor-pointer group relative border-b border-transparent hover:border-red-900/30">
                               <span className="text-red-500">{Number(order.price).toFixed(2)}</span>
                               <span className="text-right text-slate-500 blur-[3px] group-hover:blur-none transition-all">{vol.toFixed(1)}</span>
                               <span className="text-right text-slate-500">{(Number(order.price) * vol).toFixed(0)}</span>
                               <div className="absolute right-0 top-0 bottom-0 bg-red-500/5 pointer-events-none" style={{width}}></div>
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
                                ? ((Number(orderBook.asks[0].price) + Number(orderBook.bids[0].price))/2).toFixed(2) + " USD"
                                : "No Market"}
                        </span>
                     </div>
                  </div>

                  {/* Bids (Buy Orders) - Green/Primary */}
                  <div className="flex-1 overflow-y-auto pt-2">
                     {orderBook.bids.length === 0 && <div className="text-center text-[9px] text-slate-700 py-2">NO BID LIQUIDITY</div>}
                     {orderBook.bids.map((order: any, i) => {
                        const vol = Number(order.amount);
                        const maxVol = Math.max(...orderBook.bids.map((o:any) => Number(o.amount)), 100);
                        const width = `${(vol / maxVol) * 100}%`;
                        
                        return (
                            <div key={i} className="grid grid-cols-3 px-4 py-1 hover:bg-primary/10 cursor-pointer group relative border-b border-transparent hover:border-primary/20">
                               <span className="text-primary">{Number(order.price).toFixed(2)}</span>
                               <span className="text-right text-slate-500 blur-[3px] group-hover:blur-none transition-all">{vol.toFixed(1)}</span>
                               <span className="text-right text-slate-500">{(Number(order.price) * vol).toFixed(0)}</span>
                               <div className="absolute right-0 top-0 bottom-0 bg-primary/5 pointer-events-none" style={{width}}></div>
                            </div>
                        );
                     })}
                  </div>
                  </div>
               </div>
            </Card>
        </div>
    </div>
  );
};
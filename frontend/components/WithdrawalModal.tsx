import React, { useState } from 'react';
import { Modal, Button, Icon } from './UI';
import { TOKENS, TOKEN_DECIMALS } from '../lib/contracts';
import { VAULT_ABI } from '../lib/abi/valut_abi';
import { useConnection, useWaitForTransactionReceipt } from 'wagmi';
import { simulateContract, writeContract } from '@wagmi/core'
import { baseSepolia } from 'wagmi/chains';
import { parseUnits, decodeEventLog } from 'viem';
import { config } from '../lib/wagmi';
import { useSwitchChain } from 'wagmi';
import { CHAINS } from '../lib/chain-config';

import { Asset } from '../types';

interface WithdrawalModalProps {
    isOpen: boolean;
    onClose: () => void;
    assets: Asset[];
}

export const WithdrawalModal: React.FC<WithdrawalModalProps> = ({ 
    isOpen, 
    onClose,
    assets
}) => {
    const [step, setStep] = useState<'DETAILS' | 'REQUESTING' | 'PROCESSING' | 'SUCCESS'>('DETAILS');
    const [amount, setAmount] = useState("10");
    const [token, setToken] = useState<keyof typeof TOKENS>("usdc");
    const [error, setError] = useState<string | null>(null);
    const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
    const [logs, setLogs] = useState<string[]>([]);
    
    const [selectedChainId, setSelectedChainId] = useState<number>(84532); // Default Base Sepolia

    const { isConnected, address: eoaAddress, chain } = useConnection();
    const { switchChainAsync } = useSwitchChain();
    const API_URL = import.meta.env.VITE_API_URL || "https://arc.furqaannabi.com";

    // Reset state when modal opens/closes
    React.useEffect(() => {
        if (isOpen) {
            setStep('DETAILS');
            setTxHash(undefined);
            setError(null);
            setLogs([]);
        }
    }, [isOpen]);

    // Hook to wait for on-chain request receipt
    const { isLoading: isWaitingForReceipt, isSuccess: isTxSuccess, data: receipt } = useWaitForTransactionReceipt({
        hash: txHash,
    });

    const handleWithdraw = async () => {
        if (!isConnected) {
            setError("Authority Wallet (EOA) disconnected.");
            return;
        }

        setError(null);
        setLogs([]);
        
        try {
            const activeChainConfig = Object.values(CHAINS).find(c => c.chainId === selectedChainId);
            if (!activeChainConfig) throw new Error("Invalid chain config");

            const vaultAddress = activeChainConfig.vault;
            let tokenAddress = "";

            if (token.toLowerCase() === 'usdc') {
                tokenAddress = activeChainConfig.usdc;
            } else if (token.toLowerCase() === 'bond') {
                if (selectedChainId !== 84532) throw new Error("BOND is only available on Base Sepolia");
                tokenAddress = "0xa328fe09fd9f42c4cf95785b00876ba0bc82847a";
            } else {
                 throw new Error("Unsupported token");
            }

            const decimals = TOKEN_DECIMALS[token.toUpperCase()] || 18;
            const amountUnits = parseUnits(amount, decimals);
            
            // 1. REQUEST ON-CHAIN
            setStep('REQUESTING');
            console.log(`Requesting withdrawal for ${amount} ${token} on chain ${selectedChainId}...`);
            setLogs(prev => [...prev, "Initiating on-chain request..."]);

            // Check Chain
            if (chain?.id !== selectedChainId) {
                 try {
                    await switchChainAsync({ chainId: selectedChainId });
                } catch (e) {
                    throw new Error("Failed to switch network");
                }
            }


             
            const { request } = await simulateContract(config, {
                address: vaultAddress as `0x${string}`,
                abi: VAULT_ABI,
                functionName: 'requestWithdrawal',
                args: [tokenAddress, amountUnits],
                account: eoaAddress as `0x${string}`,
                chainId: selectedChainId,
            });

            const hash = await writeContract(config, request);
            setTxHash(hash);
            setLogs(prev => [...prev, "Transaction sent. Waiting for confirmation..."]);

        } catch (err: any) {
            console.error("Withdrawal request failed:", err);
            setError(err.message || "Transaction failed");
            setStep('DETAILS');
        }
    };

    // Effect to handle backend processing after on-chain success
    React.useEffect(() => {
        if (isTxSuccess && receipt && step === 'REQUESTING') {
            const processBackend = async () => {
                setStep('PROCESSING');
                setLogs(prev => [...prev, "On-chain request confirmed.", "Notifying backend settlement layer..."]);

                // Find WithdrawalId from logs
                let withdrawalId = "";
                try {
                    for (const log of receipt.logs) {
                        try {
                            const event = decodeEventLog({
                                abi: VAULT_ABI,
                                data: log.data,
                                topics: log.topics,
                            });
                            if (event.eventName === 'WithdrawalRequested') {
                                // args: [user, amount, withdrawalId, timestamp]
                                // withdrawalId is index 2, but viem returns object with named args if available
                                console.log("Found Withdrawal Event:", event.args);
                                withdrawalId = (event.args as any).withdrawalId.toString();
                                break;
                            }
                        } catch (e) { continue; } // Not our event
                    }
                } catch (e) {
                    console.error("Log parsing error:", e);
                }

                if (!withdrawalId) {
                    setError("Failed to retrieve Withdrawal ID from transaction logs.");
                    // Fallback: The backend listener *should* pick it up anyway, but we can't manually trigger api/withdraw without ID.
                    // We'll tell user to check history.
                    setLogs(prev => [...prev, "ERROR: Could not parse Withdrawal ID.", "Backend listener will handle it automatically."]);
                    setStep('SUCCESS'); // Treat as success since on-chain worked
                    return;
                }

                setLogs(prev => [...prev, `Withdrawal ID: ${withdrawalId}`]);

                // Call Backend
                try {
                    const activeChainConfig = Object.values(CHAINS).find(c => c.chainId === selectedChainId);
                    if (!activeChainConfig) throw new Error("Invalid chain config");

                    let tokenAddress = "";
                    if (token.toLowerCase() === 'usdc') {
                        tokenAddress = activeChainConfig.usdc;
                    } else if (token.toLowerCase() === 'bond') {
                        tokenAddress = "0xa328fe09fd9f42c4cf95785b00876ba0bc82847a";
                    } else { throw new Error("Unsupported token"); }
                    const decimals = TOKEN_DECIMALS[token.toUpperCase()] || 18;
                    const amountUnits = parseUnits(amount, decimals);

                    const res = await fetch(`${API_URL}/api/withdraw`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            token: tokenAddress,
                            amount: amountUnits.toString(),
                            withdrawalId: withdrawalId
                        }),
                        credentials: "include"
                    });

                    if (!res.ok) {
                       // If 409, it might mean listener already picked it up
                       if (res.status === 409) {
                           setLogs(prev => [...prev, "Backend already processing request."]);
                           setStep('SUCCESS');
                           return;
                       }
                       throw new Error("Backend handshake failed");
                    }

                    // Stream Logs
                    const reader = res.body?.getReader();
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
                                    if (data.type === 'log') setLogs(prev => [...prev, data.message]);
                                    if (data.type === 'result') {
                                        setStep('SUCCESS');
                                        setLogs(prev => [...prev, "Withdrawal Completed Successfully!"]);
                                    }
                                    if (data.type === 'error') setError(data.error);
                                } catch(e){}
                            }
                        }
                    }

                } catch (err: any) {
                    console.error("Backend process failed:", err);
                    setLogs(prev => [...prev, `Backend syncing issue: ${err.message}`, "Check History for status."]);
                    setStep('SUCCESS'); // On-chain worked, so we treat as success with warning
                }
            };
            processBackend();
        }
    }, [isTxSuccess, receipt, step, token, amount, API_URL]);

    return (
        <Modal 
            isOpen={isOpen} 
            onClose={onClose} 
            title="Withdraw Assets"
            isDismissible={step === 'DETAILS' || step === 'SUCCESS'}
        >
            <div className="space-y-6">
                {step === 'DETAILS' && (
                    <>
                        <div className="bg-yellow-500/5 border border-yellow-500/20 p-4 rounded text-xs text-yellow-500/80">
                           <p className="mb-2 uppercase font-bold text-[10px] tracking-wider">⚠ Privacy Notice</p>
                           <p>Withdrawals reveal the link between your stealth balance and your public address on-chain.</p>
                        </div>

                        <div className="space-y-4">
                            {error && (
                                <div className="bg-red-500/10 border border-red-500/20 p-3 rounded flex items-center gap-3 text-red-500 text-xs text-center justify-center">
                                    <Icon name="error" className="text-sm shrink-0" />
                                    <p>{error}</p>
                                </div>
                            )}

                            <div>
                                <label className="text-[10px] text-slate-500 uppercase tracking-widest font-mono mb-2 block">Network</label>
                                <select 
                                    className="w-full bg-black border border-border-dark text-white text-sm px-3 py-2.5 focus:ring-1 focus:ring-primary font-mono outline-none"
                                    value={selectedChainId}
                                    onChange={(e) => {
                                        const newChainId = Number(e.target.value);
                                        // Restrict BOND to Base Sepolia
                                        if (token === 'bond' && newChainId !== 84532) {
                                            setError("BOND is only available on Base Sepolia");
                                            return;
                                        }
                                        setError(null);
                                        setSelectedChainId(newChainId);
                                    }}
                                >
                                    {Object.values(CHAINS).map(c => (
                                        <option key={c.chainId} value={c.chainId}>{c.name}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="text-[10px] text-slate-500 uppercase tracking-widest font-mono mb-2 block">Asset</label>
                                <select 
                                    className="w-full bg-black border border-border-dark text-white text-sm px-3 py-2.5 focus:ring-1 focus:ring-primary font-mono outline-none"
                                    value={token}
                                    onChange={(e) => {
                                        const newToken = e.target.value as any;
                                        setToken(newToken);
                                        if (newToken === 'bond') setSelectedChainId(84532);
                                    }}
                                >
                                    {Object.keys(TOKENS).map(symbol => (
                                        <option key={symbol} value={symbol}>{symbol}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="text-[10px] text-slate-500 uppercase tracking-widest font-mono mb-2 block">Amount</label>
                                <div className="relative">
                                    <input 
                                        type="text"
                                        className="w-full bg-black border border-border-dark text-white text-sm px-3 py-2.5 focus:ring-1 focus:ring-primary font-mono pr-16 outline-none"
                                        value={amount}
                                        onChange={(e) => setAmount(e.target.value)}
                                    />
                                    <div className="absolute right-3 top-2 flex items-center gap-2">
                                        <button 
                                            onClick={() => {
                                                const asset = assets.find(a => a.symbol.toUpperCase() === token.toUpperCase());
                                                // Find balance for selected chain
                                                const activeChainConfig = Object.values(CHAINS).find(c => c.chainId === selectedChainId);
                                                const chainSelector = activeChainConfig?.chainSelector;
                                                const chainBalance = (asset?.breakdown && chainSelector) ? asset.breakdown[chainSelector] : 0;
                                                
                                                if (chainBalance) setAmount(chainBalance.toString());
                                            }}
                                            className="text-[10px] text-primary hover:text-white uppercase font-bold tracking-wider border border-primary/30 hover:bg-primary/20 px-1.5 py-0.5 rounded transition-colors"
                                        >
                                            MAX
                                        </button>
                                        <span className="text-slate-500 font-mono text-xs">{token}</span>
                                    </div>
                                </div>
                                <div className="text-right mt-1">
                                    <span className="text-[10px] text-slate-500 font-mono">
                                        Available on {Object.values(CHAINS).find(c => c.chainId === selectedChainId)?.name}: <span className="text-slate-300">{
                                            (() => {
                                                const asset = assets.find(a => a.symbol.toUpperCase() === token.toUpperCase());
                                                const activeChainConfig = Object.values(CHAINS).find(c => c.chainId === selectedChainId);
                                                const chainSelector = activeChainConfig?.chainSelector;
                                                const chainBalance = (asset?.breakdown && chainSelector) ? asset.breakdown[chainSelector] : 0;
                                                return chainBalance?.toFixed(4) || "0.00";
                                            })()
                                        }</span> {token}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="pt-2">
                            <Button fullWidth variant="destroy" icon="logout" onClick={handleWithdraw}>
                                Confirm Withdrawal
                            </Button>
                        </div>
                    </>
                )}

                {(step === 'REQUESTING' || step === 'PROCESSING') && (
                    <div className="py-6 flex flex-col items-center justify-center space-y-4 text-center">
                        <div className="w-12 h-12 border-2 border-primary border-t-transparent rounded-full animate-spin relative">
                             <div className="absolute inset-0 bg-primary/20 rounded-full animate-ping"></div>
                        </div>
                        <div>
                            <h3 className="text-white font-bold uppercase tracking-wider text-xs">
                                {step === 'REQUESTING' ? 'Requesting On-Chain...' : 'Processing Settlement...'}
                            </h3>
                            <div className="mt-4 text-left bg-black border border-border-dark p-3 rounded h-32 overflow-y-auto font-mono text-[9px] text-slate-400 space-y-1 w-full max-w-[280px]">
                                {logs.map((log, i) => (
                                    <div key={i} className="flex gap-2">
                                        <span className="text-primary">{'>'}</span> {log}
                                    </div>
                                ))}
                                <div className="animate-pulse">_</div>
                            </div>
                        </div>
                    </div>
                )}

                {step === 'SUCCESS' && (
                    <div className="py-12 flex flex-col items-center justify-center space-y-4 text-center">
                        <div className="w-16 h-16 bg-primary/20 border border-primary rounded-full flex items-center justify-center text-primary shadow-glow">
                            <Icon name="check_circle" className="text-3xl" />
                        </div>
                        <div>
                            <h3 className="text-white font-bold uppercase tracking-wider text-sm">Withdrawal Initiated</h3>
                            <p className="text-[10px] text-slate-400 mt-1 font-mono tracking-wide">Funds are being settled to your wallet.</p>
                        </div>
                        <Button variant="primary" fullWidth onClick={onClose} className="mt-4">Back to Portfolio</Button>
                    </div>
                )}
            </div>
        </Modal>
    );
};

import React, { useState } from 'react';
import { Modal, Button, Icon } from './UI';
import { VAULT_ADDRESS, TOKENS } from '../lib/contracts';
import { useConnection } from 'wagmi';

interface FundingModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const FundingModal: React.FC<FundingModalProps> = ({ 
    isOpen, 
    onClose
}) => {
    const [step, setStep] = useState<'DETAILS' | 'APPROVING' | 'FUNDING' | 'SUCCESS'>('DETAILS');
    const [amount, setAmount] = useState("1000");
    const [token, setToken] = useState<keyof typeof TOKENS>("USDC");
    const [error, setError] = useState<string | null>(null);
    const { isConnected, address: eoaAddress } = useConnection();

    const handleFund = async () => {
        if (!isConnected) {
            setError("Authority Wallet (EOA) disconnected. Please connect in your profile.");
            return;
        }

        const nullifierHash = localStorage.getItem("ssl_nullifier_hash");
        if (!nullifierHash) {
            setError("No verified identity found. Please verify with World ID first.");
            return;
        }

        setError(null);
        setStep('APPROVING');
        
        try {
            // Simulate approval (direct wallet interaction)
            console.log(`Approving ${VAULT_ADDRESS} to spend ${amount} ${token}...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            setStep('FUNDING');
            // Simulate fund(token, amount, nullifierHash)
            console.log(`Funding vault with ${amount} ${token} for nullifier ${nullifierHash}...`);
            await new Promise(resolve => setTimeout(resolve, 2500));
            
            setStep('SUCCESS');
        } catch (err: any) {
            setError(err.message || "Transaction failed");
            setStep('DETAILS');
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Deposit Confidential Assets">
            <div className="space-y-6">
                {step === 'DETAILS' && (
                    <>
                        <div className="bg-primary/5 border border-primary/20 p-4 rounded text-xs text-slate-400">
                           <p className="mb-2">Assets will be bound to your <strong>Verified World ID</strong> nullifier. This prevents identity sharing and ensures private settlement.</p>
                           <p className="text-[10px] font-mono opacity-70">FUNDING SOURCE: {eoaAddress || "DISCONNECTED"}</p>
                        </div>

                        <div className="space-y-4">
                            {error && (
                                <div className="bg-red-500/10 border border-red-500/20 p-3 rounded flex items-center gap-3 text-red-500 text-xs text-center justify-center">
                                    <Icon name="error" className="text-sm shrink-0" />
                                    <p>{error}</p>
                                </div>
                            )}

                            <div>
                                <label className="text-[10px] text-slate-500 uppercase tracking-widest font-mono mb-2 block">Asset</label>
                                <select 
                                    className="w-full bg-black border border-border-dark text-white text-sm px-3 py-2.5 focus:ring-1 focus:ring-primary font-mono outline-none"
                                    value={token}
                                    onChange={(e) => setToken(e.target.value as any)}
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
                                        className="w-full bg-black border border-border-dark text-white text-sm px-3 py-2.5 focus:ring-1 focus:ring-primary font-mono pr-12 outline-none"
                                        value={amount}
                                        onChange={(e) => setAmount(e.target.value)}
                                    />
                                    <span className="absolute right-3 top-2.5 text-slate-500 font-mono text-xs">{token}</span>
                                </div>
                            </div>
                        </div>

                        <div className="pt-2">
                            <Button fullWidth variant="primary" icon="account_balance_wallet" onClick={handleFund}>
                                Review & Deposit
                            </Button>
                        </div>
                    </>
                )}

                {(step === 'APPROVING' || step === 'FUNDING') && (
                    <div className="py-12 flex flex-col items-center justify-center space-y-4 text-center">
                        <div className="w-12 h-12 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                        <div>
                            <h3 className="text-white font-bold uppercase tracking-wider text-xs">
                                {step === 'APPROVING' ? 'Requesting Approval...' : 'Processing Deposit...'}
                            </h3>
                            <p className="text-[10px] text-slate-500 mt-1 font-mono uppercase tracking-widest">Please confirm in your wallet</p>
                        </div>
                    </div>
                )}

                {step === 'SUCCESS' && (
                    <div className="py-12 flex flex-col items-center justify-center space-y-4 text-center">
                        <div className="w-16 h-16 bg-primary/20 border border-primary rounded-full flex items-center justify-center text-primary shadow-glow">
                            <Icon name="check_circle" className="text-3xl" />
                        </div>
                        <div>
                            <h3 className="text-white font-bold uppercase tracking-wider text-sm">Deposit Successful</h3>
                            <p className="text-[10px] text-slate-400 mt-1 font-mono tracking-wide">Your assets are now shielded and ready for trading.</p>
                        </div>
                        <Button variant="primary" fullWidth onClick={onClose} className="mt-4">Back to Portfolio</Button>
                    </div>
                )}
            </div>
        </Modal>
    );
};

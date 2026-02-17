import React, { useState, useEffect } from 'react';
import { Modal, Button, Icon, useToast } from './UI';
import { 
    generateSpendingKeypair, 
    downloadKeyfile, 
    SpendingKeypair,
} from '../lib/stealth';
import { useConnection } from 'wagmi';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import WorldIdKit from './WorldIdKit';

const StealthGenerator: React.FC = () => {
    const [keys, setKeys] = useState<SpendingKeypair | null>(null);
    const [isRevealed, setIsRevealed] = useState(false);
    const { toast } = useToast();

    const handleGenerate = () => {
        const newKeys = generateSpendingKeypair();
        setKeys(newKeys);
    };

    const handleClear = () => {
        setKeys(null);
        setIsRevealed(false);
    };

    if (!keys) {
        return (
            <div className="text-center py-6">
                 <div className="w-16 h-16 mx-auto bg-primary/10 rounded-full flex items-center justify-center mb-4 border border-primary/20">
                    <Icon name="key" className="text-2xl text-primary" />
                 </div>
                 <h4 className="text-sm font-bold text-white uppercase tracking-wider mb-2">Generate Stealth Identity</h4>
                 <p className="text-[10px] text-slate-400 mb-6 font-mono max-w-[250px] mx-auto">
                    Create a disposable cryptographic keypair for confidential settlements.
                 </p>
                 <Button fullWidth variant="primary" icon="bolt" onClick={handleGenerate}>
                    Generate New Keys
                 </Button>
            </div>
        );
    }

    return (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="flex items-center gap-2 p-3 bg-red-900/10 border border-red-900/30 rounded text-red-400 text-[10px] font-mono">
                <Icon name="warning" className="text-lg" />
                <div className="flex-1">
                    <strong className="block mb-0.5 text-red-500">DO NOT REFRESH</strong>
                    These keys are ephemeral. Copy or download them now. We do not save them.
                </div>
            </div>

            <div className="space-y-2">
                <label className="text-[9px] text-slate-500 uppercase tracking-widest font-bold">Stealth Public Key (paste into orders)</label>
                <div className="p-2.5 bg-black border border-border-dark font-mono text-[10px] text-white break-all select-all flex justify-between items-center group rounded">
                    <span>{keys.publicKey}</span>
                    <Icon name="content_copy" className="text-slate-600 cursor-pointer hover:text-primary transition-colors" onClick={() => {
                        navigator.clipboard.writeText(keys.publicKey);
                        toast.success("Public Key Copied");
                    }} />
                </div>
            </div>

            <div className="space-y-2">
                <label className="text-[9px] text-slate-500 uppercase tracking-widest font-bold flex justify-between">
                    <span>Private Key (Secret)</span>
                    <span className="text-[8px] text-primary cursor-pointer hover:underline" onClick={() => setIsRevealed(!isRevealed)}>
                        {isRevealed ? "HIDE SECRET" : "REVEAL SECRET"}
                    </span>
                </label>
                <div className={`p-2.5 bg-black border border-border-dark font-mono text-[10px] break-all relative rounded overflow-hidden ${isRevealed ? 'text-red-400' : 'text-slate-700'}`}>
                     {isRevealed ? keys.privateKey : "****************************************************************"}
                     <div className="absolute top-2 right-2">
                          <Icon 
                             name="content_copy" 
                             className="text-slate-600 cursor-pointer hover:text-white transition-colors" 
                             onClick={() => {
                                 navigator.clipboard.writeText(keys.privateKey);
                                 toast.success("Private Key Copied to Clipboard");
                             }} 
                         />
                     </div>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2">
                <Button variant="secondary" icon="download" onClick={() => downloadKeyfile(keys)} className="text-[10px] border-slate-700 h-10">
                    Download Backup
                </Button>
                <Button variant="ghost" className="text-[10px] h-10 text-slate-500 hover:text-white" onClick={handleClear}>
                    Clear & Close
                </Button>
            </div>
            
            <div className="mt-4 pt-4 border-t border-border-dark space-y-3">
                <h5 className="text-[10px] font-bold text-primary uppercase tracking-widest flex items-center gap-2">
                    <Icon name="verified_user" className="text-sm" /> Setup Instructions
                </h5>
                <div className="bg-surface-lighter p-3 rounded border border-border-dark space-y-2">
                    <div className="flex gap-3 items-start">
                        <span className="w-5 h-5 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center text-[10px] font-bold border border-slate-700 shrink-0">1</span>
                        <p className="text-[10px] text-slate-400">
                            <strong className="text-white">Copy Private Key</strong> from the section above (reveal it first).
                        </p>
                    </div>
                    <div className="flex gap-3 items-start">
                        <span className="w-5 h-5 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center text-[10px] font-bold border border-slate-700 shrink-0">2</span>
                        <p className="text-[10px] text-slate-400">
                            Open your Wallet (e.g., MetaMask) and select <strong className="text-white">"Add Account"</strong> or <strong className="text-white">"Import Account"</strong>.
                        </p>
                    </div>
                    <div className="flex gap-3 items-start">
                        <span className="w-5 h-5 rounded-full bg-primary/20 text-primary flex items-center justify-center text-[10px] font-bold border border-primary/50 shrink-0 shadow-glow">3</span>
                        <p className="text-[10px] text-slate-300">
                            Paste the Private Key string. This new account acts as your <strong className="text-primary">Stealth Vault</strong> for settlements.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

import { auth } from '../lib/auth';

export const ProfileModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
    const { address: eoaAddress, isConnected } = useConnection();
    const [isHumanVerified, setIsHumanVerified] = useState(false);

    useEffect(() => {
        const checkStatus = async () => {
            // console.log("ProfileModal: Checking status...");
            const user = await auth.getMe();
            // console.log("ProfileModal: User status:", user);
            if (user) {
                setIsHumanVerified(user.isVerified);
                // console.log("ProfileModal: Set verified to", user.isVerified);
            }
        };

        if (isOpen) checkStatus();

        const handleVerificationUpdate = () => {
            //  console.log("ProfileModal: Received update event. Optimistically verifying...");
             setIsHumanVerified(true); // Optimistic Update
             
             // Add a small delay to ensure DB write is propagated for the background check
             setTimeout(checkStatus, 1000); 
        };
        // Also update immediately on mount in case it changed elsewhere
        

        window.addEventListener("world-id-updated", handleVerificationUpdate);
        return () => window.removeEventListener("world-id-updated", handleVerificationUpdate);
    }, [isOpen]); // Also re-check when modal opens

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Identity & Access">
            {/* EOA Connection Section (Authority) */}
            <div className="mb-8 p-4 bg-primary/5 border border-primary/20 rounded relative overflow-hidden">
                <div className="absolute top-0 right-0 p-3 opacity-10">
                    <Icon name="account_balance_wallet" className="text-3xl text-primary" />
                </div>
                <h4 className="text-[10px] font-bold text-primary uppercase tracking-widest mb-4 flex items-center gap-2">
                    <Icon name="verified" className="text-xs" /> Authority Wallet (EOA)
                </h4>
                
                <div className="flex flex-col items-center">
                    <div className="mb-4">
                        <ConnectButton 
                          accountStatus="address"
                          chainStatus="icon"
                          showBalance={false}
                        />
                    </div>
                    {isConnected && (
                        <div className="w-full space-y-2">
                            <div className="flex justify-between items-center text-[10px] font-mono">
                                <span className="text-slate-500">Address Origin</span>
                                <span className="text-slate-300">METAMASK / BROWSER</span>
                            </div>
                            <div className="flex justify-between items-center text-[10px] font-mono">
                                <span className="text-slate-500">Identity Rights</span>
                                <span className="text-primary">FULL AUTHENTICATION</span>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Human Verification Section */}
            <div className="mb-8 p-4 bg-blue-900/5 border border-blue-900/20 rounded relative overflow-hidden">
                <div className="absolute top-0 right-0 p-3 opacity-10">
                    <Icon name="fingerprint" className="text-3xl text-blue-400" />
                </div>
                <h4 className="text-[10px] font-bold text-blue-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                    <Icon name="face" className="text-xs" /> Human Verification
                </h4>
                <div className="flex flex-col items-center gap-4">
                    <div className="text-center">
                        {isHumanVerified ? (
                            <div className="flex flex-col items-center text-blue-400">
                                <Icon name="verified" className="text-2xl mb-1" />
                                <span className="text-xs font-mono font-bold">VERIFIED HUMAN</span>
                                <span className="text-[9px] text-slate-500">Credential via World ID</span>
                            </div>
                        ) : (
                            <p className="text-[10px] text-slate-400 mb-2 max-w-[200px]">
                                Verify your unique personhood to access compliant pools.
                            </p>
                        )}
                    </div>
                     {!isHumanVerified && (
                        <div className="w-full max-w-[200px]">
                            <WorldIdKit />
                        </div>
                     )}
                </div>
            </div>

            <div className="h-px bg-border-dark w-full mb-8"></div>

            {/* Stateless Generator Section */}
            <div className="mb-4">
                <StealthGenerator />
            </div>

        </Modal>
    );
};
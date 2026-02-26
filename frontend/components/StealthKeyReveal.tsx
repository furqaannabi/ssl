import React, { useState } from 'react';
import { Modal, Button, Icon } from './UI';

interface StealthKeyRevealProps {
    isOpen: boolean;
    onClose: () => void;
    title?: string;
    description?: string;
    privateKey: string;
    address: string;
}

export const StealthKeyReveal: React.FC<StealthKeyRevealProps> = ({ 
    isOpen, 
    onClose, 
    title = "Reveal Shield Key",
    description = "This private key controls the funds at the shield address below. Importing it into a wallet like MetaMask will give you full control.",
    privateKey,
    address
}) => {
    const [isRevealed, setIsRevealed] = useState(false);
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        navigator.clipboard.writeText(privateKey);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={title}>
            <div className="space-y-6">
                <div className="bg-yellow-900/10 border border-yellow-900/30 p-4 rounded text-yellow-500 text-xs flex gap-3">
                    <Icon name="warning" className="text-lg shrink-0" />
                    <p>{description}</p>
                </div>

                <div>
                    <label className="text-[10px] text-slate-500 uppercase tracking-widest font-mono mb-2 block">Shield Address</label>
                    <div className="bg-black border border-border-dark p-3 rounded font-mono text-xs text-white break-all flex justify-between items-center group">
                        {address}
                        <button onClick={() => navigator.clipboard.writeText(address)} className="text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                            <Icon name="content_copy" className="text-sm" />
                        </button>
                    </div>
                </div>

                <div>
                    <label className="text-[10px] text-slate-500 uppercase tracking-widest font-mono mb-2 block">Private Key</label>
                    <div className="relative">
                        <div className={`bg-black border border-border-dark p-3 rounded font-mono text-xs break-all h-20 flex items-center justify-center text-center transition-all ${isRevealed ? 'text-red-400 border-red-900/50' : 'text-slate-700 blur-sm select-none'}`}>
                            {isRevealed ? privateKey : "••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••••"}
                        </div>
                        
                        {!isRevealed && (
                            <div className="absolute inset-0 flex items-center justify-center">
                                <Button variant="secondary" icon="visibility" onClick={() => setIsRevealed(true)} className="text-[10px] bg-surface-dark border-border-dark py-1">
                                    Reveal Secret
                                </Button>
                            </div>
                        )}
                    </div>
                </div>

                <div className="pt-2 flex gap-3">
                    <Button 
                        fullWidth 
                        variant={copied ? "secondary" : "primary"} 
                        icon={copied ? "check" : "content_copy"}
                        onClick={handleCopy}
                        disabled={!isRevealed}
                    >
                        {copied ? "Copied to Clipboard" : "Copy Private Key"}
                    </Button>
                    <Button variant="ghost" className="px-6" onClick={onClose}>Close</Button>
                </div>

                <div className="space-y-2 mt-4 pt-4 border-t border-border-dark">
                    <h5 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">How to use:</h5>
                    <ol className="text-[10px] text-slate-400 space-y-1 list-decimal ml-4">
                        <li>Copy the private key above.</li>
                        <li>Open MetaMask or any EVM wallet.</li>
                        <li>Select "Import Account".</li>
                        <li>Paste the private key and submit.</li>
                    </ol>
                </div>
            </div>
        </Modal>
    );
};

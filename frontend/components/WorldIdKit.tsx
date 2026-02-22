/// <reference types="vite/client" />
import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import {
  IDKitWidget,
  VerificationLevel,
  ISuccessResult,
} from "@worldcoin/idkit";
import { Button, useToast } from "./UI";
import { useConnection, useSignMessage } from "wagmi";

interface WorldIdKitProps {
  onSuccess?: (result: ISuccessResult) => void;
  action?: string;
  app_id?: string;
  signal?: string;
}

const WorldIdKit: React.FC<WorldIdKitProps> = ({
  onSuccess: externalOnSuccess,
  action = import.meta.env.VITE_WORLD_ID_ACTION,
  app_id = import.meta.env.VITE_WORLD_ID_APP_ID,
  signal
}) => {
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const logsEndRef = React.useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const { address } = useConnection();
  const { mutateAsync: signMessageAsync } = useSignMessage();

  React.useEffect(() => {
      if (logsEndRef.current) {
          logsEndRef.current.scrollIntoView({ behavior: "smooth" });
      }
  }, [logs]);

  // Validate configuration
  if (!app_id || !action) {
    return (
      <div className="p-4 border border-red-900/50 bg-red-900/10 rounded text-red-500 text-sm">
        <strong>Config Error:</strong> World ID APP_ID or ACTION is missing.
      </div>
    );
  }

  const handleVerify = async (proof: ISuccessResult) => {
    setIsVerifying(true);
    setError(null);
    
    if (!address) {
       setError("Please connect your wallet first.");
       setIsVerifying(false);
       throw new Error("Please connect your wallet first.");
    }
    
    try {
      const API_URL = ""; // Use proxy
      
      // Step 1: Submit Proof & Stream Verification
      const res = await fetch(`${API_URL}/api/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...proof,
          user_address: address,
        }),
        credentials: 'include'
      });
      
      if (!res.ok) {
         const errorData = await res.json().catch(() => ({}));
         
         // Handle duplicate verification case
         if (res.status === 500 && errorData.detail && errorData.detail.includes("Unique constraint failed")) {
             toast.success("Welcome back! You are already verified.");
             window.dispatchEvent(new Event("world-id-updated"));
             
             // Store nullifier hash
             if (proof.nullifier_hash) {
                 localStorage.setItem("ssl_nullifier_hash", proof.nullifier_hash);
             }
             
             setIsVerifying(false);
             
             // Call external handler through onSuccess callback (IDKitWidget will call it)
             return; // Success - widget will call onSuccess then close
        }
        
        throw new Error(errorData.error || "Verification failed");
      }

      // Read SSE Stream
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      if (reader) {
          while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              
              const chunk = decoder.decode(value, { stream: true });
              buffer += chunk;
              
              const lines = buffer.split("\n");
              buffer = lines.pop() || ""; // Keep incomplete line
              
              for (const line of lines) {
                  const trimmed = line.trim();
                  if (!trimmed) continue;
                  
                  try {
                      const data = JSON.parse(trimmed);

                      if (data.type === "log") {
                          // Clean ANSI codes for display
                          const cleanMsg = data.message.replace(/\u001b\[\d+m/g, '').replace(/\u001b\[\d+;\d+m/g, '');
                          setLogs(prev => [...prev, cleanMsg]);
                          console.log("[STREAM LOG]:", cleanMsg);
                      }
                      
                      // SUCCESS CASE:
                      if (data.type === "result" && data.success) {
                          if (proof.nullifier_hash) {
                              localStorage.setItem("ssl_nullifier_hash", proof.nullifier_hash);
                          }

                          console.log("✅ Verification successful!");
                          toast.success("Human Verified successfully");
                          window.dispatchEvent(new Event("world-id-updated"));

                          return;
                      }
                      
                      // ERROR CASE:
                      if (data.type === "error") {
                          throw new Error(data.error || "Verification stream error");
                      }
                  } catch (e: any) {
                      // Only log parse errors, don't throw
                      if (!e.message?.includes("Verification stream")) {
                          console.warn("Stream parse warning:", e.message);
                      } else {
                          throw e; // Re-throw verification errors
                      }
                  }
              }
          }
      }

      // Check final buffer for any remaining data
      if (buffer.trim()) {
           try {
              const data = JSON.parse(buffer);
              if (data.type === "result" && data.success) {
                  if (proof.nullifier_hash) {
                      localStorage.setItem("ssl_nullifier_hash", proof.nullifier_hash);
                  }
                  
                  toast.dismiss("verify-log");
                  toast.success("Human Verified successfully");
                  window.dispatchEvent(new Event("world-id-updated"));
                  
                  return; // Success
              }
           } catch(e) {
               console.warn("Final buffer parse error:", e);
           }
      }

      // If we reach here, verification didn't complete successfully
      throw new Error("Verification ended without confirmation.");

    } catch (err: any) {
      console.error("❌ World ID verification error:", err);
      setError(err.message || "An unexpected error occurred.");
      toast.error(err.message || "Verification failed");
      throw err; // Re-throw to signal failure to IDKitWidget
    } finally {
      setIsVerifying(false);
    }
  };

  // This gets called by IDKitWidget AFTER handleVerify resolves successfully
  const onSuccess = (result: ISuccessResult) => {
    console.log("🎉 onSuccess callback triggered");
    
    if (externalOnSuccess) {
      externalOnSuccess(result);
    }
    
    // Reload page to ensure fresh state from backend
    setTimeout(() => {
        window.location.reload();
    }, 1500);
  };

  return (
    <div className="space-y-4">
      <IDKitWidget
        app_id={app_id}
        action={action}
        onSuccess={onSuccess}
        handleVerify={handleVerify}
        verification_level={VerificationLevel.Orb}
      >
        {({ open }) => (
          <Button 
            onClick={() => { setLogs([]); open(); }} 
            variant="primary" 
            icon={isVerifying ? undefined : "verified_user"}
            disabled={isVerifying}
            className="w-full"
            id="world-id-verify-btn"
          >
            {isVerifying ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin"></span>
                Verifying...
              </span>
            ) : "Verify with World ID"}
          </Button>
        )}
      </IDKitWidget>
      
      {/* Visual Log Terminal (HUD Mode) - Portalled to Body to escape Modal Stacking Context */}
      {(isVerifying || logs.length > 0) && createPortal(
          <div className="fixed bottom-10 left-1/2 -translate-x-1/2 w-[90%] max-w-[400px] z-[2147483647] pointer-events-none font-sans">
              <div className="bg-black/90 backdrop-blur-md rounded-lg border border-green-500/50 p-4 shadow-[0_0_50px_rgba(16,185,129,0.4)]">
                  {/* Header/Status */}
                  <div className="flex justify-between items-center mb-2 border-b border-green-500/30 pb-1">
                      <span className="text-[10px] text-green-400 font-bold tracking-[0.2em] animate-pulse">
                          {isVerifying ? "ESTABLISHING_SECURE_LINK..." : "TRANSMISSION_COMPLETE"}
                      </span>
                      <span className="text-[8px] text-green-700">NET.SEC.V1</span>
                  </div>

                  {/* Log Stream */}
                  <div 
                      className="font-mono text-[10px] space-y-1 relative max-h-[120px] overflow-hidden"
                      style={{ 
                          maskImage: 'linear-gradient(to bottom, transparent, black 10%)',
                          WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 10%)' 
                      }}
                  >
                      {logs.slice(-4).map((log, i) => (
                          <div key={i} className="text-green-500 break-words leading-tight animate-in slide-in-from-bottom-2 fade-in duration-300">
                              <span className="opacity-40 mr-2">➜</span>
                              <span className="text-green-400 shadow-green-glow" dangerouslySetInnerHTML={{ __html: log.replace(/\n/g, '<br/>') }} />
                          </div>
                      ))}
                      {isVerifying && (
                          <div className="text-green-500 animate-pulse font-bold mt-1">
                              _ <span className="sr-only">cursor</span>
                          </div>
                      )}
                  </div>
              </div>
          </div>,
          document.body
      )}

      {error && (
        <p className="text-xs text-red-500 bg-red-500/10 p-2 rounded border border-red-500/20 text-center">
          {error}
        </p>
      )}
    </div>
  );
};

export default WorldIdKit;
/// <reference types="vite/client" />
import React, { useState } from 'react';
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
  const { toast } = useToast();
  const { address } = useConnection();

  // Validate configuration
  if (!app_id || !action) {
    return (
      <div className="p-4 border border-red-900/50 bg-red-900/10 rounded text-red-500 text-sm">
        <strong>Config Error:</strong> World ID APP_ID or ACTION is missing.
      </div>
    );
  }

  const { mutateAsync: signMessageAsync } = useSignMessage();

  const handleVerify = async (proof: ISuccessResult) => {
    setIsVerifying(true);
    setError(null);
    
    if (!address) {
       setError("Please connect your wallet first.");
       setIsVerifying(false);
       return;
    }
    
    try {
      const API_URL = ""; // Use proxy
      
      // Step 1: Submit Proof & Get Challenge
      const initRes = await fetch(`${API_URL}/api/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...proof,
          credential_type: proof.verification_level, // Backend requires this field
          action,
          signal: signal || "", 
          user_address: address, // Required by backend
        }),
         credentials: 'include'
      });
      
      if (!initRes.ok) {
        const errorData = await initRes.json().catch(() => ({}));
        throw new Error(errorData.error || "Verification init failed on backend.");
      }
      
      const { requestId, messageToSign } = await initRes.json();
      
      // Step 2: Sign the Challenge
      const signature = await signMessageAsync({
          message: messageToSign,
          account: address,
      });

      // Step 3: Confirm with Signature
      const confirmRes = await fetch(`${API_URL}/api/verify/${requestId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signature }),
      });

      if (!confirmRes.ok) {
        const errorData = await confirmRes.json().catch(() => ({}));
        throw new Error(errorData.error || "Verification confirmation failed.");
      }

      // Store nullifier hash for valid session
      if (proof.nullifier_hash) {
          localStorage.setItem("ssl_nullifier_hash", proof.nullifier_hash);
      }
    } catch (err: any) {
      console.error("World ID verification error:", err);
      setError(err.message || "An unexpected error occurred during verification.");
      throw err; // IDKit handles the error UI if we throw
    } finally {
      setIsVerifying(false);
    }
  };

  const onSuccess = (result: ISuccessResult) => {
    if (externalOnSuccess) {
      externalOnSuccess(result);
    } else {
      // Default behavior: Show success and dispatch event to update UI state
      toast.success("Human Verified successfully");
      window.dispatchEvent(new Event("world-id-updated"));
    }
  };

  return (
    <div className="space-y-4">
      <IDKitWidget
        app_id={app_id}
        action={action}
        onSuccess={onSuccess}
        handleVerify={handleVerify}
        verification_level={VerificationLevel.Device}
      >
        {({ open }) => (
          <Button 
            onClick={open} 
            variant="primary" 
            icon={isVerifying ? undefined : "verified_user"}
            disabled={isVerifying}
            className="w-full"
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
      
      {error && (
        <p className="text-xs text-red-500 bg-red-500/10 p-2 rounded border border-red-500/20 text-center">
          {error}
        </p>
      )}
    </div>
  );
};

export default WorldIdKit;
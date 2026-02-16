/// <reference types="vite/client" />
import React, { useState } from 'react';
import {
  IDKitWidget,
  VerificationLevel,
  ISuccessResult,
} from "@worldcoin/idkit";
import { Button } from "./UI";
import { useConnection } from "wagmi";

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
  const { address } = useConnection();

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
    
    try {
      const API_URL = import.meta.env.VITE_API_URL || "https://arc.furqaannabi.com";
      const res = await fetch(`${API_URL}/api/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...proof,
          action,
          signal: signal || "", // Signal can be empty if not used, but usually required by backends
        }),
      });
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || "Verification failed on backend.");
      }

      // Store nullifier hash for future funding/actions
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
      // Default behavior if no callback provided
      window.location.href = "/success";
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
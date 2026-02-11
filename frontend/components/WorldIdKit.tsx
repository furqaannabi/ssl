/// <reference types="vite/client" />
import React from 'react';
import {
  IDKitWidget,
  VerificationLevel,
  ISuccessResult,
} from "@worldcoin/idkit";
import { Button } from "./UI";

interface WorldIdKitProps {
  onSuccess?: (result: ISuccessResult) => void;
  action?: string;
  app_id?: string;
}

const WorldIdKit: React.FC<WorldIdKitProps> = ({ 
  onSuccess: externalOnSuccess,
  action = import.meta.env.VITE_WORLD_ID_ACTION,
  app_id = import.meta.env.VITE_WORLD_ID_APP_ID
}) => {
  const handleVerify = async (proof: ISuccessResult) => {
    const res = await fetch("/api/verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(proof),
    });
    
    if (!res.ok) {
      throw new Error("Verification failed.");
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
          icon="verified_user"
          className="w-full"
        >
          Verify with World ID
        </Button>
      )}
    </IDKitWidget>
  );
};

export default WorldIdKit;
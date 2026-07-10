import { useState, useEffect } from "react";
import { dnaEngine } from "../lib/dna-engine/DNAEngine";
import { UserDNAProfile } from "../lib/dna-engine/types";

export function useDNAProfile() {
  const [profile, setProfile] = useState<UserDNAProfile | null>(null);

  useEffect(() => {
    // Initial fetch
    try {
      const p = dnaEngine.getProfile();
      setProfile(p);
    } catch (e) {
      // Not initialized yet, wait for it
      dnaEngine.initialize().then(() => {
        setProfile(dnaEngine.getProfile());
      });
    }

    // In a real implementation, we'd listen to an event bus for profile changes
    // setInterval or event bus here. For simplicity:
    const interval = setInterval(() => {
      try {
        setProfile({ ...dnaEngine.getProfile() });
      } catch (e) {}
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  return profile;
}

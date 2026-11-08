import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAppWallet } from '../wallet/AppWalletContext';
import {
  EMPTY_PROFILE,
  fetchPublicProfiles,
  loadOwnProfile,
  loadProfileDirectory,
  publishOwnProfile,
  rememberProfile,
  rememberProfiles,
  saveOwnProfile,
  type UserProfile,
} from '../services/userProfile';

interface ProfileValue {
  profile: UserProfile;
  directory: Record<string, UserProfile>;
  walletAddress: string;
  saveProfile: (next: UserProfile) => Promise<UserProfile>;
  lookup: (wallet?: string) => UserProfile | undefined;
  refreshDirectory: (wallets: string[]) => Promise<void>;
  ingestProfile: (wallet: string, next: UserProfile) => Promise<void>;
}

const ProfileContext = createContext<ProfileValue | null>(null);

export const ProfileProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { address } = useAppWallet();
  const walletAddress = address || '';
  const [profile, setProfile] = useState<UserProfile>(EMPTY_PROFILE);
  const [directory, setDirectory] = useState<Record<string, UserProfile>>({});

  useEffect(() => {
    loadOwnProfile(walletAddress || undefined)
      .then(async (stored) => {
        let next = stored;
        if (walletAddress) {
          const remote = await fetchPublicProfiles([walletAddress]).catch(
            () => ({}) as Record<string, UserProfile>
          );
          const found = remote[walletAddress.toLowerCase()];
          if (found) {
            next = {
              ...next,
              displayName: next.publicFace
                ? next.displayName
                : found.displayName || next.displayName,
              publicPhoto: next.publicFace
                ? next.publicPhoto
                : found.publicPhoto || next.publicPhoto,
              avatarId: next.publicFace ? next.avatarId : found.avatarId,
              publicFace: next.publicFace || found.publicFace || Boolean(found.displayName),
            };
            if (next.publicFace && !stored.publicFace) {
              await saveOwnProfile(next, walletAddress).catch(() => {});
            }
          }
        }
        setProfile(next);
      })
      .catch(() => {});
    loadProfileDirectory()
      .then(setDirectory)
      .catch(() => {});
  }, [walletAddress]);

  useEffect(() => {
    if (!walletAddress || !profile.displayName) return;
    rememberProfile(walletAddress, profile)
      .then(setDirectory)
      .catch(() => {});
  }, [walletAddress, profile]);

  const saveProfile = useCallback(
    async (next: UserProfile) => {
      const stored = await saveOwnProfile(next, walletAddress || undefined);
      setProfile(stored);
      if (walletAddress) {
        const updated = await rememberProfile(walletAddress, stored);
        if (updated) setDirectory(updated);
        await publishOwnProfile(walletAddress, stored);
      }
      return stored;
    },
    [walletAddress]
  );

  const lookup = useCallback(
    (wallet?: string) => {
      if (!wallet) return undefined;
      const key = wallet.toLowerCase();
      if (walletAddress && key === walletAddress.toLowerCase()) return profile;
      return directory[key];
    },
    [directory, profile, walletAddress]
  );

  const refreshDirectory = useCallback(async (wallets: string[]) => {
    const remote = await fetchPublicProfiles(wallets);
    if (Object.keys(remote).length === 0) return;
    const next = await rememberProfiles(remote);
    setDirectory(next);
  }, []);

  const ingestProfile = useCallback(async (wallet: string, next: UserProfile) => {
    const updated = await rememberProfile(wallet, next);
    setDirectory(updated);
  }, []);

  const value = useMemo(
    () => ({
      profile,
      directory,
      walletAddress,
      saveProfile,
      lookup,
      refreshDirectory,
      ingestProfile,
    }),
    [profile, directory, walletAddress, saveProfile, lookup, refreshDirectory, ingestProfile]
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
};

export const useUserProfile = (): ProfileValue => {
  const ctx = useContext(ProfileContext);
  if (!ctx) {
    throw new Error('useUserProfile must be used inside ProfileProvider');
  }
  return ctx;
};

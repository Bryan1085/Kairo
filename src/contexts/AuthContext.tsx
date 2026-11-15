import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { auth, db, googleProvider, handleFirestoreError, OperationType } from '../lib/firebase';
import type { UserProfile } from '../types';
import { clampString } from '../lib/utils';

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  authReady: boolean;
  profileReady: boolean;
  signingIn: boolean;
  authError: string | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  updatePreferences: (patch: {
    displayName?: string;
    defaultReminderMinutes?: number;
    alarmSoundEnabled?: boolean;
    whatsappAutoSendEnabled?: boolean;
  }) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profileReady, setProfileReady] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setAuthReady(true);
      if (!firebaseUser) {
        setProfile(null);
        setProfileReady(true);
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!authReady || !user) return;

    const userPath = `users/${user.uid}`;
    const userRef = doc(db, 'users', user.uid);
    let cancelled = false;
    let unsubSnapshot: (() => void) | null = null;

    async function initAndListenProfile(currentUser: User) {
      setProfileReady(false);
      try {
        const snap = await getDoc(userRef);
        if (!snap.exists()) {
          const email = clampString(currentUser.email || 'usuario@kairo.app', 254);
          const fallbackName = email.split('@')[0] || 'Usuario';
          const displayName = clampString(currentUser.displayName || fallbackName, 120) || 'Usuario';
          await setDoc(userRef, {
            uid: currentUser.uid,
            email,
            displayName,
            defaultReminderMinutes: 15,
            alarmSoundEnabled: true,
            whatsappAutoSendEnabled: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, userPath);
      }

      if (cancelled) return;

      unsubSnapshot = onSnapshot(
        userRef,
        (docSnap) => {
          if (docSnap.exists()) {
            setProfile(docSnap.data() as UserProfile);
          }
          setProfileReady(true);
        },
        (error) => {
          handleFirestoreError(error, OperationType.GET, userPath);
        }
      );
    }

    void initAndListenProfile(user);

    return () => {
      cancelled = true;
      if (unsubSnapshot) unsubSnapshot();
    };
  }, [authReady, user]);

  const signInWithGoogle = async () => {
    setSigningIn(true);
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo iniciar sesión con Google.';
      setAuthError(msg);
    } finally {
      setSigningIn(false);
    }
  };

  const signOut = async () => {
    await firebaseSignOut(auth);
  };

  const updatePreferences = async (patch: {
    displayName?: string;
    defaultReminderMinutes?: number;
    alarmSoundEnabled?: boolean;
    whatsappAutoSendEnabled?: boolean;
  }) => {
    if (!user) return;
    const path = `users/${user.uid}`;
    const payload: Record<string, unknown> = {
      updatedAt: serverTimestamp(),
    };
    if (patch.displayName !== undefined) {
      payload.displayName = clampString(patch.displayName, 120) || 'Usuario';
    }
    if (patch.defaultReminderMinutes !== undefined) {
      payload.defaultReminderMinutes = Math.min(1440, Math.max(0, Math.round(patch.defaultReminderMinutes)));
    }
    if (patch.alarmSoundEnabled !== undefined) {
      payload.alarmSoundEnabled = Boolean(patch.alarmSoundEnabled);
    }
    if (patch.whatsappAutoSendEnabled !== undefined) {
      payload.whatsappAutoSendEnabled = Boolean(patch.whatsappAutoSendEnabled);
    }
    try {
      await updateDoc(doc(db, 'users', user.uid), payload);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        authReady,
        profileReady,
        signingIn,
        authError,
        signInWithGoogle,
        signOut,
        updatePreferences,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
}

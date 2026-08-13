import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';
import type { Role } from '@/types';

export interface AuthProfile {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  jobTitle: string;
  employeeId: string;
  officeId: string;
  role: Role;
}

export interface NotificationPrefs {
  email: boolean;
  quoteReviewReminders: boolean;
  pendingQuotationAlerts: boolean;
  revisionRequests: boolean;
  poMismatchAlerts: boolean;
  inboxAssignment: boolean;
}

export interface AccountSettings {
  language: string;
  timezone: string;
  dateFormat: string;
  currencyFormat: string;
  notifications: NotificationPrefs;
}

// Demo credentials (prototype only — no real backend).
export const DEMO_EMAIL = 'aarav.mehta@nexustrade.in';
export const DEMO_PASSWORD = 'demo123';

const DEFAULT_PROFILE: AuthProfile = {
  id: 'usr-001',
  fullName: 'Aarav Mehta',
  email: 'aarav.mehta@nexustrade.in',
  phone: '+91 98200 41122',
  jobTitle: 'Head of Inside Sales',
  employeeId: 'NX-0001',
  officeId: 'off-mum',
  role: 'super_admin',
};

const DEFAULT_SETTINGS: AccountSettings = {
  language: 'English (India)',
  timezone: 'Asia/Kolkata (IST, GMT+5:30)',
  dateFormat: 'DD MMM YYYY',
  currencyFormat: 'INR (₹) — Indian numbering',
  notifications: {
    email: true,
    quoteReviewReminders: true,
    pendingQuotationAlerts: true,
    revisionRequests: true,
    poMismatchAlerts: true,
    inboxAssignment: true,
  },
};

const STORAGE_KEY = 'nexus-rfq-auth';

interface StoredSession {
  profile: AuthProfile;
  settings: AccountSettings;
}

function readStored(): { data: StoredSession; remember: boolean } | null {
  try {
    const local = window.localStorage.getItem(STORAGE_KEY);
    if (local) return { data: JSON.parse(local) as StoredSession, remember: true };
    const session = window.sessionStorage.getItem(STORAGE_KEY);
    if (session) return { data: JSON.parse(session) as StoredSession, remember: false };
  } catch {
    /* ignore malformed storage */
  }
  return null;
}

function writeStored(data: StoredSession, remember: boolean) {
  const str = JSON.stringify(data);
  try {
    if (remember) {
      window.localStorage.setItem(STORAGE_KEY, str);
      window.sessionStorage.removeItem(STORAGE_KEY);
    } else {
      window.sessionStorage.setItem(STORAGE_KEY, str);
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* storage may be unavailable */
  }
}

function clearStored() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

interface AuthState {
  isAuthenticated: boolean;
  profile: AuthProfile;
  settings: AccountSettings;
  login: (email: string, password: string, remember: boolean) => boolean;
  logout: () => void;
  updateProfile: (patch: Partial<AuthProfile>) => void;
  updateSettings: (patch: Partial<AccountSettings>) => void;
  updateNotifications: (patch: Partial<NotificationPrefs>) => void;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Hydrate synchronously so a protected-page refresh never flashes blank/login.
  const initial = readStored();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(!!initial);
  const [remember, setRemember] = useState<boolean>(initial?.remember ?? false);
  const [profile, setProfile] = useState<AuthProfile>(initial?.data.profile ?? DEFAULT_PROFILE);
  const [settings, setSettings] = useState<AccountSettings>(initial?.data.settings ?? DEFAULT_SETTINGS);

  const login = useCallback((email: string, password: string, rememberMe: boolean) => {
    if (email.trim().toLowerCase() !== DEMO_EMAIL || password !== DEMO_PASSWORD) return false;
    const freshProfile = DEFAULT_PROFILE;
    const freshSettings = DEFAULT_SETTINGS;
    setProfile(freshProfile);
    setSettings(freshSettings);
    setRemember(rememberMe);
    setIsAuthenticated(true);
    writeStored({ profile: freshProfile, settings: freshSettings }, rememberMe);
    return true;
  }, []);

  const logout = useCallback(() => {
    setIsAuthenticated(false);
    clearStored();
  }, []);

  const updateProfile = useCallback(
    (patch: Partial<AuthProfile>) => {
      setProfile((prev) => {
        const next = { ...prev, ...patch };
        setSettings((s) => {
          writeStored({ profile: next, settings: s }, remember);
          return s;
        });
        return next;
      });
    },
    [remember]
  );

  const updateSettings = useCallback(
    (patch: Partial<AccountSettings>) => {
      setSettings((prev) => {
        const next = { ...prev, ...patch };
        setProfile((p) => {
          writeStored({ profile: p, settings: next }, remember);
          return p;
        });
        return next;
      });
    },
    [remember]
  );

  const updateNotifications = useCallback(
    (patch: Partial<NotificationPrefs>) => {
      setSettings((prev) => {
        const next = { ...prev, notifications: { ...prev.notifications, ...patch } };
        setProfile((p) => {
          writeStored({ profile: p, settings: next }, remember);
          return p;
        });
        return next;
      });
    },
    [remember]
  );

  const value: AuthState = {
    isAuthenticated,
    profile,
    settings,
    login,
    logout,
    updateProfile,
    updateSettings,
    updateNotifications,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

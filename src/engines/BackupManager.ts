/**
 * BackupManager — نسخ احتياطي تلقائي وسجل كامل للتعديلات
 * كل تعديل يُسجل مع إمكانية الاسترجاع
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export interface BackupVersion {
  id:           string;
  timestamp:    string;
  functionName: string;
  description:  string;
  before:       string;
  after:        string;
  approved:     boolean;
  safetyScore:  number;
}

export interface BackupSession {
  sessionId:    string;
  createdAt:    string;
  fileName:     string;
  originalCode: string;
  versions:     BackupVersion[];
  currentCode:  string;
}

const STORAGE_KEY_SESSIONS = 'reality_backup_sessions';
const MAX_SESSIONS = 20;
const MAX_VERSIONS_PER_SESSION = 50;

// ===== Session Management =====
async function loadSessions(): Promise<BackupSession[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY_SESSIONS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function saveSessions(sessions: BackupSession[]): Promise<void> {
  try {
    // Keep last MAX_SESSIONS
    const trimmed = sessions.slice(-MAX_SESSIONS);
    await AsyncStorage.setItem(STORAGE_KEY_SESSIONS, JSON.stringify(trimmed));
  } catch {
    // Silently fail — backup is best-effort
  }
}

// ===== Create new session =====
export async function createSession(fileName: string, originalCode: string): Promise<BackupSession> {
  const session: BackupSession = {
    sessionId:    `session_${Date.now()}`,
    createdAt:    new Date().toISOString(),
    fileName:     fileName || 'untitled.py',
    originalCode,
    versions:     [],
    currentCode:  originalCode,
  };

  const sessions = await loadSessions();
  sessions.push(session);
  await saveSessions(sessions);

  return session;
}

// ===== Record a version (before applying change) =====
export async function recordVersion(
  sessionId:    string,
  functionName: string,
  description:  string,
  before:       string,
  after:        string,
  approved:     boolean,
  safetyScore:  number,
): Promise<BackupVersion | null> {
  try {
    const sessions = await loadSessions();
    const idx      = sessions.findIndex(s => s.sessionId === sessionId);
    if (idx === -1) return null;

    const version: BackupVersion = {
      id:           `v_${Date.now()}`,
      timestamp:    new Date().toISOString(),
      functionName,
      description,
      before,
      after,
      approved,
      safetyScore,
    };

    sessions[idx].versions.push(version);
    // Keep last MAX_VERSIONS_PER_SESSION
    if (sessions[idx].versions.length > MAX_VERSIONS_PER_SESSION) {
      sessions[idx].versions = sessions[idx].versions.slice(-MAX_VERSIONS_PER_SESSION);
    }

    if (approved) {
      sessions[idx].currentCode = after;
    }

    await saveSessions(sessions);
    return version;
  } catch {
    return null;
  }
}

// ===== Get all sessions =====
export async function getAllSessions(): Promise<BackupSession[]> {
  const sessions = await loadSessions();
  return sessions.reverse(); // Most recent first
}

// ===== Get a specific session =====
export async function getSession(sessionId: string): Promise<BackupSession | null> {
  const sessions = await loadSessions();
  return sessions.find(s => s.sessionId === sessionId) ?? null;
}

// ===== Restore to a specific version =====
export async function restoreToVersion(
  sessionId:  string,
  versionId:  string,
): Promise<string | null> {
  try {
    const sessions = await loadSessions();
    const session  = sessions.find(s => s.sessionId === sessionId);
    if (!session) return null;

    const vIdx = session.versions.findIndex(v => v.id === versionId);
    if (vIdx === -1) return null;

    // Restore means going back to "before" state of that version
    const restoredCode = session.versions[vIdx].before;
    session.currentCode = restoredCode;

    // Add a recovery record
    session.versions.push({
      id:           `v_restore_${Date.now()}`,
      timestamp:    new Date().toISOString(),
      functionName: '__restore__',
      description:  `استرجاع إلى الإصدار ${versionId}`,
      before:       session.currentCode,
      after:        restoredCode,
      approved:     true,
      safetyScore:  100,
    });

    await saveSessions(sessions);
    return restoredCode;
  } catch {
    return null;
  }
}

// ===== Restore to original =====
export async function restoreToOriginal(sessionId: string): Promise<string | null> {
  try {
    const sessions = await loadSessions();
    const session  = sessions.find(s => s.sessionId === sessionId);
    if (!session) return null;

    session.currentCode = session.originalCode;
    await saveSessions(sessions);
    return session.originalCode;
  } catch {
    return null;
  }
}

// ===== Delete a session =====
export async function deleteSession(sessionId: string): Promise<void> {
  const sessions = await loadSessions();
  const filtered = sessions.filter(s => s.sessionId !== sessionId);
  await saveSessions(filtered);
}

// ===== Get version count =====
export async function getStats(): Promise<{ sessions: number; totalVersions: number }> {
  const sessions = await loadSessions();
  return {
    sessions:      sessions.length,
    totalVersions: sessions.reduce((sum, s) => sum + s.versions.length, 0),
  };
}

// ===== Format timestamp for display =====
export function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('ar-SA', {
      year:   'numeric', month: 'short', day: 'numeric',
      hour:   '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

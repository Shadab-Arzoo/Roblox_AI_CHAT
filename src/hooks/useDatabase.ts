import { useEffect, useRef } from "react";
import type { Conversation, ChatMessage } from "../types";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

interface SimpleDb {
  execute(sql: string, params?: any[]): Promise<any>;
  select<T = any>(sql: string, params?: any[]): Promise<T[]>;
}

let dbInstance: SimpleDb | null = null;
let dbInitPromise: Promise<SimpleDb> | null = null;

async function getDb(): Promise<SimpleDb> {
  if (dbInstance) return dbInstance;
  if (dbInitPromise) return dbInitPromise;

  if (!isTauri) {
    const mockDb: SimpleDb = {
      async execute(sql: string, params: any[] = []) {
        if (sql.includes("settings") && sql.includes("INSERT OR REPLACE")) {
          localStorage.setItem(`fp_setting_${params[0]}`, String(params[1]));
        }
        return [];
      },
      async select<T = any>(sql: string, params: any[] = []): Promise<T[]> {
        if (sql.includes("settings")) {
          const val = localStorage.getItem(`fp_setting_${params[0]}`);
          return val !== null ? ([{ value: val }] as any) : [];
        }
        return [];
      },
    };
    dbInstance = mockDb;
    return mockDb;
  }

  dbInitPromise = (async () => {
    const Database = (await import("@tauri-apps/plugin-sql")).default;
    const db = await Database.load("sqlite:forgepilot.db");

    // Create tables
    await db.execute(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        studio_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        project_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id)
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    await db.execute(`
      CREATE TABLE IF NOT EXISTS tool_logs (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        arguments TEXT,
        result TEXT,
        success INTEGER NOT NULL DEFAULT 1,
        timestamp INTEGER NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      )
    `);

    dbInstance = db;
    return db;
  })();

  return dbInitPromise;
}

// ─── Conversation Operations ───────────────────────────────────────

export async function createConversation(
  id: string,
  title: string,
  projectId: string | null = null
): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.execute(
    "INSERT INTO conversations (id, title, project_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $5)",
    [id, title, projectId, now, now]
  );
}

export async function listConversations(projectId?: string): Promise<Conversation[]> {
  const db = await getDb();
  let rows: any[];

  if (projectId) {
    rows = await db.select(
      "SELECT * FROM conversations WHERE project_id = $1 ORDER BY updated_at DESC",
      [projectId]
    );
  } else {
    rows = await db.select(
      "SELECT * FROM conversations ORDER BY updated_at DESC"
    );
  }

  return rows.map((r: any) => ({
    id: r.id,
    title: r.title,
    projectId: r.project_id,
    messages: [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export async function getConversation(id: string): Promise<Conversation | null> {
  const db = await getDb();
  const rows: any[] = await db.select(
    "SELECT * FROM conversations WHERE id = $1",
    [id]
  );
  if (rows.length === 0) return null;

  const r = rows[0];
  const messages = await getMessages(id);

  return {
    id: r.id,
    title: r.title,
    projectId: r.project_id,
    messages,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function renameConversation(id: string, title: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE conversations SET title = $1, updated_at = $2 WHERE id = $3",
    [title, Date.now(), id]
  );
}

export async function deleteConversation(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM messages WHERE conversation_id = $1", [id]);
  await db.execute("DELETE FROM tool_logs WHERE conversation_id = $1", [id]);
  await db.execute("DELETE FROM conversations WHERE id = $1", [id]);
}

export async function searchConversations(query: string): Promise<Conversation[]> {
  const db = await getDb();
  const rows: any[] = await db.select(
    "SELECT DISTINCT c.* FROM conversations c LEFT JOIN messages m ON c.id = m.conversation_id WHERE c.title LIKE $1 OR m.content LIKE $1 ORDER BY c.updated_at DESC LIMIT 50",
    [`%${query}%`]
  );

  return rows.map((r: any) => ({
    id: r.id,
    title: r.title,
    projectId: r.project_id,
    messages: [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

// ─── Message Operations ────────────────────────────────────────────

export async function addMessage(
  conversationId: string,
  message: ChatMessage
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES ($1, $2, $3, $4, $5)",
    [message.id, conversationId, message.role, message.content, message.timestamp]
  );
  await db.execute(
    "UPDATE conversations SET updated_at = $1 WHERE id = $2",
    [Date.now(), conversationId]
  );
}

export async function getMessages(conversationId: string): Promise<ChatMessage[]> {
  const db = await getDb();
  const rows: any[] = await db.select(
    "SELECT * FROM messages WHERE conversation_id = $1 ORDER BY timestamp ASC",
    [conversationId]
  );
  return rows.map((r: any) => ({
    id: r.id,
    role: r.role,
    content: r.content,
    timestamp: r.timestamp,
  }));
}

export async function updateMessage(id: string, content: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE messages SET content = $1 WHERE id = $2",
    [content, id]
  );
}

// ─── Settings Operations ───────────────────────────────────────────

export async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  const rows: any[] = await db.select(
    "SELECT value FROM settings WHERE key = $1",
    [key]
  );
  return rows.length > 0 ? rows[0].value : null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)",
    [key, value]
  );
}

// ─── Tool Log Operations ───────────────────────────────────────────

export async function logToolCall(
  id: string,
  conversationId: string,
  toolName: string,
  args: string,
  result: string,
  success: boolean
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT INTO tool_logs (id, conversation_id, tool_name, arguments, result, success, timestamp) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [id, conversationId, toolName, args, result, success ? 1 : 0, Date.now()]
  );
}

// Custom hook to initialize DB on mount
export function useDatabase() {
  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      getDb().catch(console.error);
    }
  }, []);
}

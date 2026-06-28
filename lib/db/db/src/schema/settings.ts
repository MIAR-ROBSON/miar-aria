import { pgTable, serial, text, real, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const settingsTable = pgTable("settings", {
  id: serial("id").primaryKey(),
  groqKeys: text("groq_keys").notNull().default("[]"),
  openrouterKeys: text("openrouter_keys").notNull().default("[]"),
  geminiKeys: text("gemini_keys").notNull().default("[]"),
  mistralKeys: text("mistral_keys").notNull().default("[]"),
  mem0Key: text("mem0_key"),
  userEmail: text("user_email").notNull().default(""),
  directives: text("directives").notNull().default(""),
  theme: text("theme").notNull().default("light"),
  audioSpeed: real("audio_speed").notNull().default(1),
  activeProvider: text("active_provider").notNull().default("groq"),
  activeModel: text("active_model").notNull().default("llama-3.3-70b-versatile"),
  agentToken: text("agent_token"),
  plan: text("plan").notNull().default("free"),
  msgCountToday: integer("msg_count_today").notNull().default(0),
  msgCountDate: text("msg_count_date").notNull().default(""),
  silentMode: integer("silent_mode").notNull().default(0),
  // Memória
  saveToMemory: integer("save_to_memory").notNull().default(1),
  // Toggles de provedor
  groqEnabled: integer("groq_enabled").notNull().default(1),
  openrouterEnabled: integer("openrouter_enabled").notNull().default(1),
  geminiEnabled: integer("gemini_enabled").notNull().default(1),
  mistralEnabled: integer("mistral_enabled").notNull().default(1),
});

export const insertSettingsSchema = createInsertSchema(settingsTable).omit({ id: true });
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type Settings = typeof settingsTable.$inferSelect;

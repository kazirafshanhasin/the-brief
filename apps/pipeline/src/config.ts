import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isTopicId, type TopicId } from "@brief/core";

export interface SourceConfig {
  id: string;
  name: string;
  domain: string;
  country: string | null;
  language: string;
  feed_url: string | null;
  default_topic: TopicId | null;
  owner: string | null;
  official?: boolean;
  rights: "headline_link" | "headline_excerpt_link" | "full_text_licensed";
  trust_score: number;
  status: "approved" | "pending" | "discovered" | "disabled";
  terms_checked: boolean;
}

export interface GdeltConfig {
  enabled: boolean;
  timespan: string;
  max_records: number;
  queries: string[];
}

export interface PipelineConfig {
  supabaseUrl: string;
  supabaseKey: string;
  ai: {
    provider: "anthropic" | "openai" | "none";
    apiKey: string;
    model: string;
    baseUrl: string;
    dailyCallCap: number;
    maxSummariesPerRun: number;
  };
  translateLanguages: string[];
  userAgent: string;
  dryRun: boolean;
  /** GitHub-only static mode: working state folder and public JSON folder. Unset means Supabase. */
  dataDir?: string;
  publicDir?: string;
  sources: SourceConfig[];
  gdelt: GdeltConfig;
}

const here = dirname(fileURLToPath(import.meta.url));
export const SOURCES_PATH = resolve(here, "../../../config/sources.json");

export function loadSourcesFile(path = SOURCES_PATH): { sources: SourceConfig[]; gdelt: GdeltConfig } {
  const raw = JSON.parse(readFileSync(path, "utf8")) as { sources: SourceConfig[]; gdelt: GdeltConfig };
  const ids = new Set<string>();
  for (const s of raw.sources) {
    if (ids.has(s.id)) throw new Error(`Duplicate source id ${s.id}`);
    ids.add(s.id);
    if (s.default_topic && !isTopicId(s.default_topic)) throw new Error(`Source ${s.id}: unknown topic ${s.default_topic}`);
    s.official = Boolean(s.official);
  }
  return raw;
}

export function loadConfig(argv: string[] = process.argv, env: NodeJS.ProcessEnv = process.env): PipelineConfig {
  const dryRun = argv.includes("--dry-run");
  const { sources, gdelt } = loadSourcesFile();
  const dataDir = env.DATA_DIR || undefined;
  const publicDir = env.PUBLIC_DATA_DIR || undefined;
  if (dataDir && !publicDir) throw new Error("DATA_DIR needs PUBLIC_DATA_DIR");
  const need = (k: string) => {
    const v = env[k];
    if (!v && !dryRun && !dataDir) throw new Error(`Missing environment variable ${k}`);
    return v ?? "";
  };
  const provider = (env.AI_PROVIDER || "none") as PipelineConfig["ai"]["provider"];
  if (!["anthropic", "openai", "none"].includes(provider)) throw new Error(`AI_PROVIDER must be anthropic, openai or none`);
  return {
    supabaseUrl: need("SUPABASE_URL"),
    supabaseKey: need("SUPABASE_SECRET_KEY"),
    ai: {
      provider,
      apiKey: provider === "none" ? "" : (env.AI_API_KEY ?? ""),
      model: env.AI_MODEL ?? "",
      // `||`: Actions passes unset repository variables as empty strings.
      baseUrl: env.AI_BASE_URL || (provider === "anthropic" ? "https://api.anthropic.com" : "https://api.openai.com/v1"),
      dailyCallCap: Number(env.AI_DAILY_CALL_CAP || 400),
      maxSummariesPerRun: Number(env.MAX_SUMMARIES_PER_RUN || 40),
    },
    translateLanguages: (env.TRANSLATE_LANGUAGES ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    userAgent: env.BOT_USER_AGENT || "TheBriefBot/0.1 (news summaries; contact: set BOT_USER_AGENT)",
    dryRun,
    dataDir,
    publicDir,
    sources,
    gdelt,
  };
}

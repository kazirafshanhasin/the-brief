import {
  COUNTRIES,
  isTopicId,
  languageName,
  splitSentences,
  validateSummary,
  type TopicId,
} from "@brief/core";
import type { PipelineConfig } from "./config";

export interface ModelReply {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export type ModelCall = (system: string, user: string, maxTokens: number) => Promise<ModelReply>;

/** Provider-agnostic model call. Anthropic Messages API or any OpenAI-compatible chat endpoint. */
export function createModel(ai: PipelineConfig["ai"]): ModelCall | null {
  if (ai.provider === "none" || !ai.apiKey || !ai.model) return null;
  if (ai.provider === "anthropic") {
    return async (system, user, maxTokens) => {
      const res = await fetch(`${ai.baseUrl.replace(/\/+$/, "")}/v1/messages`, {
        method: "POST",
        headers: { "x-api-key": ai.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: ai.model, max_tokens: maxTokens, temperature: 0.2, system, messages: [{ role: "user", content: user }] }),
      });
      if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const data = (await res.json()) as { content: { type: string; text?: string }[]; usage?: { input_tokens: number; output_tokens: number } };
      return {
        text: data.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join(""),
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
      };
    };
  }
  return async (system, user, maxTokens) => {
    const res = await fetch(`${ai.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ai.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: ai.model,
        max_tokens: maxTokens,
        temperature: 0.2,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Model API ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as {
      choices: { message: { content: string } }[];
      usage?: { prompt_tokens: number; completion_tokens: number };
    };
    return {
      text: data.choices[0]?.message.content ?? "",
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    };
  };
}

/** Extract the first JSON object from a model reply (tolerates code fences and prose). */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const v = JSON.parse(text.slice(start, end + 1));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export interface SourceExcerpt {
  publisher: string;
  published_at: string;
  headline: string;
  excerpt: string;
}

export interface BriefResult {
  headline: string;
  summary: string;
  topics: TopicId[];
  event_countries: string[];
  affected_countries: string[];
  importance: number;
  sensitive: boolean;
}

const SUMMARY_SYSTEM = `You are a careful, neutral news editor writing for busy readers.
Rules:
- Use ONLY facts stated in the source excerpts. Never add names, numbers, dates, causes or context that are not in them.
- Write in English, in plain neutral language, third person. No opinions, no hype, no links.
- Summary: 2 to 4 sentences: what happened; why it matters and possible implications ONLY if the sources say so.
- Keep every number exactly as written in the sources.
- If sources disagree, say that reports differ.
- If the excerpts do not contain enough information for 2 sentences, set "enough_information": false.
Reply with one JSON object and nothing else.`;

const ISO = new Set(COUNTRIES.map((c) => c.code));

export function buildSummaryPrompt(excerpts: SourceExcerpt[]): string {
  const blocks = excerpts
    .map((e, i) => `[${i + 1}] ${e.publisher} — ${e.published_at}\nHeadline: ${e.headline}\nExcerpt: ${e.excerpt || "(none)"}`)
    .join("\n\n");
  return `Source excerpts:\n\n${blocks}\n\nReturn JSON with exactly these keys:
{"headline": "factual headline, at most 14 words",
 "summary": "2-4 sentences",
 "topics": ["1-3 of: world, politics, business, technology, science, education, health, sports, entertainment, environment, finance, startups"],
 "event_countries": ["ISO 3166-1 alpha-2 codes of where the event happened (not the publisher's country)"],
 "affected_countries": ["ISO codes materially affected, may repeat event countries"],
 "importance": "integer 1-5 (5 = major international significance, 1 = minor local interest)",
 "sensitive": "true if about armed conflict, terrorism, disasters with casualties, or disputed political claims",
 "enough_information": true}`;
}

function cleanList(v: unknown, ok: (s: string) => boolean, max: number): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map((x) => String(x).trim()).filter(ok))].slice(0, max);
}

/** Parse + validate a model brief. Returns errors instead of throwing so the caller can retry once. */
export function interpretBrief(raw: string, sourceText: string): { brief: BriefResult | null; errors: string[] } {
  const obj = parseJsonObject(raw);
  if (!obj) return { brief: null, errors: ["reply was not JSON"] };
  if (obj.enough_information === false) return { brief: null, errors: ["model reported insufficient information"] };
  const headline = String(obj.headline ?? "").trim();
  const summary = String(obj.summary ?? "").trim();
  const check = validateSummary(headline, summary, sourceText);
  if (!check.ok) return { brief: null, errors: check.errors };
  const imp = Math.round(Number(obj.importance));
  const brief: BriefResult = {
    headline,
    summary,
    topics: cleanList(obj.topics, isTopicId, 3) as TopicId[],
    event_countries: cleanList(obj.event_countries, (c) => ISO.has(c.toUpperCase()), 3).map((c) => c.toUpperCase()),
    affected_countries: cleanList(obj.affected_countries, (c) => ISO.has(c.toUpperCase()), 6).map((c) => c.toUpperCase()),
    importance: Number.isFinite(imp) ? Math.min(5, Math.max(1, imp)) : 2,
    sensitive: obj.sensitive === true || obj.sensitive === "true",
  };
  return { brief, errors: [] };
}

export async function writeBrief(model: ModelCall, excerpts: SourceExcerpt[]): Promise<{ brief: BriefResult | null; errors: string[]; usage: { input: number; output: number; calls: number } }> {
  const sourceText = excerpts.map((e) => `${e.headline} ${e.excerpt}`).join(" ");
  const prompt = buildSummaryPrompt(excerpts);
  const usage = { input: 0, output: 0, calls: 0 };
  let reply = await model(SUMMARY_SYSTEM, prompt, 450);
  usage.input += reply.inputTokens;
  usage.output += reply.outputTokens;
  usage.calls++;
  let result = interpretBrief(reply.text, sourceText);
  if (!result.brief && !result.errors.includes("model reported insufficient information")) {
    // One corrective retry with the validator's feedback.
    reply = await model(
      SUMMARY_SYSTEM,
      `${prompt}\n\nYour previous reply was rejected: ${result.errors.join("; ")}. Fix these problems.`,
      450,
    );
    usage.input += reply.inputTokens;
    usage.output += reply.outputTokens;
    usage.calls++;
    result = interpretBrief(reply.text, sourceText);
  }
  return { ...result, usage };
}

export async function translateBrief(
  model: ModelCall,
  brief: { headline: string; summary: string },
  language: string,
): Promise<{ result: { headline: string; summary: string } | null; inputTokens: number; outputTokens: number }> {
  const reply = await model(
    `You translate news briefs faithfully into ${languageName(language)}. Keep the meaning exact, keep all names and numbers, do not add or drop information. Use digits for numbers. Reply with one JSON object only.`,
    `Translate:\n${JSON.stringify(brief)}\n\nReturn {"headline": "...", "summary": "..."}`,
    600,
  );
  const usage = { inputTokens: reply.inputTokens, outputTokens: reply.outputTokens };
  const obj = parseJsonObject(reply.text);
  if (!obj) return { result: null, ...usage };
  const headline = String(obj.headline ?? "").trim();
  const summary = String(obj.summary ?? "").trim();
  const n = splitSentences(summary).length;
  // Meaning-preservation guard: same sentence count range and every number carried over.
  const nums = (s: string) => (s.match(/\d+/g) ?? []).sort().join(",");
  if (!headline || n < 2 || n > 4 || nums(summary) !== nums(brief.summary)) return { result: null, ...usage };
  return { result: { headline, summary }, ...usage };
}

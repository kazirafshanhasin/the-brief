export const TOPICS = [
  { id: "world", label: "World" },
  { id: "politics", label: "Politics" },
  { id: "business", label: "Business & Economy" },
  { id: "technology", label: "Technology" },
  { id: "science", label: "Science" },
  { id: "education", label: "Education" },
  { id: "health", label: "Health" },
  { id: "sports", label: "Sports" },
  { id: "entertainment", label: "Entertainment" },
  { id: "environment", label: "Environment" },
  { id: "finance", label: "Finance" },
  { id: "startups", label: "Startups" },
] as const;

export type TopicId = (typeof TOPICS)[number]["id"];

const IDS = new Set<string>(TOPICS.map((t) => t.id));

export function isTopicId(value: string): value is TopicId {
  return IDS.has(value);
}

export function topicLabel(id: string): string {
  return TOPICS.find((t) => t.id === id)?.label ?? id;
}

/**
 * Keyword lexicon used as a cheap fallback classifier (when no AI model is configured,
 * or for headline-only entries). Matching is on whole lowercase words / short phrases.
 */
export const TOPIC_KEYWORDS: Record<TopicId, string[]> = {
  world: ["united nations", "un ", "summit", "diplomat", "foreign minister", "embassy", "treaty", "refugee", "border", "nato", "ceasefire", "sanctions"],
  politics: ["election", "parliament", "president", "prime minister", "minister", "senate", "congress", "vote", "voters", "party", "opposition", "cabinet", "lawmakers", "government", "referendum", "campaign"],
  business: ["economy", "economic", "gdp", "inflation", "trade", "exports", "imports", "company", "companies", "earnings", "profit", "revenue", "jobs", "unemployment", "tariff", "industry", "manufacturing", "retail"],
  technology: ["ai", "artificial intelligence", "software", "chip", "chips", "semiconductor", "smartphone", "app", "apps", "cyber", "internet", "tech", "robot", "data", "cloud", "satellite"],
  science: ["scientists", "study", "research", "researchers", "space", "nasa", "physics", "astronomy", "discovery", "species", "telescope", "genome"],
  education: ["school", "schools", "university", "universities", "students", "teachers", "exam", "exams", "education", "campus", "tuition", "curriculum"],
  health: ["health", "hospital", "disease", "virus", "vaccine", "outbreak", "patients", "doctors", "medical", "cancer", "dengue", "covid", "who "],
  sports: ["football", "soccer", "cricket", "tennis", "olympic", "olympics", "match", "tournament", "league", "cup", "championship", "coach", "athlete", "goal", "wicket", "nba", "fifa"],
  entertainment: ["film", "movie", "music", "album", "actor", "actress", "celebrity", "festival", "box office", "series", "streaming", "concert", "award", "awards"],
  environment: ["climate", "flood", "floods", "cyclone", "earthquake", "wildfire", "emissions", "pollution", "heatwave", "drought", "environment", "carbon", "renewable", "storm"],
  finance: ["stock", "stocks", "shares", "bank", "banks", "central bank", "interest rate", "rates", "bond", "bonds", "currency", "markets", "investors", "crypto", "bitcoin", "imf"],
  startups: ["startup", "startups", "founder", "founders", "venture", "funding round", "seed round", "series a", "series b", "unicorn", "valuation", "accelerator"],
};

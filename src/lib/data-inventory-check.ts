/**
 * Compares the data inventory with what the code holds. Pure, so each check can be shown failing on a fixture.
 *
 * A tripwire, not proof. It can't see: a host known only at run time, base URLs from the environment, SDK defaults,
 * calls made inside dependencies, what a listed call actually sends, the host's own processing, access logs, backups
 * or DNS, or anything under scripts/. docs/PHASE_4_0_5_DATA_INVENTORY.md says what has to be checked by reading.
 */
export interface Inventory {
  categories: Record<string, string>;
  models: Record<string, string>;
  possiblyHealthRelated: string[];
  callSites: { server: Record<string, string>; browser: Record<string, string> };
  hosts: Record<string, string>;
  notDestinations: Record<string, string>;
  mail: { factory: string; transports: string[]; holdsLiveTokens: string };
  dependencies: Record<string, string>;
  processors: Record<string, { noticeName: string; receives: string; state: string; settings?: string[] }>;
  periods: Record<string, { state: string; noticeText?: string; noticeLabel?: string; source?: string; proof?: string; needs?: string }>;
}

export interface InventoryFacts {
  models: { name: string; fields: string[] }[];
  dataMapModels: string[];
  /** Non-test source files under src/, with paths using forward slashes. */
  sources: { path: string; text: string }[];
  dependencies: string[];
  aiSettings: string[];
}

const NETWORK_MODULES = "http|https|net|tls|dns|dgram|child_process|http2";
/** Anything that can reach another host or process. Each match has to be in a listed file. */
export const OUTBOUND_PATTERNS = [
  /\bfetch\s*\(/,
  /=\s*(?:globalThis\.|window\.|self\.)?fetch\b/,
  /\bfetch\.(?:call|apply|bind)\b/,
  /\bhttps?\.(?:request|get)\(/,
  /\b(?:net|tls)\.connect\(/,
  /\bnew WebSocket\(/,
  /\bXMLHttpRequest\b/,
  /\bsendBeacon\(/,
  /\bnew EventSource\(/,
  /\bnew Anthropic\(/,
  new RegExp(`(?:from|import)\\s+["'](?:node:)?(?:${NETWORK_MODULES})["']`),
  new RegExp(`(?:require|import)\\(["'](?:node:)?(?:${NETWORK_MODULES})["']\\)`),
  /(?:from\s+|import\s+|import\(|require\()["'](?:@anthropic-ai\/sdk|undici|axios|got|node-fetch|ws|nodemailer|openai)["']/,
];
const HOST_LITERAL = /\bhttps?:\/\/([a-z0-9][a-z0-9.-]*)/gi;
const MAIL_IMPLEMENTATION = /(?::|\bsatisfies|\bas)\s*MailTransport\b/g;

/** Comment lines say nothing about what runs. Trailing comments need a space, so a URL's `//` isn't one. */
export function withoutComments(text: string): string {
  return text.split(/\r?\n/).map((line) => line.replace(/\/\*.*?\*\//g, "")).filter((line) => !/^\s*(?:\/\/|\/\*|\*)/.test(line)).map((line) => line.replace(/\s\/\/\s.*$/, "")).join("\n");
}

export const callSiteFiles = (sources: InventoryFacts["sources"]) =>
  sources.filter((s) => { const code = withoutComments(s.text); return OUTBOUND_PATTERNS.some((p) => p.test(code)); }).map((s) => s.path).sort();

export function hostLiterals(sources: InventoryFacts["sources"]): string[] {
  const found = new Set<string>();
  for (const s of sources) for (const m of withoutComments(s.text).matchAll(HOST_LITERAL)) found.add(m[1].toLowerCase().replace(/\.$/, ""));
  return [...found].sort();
}

const sameSet = (label: string, have: string[], want: string[], out: string[]) => {
  for (const x of want) if (!have.includes(x)) out.push(`${label}: ${x} isn't in the inventory`);
  for (const x of have) if (!want.includes(x)) out.push(`${label}: ${x} is listed, and wasn't found`);
};

export function inventoryProblems(inv: Inventory, facts: InventoryFacts): string[] {
  const out: string[] = [];
  const schema = facts.models.map((m) => m.name);

  sameSet("model", Object.keys(inv.models), schema, out);
  sameSet("data-map model", schema, facts.dataMapModels, out);
  for (const [model, category] of Object.entries(inv.models)) if (!inv.categories[category]) out.push(`model: ${model} has no category`);
  for (const ref of inv.possiblyHealthRelated) {
    const [model, field] = ref.split(".");
    if (!facts.models.find((m) => m.name === model)?.fields.includes(field)) out.push(`field: ${ref} doesn't exist`);
  }

  sameSet("call site", [...Object.keys(inv.callSites.server), ...Object.keys(inv.callSites.browser)], callSiteFiles(facts.sources), out);
  for (const f of Object.keys(inv.callSites.server)) if (!f.startsWith("src/lib/server/")) out.push(`call site: ${f} is listed as server code, and isn't`);
  for (const f of Object.keys(inv.callSites.browser)) if (f.startsWith("src/lib/server/")) out.push(`call site: ${f} is listed as browser code, and isn't`);

  const hosts = hostLiterals(facts.sources);
  for (const h of hosts) if (!inv.hosts[h] && !inv.notDestinations[h]) out.push(`host: ${h} isn't in the inventory`);
  for (const h of Object.keys(inv.hosts)) if (!hosts.includes(h)) out.push(`host: ${h} is listed, and wasn't found`);
  for (const [h, processor] of Object.entries(inv.hosts)) if (!inv.processors[processor]) out.push(`host: ${h} names no processor`);

  const factories = facts.sources.filter((s) => /function\s+mailTransport\s*\(/.test(withoutComments(s.text))).map((s) => s.path);
  if (factories.length !== 1 || factories[0] !== inv.mail.factory) out.push(`mail: the factory should be only in ${inv.mail.factory}, and is in ${factories.join(", ") || "nothing"}`);
  const transports: string[] = [];
  for (const s of facts.sources) {
    for (const line of withoutComments(s.text).split("\n")) {
      if (MAIL_IMPLEMENTATION.test(line)) {
        const name = /(?:const|let|function)\s+(\w+)/.exec(line)?.[1] ?? line.trim();
        // The one factory hands a transport out, and isn't one. Anything else with that name still counts.
        if (!(s.path === inv.mail.factory && /function\s+mailTransport\s*\(/.test(line))) transports.push(name);
      }
      MAIL_IMPLEMENTATION.lastIndex = 0;
    }
    for (const m of withoutComments(s.text).matchAll(/class\s+(\w+)[^{]*\bimplements\b[^{]*\bMailTransport\b/g)) transports.push(m[1]);
  }
  sameSet("mail transport", inv.mail.transports, transports.sort(), out);

  sameSet("dependency", Object.keys(inv.dependencies), facts.dependencies, out);
  for (const [dep, use] of Object.entries(inv.dependencies)) if (use !== "none" && use !== "database" && !inv.processors[use]) out.push(`dependency: ${dep} names no processor`);

  const conditional = Object.values(inv.processors).flatMap((p) => p.settings ?? []);
  sameSet("AI setting", conditional, facts.aiSettings, out);

  for (const [id, p] of Object.entries(inv.periods)) {
    if (p.state !== "built") continue;
    const source = facts.sources.find((s) => s.path === p.source);
    if (!source || !p.proof || !new RegExp(p.proof).test(source.text)) out.push(`period: ${id} no longer matches ${p.source}`);
  }
  return out;
}

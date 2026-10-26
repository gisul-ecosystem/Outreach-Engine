// User agents of security scanners, link previews and scripts — ONE list, easy to edit.
// A user agent is the name a browser or program sends with every request ("Mozilla/5.0 … Chrome/…").
// Matching is case-insensitive on a part of the user agent. Add a line to catch a new scanner.
//
// Note: Microsoft Defender Safe Links usually pretends to be a normal browser, so it is caught by the
// timing / header rules in classify-click.ts, not by this list.

export const SCANNER_USER_AGENTS: { match: string; name: string }[] = [
  // Email security scanners that name themselves
  { match: "reactornetty", name: "Avanan / Check Point scanner" },
  { match: "barracuda", name: "Barracuda" },
  { match: "mimecast", name: "Mimecast" },
  { match: "proofpoint", name: "Proofpoint" },
  { match: "urldefense", name: "Proofpoint URL Defense" },
  { match: "trendmicro", name: "Trend Micro" },
  { match: "forcepoint", name: "Forcepoint" },
  { match: "ironport", name: "Cisco IronPort" },
  { match: "symantec", name: "Symantec" },
  { match: "fortiguard", name: "FortiGuard" },
  { match: "sophos", name: "Sophos" },
  { match: "zscaler", name: "Zscaler" },
  // Link previews (chat apps and social sites fetch a link to draw a preview card)
  { match: "slackbot", name: "Slack preview" },
  { match: "facebookexternalhit", name: "Facebook preview" },
  { match: "linkedinbot", name: "LinkedIn preview" },
  { match: "twitterbot", name: "X / Twitter preview" },
  { match: "whatsapp", name: "WhatsApp preview" },
  { match: "telegrambot", name: "Telegram preview" },
  { match: "discordbot", name: "Discord preview" },
  { match: "skypeuripreview", name: "Skype / Teams preview" },
  { match: "microsoftpreview", name: "Microsoft preview" },
  { match: "googleimageproxy", name: "Gmail image proxy" },
  // Search engines and crawlers
  { match: "googlebot", name: "Googlebot" },
  { match: "bingbot", name: "Bingbot" },
  { match: "bingpreview", name: "Bing preview" },
  { match: "yandexbot", name: "Yandex" },
  { match: "duckduckbot", name: "DuckDuckGo" },
  // Headless browsers and scripts
  { match: "headlesschrome", name: "Headless Chrome" },
  { match: "phantomjs", name: "PhantomJS" },
  { match: "curl/", name: "curl" },
  { match: "wget/", name: "wget" },
  { match: "python-requests", name: "Python script" },
  { match: "python-urllib", name: "Python script" },
  { match: "aiohttp", name: "Python script" },
  { match: "go-http-client", name: "Go program" },
  { match: "java/", name: "Java program" },
  { match: "okhttp", name: "OkHttp program" },
  { match: "axios", name: "axios script" },
  { match: "node-fetch", name: "Node.js script" },
  { match: "undici", name: "Node.js script" },
  { match: "libwww-perl", name: "Perl script" },
  { match: "apache-httpclient", name: "Apache HTTP client" },
  { match: "bot/", name: "a bot" },
  { match: "spider", name: "a crawler" },
  { match: "crawler", name: "a crawler" },
];

/** The scanner's name when the user agent is on the list, else null. */
export function knownScanner(userAgent: string): string | null {
  const ua = userAgent.toLowerCase();
  return SCANNER_USER_AGENTS.find((s) => ua.includes(s.match))?.name ?? null;
}

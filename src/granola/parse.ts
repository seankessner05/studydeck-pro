/** Parsers for the text Granola's MCP tools return (XML-flavoured, with markdown inside). Pure and tested. */

export interface ListedMeeting {
  id: string;
  title: string;
  /** e.g. 2026-10-13T14:49:40.499-04:00 */
  meetingAt: string;
  url?: string;
}

export interface ListPage {
  meetings: ListedMeeting[];
  hasMore: boolean;
  nextCursor?: string;
  total?: number;
}

export interface GranolaFolder {
  id: string;
  title: string;
}

export interface FullMeeting extends ListedMeeting {
  createdAt?: string;
  updatedAt?: string;
  folders: GranolaFolder[];
  /** What you typed yourself in Granola, if anything. */
  privateNotes: string;
  /** Granola's AI-enhanced notes (markdown). */
  summary: string;
  creatorEmail?: string;
}

export interface MeetingsBatch {
  connectedEmail?: string;
  meetings: FullMeeting[];
  /** Ids the server left out because the response was too large; ask for them again. */
  omitted: string[];
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;|&#x27;/g, "'")
    .replace(/&amp;/g, "&");
}

export function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/([\w:-]+)="([^"]*)"/g)) out[m[1]] = decodeEntities(m[2]);
  return out;
}

/** The meeting's calendar date in the meeting's own timezone (the first 10 characters of meeting_at). */
export function meetingDate(meetingAt: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(meetingAt) ? meetingAt.slice(0, 10) : "";
}

/** Output of `search_meetings`. */
export function parseMeetingList(text: string): ListPage {
  const meetings: ListedMeeting[] = [];
  for (const m of text.matchAll(/<meeting\s+([^>]*)>/g)) {
    const a = parseAttrs(m[1]);
    if (a.id && a.title !== undefined && a.meeting_at) meetings.push({ id: a.id, title: a.title, meetingAt: a.meeting_at, url: a.url });
  }
  const p = text.match(/<pagination\s+([^>]*)\/?>/);
  const pa = p ? parseAttrs(p[1]) : {};
  return {
    meetings,
    hasMore: pa.has_more === "true",
    nextCursor: pa.next_cursor || undefined,
    total: pa.total_count ? Number(pa.total_count) : undefined,
  };
}

/** Output of `get_meetings`. */
export function parseMeetings(text: string): MeetingsBatch {
  const connectedEmail = text.match(/<connected_user_email>([^<]+)<\/connected_user_email>/)?.[1]?.trim();
  const meetings: FullMeeting[] = [];
  for (const m of text.matchAll(/<meeting\s+([^>]*)>([\s\S]*?)<\/meeting>/g)) {
    const a = parseAttrs(m[1]);
    const body = m[2];
    if (!a.id || !a.meeting_at) continue;

    const folders = [...body.matchAll(/<folder\s+([^>]*?)\/>/g)]
      .map((f) => parseAttrs(f[1]))
      .filter((f) => f.id)
      .map((f) => ({ id: f.id, title: f.title ?? "" }));

    const pn = body.match(/<private_notes\s*([^>]*?)(?:\/>|>([\s\S]*?)<\/private_notes>)/);
    const privateNotes = pn && pn[2] ? decodeEntities(pn[2]).trim() : "";

    const summary = decodeEntities(body.match(/<summary>([\s\S]*?)<\/summary>/)?.[1] ?? "").trim();
    const creatorEmail = body.match(/\(note creator\)\s*\(([^)\s]+)\)/)?.[1];

    meetings.push({
      id: a.id,
      title: a.title ?? "",
      meetingAt: a.meeting_at,
      url: a.url,
      createdAt: a.created_at,
      updatedAt: a.updated_at,
      folders,
      privateNotes,
      summary,
      creatorEmail,
    });
  }
  const omitted = [...text.matchAll(/<omitted_meetings[^>]*>([\s\S]*?)<\/omitted_meetings>/g)].flatMap((o) =>
    [...o[1].matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi)].map((x) => x[0]),
  );
  return { connectedEmail, meetings, omitted };
}

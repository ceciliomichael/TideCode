import type { Message } from '../types/chat'

const COMPRESSION_MESSAGE_NAMESPACE = "tidecode";
const COMPRESSION_MESSAGE_ROOT = "compressed_history";
const COMPRESSION_SUMMARY_TAG = "summary";
const CAMP_SECTION_ORDER = [
  "Goal",
  "Current State",
  "Done",
  "Decisions",
  "Open Items",
  "Key Refs",
  "Next Step",
] as const;

export const COMPRESSION_ACKNOWLEDGEMENT_TEXT =
  "Loaded the compressed context and I'm ready to continue.";

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function unescapeXml(value: string) {
  return value
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

export interface ParsedCompressedHistoryMessage {
  summary: string;
}

export type CampSectionName = (typeof CAMP_SECTION_ORDER)[number];

export interface CampSection {
  name: CampSectionName;
  content: string;
}

export interface ParsedCampMemoryPacket {
  sections: CampSection[];
}

export function buildCompressedHistoryMessage(summary: string) {
  const trimmedSummary = summary.trim();
  const compressedHistoryBlock = [
    `<${COMPRESSION_MESSAGE_NAMESPACE}:${COMPRESSION_MESSAGE_ROOT}>`,
    `  <${COMPRESSION_MESSAGE_NAMESPACE}:${COMPRESSION_SUMMARY_TAG}>${escapeXml(trimmedSummary)}</${COMPRESSION_MESSAGE_NAMESPACE}:${COMPRESSION_SUMMARY_TAG}>`,
    `</${COMPRESSION_MESSAGE_NAMESPACE}:${COMPRESSION_MESSAGE_ROOT}>`,
  ].join("\n");

  return compressedHistoryBlock;
}

export function buildCompressedHistoryAcknowledgementMessage(messageId: string, timestamp = Date.now()): Message {
  return {
    content: COMPRESSION_ACKNOWLEDGEMENT_TEXT,
    id: messageId,
    role: 'assistant',
    timestamp,
  };
}

export function parseCompressedHistoryMessage(
  content: string,
): ParsedCompressedHistoryMessage | null {
  const trimmedContent = content.trim();
  const namespace = COMPRESSION_MESSAGE_NAMESPACE.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
  const rootTag = COMPRESSION_MESSAGE_ROOT.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
  const summaryTag = COMPRESSION_SUMMARY_TAG.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
  const pattern = new RegExp(
    `^<${namespace}:${rootTag}>\\s*<${namespace}:${summaryTag}>([\\s\\S]*?)</${namespace}:${summaryTag}>\\s*</${namespace}:${rootTag}>(?:[\\s\\S]*)$`,
  );
  const match = trimmedContent.match(pattern);

  if (!match) {
    return null;
  }

  return {
    summary: unescapeXml(match[1].trim()),
  };
}

function normalizeCampSectionName(value: string): CampSectionName | null {
  const normalizedValue = value.trim().toLowerCase();

  if (normalizedValue === "goal") {
    return "Goal";
  }

  if (normalizedValue === "current state") {
    return "Current State";
  }

  if (normalizedValue === "done") {
    return "Done";
  }

  if (normalizedValue === "decisions") {
    return "Decisions";
  }

  if (normalizedValue === "open items") {
    return "Open Items";
  }

  if (normalizedValue === "key refs" || normalizedValue === "key references") {
    return "Key Refs";
  }

  if (normalizedValue === "next step") {
    return "Next Step";
  }

  return null;
}

export function parseCampMemoryPacket(
  summary: string,
): ParsedCampMemoryPacket | null {
  const lines = summary
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd());

  const sections: CampSection[] = [];
  let currentSection: CampSection | null = null;

  const flushCurrentSection = () => {
    if (currentSection === null) {
      return;
    }

    if (currentSection.content.trim().length === 0) {
      return;
    }

    sections.push({
      name: currentSection.name,
      content: currentSection.content.trim(),
    });
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line.length === 0) {
      if (currentSection) {
        currentSection.content = `${currentSection.content}\n`;
      }
      continue;
    }

    const headingPattern =
      /^(?:#{1,3}\s*)?(?:\d+\.\s*)?(Goal|Current State|Done|Decisions|Open Items|Key Refs|Key References|Next Step)\s*:?\s*(.*)$/i;
    const headingMatch = line.match(headingPattern);

    if (headingMatch) {
      const sectionName = normalizeCampSectionName(headingMatch[1]);
      if (!sectionName) {
        continue;
      }

      flushCurrentSection();

      currentSection = {
        name: sectionName,
        content: headingMatch[2]?.trim() ?? "",
      };
      continue;
    }

    if (currentSection) {
      currentSection.content = currentSection.content.length > 0
        ? `${currentSection.content}\n${line}`
        : line;
    }
  }

  flushCurrentSection();

  if (sections.length === 0) {
    return null;
  }

  const sectionOrder = new Map<CampSectionName, number>(
    CAMP_SECTION_ORDER.map((sectionName, index) => [sectionName, index]),
  );

  sections.sort((left, right) => {
    const leftOrder = sectionOrder.get(left.name) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = sectionOrder.get(right.name) ?? Number.MAX_SAFE_INTEGER;

    return leftOrder - rightOrder;
  });

  return {
    sections,
  };
}

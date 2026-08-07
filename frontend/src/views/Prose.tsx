import { Fragment, useMemo } from "react";

/**
 * Just enough markdown for these documents.
 *
 * A renderer rather than a dependency: the agreement uses headings, paragraphs,
 * lists, bold, inline code and horizontal rules, and nothing else. Pulling in a
 * markdown library — and with it an HTML sanitiser, because the two arrive
 * together — to render one string the repository controls would be a lot of
 * third-party code in the path of a legal document.
 *
 * Nothing here emits raw HTML. Everything becomes React elements, so a stray
 * angle bracket in the prose is text and can never be markup.
 */
export function Prose({
  markdown,
  skipTitle = false,
  headingOffset = 2,
}: {
  markdown: string;
  /**
   * Drop the document's own top-level heading.
   *
   * A markdown file names itself on line one, and a page that renders it
   * usually names it too — so without this the title appears twice, once as
   * the page heading and once as the first thing in the body. Dropped here
   * rather than edited out of the source, because the source is the document
   * and it should still read as one on its own.
   */
  skipTitle?: boolean;
  /** Add this many levels to markdown headings in their surrounding page. */
  headingOffset?: 0 | 1 | 2;
}) {
  const blocks = useMemo(() => {
    const parsed = parse(markdown);
    if (!skipTitle) return parsed;
    const first = parsed.findIndex((b) => b.kind === "heading" && b.level === 1);
    return first === -1 ? parsed : parsed.filter((_, i) => i !== first);
  }, [markdown, skipTitle]);
  return (
    <>
      {blocks.map((block, i) => {
        if (block.kind === "rule") return <hr key={i} />;
        if (block.kind === "heading") {
          const level = Math.min(6, block.level + headingOffset);
          const Tag = `h${level}` as keyof React.JSX.IntrinsicElements;
          // A dialog already owns an h2, while the standalone Rules page wraps
          // the agreement in its own h2. The caller chooses the offset so the
          // same document follows either surrounding hierarchy.
          return <Tag key={i}>{inline(block.text)}</Tag>;
        }
        if (block.kind === "list") {
          const Tag = block.ordered ? "ol" : "ul";
          return (
            <Tag key={i}>
              {block.items.map((item, j) => (
                <li key={j}>{inline(item)}</li>
              ))}
            </Tag>
          );
        }
        return <p key={i}>{inline(block.text)}</p>;
      })}
    </>
  );
}

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "para"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "rule" };

function parse(source: string): Block[] {
  const blocks: Block[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];

  const flush = () => {
    if (para.length) {
      blocks.push({ kind: "para", text: para.join(" ") });
      para = [];
    }
    if (list) {
      blocks.push({ kind: "list", ...list });
      list = null;
    }
  };

  for (const line of source.split("\n")) {
    const text = line.trim();
    if (text === "") {
      flush();
      continue;
    }
    if (text === "---") {
      flush();
      blocks.push({ kind: "rule" });
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(text);
    if (heading) {
      flush();
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] });
      continue;
    }
    const bullet = /^[-*]\s+(.*)$/.exec(text);
    const numbered = /^\d+\.\s+(.*)$/.exec(text);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      const item = (bullet ?? numbered)![1];
      if (para.length) {
        blocks.push({ kind: "para", text: para.join(" ") });
        para = [];
      }
      // A change of list type starts a new list rather than mixing them.
      if (!list || list.ordered !== ordered) {
        if (list) blocks.push({ kind: "list", ...list });
        list = { ordered, items: [] };
      }
      list.items.push(item);
      continue;
    }
    if (list) {
      blocks.push({ kind: "list", ...list });
      list = null;
    }
    para.push(text);
  }
  flush();
  return blocks;
}

/** `**bold**` and `` `code` ``, and nothing else. */
function inline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 1) {
      return <code key={i}>{part.slice(1, -1)}</code>;
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

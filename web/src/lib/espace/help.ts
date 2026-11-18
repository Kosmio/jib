// Aide de l'interface organisation (15-administration.md, F-187) : pages Markdown de `src/content/aide/`, lues au build (elles
// font donc partie de l'image du site), rendues avec `marked`. Nom de fichier « 03-programme.md » : rang 3, adresse « programme ».
import { marked } from "marked";

export type HelpSection = { id: string; title: string };
export type HelpPage = { slug: string; rank: number; title: string; summary: string; html: string; sections: HelpSection[] };

const sources = import.meta.glob("../../content/aide/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

const anchor = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

function render(markdown: string): Omit<HelpPage, "slug" | "rank"> {
  const sections: HelpSection[] = [];
  const tokens = marked.lexer(markdown);
  const titleToken = tokens.find((token) => token.type === "heading" && token.depth === 1) as { text: string } | undefined;
  const firstParagraph = tokens.find((token) => token.type === "paragraph") as { text: string } | undefined;
  const renderer = new marked.Renderer();
  renderer.heading = ({ tokens: inline, depth, text }) => {
    if (depth === 1) return "";
    const id = anchor(text);
    if (depth === 2) sections.push({ id, title: text });
    return `<h${depth + 1} id="${id}">${marked.Parser.parseInline(inline)}</h${depth + 1}>`;
  };
  const html = marked.parse(markdown, { renderer, async: false }) as string;
  return {
    title: titleToken?.text ?? "Aide",
    summary: (firstParagraph?.text ?? "").replace(/\*\*|`/g, ""),
    html,
    sections,
  };
}

export const helpPages: HelpPage[] = Object.entries(sources)
  .map(([path, markdown]) => {
    const file = path.split("/").pop()!.replace(/\.md$/, "");
    const match = /^(\d+)-(.+)$/.exec(file);
    return { slug: match ? match[2] : file, rank: match ? Number(match[1]) : 99, ...render(markdown) };
  })
  .sort((a, b) => a.rank - b.rank);

export const helpPage = (slug: string) => helpPages.find((page) => page.slug === slug) ?? null;

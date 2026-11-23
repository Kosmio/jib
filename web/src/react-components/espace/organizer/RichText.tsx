import React, { useEffect, useId, useRef, useState } from "react";

// Éditeur de texte riche de l'interface organisation (D-23, NF-76) : barre réduite (gras, italique, listes, lien, intertitre),
// utilisable au clavier (Ctrl ou Cmd + B, I, K). Il écrit le même HTML simple que le site affiche déjà ; le serveur le nettoie
// encore avant de l'enregistrer (NF-72). Coller du texte venant d'ailleurs ne garde que le texte et les retours à la ligne.

type Props = {
  label: string;
  value: string;
  onChange: (html: string) => void;
  hint?: string;
  /** Hauteur minimale en lignes. */
  rows?: number;
};

type Command = { id: string; label: string; icon: React.ReactNode; run: () => void; active?: () => boolean };

const escapeText = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const ALLOWED = new Set(["P", "BR", "STRONG", "B", "EM", "I", "U", "UL", "OL", "LI", "A", "H3", "H4"]);

/**
 * HTML à afficher ou à placer dans l'éditeur : même liste blanche que le serveur (NF-72). Un texte saisi dans Strapi peut contenir
 * n'importe quoi ; DOMParser ne lance ni script ni gestionnaire d'événement, et rien d'autre que ces balises et un `href` sûr ne passe.
 * Rendu serveur (pas de DOMParser) : le texte seul, échappé.
 */
export function displayHtml(html: string | null | undefined): string {
  if (!html) return "";
  if (typeof DOMParser === "undefined") return escapeText(html.replace(/<[^>]*>/g, " "));
  const source = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html").body;
  const clean = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return escapeText(node.textContent ?? "");
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const element = node as Element;
    if (["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "TEMPLATE", "SVG", "MATH"].includes(element.tagName)) return "";
    const inner = [...element.childNodes].map(clean).join("");
    if (!ALLOWED.has(element.tagName)) return inner;
    const tag = element.tagName.toLowerCase();
    if (tag === "br") return "<br>";
    if (tag === "a") {
      const href = (element.getAttribute("href") ?? "").trim();
      return /^(https?:|mailto:)/i.test(href.replace(/[\u0000-\u0020]/g, "")) ? `<a href="${escapeText(href).replace(/"/g, "&quot;")}">${inner}</a>` : inner;
    }
    return `<${tag}>${inner}</${tag}>`;
  };
  return [...source.childNodes].map(clean).join("");
}

function Glyph({ d }: { d: string }) {
  return (
    <svg aria-hidden="true" className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

export default function RichText({ label, value, onChange, hint, rows = 4 }: Props) {
  const id = useId();
  const editor = useRef<HTMLDivElement>(null);
  const [, refresh] = useState(0);
  const [linking, setLinking] = useState(false);
  const [url, setUrl] = useState("https://");
  const saved = useRef<Range | null>(null);

  // La valeur reçue ne remplace le contenu que si elle vient d'ailleurs (rechargement), jamais pendant la frappe.
  useEffect(() => {
    if (editor.current && editor.current.innerHTML !== value) editor.current.innerHTML = displayHtml(value);
  }, [value]);

  const emit = () => onChange(editor.current?.innerHTML === "<br>" ? "" : (editor.current?.innerHTML ?? ""));
  const exec = (command: string, argument?: string) => {
    editor.current?.focus();
    document.execCommand(command, false, argument);
    emit();
    refresh((n) => n + 1);
  };
  const state = (command: string) => {
    try {
      return document.queryCommandState(command);
    } catch {
      return false;
    }
  };
  const inHeading = () => {
    try {
      return /^h[34]$/i.test(String(document.queryCommandValue("formatBlock")));
    } catch {
      return false;
    }
  };

  function openLink() {
    const selection = window.getSelection();
    saved.current = selection && selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    setUrl("https://");
    setLinking(true);
  }
  function applyLink(event: React.FormEvent) {
    event.preventDefault();
    setLinking(false);
    if (!/^(https?:\/\/|mailto:)\S+/i.test(url.trim())) return;
    editor.current?.focus();
    const selection = window.getSelection();
    if (saved.current && selection) {
      selection.removeAllRanges();
      selection.addRange(saved.current);
    }
    if (selection?.isCollapsed) document.execCommand("insertHTML", false, `<a href="${escapeText(url.trim())}">${escapeText(url.trim())}</a>`);
    else document.execCommand("createLink", false, url.trim());
    emit();
  }

  const commands: Command[] = [
    { id: "bold", label: "Gras", icon: <span className="text-base font-black">G</span>, run: () => exec("bold"), active: () => state("bold") },
    { id: "italic", label: "Italique", icon: <span className="font-serif text-base italic">I</span>, run: () => exec("italic"), active: () => state("italic") },
    { id: "h3", label: "Intertitre", icon: <span className="text-sm font-bold">T</span>, run: () => exec("formatBlock", inHeading() ? "<p>" : "<h3>"), active: inHeading },
    { id: "ul", label: "Liste à puces", icon: <Glyph d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />, run: () => exec("insertUnorderedList"), active: () => state("insertUnorderedList") },
    { id: "ol", label: "Liste numérotée", icon: <Glyph d="M10 6h10M10 12h10M10 18h10M4 5h1v4M4 9h2M4 15h2l-2 3h2" />, run: () => exec("insertOrderedList"), active: () => state("insertOrderedList") },
    { id: "link", label: "Lien", icon: <Glyph d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />, run: openLink },
  ];

  return (
    <div>
      <span id={`${id}-label`} className="block font-semibold">
        {label}
      </span>
      <div className="mt-1.5 rounded-lg border-2 border-surface-alt bg-white focus-within:border-accent">
        <div role="toolbar" aria-label={`Mise en forme : ${label}`} className="flex flex-wrap gap-1 border-b border-surface-alt p-1">
          {commands.map((command) => (
            <button
              key={command.id}
              type="button"
              title={command.label}
              aria-label={command.label}
              aria-pressed={command.active ? command.active() : undefined}
              onMouseDown={(event) => event.preventDefault()}
              onClick={command.run}
              className={`inline-flex size-10 items-center justify-center rounded-md text-title hover:bg-surface ${command.active?.() ? "bg-surface-alt" : ""}`}
            >
              {command.icon}
            </button>
          ))}
        </div>
        <div
          ref={editor}
          id={id}
          role="textbox"
          aria-multiline="true"
          aria-labelledby={`${id}-label`}
          aria-describedby={hint ? `${id}-aide` : undefined}
          contentEditable
          suppressContentEditableWarning
          onInput={emit}
          onKeyUp={() => refresh((n) => n + 1)}
          onMouseUp={() => refresh((n) => n + 1)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
              event.preventDefault();
              openLink();
            }
          }}
          onPaste={(event) => {
            event.preventDefault();
            const plain = event.clipboardData.getData("text/plain");
            const html = plain
              .split(/\n{2,}/)
              .map((block) => `<p>${escapeText(block).replace(/\n/g, "<br>")}</p>`)
              .join("");
            document.execCommand("insertHTML", false, html);
            emit();
          }}
          style={{ minHeight: `${rows * 1.6}rem` }}
          className="rich-text max-w-none px-3 py-2 text-base text-ink outline-none"
        />
      </div>
      {linking && (
        <form onSubmit={applyLink} className="mt-2 flex flex-wrap items-end gap-2 rounded-lg bg-surface p-3">
          <label className="min-w-56 flex-1 text-sm font-semibold">
            Adresse du lien
            <input autoFocus type="url" value={url} onChange={(event) => setUrl(event.target.value)} className="mt-1 block min-h-11 w-full rounded-lg border-2 border-surface-alt bg-white px-3 font-normal" />
          </label>
          <button type="submit" className="min-h-11 rounded-lg bg-gold px-4 font-bold text-gold-ink">
            Ajouter le lien
          </button>
          <button type="button" onClick={() => setLinking(false)} className="min-h-11 rounded-lg border-2 border-title bg-white px-4 font-bold text-title">
            Annuler
          </button>
        </form>
      )}
      {hint && (
        <p id={`${id}-aide`} className="mt-1 text-sm text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

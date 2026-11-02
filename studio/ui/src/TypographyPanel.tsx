import { useEffect, useState } from 'react';
import type { FontFamily, TextStyle } from '../../server/protocol';

export interface Typo {
  styles: string[];
  hero: string;
  caption: string;
  accent: string;
  highlight: string;
  size: string;
  position: string;
  words: string;
  caps: string;
}

export const AUTO = 'Auto';
export const EMPTY_TYPO: Typo = { styles: [], hero: AUTO, caption: AUTO, accent: AUTO, highlight: AUTO, size: AUTO, position: AUTO, words: AUTO, caps: AUTO };
const MAX_STYLES = 3;

const SWATCHES: [string, string][] = [
  ['Gold', '#E8B04A'],
  ['Saffron', '#FF9933'],
  ['Red', '#C62828'],
  ['Navy', '#1B2A4A'],
  ['Teal', '#1FA39A'],
  ['White', '#FFFFFF'],
];
const PAIRINGS: [string, string][] = [
  ['Castoro', 'Montserrat'],
  ['Playfair Display', 'DM Sans'],
];
const HIGHLIGHT = [AUTO, 'Box', 'Colour', 'Underline', 'Glow'];
const SIZE = [AUTO, 'S', 'M', 'L'];
const POSITION = [AUTO, 'Lower third', 'Centre', 'Upper third'];
const WORDS = [AUTO, '2', '3', '4', '5'];
const CAPS = [AUTO, 'As spoken', 'ALL CAPS'];

export interface Catalog {
  styles: TextStyle[];
  fonts: FontFamily[];
}

const previewFamily = (f: string) => `rs-${f.replace(/\W/g, '')}`;

/** Loads the style and font catalog, and registers every installed font with the browser for previews. */
export function useTypography() {
  const [cat, setCat] = useState<Catalog>({ styles: [], fonts: [] });
  const load = (c: Catalog) => {
    setCat(c);
    for (const f of c.fonts) {
      const file = f.files.find((p) => /regular|\[wght\]|medium/i.test(p) && !/italic/i.test(p)) || f.files[0];
      const face = new FontFace(previewFamily(f.family), `url(/api/fonts/file?path=${encodeURIComponent(file)})`);
      face.load().then((ff) => document.fonts.add(ff)).catch(() => {});
    }
  };
  const reload = () =>
    fetch('/api/typography')
      .then((r) => r.json())
      .then(load)
      .catch(() => {});
  useEffect(() => {
    reload();
  }, []);
  return { cat, setFonts: (fonts: FontFamily[]) => load({ ...cat, fonts }) };
}

/** The editor's choices as text for Claude. Empty when everything is on Auto. */
export function typoBrief(t: Typo, cat: Catalog): string {
  const lines: string[] = [];
  const styles = t.styles.map((id) => cat.styles.find((s) => s.id === id)).filter((s): s is TextStyle => !!s);
  if (styles.length) lines.push(`Text styles (use only these): ${styles.map((s) => `${s.name} (${s.ref})`).join('; ')}`);
  const font = (fam: string) => {
    const ps = cat.fonts.find((f) => f.family === fam)?.postscript.slice(0, 8) || [];
    return ps.length ? `${fam} [PostScript: ${ps.join(', ')}]` : fam;
  };
  if (t.hero !== AUTO) lines.push(`Headline / hero font: ${font(t.hero)}`);
  if (t.caption !== AUTO) lines.push(`Caption font: ${font(t.caption)}`);
  if (t.accent !== AUTO) lines.push(`Accent colour: ${t.accent}`);
  if (t.highlight !== AUTO) lines.push(`Keyword highlight: ${t.highlight}`);
  const cap = [
    t.size !== AUTO && `size ${t.size}`,
    t.position !== AUTO && `${t.position.toLowerCase()} (inside the Instagram safe zone)`,
    t.words !== AUTO && `${t.words} words per line`,
    t.caps !== AUTO && t.caps,
  ].filter(Boolean);
  if (cap.length) lines.push(`Captions: ${cap.join(', ')}`);
  return lines.length ? `Typography (chosen in the Reel Studio panel; these override default text choices):\n- ${lines.join('\n- ')}` : '';
}

export function TypographyPanel({ value, onChange, cat, setFonts }: { value: Typo; onChange: (fn: (t: Typo) => Typo) => void; cat: Catalog; setFonts: (f: FontFamily[]) => void }) {
  const set = (patch: Partial<Typo>) => onChange((t) => ({ ...t, ...patch }));
  const toggleStyle = (id: string) =>
    onChange((t) => ({ ...t, styles: t.styles.includes(id) ? t.styles.filter((s) => s !== id) : [...t.styles, id].slice(-MAX_STYLES) }));
  const families = cat.fonts.map((f) => f.family);

  return (
    <div className="typo">
      <section>
        <div className="typo-head">
          <h4>Text styles</h4>
          <span className="muted small">Pick up to {MAX_STYLES}. None picked: Claude chooses.</span>
          {value.styles.length > 0 && (
            <button className="link small" onClick={() => set({ styles: [] })}>
              Clear
            </button>
          )}
        </div>
        <div className="style-grid">
          {cat.styles.map((s) => (
            <StyleCard key={s.id} s={s} on={value.styles.includes(s.id)} order={value.styles.indexOf(s.id) + 1} onClick={() => toggleStyle(s.id)} />
          ))}
        </div>
      </section>

      <section>
        <div className="typo-head">
          <h4>Fonts</h4>
        </div>
        <div className="typo-row">
          <FontSelect label="Headline" value={value.hero} families={families} onChange={(hero) => set({ hero })} />
          <FontSelect label="Captions" value={value.caption} families={families} onChange={(caption) => set({ caption })} />
        </div>
        <div className="typo-row">
          {PAIRINGS.filter(([a, b]) => families.includes(a) && families.includes(b)).map(([a, b]) => (
            <button key={a} className={`chip-btn ${value.hero === a && value.caption === b ? 'on' : ''}`} onClick={() => set({ hero: a, caption: b })}>
              {a} + {b}
            </button>
          ))}
        </div>
        {(value.hero !== AUTO || value.caption !== AUTO) && (
          <div className="font-preview">
            {value.hero !== AUTO && <div style={{ fontFamily: previewFamily(value.hero), fontSize: 26, fontWeight: 700 }}>Shubh Diwali 2026</div>}
            {value.caption !== AUTO && <div style={{ fontFamily: previewFamily(value.caption), fontSize: 15 }}>aapki curiosity ko phir se jaga sakti hai</div>}
          </div>
        )}
        <AddFont onAdded={setFonts} />
      </section>

      <section>
        <div className="typo-head">
          <h4>Colour and highlight</h4>
        </div>
        <div className="typo-row">
          <button className={`chip-btn ${value.accent === AUTO ? 'on' : ''}`} onClick={() => set({ accent: AUTO })}>
            Auto
          </button>
          {SWATCHES.map(([name, hex]) => (
            <button key={hex} title={`${name} ${hex}`} aria-label={name} className={`swatch ${value.accent === hex ? 'on' : ''}`} style={{ background: hex }} onClick={() => set({ accent: hex })} />
          ))}
          <label className="swatch custom" title="Custom colour">
            <input type="color" value={value.accent.startsWith('#') ? value.accent : '#E8B04A'} onChange={(e) => set({ accent: e.target.value.toUpperCase() })} />
          </label>
          {value.accent !== AUTO && <span className="muted small">{value.accent}</span>}
        </div>
        <Seg label="Keyword highlight" options={HIGHLIGHT} value={value.highlight} onChange={(highlight) => set({ highlight })} />
      </section>

      <section>
        <div className="typo-head">
          <h4>Caption layout</h4>
        </div>
        <Seg label="Size" options={SIZE} value={value.size} onChange={(size) => set({ size })} />
        <Seg label="Position" options={POSITION} value={value.position} onChange={(position) => set({ position })} />
        <Seg label="Words per line" options={WORDS} value={value.words} onChange={(words) => set({ words })} />
        <Seg label="Case" options={CAPS} value={value.caps} onChange={(caps) => set({ caps })} />
      </section>
    </div>
  );
}

function StyleCard({ s, on, order, onClick }: { s: TextStyle; on: boolean; order: number; onClick: () => void }) {
  const [noThumb, setNoThumb] = useState(false);
  return (
    <button className={`style-card ${on ? 'on' : ''}`} onClick={onClick} title={s.bestFor}>
      <div className="style-thumb">
        {noThumb ? <span>{s.name}</span> : <img src={`/api/typography/thumb/${s.id}`} alt="" loading="lazy" onError={() => setNoThumb(true)} />}
        {on && <span className="style-order">{order}</span>}
      </div>
      <span className="style-name">{s.name}</span>
      <span className="style-best">{s.bestFor}</span>
    </button>
  );
}

function FontSelect({ label, value, families, onChange }: { label: string; value: string; families: string[]; onChange: (v: string) => void }) {
  return (
    <label className="field">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} style={value !== AUTO ? { fontFamily: previewFamily(value) } : undefined}>
        <option>{AUTO}</option>
        {families.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>
    </label>
  );
}

function Seg({ label, options, value, onChange }: { label: string; options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="seg-row">
      <span className="muted small">{label}</span>
      <div className="seg" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={o} role="radio" aria-checked={value === o} className={value === o ? 'on' : ''} onClick={() => onChange(o)}>
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

function AddFont({ onAdded }: { onAdded: (f: FontFamily[]) => void }) {
  const [name, setName] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(req: Promise<Response>) {
    setBusy(true);
    setMsg('');
    try {
      const r = await req;
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || 'Could not add the font');
      onAdded(body.fonts);
      setName('');
      setMsg(`Added ${body.files.length} file${body.files.length === 1 ? '' : 's'}. If After Effects is open, restart it so it sees the new font.`);
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="add-font">
      <div className="typo-row">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && name.trim() && run(fetch('/api/fonts/google', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ family: name }) }))}
          placeholder="Google Font name, e.g. Poppins"
        />
        <button
          className="ghost"
          disabled={busy || !name.trim()}
          onClick={() => run(fetch('/api/fonts/google', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ family: name }) }))}
        >
          {busy ? 'Adding…' : 'Download'}
        </button>
        <label className={`ghost upload-font ${busy ? 'disabled' : ''}`}>
          Upload .ttf / .otf
          <input
            type="file"
            accept=".ttf,.otf"
            multiple
            hidden
            disabled={busy}
            onChange={(e) => {
              const fd = new FormData();
              Array.from(e.target.files || []).forEach((f) => fd.append('files', f));
              e.target.value = '';
              run(fetch('/api/fonts/upload', { method: 'POST', body: fd }));
            }}
          />
        </label>
      </div>
      {msg && <div className="muted small">{msg}</div>}
    </div>
  );
}

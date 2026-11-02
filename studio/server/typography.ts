// Text styles and fonts for the composer's typography panel. Styles are the looks Claude knows how to build in AE;
// fonts are whatever is installed in ~/Library/Fonts, plus Google Fonts or font files the editor adds from the UI.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import type { FontFamily, TextStyle } from './protocol.js';

const MOVIES = path.join(os.homedir(), 'Movies');
const LIB = path.join(MOVIES, '_studio/text_styles');
export const FONT_DIR = process.env.STUDIO_FONT_DIR || path.join(os.homedir(), 'Library/Fonts');
const THUMBS = path.join(LIB, 'thumbs');
const STS = `STS library ${path.join(LIB, 'studio_text_styles.jsx').replace(os.homedir(), '~')}`;
const DEMO = path.join(LIB, 'Style_Demo.mp4');
const AK360 = path.join(MOVIES, 'sanjeevji/Ak 360 23.mp4');

type Style = TextStyle & { src: string; t: number };

// `ref` tells Claude where the look is already built; src/t is the frame used for the card thumbnail.
const STYLES: Style[] = [
  { id: 'moon', name: 'Moon Reel', bestFor: 'Bold caps captions, gold keyword, night scenes', ref: 'as in ~/Movies/Astro_arun/Moon_Reel_edit/build_moon_aep.jsx', src: path.join(MOVIES, 'Astro_arun/Moon_Reel_edit/Moon_Reel_final.mp4'), t: 28.5 },
  { id: 'boxHighlight', name: 'Box highlight', bestFor: 'Talking head, busy clothes', ref: `STS.boxHighlight, ${STS}`, src: DEMO, t: 3.0 },
  { id: 'editorial', name: 'Editorial', bestFor: 'Intros, stock scenes', ref: `STS.editorial, ${STS}`, src: DEMO, t: 7.5 },
  { id: 'multiline', name: 'Multiline lockup', bestFor: 'Key numbers and dates', ref: `STS.multiline, ${STS}`, src: DEMO, t: 11.8 },
  { id: 'karaoke', name: 'Karaoke', bestFor: 'Captions, words light up as spoken', ref: `STS.karaoke, ${STS}`, src: DEMO, t: 16.6 },
  { id: 'goldPunch', name: 'Gold punch', bestFor: 'Hooks and warnings', ref: `STS.goldPunch, ${STS}`, src: DEMO, t: 20.6 },
  { id: 'deepGlow', name: 'Deep glow', bestFor: 'Dark or gold stock', ref: `STS.deepGlow, ${STS}`, src: DEMO, t: 25.2 },
  { id: 'behindPerson', name: 'Text behind person', bestFor: 'One big hook word behind the speaker', ref: `STS.behindPerson, ${STS}`, src: DEMO, t: 29.6 },
  { id: 'pill', name: 'Pill captions', bestFor: 'Small captions at chest height', ref: 'as in ~/Movies/sakshiji/sakshiji_switchword/Switch_edit/build_switch.jsx', src: AK360, t: 24 },
  { id: 'banner', name: 'Hook banner', bestFor: 'Opening hook on a torn-paper banner', ref: 'as in ~/Movies/sakshiji/sakshiji_switchword/Switch_edit/build_switch.jsx', src: AK360, t: 1 },
];

export const listStyles = (): TextStyle[] => STYLES.map(({ src: _s, t: _t, ...s }) => s);

/** Card thumbnail for a style, cut once from its example video with ffmpeg and cached next to the library. */
export function styleThumb(id: string): Promise<string | undefined> {
  const s = STYLES.find((x) => x.id === id);
  if (!s) return Promise.resolve(undefined);
  const out = path.join(THUMBS, `${id}.jpg`);
  // a cached thumb is enough; the source video may not exist on a Mac set up from the studio kit
  if (fs.existsSync(out)) return Promise.resolve(out);
  if (!fs.existsSync(s.src)) return Promise.resolve(undefined);
  fs.mkdirSync(THUMBS, { recursive: true });
  return new Promise((resolve) =>
    execFile('ffmpeg', ['-v', 'error', '-y', '-ss', String(s.t), '-i', s.src, '-frames:v', '1', '-vf', 'scale=270:-2', '-q:v', '4', out], (err) =>
      resolve(err ? undefined : out),
    ),
  );
}

// --- fonts -------------------------------------------------------------------------------------------------------

const FONT_EXT = /\.(ttf|otf|ttc)$/i;

/** Family and PostScript names from a font file's `name` table (TTF/OTF, first face of a TTC). */
function fontNames(file: string): { family: string; ps: string } | undefined {
  try {
    const b = fs.readFileSync(file);
    const base = b.toString('latin1', 0, 4) === 'ttcf' ? b.readUInt32BE(12) : 0;
    const n = b.readUInt16BE(base + 4);
    let name = -1;
    for (let i = 0; i < n; i++) {
      const rec = base + 12 + i * 16;
      if (b.toString('latin1', rec, rec + 4) === 'name') name = b.readUInt32BE(rec + 8);
    }
    if (name < 0) return undefined;
    const count = b.readUInt16BE(name + 2);
    const strings = name + b.readUInt16BE(name + 4);
    const found: Record<number, string> = {};
    for (let i = 0; i < count; i++) {
      const r = name + 6 + i * 12;
      const [platform, , lang, id, len, off] = [0, 2, 4, 6, 8, 10].map((o) => b.readUInt16BE(r + o));
      if (![1, 6, 16].includes(id) || found[id]) continue;
      const raw = b.subarray(strings + off, strings + off + len);
      if (platform === 3 && (lang & 0x3ff) === 0x09) found[id] = Buffer.from(raw).swap16().toString('utf16le');
      else if (platform === 1 && lang === 0) found[id] = raw.toString('latin1');
    }
    const family = found[16] || found[1];
    return family ? { family, ps: found[6] || '' } : undefined;
  } catch {
    return undefined;
  }
}

function fontFiles(dir = FONT_DIR, depth = 0): string[] {
  let names: fs.Dirent[] = [];
  try {
    names = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return names.flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory() && depth < 2) return fontFiles(p, depth + 1);
    return d.isFile() && FONT_EXT.test(d.name) ? [p] : [];
  });
}

const WEIGHT_SUFFIX = /\s+(Thin|Hairline|ExtraLight|UltraLight|Light|Medium|SemiBold|DemiBold|ExtraBold|UltraBold|Black|Heavy)$/i;

const nameCache = new Map<string, { mtime: number; names?: { family: string; ps: string } }>();

export function listFonts(): FontFamily[] {
  const fams = new Map<string, FontFamily>();
  for (const f of fontFiles()) {
    const mtime = fs.statSync(f).mtimeMs;
    let c = nameCache.get(f);
    if (!c || c.mtime !== mtime) nameCache.set(f, (c = { mtime, names: fontNames(f) }));
    // static files from Google name each weight as its own family ("Poppins Medium"); fold them into one
    const family = (c.names?.family || path.basename(f).replace(/[-_[].*$|\..*$/, '')).replace(WEIGHT_SUFFIX, '');
    const fam = fams.get(family) || { family, files: [], postscript: [] };
    fam.files.push(path.relative(FONT_DIR, f));
    if (c.names?.ps) fam.postscript.push(c.names.ps);
    fams.set(family, fam);
  }
  return [...fams.values()].sort((a, b) => a.family.localeCompare(b.family));
}

/** A font file the browser may load for previews; only files inside ~/Library/Fonts. */
export function fontFile(rel: string): string | undefined {
  const abs = path.resolve(FONT_DIR, rel);
  return abs.startsWith(FONT_DIR + path.sep) && FONT_EXT.test(abs) && fs.existsSync(abs) ? abs : undefined;
}

const WEIGHTS: Record<string, string> = {
  '100': 'Thin', '200': 'ExtraLight', '300': 'Light', '400': 'Regular', '500': 'Medium',
  '600': 'SemiBold', '700': 'Bold', '800': 'ExtraBold', '900': 'Black',
};

/** Download a Google Fonts family as static TTFs into ~/Library/Fonts/<Family>/. Returns the files written. */
export async function installGoogleFont(family: string): Promise<string[]> {
  const clean = family.trim().replace(/\s+/g, ' ');
  if (!/^[A-Za-z0-9 ]{2,60}$/.test(clean)) throw new Error('Type a Google Fonts family name, e.g. "Poppins"');
  const want = '300,400,500,600,700,800,900,400italic,700italic';
  // a plain user agent makes Google serve TrueType, which After Effects can use
  const r = await fetch(`https://fonts.googleapis.com/css?family=${encodeURIComponent(clean).replace(/%20/g, '+')}:${want}`, {
    headers: { 'user-agent': 'node' },
  });
  if (!r.ok) throw new Error(`Google Fonts has no family called "${clean}"`);
  const css = await r.text();
  const faces = [...css.matchAll(/font-style:\s*(\w+);\s*font-weight:\s*(\d+);[^}]*?src:\s*url\(([^)]+\.ttf)\)/g)];
  if (!faces.length) throw new Error(`No TrueType files found for "${clean}"`);
  const dir = path.join(FONT_DIR, clean.replace(/ /g, ''));
  fs.mkdirSync(dir, { recursive: true });
  const seen = new Set<string>();
  const written: string[] = [];
  for (const [, style, weight, url] of faces) {
    if (seen.has(url)) continue; // Google repeats the nearest file for weights a family lacks
    seen.add(url);
    const name = `${clean.replace(/ /g, '')}-${WEIGHTS[weight] || weight}${style === 'italic' ? 'Italic' : ''}.ttf`;
    const res = await fetch(url);
    if (!res.ok) continue;
    fs.writeFileSync(path.join(dir, name), Buffer.from(await res.arrayBuffer()));
    written.push(path.join(path.basename(dir), name));
  }
  return written;
}

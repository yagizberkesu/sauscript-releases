/**
 * SABİS sayfalarında "Öğrenci Bilgi Sistemi" başlığının hemen altında öğrencinin adı,
 * Anasayfa'da ise onun da altında öğrenci numarası (ör. B231210067) yazar. Profiller bu
 * bilgiyle sahibine bağlanır; başka birinin notları yanlış profile aktarılmaz.
 */
export interface StudentIdentity {
  name: string;
  number: string;
}

const NUMBER_RE = /^[A-ZÇĞİÖŞÜ]?\d{9,11}$/;
const NAME_RE = /^[A-ZÇĞİÖŞÜ][A-ZÇĞİÖŞÜ.'\- ]+$/;
const ANCHOR_RE = /öğrenci bilgi sistemi/i;

export const normalizeName = (name: string) => name.toLocaleUpperCase("tr").replace(/\s+/g, " ").trim();

/** Ad bulunamazsa null; numara her sayfada olmadığı için boş kalabilir. */
export function extractIdentity(text: string): StudentIdentity | null {
  const lines = text.split(/\r?\n/).map((line) => line.replace(/^[*\-\s]+/, "").trim()).filter(Boolean);
  const anchor = lines.findIndex((line) => ANCHOR_RE.test(line));
  if (anchor < 0) return null;
  const name = lines[anchor + 1] ?? "";
  // Ad en az iki kelime ve tamamı büyük harf; "Ders Programı" gibi sayfa başlıkları elenir.
  if (!NAME_RE.test(name) || name.trim().split(/\s+/).length < 2) return null;
  const next = (lines[anchor + 2] ?? "").replace(/\s+/g, "");
  return { name: normalizeName(name), number: NUMBER_RE.test(next) ? next.toLocaleUpperCase("tr") : "" };
}

/** İki tarafta da numara varsa numaraya, yoksa ada bakılır. */
export function sameStudent(a: StudentIdentity, b: StudentIdentity) {
  if (a.number && b.number) return a.number === b.number;
  return normalizeName(a.name) === normalizeName(b.name);
}

/** "YAĞIZ BERKE SU" → "Yağız Berke Su" */
export const displayName = (name: string) =>
  name.toLocaleLowerCase("tr").replace(/(^|\s)(\S)/g, (_, space: string, letter: string) => space + letter.toLocaleUpperCase("tr"));

import { Course, CourseStatus, SAU_GRADE_POINTS } from "./types";

const GRADES = "AA|BA|BB|CB|CC|DC|DD|FD|FF|YT|ALMADI";
const SEMESTER_LINE = /^(\d+)\.\s*Yarıyıl$/i;

function normalizeLine(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export interface SelectedCourseImport {
  code: string;
  name: string;
  assessments: Array<{ type: string; weight: number }>;
}

export function parseSelectedCourses(text: string): SelectedCourseImport[] {
  const lines = text.split(/\r?\n/).map(normalizeLine).filter(Boolean);
  const codePattern = /^[A-ZÇĞİÖŞÜ]{2,}\d{3}$/i;
  const numberPattern = /^\d+(?:[,.]\d+)?$/;
  const scorePattern = /^(?:\d+(?:[,.]\d+)?|GR)$/i;
  const codeIndexes = lines.flatMap((line, index) => codePattern.test(line) ? [index] : []);

  return codeIndexes.flatMap((start, codeIndex) => {
    const block = lines.slice(start + 1, codeIndexes[codeIndex + 1] ?? lines.length);
    const groupIndex = block.findIndex((line) => /Öğretim.*Grubu/i.test(line));
    const headerIndex = block.findIndex((line) => /^Oran(?:\s+Çalışma Tipi\s+Not)?$/i.test(line));
    const nameEnd = groupIndex >= 0 ? groupIndex : headerIndex;
    const name = block.slice(0, nameEnd >= 0 ? nameEnd : 1).join(" ").trim();
    const assessmentStart = headerIndex >= 0 ? headerIndex + 1 : Math.max(groupIndex + 1, 0);
    const assessmentLines = block.slice(assessmentStart);
    const assessments: Array<{ type: string; weight: number }> = [];

    for (let index = 0; index < assessmentLines.length; index += 1) {
      const line = assessmentLines[index];
      if (/^Başarı Notu/i.test(line)) break;
      // Not sütunu dönem başında boş gelir ("20 Ara Sınav"); not varsa sonda durur ("20 Ara Sınav 40").
      const complete = line.match(/^(\d+(?:[,.]\d+)?)\s+(.+?)(?:\s+(?:\d+(?:[,.]\d+)?|GR))?$/i);
      let rawWeight = "";
      let type = "";
      if (complete) {
        rawWeight = complete[1];
        type = complete[2];
      } else if (numberPattern.test(line) && assessmentLines[index + 1] && assessmentLines[index + 2] && scorePattern.test(assessmentLines[index + 2])) {
        rawWeight = line;
        type = assessmentLines[index + 1];
        index += 2;
      }
      const weight = Number(rawWeight.replace(",", "."));
      if (!type || !weight || /Bütünleme/i.test(type)) continue;
      assessments.push({ type: /Ara Sınav/i.test(type) ? "Vize" : type, weight });
    }

    return name && assessments.length ? [{ code: lines[start].toUpperCase(), name, assessments }] : [];
  });
}

export function parsePastedTranscript(text: string): Course[] {
  const courses: Course[] = [];
  const lines = text.split(/\r?\n/).map(normalizeLine).filter(Boolean);
  let semester = 0;
  let pendingName = "";
  let pendingType = "";
  let pendingGrade: CourseStatus | "" = "";

  const addCourse = (name: string, type: string, grade: CourseStatus, credits: number) => {
    const normalizedName = name.replace(/\s*\*\s*$/, "").trim();
    const excluded = name.includes("*") || grade === "YT" || grade === "ALMADI";
    courses.push({
      id: `s${semester}-${courses.length}-${normalizedName.toLocaleLowerCase("tr-TR").replace(/[^a-z0-9çğıöşü]+/gi, "-")}`,
      semester,
      name: normalizedName,
      type: type || "Zorunlu",
      credits,
      grade,
      included: !excluded
    });
    pendingName = "";
    pendingType = "";
    pendingGrade = "";
  };

  for (const line of lines) {
    const semesterMatch = line.match(SEMESTER_LINE);
    if (semesterMatch) {
      semester = Number(semesterMatch[1]);
      pendingName = "";
      pendingType = "";
      pendingGrade = "";
      continue;
    }
    if (!semester || /^(Ders Adı|Toplam AKTS|Dönem Sonu:|Genel:)/i.test(line)) continue;

    const complete = line.match(new RegExp(`^(.*?)\\s*(Zorunlu|Seçmeli)\\s+(${GRADES})\\s+(\\d+(?:[,.]\\d+)?)$`, "i"));
    if (complete) {
      const [, prefix, type, rawGrade, rawCredits] = complete;
      addCourse(pendingName || prefix.trim() || "Seçmeli Ders", type, rawGrade.toUpperCase() as CourseStatus, Number(rawCredits.replace(",", ".")));
      continue;
    }

    const typeMatch = line.match(/^(.*?)(Zorunlu|Seçmeli)$/i);
    if (typeMatch) {
      pendingType = typeMatch[2];
      if (!pendingName && typeMatch[1].trim()) pendingName = typeMatch[1].trim();
      continue;
    }
    if (new RegExp(`^(${GRADES})$`, "i").test(line)) {
      pendingGrade = line.toUpperCase() as CourseStatus;
      continue;
    }
    if (pendingName && pendingGrade && /^\d+(?:[,.]\d+)?$/.test(line)) {
      addCourse(pendingName, pendingType, pendingGrade, Number(line.replace(",", ".")));
      continue;
    }

    if (/^Seçmeli Ders$/i.test(pendingName)) pendingName = line;
    else if (!pendingName) pendingName = line;
  }

  return courses;
}

export function transcriptLooksValid(courses: Course[]) {
  return courses.length >= 2 && courses.some((course) => course.grade in SAU_GRADE_POINTS);
}

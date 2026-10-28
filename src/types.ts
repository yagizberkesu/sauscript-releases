export const SAU_GRADE_POINTS = {
  AA: 4,
  BA: 3.5,
  BB: 3,
  CB: 2.5,
  CC: 2,
  DC: 1.5,
  DD: 1,
  FD: 0.5,
  FF: 0
} as const;

export type LetterGrade = keyof typeof SAU_GRADE_POINTS;
export type CourseStatus = LetterGrade | "ALMADI" | "YT";

export interface Course {
  id: string;
  semester: number;
  name: string;
  type: string;
  credits: number;
  grade: CourseStatus;
  included: boolean;
}

export interface Scenario {
  courseId: string;
  grade: LetterGrade | "";
  operation: "new" | "replacement";
}

export interface TranscriptSummary {
  credits: number;
  weight: number;
  gpa: number;
}

export interface TermAssessment {
  id: string;
  type: string;
  weight: number;
  score: number | "";
}

export interface SavedState {
  courses: Course[];
  scenarios: Scenario[];
  gradePoints: Record<LetterGrade, number>;
  mode: "sau" | "general";
}

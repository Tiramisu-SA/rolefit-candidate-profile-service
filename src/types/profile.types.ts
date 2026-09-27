/**
 * Domain types for candidate profiles.
 *
 * These are shared by REST controllers, gRPC handlers, the service layer and
 * the repository. Keep them independent of Express, gRPC and SQL.
 * Shapes follow docs/superpowers/specs/2026-09-27-profile-rest-crud-design.md.
 */

export const PROFICIENCY_LEVELS = ['BASIC', 'INTERMEDIATE', 'ADVANCED'] as const;
export const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'INTERNSHIP', 'CONTRACT'] as const;
export const WORK_ARRANGEMENTS = ['ONSITE', 'HYBRID', 'REMOTE'] as const;

export type ProficiencyLevel = (typeof PROFICIENCY_LEVELS)[number];
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
export type WorkArrangement = (typeof WORK_ARRANGEMENTS)[number];

/** Validated profile basics (the candidate_profile columns a candidate may edit). */
export interface ProfileBasics {
  name: string;
  headline: string | null;
  summary: string | null;
  email: string | null;
  location: string | null;
  links: string[];
}

export interface SkillData {
  name: string;
  proficiencyLevel: ProficiencyLevel | null;
}

export interface ExperienceData {
  companyName: string;
  jobTitle: string;
  /** YYYY-MM-DD */
  startDate: string | null;
  /** YYYY-MM-DD */
  endDate: string | null;
  isCurrent: boolean;
  bullets: string[];
}

export interface EducationData {
  institutionName: string;
  degree: string;
  fieldOfStudy: string | null;
  gpa: number | null;
  /** YYYY */
  year: string | null;
}

export interface ProjectData {
  name: string;
  tech: string[];
  bullets: string[];
}

export interface PreferencesData {
  employmentTypes: EmploymentType[];
  preferredRoles: string[];
  workArrangements: WorkArrangement[];
  preferredLocations: string[];
  minimumSalary: number | null;
  salaryCurrency: string | null;
}

/** A whole profile in one request: used by confirm and returned by import-resume. */
export interface ProfileDocument extends ProfileBasics {
  skills: SkillData[];
  experience: ExperienceData[];
  education: EducationData[];
  projects: ProjectData[];
  preferences: PreferencesData | null;
}

export type Skill = SkillData & { id: string };
export type Experience = ExperienceData & { id: string };
export type Education = EducationData & { id: string };
export type Project = ProjectData & { id: string };
export type Preferences = PreferencesData;

/** The four one-to-many child tables, keyed by their REST collection name. */
export interface ChildDataMap {
  skills: SkillData;
  experience: ExperienceData;
  education: EducationData;
  projects: ProjectData;
}
export type ChildKind = keyof ChildDataMap;
export type ChildRow<K extends ChildKind> = ChildDataMap[K] & { id: string };

export interface CandidateProfile extends ProfileBasics {
  id: string;
  userId: string;
  verified: boolean;
  totalExperienceMonths: number;
  skills: Skill[];
  experience: Experience[];
  education: Education[];
  projects: Project[];
  preferences: Preferences | null;
  createdAt: Date;
  updatedAt: Date;
}

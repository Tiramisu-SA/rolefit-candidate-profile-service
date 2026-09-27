import type { Pool, PoolClient } from 'pg';
import type { ProfileRepository } from './profile.repository';
import type {
  CandidateProfile,
  ChildDataMap,
  ChildKind,
  ChildRow,
  Preferences,
  PreferencesData,
  ProfileBasics,
  ProfileDocument,
} from '../types/profile.types';
import { ConflictError } from '../utils/errors';

type Queryable = Pool | PoolClient;

/** Each child collection: table, domain key -> column, and the API ordering. */
const CHILD_TABLES: Record<ChildKind, { table: string; columns: Record<string, string>; orderBy: string }> = {
  skills: {
    table: 'candidate_skill',
    columns: { name: 'skill_name', proficiencyLevel: 'proficiency_level' },
    orderBy: 'lower(skill_name)',
  },
  experience: {
    table: 'work_experience',
    columns: {
      companyName: 'company_name',
      jobTitle: 'job_title',
      startDate: 'start_date',
      endDate: 'end_date',
      isCurrent: 'is_current',
      bullets: 'bullets',
    },
    orderBy: 'is_current DESC, start_date DESC NULLS LAST',
  },
  education: {
    table: 'education',
    columns: { institutionName: 'institution_name', degree: 'degree', fieldOfStudy: 'field_of_study', gpa: 'gpa', year: 'year' },
    orderBy: 'year DESC NULLS LAST',
  },
  projects: {
    table: 'project',
    columns: { name: 'name', tech: 'tech', bullets: 'bullets' },
    orderBy: 'lower(name)',
  },
};

const BASIC_COLUMNS = ['name', 'headline', 'summary', 'email', 'location', 'links'] as const;

const PROFILE_SELECT = `
  SELECT id, name, headline, summary, email, location, links, verified,
         coalesce(total_experience_months, 0) AS "totalExperienceMonths",
         created_at AS "createdAt", updated_at AS "updatedAt"
  FROM candidate_profile`;

const PREFERENCES_SELECT = `
  employment_types AS "employmentTypes", coalesce(preferred_roles, '{}') AS "preferredRoles",
  coalesce(work_arrangements, '{}') AS "workArrangements", coalesce(preferred_locations, '{}') AS "preferredLocations",
  minimum_salary AS "minimumSalary", salary_currency AS "salaryCurrency"`;

function selectList(kind: ChildKind): string {
  const cols = Object.entries(CHILD_TABLES[kind].columns).map(([key, col]) => `${col} AS "${key}"`);
  return ['id', ...cols].join(', ');
}

/** pg returns numeric as string: turn gpa / minimumSalary back into numbers. */
function toNumberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function mapChild<K extends ChildKind>(kind: K, row: Record<string, unknown>): ChildRow<K> {
  if (kind === 'education') row.gpa = toNumberOrNull(row.gpa);
  return row as unknown as ChildRow<K>;
}

function mapPreferences(row: Record<string, unknown>): Preferences {
  return { ...(row as unknown as Preferences), minimumSalary: toNumberOrNull(row.minimumSalary) };
}

function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = err as { code?: string; constraint?: string };
  return e?.code === '23505' && (constraint === undefined || e.constraint === constraint);
}

/**
 * PostgreSQL implementation of ProfileRepository (Supabase database).
 * The only code in RoleFit that reads or writes candidate profile tables.
 */
export class PostgresProfileRepository implements ProfileRepository {
  constructor(
    private readonly db: Queryable,
    private readonly inTransaction = false,
  ) {}

  async transaction<T>(fn: (repo: ProfileRepository) => Promise<T>): Promise<T> {
    if (this.inTransaction) return fn(this);
    const client = await (this.db as Pool).connect();
    try {
      await client.query('BEGIN');
      const result = await fn(new PostgresProfileRepository(client, true));
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async findById(id: string): Promise<CandidateProfile | null> {
    const { rows } = await this.db.query(`${PROFILE_SELECT} WHERE id = $1`, [id]);
    return rows[0] ? this.assemble(rows[0]) : null;
  }

  async create(id: string, basics: ProfileBasics): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO candidate_profile (id, name, headline, summary, email, location, links)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, basics.name, basics.headline, basics.summary, basics.email, basics.location, basics.links],
      );
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictError('PROFILE_ALREADY_EXISTS', 'You already have a profile');
      throw err;
    }
  }

  async updateBasics(profileId: string, changes: Partial<ProfileBasics>): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [profileId];
    for (const column of BASIC_COLUMNS) {
      if (column in changes) {
        values.push(changes[column]);
        sets.push(`${column} = $${values.length}`);
      }
    }
    sets.push('updated_at = now()');
    await this.db.query(`UPDATE candidate_profile SET ${sets.join(', ')} WHERE id = $1`, values);
  }

  async deleteById(profileId: string): Promise<void> {
    await this.db.query('DELETE FROM candidate_profile WHERE id = $1', [profileId]);
  }

  async touch(profileId: string): Promise<void> {
    await this.db.query('UPDATE candidate_profile SET updated_at = now() WHERE id = $1', [profileId]);
  }

  async setExperienceMonths(profileId: string, months: number): Promise<void> {
    await this.db.query('UPDATE candidate_profile SET total_experience_months = $2 WHERE id = $1', [profileId, months]);
  }

  async listChildren<K extends ChildKind>(kind: K, profileId: string): Promise<ChildRow<K>[]> {
    const { table, orderBy } = CHILD_TABLES[kind];
    const { rows } = await this.db.query(
      `SELECT ${selectList(kind)} FROM ${table} WHERE candidate_id = $1 ORDER BY ${orderBy}, id`,
      [profileId],
    );
    return rows.map((row) => mapChild(kind, row));
  }

  async insertChild<K extends ChildKind>(kind: K, profileId: string, data: ChildDataMap[K]): Promise<ChildRow<K>> {
    const { table, columns } = CHILD_TABLES[kind];
    const keys = Object.keys(columns);
    const values = keys.map((key) => (data as unknown as Record<string, unknown>)[key]);
    const placeholders = keys.map((_, i) => `$${i + 2}`);
    try {
      const { rows } = await this.db.query(
        `INSERT INTO ${table} (candidate_id, ${keys.map((k) => columns[k]).join(', ')})
         VALUES ($1, ${placeholders.join(', ')}) RETURNING ${selectList(kind)}`,
        [profileId, ...values],
      );
      return mapChild(kind, rows[0]);
    } catch (err) {
      throw this.mapSkillConflict(kind, err, data);
    }
  }

  async updateChild<K extends ChildKind>(
    kind: K,
    profileId: string,
    id: string,
    data: ChildDataMap[K],
  ): Promise<ChildRow<K> | null> {
    const { table, columns } = CHILD_TABLES[kind];
    const keys = Object.keys(columns);
    const sets = keys.map((key, i) => `${columns[key]} = $${i + 3}`);
    const values = keys.map((key) => (data as unknown as Record<string, unknown>)[key]);
    try {
      const { rows } = await this.db.query(
        `UPDATE ${table} SET ${sets.join(', ')} WHERE id = $1 AND candidate_id = $2 RETURNING ${selectList(kind)}`,
        [id, profileId, ...values],
      );
      return rows[0] ? mapChild(kind, rows[0]) : null;
    } catch (err) {
      throw this.mapSkillConflict(kind, err, data);
    }
  }

  async deleteChild(kind: ChildKind, profileId: string, id: string): Promise<boolean> {
    const { rowCount } = await this.db.query(`DELETE FROM ${CHILD_TABLES[kind].table} WHERE id = $1 AND candidate_id = $2`, [
      id,
      profileId,
    ]);
    return (rowCount ?? 0) > 0;
  }

  async getPreferences(profileId: string): Promise<Preferences | null> {
    const { rows } = await this.db.query(`SELECT ${PREFERENCES_SELECT} FROM job_preference WHERE candidate_id = $1`, [profileId]);
    return rows[0] ? mapPreferences(rows[0]) : null;
  }

  async upsertPreferences(profileId: string, data: PreferencesData): Promise<Preferences> {
    const { rows } = await this.db.query(
      `INSERT INTO job_preference
         (candidate_id, employment_types, preferred_roles, work_arrangements, preferred_locations, minimum_salary, salary_currency)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (candidate_id) DO UPDATE SET
         employment_types = EXCLUDED.employment_types,
         preferred_roles = EXCLUDED.preferred_roles,
         work_arrangements = EXCLUDED.work_arrangements,
         preferred_locations = EXCLUDED.preferred_locations,
         minimum_salary = EXCLUDED.minimum_salary,
         salary_currency = EXCLUDED.salary_currency
       RETURNING ${PREFERENCES_SELECT}`,
      [
        profileId,
        data.employmentTypes,
        data.preferredRoles,
        data.workArrangements,
        data.preferredLocations,
        data.minimumSalary,
        data.salaryCurrency,
      ],
    );
    return mapPreferences(rows[0]);
  }

  async deletePreferences(profileId: string): Promise<boolean> {
    const { rowCount } = await this.db.query('DELETE FROM job_preference WHERE candidate_id = $1', [profileId]);
    return (rowCount ?? 0) > 0;
  }

  async replaceDocument(profileId: string, doc: ProfileDocument, experienceMonths: number): Promise<void> {
    await this.transaction(async (tx) => {
      const repo = tx as PostgresProfileRepository;
      await repo.db.query(
        `INSERT INTO candidate_profile
           (id, name, headline, summary, email, location, links, verified, total_experience_months)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, headline = EXCLUDED.headline, summary = EXCLUDED.summary,
           email = EXCLUDED.email, location = EXCLUDED.location, links = EXCLUDED.links,
           verified = true, total_experience_months = EXCLUDED.total_experience_months, updated_at = now()`,
        [profileId, doc.name, doc.headline, doc.summary, doc.email, doc.location, doc.links, experienceMonths],
      );

      for (const { table } of Object.values(CHILD_TABLES)) {
        await repo.db.query(`DELETE FROM ${table} WHERE candidate_id = $1`, [profileId]);
      }
      await repo.db.query('DELETE FROM job_preference WHERE candidate_id = $1', [profileId]);

      for (const skill of doc.skills) await repo.insertChild('skills', profileId, skill);
      for (const exp of doc.experience) await repo.insertChild('experience', profileId, exp);
      for (const edu of doc.education) await repo.insertChild('education', profileId, edu);
      for (const project of doc.projects) await repo.insertChild('projects', profileId, project);
      if (doc.preferences) await repo.upsertPreferences(profileId, doc.preferences);
    });
  }

  private async assemble(row: Record<string, unknown>): Promise<CandidateProfile> {
    const id = row.id as string;
    const [skills, experience, education, projects, preferences] = await Promise.all([
      this.listChildren('skills', id),
      this.listChildren('experience', id),
      this.listChildren('education', id),
      this.listChildren('projects', id),
      this.getPreferences(id),
    ]);
    return { ...(row as unknown as CandidateProfile), skills, experience, education, projects, preferences };
  }

  private mapSkillConflict(kind: ChildKind, err: unknown, data: unknown): unknown {
    if (kind === 'skills' && isUniqueViolation(err)) {
      return new ConflictError('DUPLICATE_SKILL', `You already have the skill "${(data as { name: string }).name}"`);
    }
    return err;
  }
}

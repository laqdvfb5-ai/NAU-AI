import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import type { Student, StudentDataProvider } from '@nau/domain';
import { Database } from './database.js';
import { env, root } from './config.js';
/** Integration modules implement the canonical contract. No NAU endpoint or database schema is assumed. */
export async function createStudentProvider(db: Database): Promise<StudentDataProvider> {
  if (env.synthetic) return db;
  if (!process.env.STUDENT_PROVIDER_MODULE)
    throw new Error(
      'Real data requires a reviewed STUDENT_PROVIDER_MODULE. No mock fallback is allowed.',
    );
  const module = await import(
    pathToFileURL(resolve(root, process.env.STUDENT_PROVIDER_MODULE)).href
  );
  const adapter = (await module.createProvider()) as StudentDataProvider;
  if (typeof adapter?.getStudent !== 'function' || typeof adapter?.count !== 'function')
    throw new Error('Invalid StudentDataProvider module.');
  return {
    count: () => adapter.count(),
    async getStudent(id: string) {
      const student: Student | null = await adapter.getStudent(id);
      if (!student) return null;
      if (
        student.id !== id ||
        student.synthetic !== false ||
        !Array.isArray(student.courses) ||
        !student.admittedAt
      )
        throw new Error('Student adapter returned a mismatched or invalid canonical identity.');
      return student;
    },
  };
}

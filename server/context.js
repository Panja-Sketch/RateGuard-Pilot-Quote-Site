// Wires services together. Every service receives the same store/audit/clock so tests can inject
// an in-memory store and a fixed clock.
import { AuditLog } from './services/audit.js';
import { VersionService } from './services/versions.js';
import { QuoteService } from './services/quote.js';
import { seedAll } from './seed/index.js';
import { MemoryBlobStore } from './store/blobs.js';

export async function createContext({ store, blobs = new MemoryBlobStore(), clock = () => new Date(), seed = true, samplesDir } = {}) {
  const audit = new AuditLog(store, clock);
  const versions = new VersionService({ store, audit, clock });
  const quotes = new QuoteService({ store, versions, audit, clock });
  const ctx = { store, blobs, samplesDir, clock, audit, versions, quotes };
  const { SubmissionService } = await import('./services/submissions.js');
  const { WorkbookService } = await import('./services/workbooks.js');
  const { FeedbackService } = await import('./services/feedback.js');
  const { TestToolsService } = await import('./services/testtools.js');
  ctx.submissions = new SubmissionService(ctx);
  ctx.workbooks = new WorkbookService(ctx);
  ctx.feedback = new FeedbackService(ctx);
  ctx.testTools = new TestToolsService(ctx);
  if (seed && (await store.count('products')) === 0) {
    await seedAll(ctx);
    const { seedSubmissions } = await import('./seed/submissions.js');
    await seedSubmissions(ctx);
  }
  return ctx;
}

export async function resetData(ctx) {
  await ctx.store.clear();
  const { seedAll: reseed } = await import('./seed/index.js');
  await reseed(ctx);
  const { seedSubmissions } = await import('./seed/submissions.js');
  await seedSubmissions(ctx);
}

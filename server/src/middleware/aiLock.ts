/**
 * In-flight request deduplication lock per user account.
 * Prevents race conditions and duplicate AI generation charges from rapid duplicate clicks.
 */
export const activeAiUsers = new Set<string>();

export function acquireAiLock(userId: string): boolean {
  if (activeAiUsers.has(userId)) {
    return false;
  }
  activeAiUsers.add(userId);
  return true;
}

export function releaseAiLock(userId: string): void {
  activeAiUsers.delete(userId);
}

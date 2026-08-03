export function shouldUploadLocalState(
  localUpdatedAtISO: string | null,
  cloudUpdatedAtISO: string | null,
  pendingMutationCount: number
): boolean {
  if (pendingMutationCount > 0) return true;
  return !!localUpdatedAtISO && (!cloudUpdatedAtISO || localUpdatedAtISO > cloudUpdatedAtISO);
}

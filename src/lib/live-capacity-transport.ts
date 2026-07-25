export const MAX_CAPACITY_DIAGNOSTIC_BATCH_ENTRIES = 64;

export type CapacityDiagnosticEntryLike = {
  sequence?: unknown;
};

export type CapacityDiagnosticAcknowledgement = {
  ok?: boolean;
  sessionId?: string;
  batchId?: string | null;
  acceptedFirst?: number | null;
  acceptedThrough?: number | null;
  acceptedCount?: number;
};

const normalizeSequence = (value: unknown) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.max(0, Math.trunc(numericValue)) : 0;
};

export const readCapacityDiagnosticBatchSpan = (
  entries: CapacityDiagnosticEntryLike[],
) => ({
  firstSequence: entries.length > 0 ? normalizeSequence(entries[0]?.sequence) : 0,
  lastSequence: entries.length > 0
    ? normalizeSequence(entries[entries.length - 1]?.sequence)
    : 0,
  count: entries.length,
});

export const isCapacityDiagnosticAcknowledgementComplete = (
  acknowledgement: CapacityDiagnosticAcknowledgement,
  expected: {
    sessionId: string;
    batchId: string;
    entries: CapacityDiagnosticEntryLike[];
  },
) => {
  const span = readCapacityDiagnosticBatchSpan(expected.entries);
  return (
    acknowledgement.ok === true
    && acknowledgement.sessionId === expected.sessionId
    && acknowledgement.batchId === expected.batchId
    && acknowledgement.acceptedFirst === span.firstSequence
    && acknowledgement.acceptedThrough === span.lastSequence
    && acknowledgement.acceptedCount === span.count
  );
};

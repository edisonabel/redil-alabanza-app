export type GlobalAlignmentCandidate = {
  startSec: number;
  confidence: number;
  evidenceCount?: number;
  exactStart?: boolean;
  fingerprint?: string;
  [key: string]: unknown;
};

type AlignmentNode<T extends GlobalAlignmentCandidate> = {
  sectionIndex: number;
  candidate: T;
  score: number;
  previousNodeIndex: number;
};

type GlobalAlignmentOptions<T extends GlobalAlignmentCandidate> = {
  candidateSets: T[][];
  expectedStarts?: Array<number | null>;
  durationSec?: number | null;
};

const finiteOrNull = (value: unknown) => (
  Number.isFinite(Number(value)) ? Number(value) : null
);

const candidateEvidenceScore = (candidate: GlobalAlignmentCandidate) => {
  const confidence = Math.max(0, Math.min(1, Number(candidate.confidence) || 0));
  const evidenceCount = Math.max(1, Number(candidate.evidenceCount) || 1);
  return (
    confidence * 2.35
    + Math.min(4, evidenceCount) * 0.28
    + (candidate.exactStart ? 0.35 : 0)
  );
};

const expectedPositionPenalty = (
  startSec: number,
  expectedStartSec: number | null,
  durationSec: number | null,
) => {
  if (expectedStartSec == null || durationSec == null || durationSec <= 0) return 0;
  const normalizedDistance = Math.abs(startSec - expectedStartSec) / durationSec;
  return Math.min(1.15, normalizedDistance * 3.4);
};

const transitionScore = ({
  previousStartSec,
  currentStartSec,
  previousExpectedStartSec,
  currentExpectedStartSec,
  skippedSections,
}: {
  previousStartSec: number;
  currentStartSec: number;
  previousExpectedStartSec: number | null;
  currentExpectedStartSec: number | null;
  skippedSections: number;
}) => {
  const actualGap = currentStartSec - previousStartSec;
  if (!Number.isFinite(actualGap) || actualGap <= 0.45) return Number.NEGATIVE_INFINITY;

  let score = -(skippedSections * 0.92);
  if (previousExpectedStartSec == null || currentExpectedStartSec == null) return score;

  const expectedGap = Math.max(0.5, currentExpectedStartSec - previousExpectedStartSec);
  const minimumPlausibleGap = Math.max(0.65, Math.min(5, expectedGap * 0.16));
  if (actualGap < minimumPlausibleGap) return Number.NEGATIVE_INFINITY;

  const ratioPenalty = Math.abs(Math.log(Math.max(0.05, actualGap / expectedGap)));
  score -= Math.min(2.6, ratioPenalty * 0.92);
  return score;
};

/**
 * Selects one monotonically ordered occurrence per section using the complete song
 * sequence. Sections may be skipped when every candidate would force a bad path.
 */
export const alignSectionCandidateSequence = <T extends GlobalAlignmentCandidate>({
  candidateSets,
  expectedStarts = [],
  durationSec = null,
}: GlobalAlignmentOptions<T>): Array<T | null> => {
  const safeCandidateSets = Array.isArray(candidateSets) ? candidateSets : [];
  const result: Array<T | null> = safeCandidateSets.map(() => null);
  if (safeCandidateSets.length === 0) return result;

  const safeDuration = finiteOrNull(durationSec);
  const nodes: AlignmentNode<T>[] = [];

  safeCandidateSets.forEach((rawCandidates, sectionIndex) => {
    const candidates = (Array.isArray(rawCandidates) ? rawCandidates : [])
      .filter((candidate) => Number.isFinite(Number(candidate?.startSec)))
      .sort((left, right) => Number(left.startSec) - Number(right.startSec));

    candidates.forEach((candidate) => {
      const startSec = Number(candidate.startSec);
      const currentExpectedStart = finiteOrNull(expectedStarts[sectionIndex]);
      const nodeBaseScore = candidateEvidenceScore(candidate)
        - expectedPositionPenalty(startSec, currentExpectedStart, safeDuration);
      let bestScore = nodeBaseScore - (sectionIndex * 0.92);
      let previousNodeIndex = -1;

      for (let candidateNodeIndex = 0; candidateNodeIndex < nodes.length; candidateNodeIndex += 1) {
        const previousNode = nodes[candidateNodeIndex];
        if (previousNode.sectionIndex >= sectionIndex) continue;

        const transition = transitionScore({
          previousStartSec: Number(previousNode.candidate.startSec),
          currentStartSec: startSec,
          previousExpectedStartSec: finiteOrNull(expectedStarts[previousNode.sectionIndex]),
          currentExpectedStartSec: currentExpectedStart,
          skippedSections: sectionIndex - previousNode.sectionIndex - 1,
        });
        if (!Number.isFinite(transition)) continue;

        const score = previousNode.score + transition + nodeBaseScore;
        if (score > bestScore) {
          bestScore = score;
          previousNodeIndex = candidateNodeIndex;
        }
      }

      nodes.push({ sectionIndex, candidate, score: bestScore, previousNodeIndex });
    });
  });

  let bestFinalScore = -(safeCandidateSets.length * 0.92);
  let bestFinalNodeIndex = -1;
  nodes.forEach((node, nodeIndex) => {
    const trailingSkippedSections = safeCandidateSets.length - node.sectionIndex - 1;
    const finalScore = node.score - trailingSkippedSections * 0.92;
    if (finalScore > bestFinalScore) {
      bestFinalScore = finalScore;
      bestFinalNodeIndex = nodeIndex;
    }
  });

  let cursor = bestFinalNodeIndex;
  while (cursor >= 0) {
    const node = nodes[cursor];
    result[node.sectionIndex] = node.candidate;
    cursor = node.previousNodeIndex;
  }

  return result;
};

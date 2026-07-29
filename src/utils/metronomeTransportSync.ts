type MetronomeTransportAlignmentInput = {
  beatsPerMeasure?: number;
  minimumLeadSeconds?: number;
  subdivision?: number;
  tempo?: number;
  transportTimeSeconds?: number;
};

export const resolveMetronomeTransportAlignment = ({
  beatsPerMeasure = 4,
  minimumLeadSeconds = 0.05,
  subdivision = 1,
  tempo = 120,
  transportTimeSeconds = 0,
}: MetronomeTransportAlignmentInput = {}) => {
  const safeTempo = Math.max(1, Number.isFinite(tempo) ? tempo : 120);
  const safeSubdivision = Math.max(1, Math.round(Number.isFinite(subdivision) ? subdivision : 1));
  const safeBeatsPerMeasure = Math.max(
    1,
    Math.round(Number.isFinite(beatsPerMeasure) ? beatsPerMeasure : 4),
  );
  const safeTransportTime = Math.max(
    0,
    Number.isFinite(transportTimeSeconds) ? transportTimeSeconds : 0,
  );
  const safeLead = Math.max(
    0.01,
    Number.isFinite(minimumLeadSeconds) ? minimumLeadSeconds : 0.05,
  );
  const secondsPerPulse = 60 / safeTempo / safeSubdivision;
  const pulsesPerBar = safeBeatsPerMeasure * safeSubdivision;

  if (safeTransportTime <= 0.001) {
    return {
      delaySeconds: safeLead,
      pulseInBar: 0,
      secondsPerPulse,
    };
  }

  const nextAbsolutePulse = Math.ceil(
    (safeTransportTime + safeLead - Number.EPSILON) / secondsPerPulse,
  );
  const nextPulseTransportTime = nextAbsolutePulse * secondsPerPulse;

  return {
    delaySeconds: Math.max(safeLead, nextPulseTransportTime - safeTransportTime),
    pulseInBar: nextAbsolutePulse % pulsesPerBar,
    secondsPerPulse,
  };
};

export type MetronomeOutputRoute = 'stereo' | 'left' | 'right';

export const clampMetronomeVolume = (value: number): number => (
  Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1
);

export const connectMetronomeOutput = (
  sourceNode: Pick<AudioNode, 'connect'>,
  context: Pick<AudioContext, 'createChannelMerger' | 'destination'>,
  outputRoute: MetronomeOutputRoute,
): ChannelMergerNode | null => {
  if (outputRoute === 'stereo') {
    sourceNode.connect(context.destination);
    return null;
  }

  const routeMergerNode = context.createChannelMerger(2);
  const targetChannel = outputRoute === 'right' ? 1 : 0;
  sourceNode.connect(routeMergerNode, 0, targetChannel);
  routeMergerNode.connect(context.destination);
  return routeMergerNode;
};

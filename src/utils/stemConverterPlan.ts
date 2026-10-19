import { STEM_CATEGORIES, STEM_CATEGORY_ORDER, CONTROL_STEM_CATEGORIES, categorizeStemName, buildClassifiedStemFileName, type StemCategory } from './stemCategories.ts';

export const MAX_STEMS = 15;
export type PlanAction = 'keep' | 'merge' | 'skip';
export type StemStatus = 'queued' | 'processing' | 'done' | 'error';
export type SourceStem = { id: string; file: File; name: string; relativePath: string; size: number; category: StemCategory };
export type StemItem = {
  id: string;
  sources: SourceStem[];
  name: string;
  relativePath: string;
  size: number;
  status: StemStatus;
  progress: number;
  outputName?: string;
  outputSize?: number;
  error?: string;
  channelMode?: 'mono' | 'stereo';
  channelNote?: string;
  levelNote?: string;
};
export type SmartPlanGroup = { id: string; action: PlanAction; category: StemCategory; name: string; reason: string; sources: SourceStem[] };

export const sourceStemFromFile = (file: File, index: number): SourceStem => {
  const relativePath = file.webkitRelativePath || file.name;
  return { id: `${index}-${relativePath}-${file.size}-${file.lastModified}`, file, name: file.name, relativePath,
    size: file.size, category: categorizeStemName(file.name) };
};

export const canMergeStemGroup = (group: Pick<SmartPlanGroup, 'category' | 'sources'>) => (
  group.sources.length > 1 && !CONTROL_STEM_CATEGORIES.has(group.category)
  && !group.sources.some((source) => CONTROL_STEM_CATEGORIES.has(source.category)
    || CONTROL_STEM_CATEGORIES.has(categorizeStemName(source.name)))
);

export const getPlanReason = (category: StemCategory, sources: SourceStem[], action: PlanAction) => {
  if (action === 'skip') return 'Omitida por tu elección.';
  if (action === 'merge') return 'Se fusionarán únicamente las pistas de este grupo.';
  if (CONTROL_STEM_CATEGORIES.has(category)) return 'Click, guía y conteos siempre se exportan por separado.';
  if (category === 'unknown') return 'Elige una categoría o conserva el nombre original.';
  return sources.length > 1 ? 'Cada archivo conserva su propio canal.' : 'Instrumento en un canal independiente.';
};

export const buildSmartPlan = (sources: SourceStem[], previous: SmartPlanGroup[] = []): SmartPlanGroup[] => (
  STEM_CATEGORY_ORDER.flatMap((category) => {
    const bucket = sources.filter((source) => source.category === category);
    if (!bucket.length) return [];
    const id = `${category}-${bucket.map((source) => source.id).join('|')}`;
    // Only preserve a user's choice when the exact group membership is unchanged.
    const requestedAction = previous.find((group) => group.id === id)?.action || 'keep';
    const action = requestedAction === 'merge' && !canMergeStemGroup({ category, sources: bucket }) ? 'keep' : requestedAction;
    return [{ id, category, sources: bucket, action, name: STEM_CATEGORIES[category].label,
      reason: getPlanReason(category, bucket, action) }];
  })
);

export const getGroupOutputCount = (group: SmartPlanGroup) => (
  group.action === 'skip' ? 0 : group.action === 'merge' && canMergeStemGroup(group) ? 1 : group.sources.length
);
export const getPlanOutputCount = (groups: SmartPlanGroup[]) => groups.reduce((count, group) => count + getGroupOutputCount(group), 0);

export const planGroupsToStems = (groups: SmartPlanGroup[]): StemItem[] => {
  const output: StemItem[] = [];
  for (const group of groups) {
    if (group.action === 'skip') continue;
    const batches = group.action === 'merge' && canMergeStemGroup(group)
      ? [group.sources] : group.sources.map((source) => [source]);
    for (const sources of batches) {
      const name = sources.length > 1 ? group.name : sources[0].name;
      output.push({ id: `plan-${output.length}-${sources.map((source) => source.id).join('|')}`, sources, name,
        relativePath: sources.map((source) => source.relativePath).join(', '),
        size: sources.reduce((size, source) => size + source.size, 0), status: 'queued', progress: 0,
        outputName: buildClassifiedStemFileName(name, output.length, group.category) });
    }
  }
  return output;
};

export const rawSourcesToStems = (sources: SourceStem[]) => {
  if (sources.length > MAX_STEMS) throw new Error(`Elige hasta ${MAX_STEMS} salidas; no se omitirá ningún archivo automáticamente.`);
  return planGroupsToStems(buildSmartPlan(sources));
};

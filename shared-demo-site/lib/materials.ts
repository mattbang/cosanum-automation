/** Synthetic learning content only; no operational instructions or access grants. */
import materials from './demo-resources/v1/materials.json' with { type: 'json' };
export const MATERIALS = materials.map(item => ({
  topic: item.topic,
  duration: item.reading_duration,
  objective: item.objective,
  lesson: `/${item.lesson_path}`,
  preparation: `/${item.preparation_path}`,
}));

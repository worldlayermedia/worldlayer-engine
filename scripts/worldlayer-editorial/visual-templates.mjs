export const VISUAL_INTENTS = Object.freeze([
  'global_context', 'regional_context', 'location_reveal', 'close_approach',
  'orbit_location', 'route_overview', 'static_context', 'emphasis',
]);

export const templates = Object.freeze({
  global_context: { altitude: 12000000, flightDuration: 4, movements: [] },
  regional_context: { altitude: 2500000, flightDuration: 4, movements: [] },
  location_reveal: { altitude: 90000, flightDuration: 4, movements: [] },
  close_approach: { altitude: 15000, pitch: -55, flightDuration: 4, movements: [{ type: 'zoom', factor: 0.8, duration: 2, easing: 'easeOut' }] },
  orbit_location: { altitude: 25000, pitch: -55, flightDuration: 4, movements: [{ type: 'orbit', degrees: 35, duration: 3, easing: 'easeInOut' }] },
  route_overview: { altitude: 120000, flightDuration: 4, movements: [{ type: 'pan', horizontalMeters: 2000, duration: 2, easing: 'linear' }] },
  static_context: { altitude: 80000, flightDuration: 2, movements: [{ type: 'hold', duration: 2 }] },
  emphasis: { altitude: 35000, flightDuration: 3, movements: [{ type: 'zoom', factor: 0.9, duration: 2, easing: 'easeOut' }] },
});

export function selectVisualIntent(text, locationKey) {
  if (!locationKey) return /\b(but|however|why|crucial|important)\b/i.test(text) ? 'emphasis' : 'static_context';
  if (/\b(orbit|around|circle|surround)\b/i.test(text)) return 'orbit_location';
  if (/\b(route|corridor|connect|travel|path)\b/i.test(text)) return 'route_overview';
  if (/\b(close|street|beneath|ground|detail)\b/i.test(text)) return 'close_approach';
  if (/\b(world|globe|planet|global)\b/i.test(text)) return 'global_context';
  if (/\b(region|country|province|canada)\b/i.test(text)) return 'regional_context';
  return 'location_reveal';
}

export function sceneFromBeat(beat, coordinate, index) {
  const template = templates[beat.template];
  if (!template) throw new Error(`Worldlayer: unknown visual template "${beat.template}".`);
  return {
    id: `scene_${String(index + 1).padStart(2, '0')}`,
    name: beat.visualIntent.replaceAll('_', ' '),
    editorialBeatId: beat.id,
    camera: {
      longitude: coordinate.longitude, latitude: coordinate.latitude,
      altitude: template.altitude, flightDuration: template.flightDuration,
      ...(template.pitch === undefined ? {} : { pitch: template.pitch }),
    },
    movements: structuredClone(template.movements),
    timing: { mode: 'weighted', weight: beat.weight },
  };
}

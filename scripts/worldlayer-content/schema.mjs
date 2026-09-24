export const INTEGRITY_CATEGORIES = Object.freeze([
  'VERIFIED_FACT',
  'OBSERVED_DATA',
  'ESTIMATE',
  'VISUALIZATION',
  'ASSUMPTION',
  'SPECULATION',
]);
export const CLAIM_STATUSES = Object.freeze([
  'verified',
  'partially_supported',
  'unresolved',
  'excluded',
]);

function fail(message) {
  throw new Error(`Worldlayer: ${message}`);
}
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail(`${label} must be an object.`);
}
function string(value, label) {
  if (typeof value !== 'string' || !value.trim())
    fail(`${label} must be nonempty text.`);
}
function stringList(value, label) {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== 'string' || !item.trim())
  )
    fail(`${label} must be an array of nonempty strings.`);
}
function coordinates(value, label) {
  object(value, label);
  if (
    !Number.isFinite(value.longitude) ||
    value.longitude < -180 ||
    value.longitude > 180 ||
    !Number.isFinite(value.latitude) ||
    value.latitude < -90 ||
    value.latitude > 90
  )
    fail(`${label} needs valid longitude and latitude.`);
}

export function validateTopicBrief(brief) {
  object(brief, 'topic brief');
  if (brief.version !== '0.1') fail('topic brief version must be 0.1.');
  for (const field of ['title', 'language', 'angle', 'audience'])
    string(brief[field], `topic brief ${field}`);
  if (
    !Number.isFinite(brief.targetDurationSeconds) ||
    brief.targetDurationSeconds <= 0
  )
    fail('topic brief targetDurationSeconds must be positive.');
  object(brief.locations, 'topic brief locations');
  for (const [key, value] of Object.entries(brief.locations)) {
    if (!/^[a-zA-Z0-9_-]+$/.test(key)) fail(`invalid location key ${key}.`);
    coordinates(value, `topic brief location ${key}`);
  }
  for (const field of ['keyQuestions', 'exclusions', 'requiredPoints'])
    if (brief[field] !== undefined)
      stringList(brief[field], `topic brief ${field}`);
  return brief;
}

export function validateSource(source) {
  object(source, 'source');
  for (const field of ['id', 'title', 'publisher', 'sourceType'])
    string(source[field], `source ${field}`);
  if ((source.url === undefined) === (source.localReference === undefined))
    fail(`source ${source.id} needs exactly one URL or local reference.`);
  if (source.url !== undefined) {
    string(source.url, `source ${source.id} URL`);
    if (!/^https?:\/\//.test(source.url))
      fail(`source ${source.id} URL must be HTTP(S).`);
  }
  if (source.localReference !== undefined)
    string(source.localReference, `source ${source.id} localReference`);
  for (const field of ['publicationDate', 'accessedDate'])
    if (
      source[field] !== undefined &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(source[field]) ||
        Number.isNaN(Date.parse(source[field])))
    )
      fail(`source ${source.id} ${field} must be a date.`);
  return source;
}

export function validateClaim(claim, sourceIds) {
  object(claim, 'claim');
  string(claim.id, 'claim id');
  string(claim.text, `claim ${claim.id} text`);
  if (!CLAIM_STATUSES.includes(claim.status))
    fail(`claim ${claim.id} status is unsupported.`);
  if (!INTEGRITY_CATEGORIES.includes(claim.category))
    fail(`claim ${claim.id} integrity category is unsupported.`);
  stringList(claim.sourceIds, `claim ${claim.id} sourceIds`);
  for (const id of claim.sourceIds)
    if (!sourceIds.has(id))
      fail(`claim ${claim.id} references missing source ${id}.`);
  if (claim.status === 'verified' && !claim.sourceIds.length)
    fail(`verified claim ${claim.id} needs a source.`);
  return claim;
}

export function validateResearchPacket(packet) {
  object(packet, 'research packet');
  if (packet.version !== '0.1') fail('research packet version must be 0.1.');
  string(packet.topic, 'research topic');
  stringList(packet.researchQuestions, 'research questions');
  if (!Array.isArray(packet.sources) || !packet.sources.length)
    fail('research packet needs sources.');
  const sourceIds = new Set();
  for (const source of packet.sources) {
    validateSource(source);
    if (sourceIds.has(source.id)) fail(`duplicate source ${source.id}.`);
    sourceIds.add(source.id);
  }
  if (!Array.isArray(packet.claims) || !packet.claims.length)
    fail('research packet needs claims.');
  const claimIds = new Set();
  for (const claim of packet.claims) {
    validateClaim(claim, sourceIds);
    if (claimIds.has(claim.id)) fail(`duplicate claim ${claim.id}.`);
    claimIds.add(claim.id);
  }
  if (!Array.isArray(packet.findings))
    fail('research packet findings must be an array.');
  for (const finding of packet.findings) {
    object(finding, 'finding');
    string(finding.text, 'finding text');
    stringList(finding.claimIds, 'finding claimIds');
    for (const id of finding.claimIds)
      if (!claimIds.has(id)) fail(`finding references missing claim ${id}.`);
  }
  stringList(packet.uncertainties, 'research uncertainties');
  if (!Array.isArray(packet.suggestedVisuals))
    fail('research suggestedVisuals must be an array.');
  for (const visual of packet.suggestedVisuals) {
    object(visual, 'suggested visual');
    string(visual.description, 'suggested visual description');
    if (visual.locationKey !== undefined)
      string(visual.locationKey, 'suggested visual locationKey');
  }
  object(packet.provenance, 'research provenance');
  string(packet.provenance.provider, 'research provider');
  validateApproval(packet.approval);
  return packet;
}

export function validateClaimLedger(ledger, packet) {
  validateResearchPacket(packet);
  object(ledger, 'claim ledger');
  if (ledger.version !== '0.1' || ledger.topic !== packet.topic)
    fail('claim ledger version or topic does not match research packet.');
  if (
    !Array.isArray(ledger.claims) ||
    ledger.claims.length !== packet.claims.length
  )
    fail('claim ledger must contain every research claim.');
  for (const [index, claim] of ledger.claims.entries())
    if (JSON.stringify(claim) !== JSON.stringify(packet.claims[index]))
      fail(`claim ledger entry ${index} differs from research packet.`);
  return ledger;
}

export function validateApproval(approval) {
  object(approval, 'research approval');
  if (!['pending', 'approved'].includes(approval.status))
    fail('research approval status must be pending or approved.');
  if (approval.status === 'approved') {
    if (
      approval.scope !== 'development_fixture' ||
      approval.approvedBy !== 'explicit_fixture_opt_in'
    )
      fail(
        'research approval needs explicit development fixture authorization.',
      );
  }
  return approval;
}

export function approvedClaims(packet) {
  validateResearchPacket(packet);
  if (packet.approval.status !== 'approved')
    fail('research packet requires approval before script generation.');
  return packet.claims.filter(
    (claim) =>
      claim.status === 'verified' &&
      ['VERIFIED_FACT', 'OBSERVED_DATA'].includes(claim.category),
  );
}

export function validateScriptArtifact(script, packet) {
  validateResearchPacket(packet);
  object(script, 'script artifact');
  if (script.version !== '0.1') fail('script artifact version must be 0.1.');
  string(script.title, 'script title');
  string(script.text, 'script text');
  if (!Array.isArray(script.sections) || !script.sections.length)
    fail('script artifact needs sections.');
  const allowed = new Set(approvedClaims(packet).map((claim) => claim.id));
  for (const section of script.sections) {
    object(section, 'script section');
    string(section.text, 'script section text');
    stringList(section.claimIds, 'script section claimIds');
    if (!section.claimIds.length)
      fail('script section needs claim references.');
    for (const id of section.claimIds)
      if (!allowed.has(id))
        fail(`script references nonexistent or unusable claim ${id}.`);
  }
  if (
    script.text !== script.sections.map((section) => section.text).join('\n\n')
  )
    fail('script text must equal its ordered sections.');
  return script;
}

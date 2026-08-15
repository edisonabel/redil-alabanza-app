import { createHash, timingSafeEqual } from 'node:crypto';
import { readEnv } from './supabase-env.js';

export const REGISTRATION_TICKET_TTL_MINUTES = 15;

const normalizeCode = (value) => String(value || '').trim().toLocaleUpperCase('es');

const safeCodeMatch = (candidate, configuredCode) => {
  const expected = normalizeCode(configuredCode);
  if (!expected) return false;

  const candidateDigest = createHash('sha256').update(normalizeCode(candidate)).digest();
  const expectedDigest = createHash('sha256').update(expected).digest();
  return timingSafeEqual(candidateDigest, expectedDigest);
};

export const resolveRegistrationTarget = (rawCode) => {
  const generalCode = readEnv('REGISTRATION_CODE');
  const youthCode = readEnv('YOUTH_REGISTRATION_CODE', 'SIN_FILTROS_REGISTRATION_CODE');

  if (safeCodeMatch(rawCode, youthCode)) return 'sin_filtros';
  if (safeCodeMatch(rawCode, generalCode)) return 'general';
  return '';
};

export const getRequestActorAddress = (request) => String(
  request.headers.get('x-nf-client-connection-ip')
  || request.headers.get('cf-connecting-ip')
  || request.headers.get('x-forwarded-for')?.split(',')[0]
  || 'unknown',
).trim();

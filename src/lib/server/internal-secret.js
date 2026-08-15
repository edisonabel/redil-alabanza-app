import { timingSafeEqual } from 'node:crypto';

export const internalSecretsMatch = (received, expected) => {
  const receivedBuffer = Buffer.from(String(received || '').trim());
  const expectedBuffer = Buffer.from(String(expected || '').trim());

  return receivedBuffer.length > 0
    && receivedBuffer.length === expectedBuffer.length
    && timingSafeEqual(receivedBuffer, expectedBuffer);
};

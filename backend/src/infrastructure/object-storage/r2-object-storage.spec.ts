import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { R2ObjectStorage } from './r2-object-storage';

const SETTINGS = {
  accountId: '0123456789abcdef0123456789abcdef',
  bucket: 'hoanglong-evidence',
  accessKeyId: 'AKIDEXAMPLE0123456789',
  secretAccessKey: 's'.repeat(64),
};

const drain = async (stream: Readable): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks).toString();
};

/**
 * The R2 adapter, against a stubbed `fetch` — no network. What it proves: the
 * request goes to the account's private bucket, is SigV4-signed by aws4fetch
 * (never by hand), carries the content type, and a failure is an error that
 * names a status and never a credential.
 */
describe('R2ObjectStorage', () => {
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  it('PUTs to the private bucket with a SigV4 signature over the payload, and the content type', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

    await new R2ObjectStorage(SETTINGS).put('fuel-evidence/abc', Buffer.from('jpeg'), 'image/jpeg');

    const request = fetchMock.mock.calls[0][0] as Request;
    expect(request.method).toBe('PUT');
    expect(request.url).toBe(
      'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/hoanglong-evidence/fuel-evidence/abc',
    );
    expect(request.headers.get('authorization')).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE0123456789\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=.*, Signature=[0-9a-f]{64}$/,
    );
    // The payload is inside the signature, not UNSIGNED-PAYLOAD.
    expect(request.headers.get('x-amz-content-sha256')).toBe(createHash('sha256').update('jpeg').digest('hex'));
    expect(request.headers.get('authorization')).toContain('x-amz-content-sha256');
    expect(request.headers.get('content-type')).toBe('image/jpeg');
  });

  it('streams a GET back as a Node stream', async () => {
    fetchMock.mockResolvedValue(new Response('image bytes', { status: 200 }));
    expect(await drain(await new R2ObjectStorage(SETTINGS).get('fuel-evidence/abc'))).toBe('image bytes');
  });

  it('fails a refused write with the status — and without any secret in the message', async () => {
    fetchMock.mockResolvedValue(new Response('denied', { status: 403 }));
    const failure = new R2ObjectStorage(SETTINGS).put('fuel-evidence/abc', Buffer.from('x'), 'image/png');
    await expect(failure).rejects.toThrow('Object storage refused the write (403).');
    await expect(failure).rejects.not.toThrow(SETTINGS.secretAccessKey);
  });

  it('retries a 5xx at most twice — not aws4fetch’s default of ten', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));
    await expect(new R2ObjectStorage(SETTINGS).get('fuel-evidence/abc')).rejects.toThrow('(503)');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('refuses an unsafe key before any request is signed', async () => {
    await expect(new R2ObjectStorage(SETTINGS).get('../other-bucket/x')).rejects.toThrow(/unsafe/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

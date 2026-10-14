// Unit spec — AWS Signature Version 4 (src/terminal/backends/sigv4.ts)
//
// Vectors: the AWS-documented "GET Object" example (host examplebucket,
// range header, 20130524) — the canonical request and final signature are
// the published values; the example secret is the documented
// wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY. The PUT vector's signature is
// cross-derived independently with openssl + python hmac against the same
// canonical shape, so a bug in the module under test cannot pass itself.

import { describe, expect, it } from 'vitest';
import { deriveSigningKey, sigv4Headers } from '../../src/terminal/backends/sigv4.js';

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const AKID = 'AKIAIOSFODNN7EXAMPLE';
const SECRET = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';

describe('the published GET example', () => {
  it('reproduces the AWS signature byte-for-byte', async () => {
    const headers = await sigv4Headers({
      method: 'GET',
      url: 'https://examplebucket.s3.amazonaws.com/test.txt',
      headers: { range: 'bytes=0-9' },
      accessKeyId: AKID,
      secretAccessKey: SECRET,
      region: 'us-east-1',
      amzDate: '20130524T000000Z',
      payloadHash: EMPTY_SHA256,
    });
    expect(headers.Authorization).toBe(
      `AWS4-HMAC-SHA256 Credential=${AKID}/20130524/us-east-1/s3/aws4_request, ` +
        'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ' +
        'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
    expect(headers['x-amz-date']).toBe('20130524T000000Z');
    expect(headers['x-amz-content-sha256']).toBe(EMPTY_SHA256);
    expect(headers['x-amz-security-token']).toBeUndefined();
  });
});

describe('a PUT with body and extra signed headers', () => {
  it('signs the body hash and merges extra headers (cross-derived vector)', async () => {
    const body = 'Welcome to Amazon S3.';
    const headers = await sigv4Headers({
      method: 'PUT',
      url: 'https://examplebucket.s3.amazonaws.com/test.txt',
      headers: { 'content-type': 'text/plain', 'x-amz-storage-class': 'REDUCED_REDUNDANCY' },
      body,
      accessKeyId: AKID,
      secretAccessKey: SECRET,
      region: 'us-east-1',
      amzDate: '20130524T000000Z',
    });
    // sha256('Welcome to Amazon S3.') — the AWS-documented payload hash.
    expect(headers['x-amz-content-sha256']).toBe(
      '44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072',
    );
    // Cross-derived (openssl + python hmac) for this canonical request.
    expect(headers.Authorization).toBe(
      `AWS4-HMAC-SHA256 Credential=${AKID}/20130524/us-east-1/s3/aws4_request, ` +
        'SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class, ' +
        'Signature=faf3f28f9a7b3b69ba27732f45706e687fcea69022d9f0ede2d3c9c62c674a2a',
    );
  });

  it('signs the session token as x-amz-security-token', async () => {
    const headers = await sigv4Headers({
      method: 'GET',
      url: 'https://examplebucket.s3.amazonaws.com/',
      accessKeyId: AKID,
      secretAccessKey: SECRET,
      sessionToken: 'st-example-token',
      region: 'us-east-1',
      amzDate: '20130524T000000Z',
      payloadHash: EMPTY_SHA256,
    });
    expect(headers['x-amz-security-token']).toBe('st-example-token');
    expect(headers.Authorization).toContain('SignedHeaders=host;x-amz-content-sha256;x-amz-date;x-amz-security-token');
  });
});

describe('canonicalization', () => {
  it('query order does not change the signature', async () => {
    const make = (search: string) =>
      sigv4Headers({
        method: 'GET',
        url: `https://examplebucket.s3.amazonaws.com/${search}`,
        accessKeyId: AKID,
        secretAccessKey: SECRET,
        region: 'us-east-1',
        amzDate: '20130524T000000Z',
        payloadHash: EMPTY_SHA256,
      });
    const [one, two] = await Promise.all([make('?b=1&a=2'), make('?a=2&b=1')]);
    expect(one.Authorization).toBe(two.Authorization); // canonical order inside
  });

  it('the signing key is 32 bytes', async () => {
    const key = await deriveSigningKey(SECRET, '20130524', 'us-east-1', 's3');
    expect(key).toHaveLength(32);
  });
});

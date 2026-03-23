const request = require('supertest');
const app = require('../src/app');
const path = require('path');
const fs = require('fs');

describe('API Tests', () => {

  describe('GET /api/health', () => {
    it('should return health status', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body).toHaveProperty('timestamp');
      expect(res.body).toHaveProperty('system');
      expect(res.body).toHaveProperty('storage');
      expect(res.body.storage).toHaveProperty('type');
      expect(res.body).toHaveProperty('videos');
    });
  });

  describe('GET /api/videos', () => {
    it('should return empty list initially', async () => {
      const res = await request(app).get('/api/videos');
      expect(res.status).toBe(200);
      expect(res.body.videos).toEqual([]);
      expect(res.body.pagination).toBeDefined();
      expect(res.body.pagination.total).toBe(0);
    });

    it('should support query parameters', async () => {
      const res = await request(app).get('/api/videos?search=test&category=kubernetes&page=1&limit=10');
      expect(res.status).toBe(200);
      expect(res.body.videos).toBeInstanceOf(Array);
    });
  });

  describe('GET /api/categories', () => {
    it('should return categories list', async () => {
      const res = await request(app).get('/api/categories');
      expect(res.status).toBe(200);
      expect(res.body).toBeInstanceOf(Array);
    });
  });

  describe('GET /api/videos/:id', () => {
    it('should return 404 for non-existent video', async () => {
      const res = await request(app).get('/api/videos/non-existent-id');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Video not found');
    });
  });

  describe('PUT /api/videos/:id', () => {
    it('should return 404 for non-existent video', async () => {
      const res = await request(app)
        .put('/api/videos/non-existent-id')
        .send({ title: 'Updated Title' });
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/videos/:id', () => {
    it('should return 404 for non-existent video', async () => {
      const res = await request(app).delete('/api/videos/non-existent-id');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/videos/presign', () => {
    it('should return 503 when R2 is not configured', async () => {
      const res = await request(app)
        .post('/api/videos/presign')
        .send({ filename: 'test.mp4' });
      expect(res.status).toBe(503);
    });

    it('should reject requests without a filename', async () => {
      const res = await request(app)
        .post('/api/videos/presign')
        .send({});
      // Either 400 (no filename) or 503 (R2 not configured) is acceptable
      expect([400, 503]).toContain(res.status);
    });
  });

  describe('POST /api/videos/register', () => {
    it('should reject requests without id and s3Key', async () => {
      const res = await request(app)
        .post('/api/videos/register')
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('id and s3Key are required');
    });
  });

  describe('POST /api/videos/download', () => {
    it('should reject requests without a URL', async () => {
      const res = await request(app)
        .post('/api/videos/download')
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('URL is required');
    });
  });
});

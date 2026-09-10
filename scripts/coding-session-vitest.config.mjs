export default {
  cacheDir: '/tmp/origin-vite-cache',
  test: {
    environment: 'node',
    maxWorkers: 1,
    include: ['src/agent/codingSessionV14.test.ts'],
  },
};

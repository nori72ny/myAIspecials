export default {
  cacheDir: '/tmp/origin-vite-cache',
  test: {
    environment: 'node',
    maxWorkers: 1,
    include: ['src/agent/codingSessionV14.test.ts', 'src/agent/codingPlannerV14.test.ts'],
  },
};

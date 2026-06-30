module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/api/**/*.test.ts', '**/tests/integration/**/*.test.ts'],
  collectCoverage: true,
  coverageDirectory: 'coverage/jest',
  coverageReporters: ['json', 'lcov', 'text', 'clover', 'html'],
  reporters: [
    'default',
    ['jest-junit', { outputDirectory: 'results', outputName: 'jest-results.xml' }],
    ['jest-html-reporter', { pageTitle: 'ACOS 2.0 API Test Report', outputPath: 'results/jest-report.html' }]
  ],
  testTimeout: 120000
};

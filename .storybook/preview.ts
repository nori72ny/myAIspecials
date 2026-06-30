import type { Preview } from "@storybook/react";
import "../src/index.css"; // Global Tailwind imports

const preview: Preview = {
  parameters: {
    actions: { argTypesRegex: "^on[A-Z].*" },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      default: 'dark',
      values: [
        { name: 'light', value: '#f8fafc' },
        { name: 'dark', value: '#08080c' },
      ],
    },
  },
};

export default preview;
